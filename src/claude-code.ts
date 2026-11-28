// The Claude Code runtime: crew members run on YOUR Claude subscription, through the Claude Code
// CLI installed on this computer and signed in with your Claude account (Pro or Max).
//
// - The Agent SDK drives `claude` (the same pattern as the Adventurer's Guild). No API key reaches
//   it: ANTHROPIC_API_KEY and friends are stripped, so it can't bill the API by accident.
// - The camp keeps its own system prompt (identity, crew, boundaries, memory, sessions, skills).
//   Your own Claude Code settings, hooks, CLAUDE.md, skills, and MCP servers are not loaded, and
//   nothing is saved as a Claude Code session.
// - Claude Code's built-in file and shell tools are switched off. The camp's own tools (dispatch,
//   remember, read/edit/grep/glob, bash with approvals, wiki, skills, jobs, connectors…) are served
//   to it from an in-process MCP server, so every camp boundary and approval still applies. Only
//   web search and fetch come from Claude Code's built-ins (for the Scout).
// - Usage counts against your plan's limits. Claude Code reports what it would have cost on the
//   API; the camp shows that as an estimate and uses it for budgets.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import type Anthropic from "@anthropic-ai/sdk";
import type { Options, SDKMessage, SDKUserMessage, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spillOutput } from "./spill.js";
import { clipOutput, steerNote, wrapUpNote, type Tool, type ToolOutput } from "./tools.js";
import type { Steering } from "./context.js";
import { w } from "./words.js";
import type { RequestContent } from "./attachments.js";
import { costOf } from "./costs.js";
import { noteCredit, noteRateLimit, noteUsage, pausedUntil, pauseMessage, type UsageWindow } from "./limits.js";
import { claudeOnWindows, isWindows } from "./platform.js";

const run = promisify(execFile);
export const LOGIN_HELP = "Run `claude auth login` in a terminal and sign in with your Claude account (Pro or Max), then try again.";

// Server tools in the camp's definitions map to Claude Code's own built-ins.
const BUILTIN_FOR: Record<string, string> = { web_search: "WebSearch", web_fetch: "WebFetch" };
const MCP_PREFIX = "mcp__camp__";

export function claudeExecutable(env = process.env) {
  return env.CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
}
// How it's started on this system. Everywhere but Windows that's just its name. On Windows
// "claude" may be a script that only runs through a shell (see claudeOnWindows in platform.ts):
// run is how to ask it a one-line question, sdk is what the Agent SDK is told (nothing: its own copy).
function claudeStart(): { run: { file: string; shell: boolean }; sdk: { pathToClaudeCodeExecutable?: string } } {
  const name = claudeExecutable();
  if (!isWindows) return { run: { file: name, shell: false }, sdk: { pathToClaudeCodeExecutable: name } };
  const w = claudeOnWindows(name);
  return { run: w.run, sdk: w.path ? { pathToClaudeCodeExecutable: w.path } : {} };
}

// The environment for the CLI: everything but API credentials (so it uses your login).
function cliEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL|PROFILE)$/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
}

// ---------- Login check (cached for 5 minutes) ----------
export type LoginStatus = { ok: boolean; problem?: string; plan?: string; version?: string };
let loginCache: { at: number; status: LoginStatus } | null = null;

export async function claudeLogin(force = false): Promise<LoginStatus> {
  if (!force && loginCache && Date.now() - loginCache.at < 5 * 60_000) return loginCache.status;
  const exe = claudeExecutable();
  let status: LoginStatus;
  try {
    const { file, shell } = claudeStart().run;
    const version = (await run(file, ["--version"], { env: cliEnv(), timeout: 30_000, shell, windowsHide: true })).stdout.trim().split("\n")[0];
    const raw = (await run(file, ["auth", "status", "--json"], { env: cliEnv(), timeout: 30_000, shell, windowsHide: true })).stdout;
    const s = JSON.parse(raw.trim() || "{}");
    const keyed = typeof s.apiKeySource === "string" && s.apiKeySource !== "none";
    const thirdParty = typeof s.apiProvider === "string" && s.apiProvider !== "firstParty";
    status = !s.loggedIn
      ? { ok: false, problem: `Claude Code isn't signed in. ${LOGIN_HELP}`, version }
      : keyed
        ? { ok: false, problem: `Claude Code is signed in with an API key (${s.apiKeySource}), which bills the API, not your subscription. ${LOGIN_HELP}`, version }
        : thirdParty
          ? { ok: false, problem: `Claude Code is set up for ${s.apiProvider}, not a Claude account. ${LOGIN_HELP}`, version }
          : { ok: true, plan: typeof s.subscriptionType === "string" ? s.subscriptionType : undefined, version };
  } catch (e: any) {
    status = e?.code === "ENOENT"
      ? { ok: false, problem: `Claude Code isn't installed (looked for "${exe}"). Install it (npm install -g @anthropic-ai/claude-code), or set CLAUDE_CODE_EXECUTABLE.` }
      : { ok: false, problem: `Couldn't check Claude Code's sign-in: ${e?.message ?? e}` };
  }
  loginCache = { at: Date.now(), status };
  return status;
}

// ---------- The camp's tools, served to Claude Code ----------
function toMcpContent(out: ToolOutput) {
  if (typeof out === "string") return [{ type: "text" as const, text: out }];
  return out.map((b: any) => {
    if (b.type === "text") return { type: "text" as const, text: b.text };
    if (b.type === "image" && b.source?.type === "base64") return { type: "image" as const, data: b.source.data, mimeType: b.source.media_type };
    if (b.type === "document") return { type: "text" as const, text: "[A PDF was attached. PDFs can't be shown on the Claude Code runtime; read its text another way or ask the user.]" };
    return { type: "text" as const, text: JSON.stringify(b).slice(0, 2000) };
  });
}

// Tools Claude Code may run at the same time when the model calls several in one turn. It runs
// tools one after another unless they're marked read-only, so without this two quests sent
// together set out in a queue, and five file reads are five round trips. dispatch is on the list
// because quests are built to run side by side (the camp's own limit on quests at once still
// holds); the rest only read. Anything that writes, runs a command, or asks you stays one at a time.
export const SIDE_BY_SIDE = new Set(["dispatch", "dispatch_helper", "read_file", "view_file", "list_dir", "glob", "grep", "outline", "git", "pull_request", "recall", "jira"]);

// An MCP server (inside this process) exposing the agent's camp tools. Handlers run in the
// run's own context, so budgets, quests, and Stop work across tool calls.
function campServer(tools: Tool[], inContext: <R>(fn: () => R) => R, note: () => string | null = () => null, spillAs?: string): McpSdkServerConfigWithInstance {
  const server = new McpServer({ name: "camp", version: "1.0.0" }, { capabilities: { tools: {} } });
  const handlers = new Map<string, NonNullable<Tool["run"]>>();
  const listed: { name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint: true } }[] = [];
  for (const t of tools) {
    if (!t.run || !("name" in t.def) || !("input_schema" in t.def)) continue;
    handlers.set(t.def.name, t.run);
    listed.push({ name: t.def.name, description: t.def.description, inputSchema: t.def.input_schema as Record<string, unknown>,
      ...(SIDE_BY_SIDE.has(t.def.name) ? { annotations: { readOnlyHint: true as const } } : {}) });
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed as any }));
  server.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const handler = handlers.get(req.params.name);
    if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
    try {
      const out = await inContext(() => handler(req.params.arguments ?? {}));
      const extra = note(); // a heads-up near the turn limit rides along with the result
      return { content: [...toMcpContent(spillAs ? spillOutput(out, spillAs) : clipOutput(out)), ...(extra ? [{ type: "text" as const, text: extra }] : [])] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err?.stderr || err?.message || err}` }], isError: true };
    }
  });
  return { type: "sdk", name: "camp", instance: server };
}

// ---------- One run ----------
export type ClaudeCodeRun = {
  model: string;
  effort?: string;
  system: string;
  task: RequestContent;
  tools: Tool[];
  maxTurns: number;
  budgetLeftUsd?: number;          // remaining expedition budget, if any
  signal?: AbortSignal;
  messages: Anthropic.MessageParam[]; // the transcript, filled in as the run goes
  onMessage?: () => void;          // called after each message is added to it (the run is saved as it goes: runstore.ts)
  spillAs?: string;                // whose long tool output this is: it goes to camp/spill/ for them (spill.ts) instead of being cut
  onDelta: (text: string) => void;
  onText: (text: string) => void;
  onTool: (name: string, input: unknown) => void;
  onNotice?: (text: string) => void; // something worth a line in the feed (a model declined, another carried on)
  // Called after each model reply with what it cost (an estimate at API prices), so the
  // expedition's shared budget is current while the run is still going.
  onSpend?: (usd: number) => void;
  overBudget?: () => boolean;      // checked after each reply; true ends the run
  steering?: Steering;             // what the user says to the expedition while it runs
  // A narrower door: called with each tool's full name before it runs; a string refuses it with that message.
  // (A learning review keeps the run's whole tool list, so the prompt matches, and answers only its own few.)
  mayUse?: (name: string) => string | null;
  // A run that uses all maxTurns without finishing may carry on in the same session, with what it
  // has read and done still in its context, up to `times` more allowances of maxTurns. next(n) is
  // called as allowance n (1-based) begins and returns what the model is told; the caller says so
  // in the feed there too. Left out, running out of turns ends the run, as it always did.
  carryOn?: { times: number; next: (n: number) => string };
};

export type ClaudeCodeResult = {
  status: "done" | "out_of_turns" | "over_budget" | "stopped";
  text: string;
  turns: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  spentLive: number;               // how much of costUsd was already reported through onSpend
};

// A run that failed part-way still used tokens: the error carries what it had spent.
export type ClaudeCodeFailure = Error & { partial?: Pick<ClaudeCodeResult, "text" | "turns" | "usage" | "costUsd" | "spentLive"> };

// Tests swap in a fake `query` (Claude Code itself can't run in the test suite).
type QueryFn = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;
let queryOverride: QueryFn | null = null;
export function useQueryForTests(fn: QueryFn | null) {
  queryOverride = fn;
  loginCache = null;
}

export async function runClaudeCode(r: ClaudeCodeRun): Promise<ClaudeCodeResult> {
  const login = await claudeLogin();
  if (!login.ok) throw new Error(login.problem);
  const query: QueryFn = queryOverride ?? ((await import("@anthropic-ai/claude-agent-sdk")).query as unknown as QueryFn);

  const inContext = AsyncLocalStorage.snapshot(); // this run's budget, quest, and Stop signal
  const builtins = r.tools.flatMap((t) => (!t.run && "name" in t.def && BUILTIN_FOR[t.def.name] ? [BUILTIN_FOR[t.def.name]] : []));
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  r.signal?.addEventListener("abort", onAbort, { once: true });

  // Streaming input keeps the session open for MCP tool calls; we close it when the result arrives.
  let finished!: () => void;
  const done = new Promise<void>((ok) => (finished = ok));
  const first: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: r.task as any },
    parent_tool_use_id: null,
  } as SDKUserMessage;
  // After the task, anything the user says to the running expedition is passed in as it arrives.
  const asUser = (content: any): SDKUserMessage => ({ type: "user", message: { role: "user", content }, parent_tool_use_id: null } as SDKUserMessage);
  // Messages the run itself sends into the open session (the word to carry on after a turn limit).
  const queued: SDKUserMessage[] = [];
  let poke: (() => void) | undefined;
  const send = (m: SDKUserMessage) => { queued.push(m); poke?.(); };
  async function* prompt() {
    yield first;
    const s = r.steering;
    let seen = s?.messages.length ?? 0;
    for (;;) {
      if (queued.length) { yield queued.shift()!; continue; }
      let wake: (() => void) | undefined;
      const said = s ? new Promise<"said">((ok) => { wake = () => ok("said"); s.waiters.add(wake); }) : new Promise<"said">(() => {});
      const more = new Promise<"more">((ok) => { poke = () => ok("more"); });
      const what = s && s.messages.length > seen ? "said" : await Promise.race([done.then(() => "done" as const), said, more]);
      poke = undefined;
      if (wake) s!.waiters.delete(wake);
      if (what === "more") continue;
      if (what === "done" || !s) return;
      const fresh = s.messages.slice(seen).map((m) => m.text);
      seen = s.messages.length;
      if (fresh.length) yield asUser(steerNote(fresh));
    }
  }
  const times = Math.max(0, r.carryOn?.times ?? 0);
  let carried = 0;     // how many more allowances of turns this run has been given so far
  let allowanceFrom = 0; // the reply count the current allowance began at
  let noted = 0; // the turn count the last wrap-up note was given at
  const turnNote = () => {
    // With another allowance to come, a note to wrap up would have the run stop where it could carry on.
    if (carried < times) return null;
    const left = r.maxTurns - (replies.size - allowanceFrom);
    if (r.maxTurns < 6 || left === noted) return null;
    const note = wrapUpNote(left);
    if (note) noted = left;
    return note;
  };

  const options: Options = {
    abortController: abort,
    cwd: process.cwd(),
    ...claudeStart().sdk,
    model: r.model,
    ...(r.effort ? { effort: r.effort as Options["effort"] } : {}),
    systemPrompt: r.system,
    tools: builtins,                                  // only web search/fetch, if any
    mcpServers: { camp: campServer(r.tools, inContext, turnNote, r.spillAs) },
    canUseTool: async (name, input) => {
      const refused = r.mayUse?.(name);
      if (refused) return { behavior: "deny", message: refused };
      return name.startsWith(MCP_PREFIX) || builtins.includes(name)
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: `That tool isn't available in the ${w("camp")}. Use the ${w("camp")}'s own tools (mcp__camp__…).` };
    },
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    includePartialMessages: true,
    maxTurns: r.maxTurns,
    ...(r.budgetLeftUsd != null ? { maxBudgetUsd: Math.max(0.01, r.budgetLeftUsd) } : {}),
    env: cliEnv(),
  };

  let text = "";
  type Result = Extract<SDKMessage, { type: "result" }>;
  let resultMsg: Result | null = null;
  const results: Result[] = []; // one for each turn of the session: more than one when the run carried on
  // The turn limit it was carrying on from, when the session ended before a word of the next
  // allowance: the run ran out of turns. (One that broke off part-way through it is a failure.)
  const lastOutOfTurns = (): Result | null => (carried && results.at(-1)?.subtype === "error_max_turns" && replies.size === allowanceFrom ? results.at(-1)! : null);
  let budgetStop = false;
  // Usage so far, by model reply (a reply can arrive in several pieces with the same id and usage).
  const replies = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>();
  let spentLive = 0;
  const soFar = () => {
    const usage = zero();
    for (const u of replies.values()) { usage.input += u.input; usage.output += u.output; usage.cacheRead += u.cacheRead; usage.cacheWrite += u.cacheWrite; }
    return { text, turns: replies.size, usage, costUsd: spentLive, spentLive };
  };
  const noteUsage = (message: any) => {
    const u = message?.usage;
    if (!message?.id || !u) return;
    const before = replies.get(message.id);
    const now = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    replies.set(message.id, now);
    const delta = costOf(r.model, now) - (before ? costOf(r.model, before) : 0);
    if (delta > 0) { spentLive += delta; r.onSpend?.(delta); }
    if (r.overBudget?.() && !abort.signal.aborted) { budgetStop = true; abort.abort(); }
  };
  const stopped = (): ClaudeCodeResult => budgetStop
    ? { ...soFar(), status: "over_budget", text: text + `\n\n[Stopped: this ${w("expedition")} reached its budget.]` }
    : { ...soFar(), status: "stopped", text: text + "\n\n[Stopped by the user.]" };
  try {
    for await (const m of query({ prompt: prompt(), options })) {
      if (m.type === "rate_limit_event") {
        noteRateLimit(m.rate_limit_info);
      } else if (m.type === "system" && ((m as any).subtype === "model_refusal_fallback" || (m as any).subtype === "model_refusal_no_fallback")) {
        // Claude Code's own handling of a model that declines: it may retry on another model, or not.
        // Either way the feed says what it reported. (Whether it retries is its decision, not the camp's.)
        const s = m as any;
        const why = s.api_refusal_category ? ` (${String(s.api_refusal_category).replace(/_/g, " ")})` : "";
        r.onNotice?.(s.subtype === "model_refusal_fallback"
          ? `↪️ ${s.original_model ?? r.model} declined this request${why}; ${s.fallback_model ?? "another model"} carried on.`
          : `🚫 ${s.original_model ?? r.model} declined this request${why}, and no other model took it up.`);
      } else if (m.type === "stream_event" && !m.parent_tool_use_id) {
        const ev: any = m.event;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") r.onDelta(ev.delta.text);
      } else if (m.type === "assistant" && !m.parent_tool_use_id) {
        const blocks = (m.message.content ?? []) as any[];
        r.messages.push({ role: "assistant", content: blocks.filter((b) => b.type !== "thinking") });
        r.onMessage?.();
        for (const b of blocks) {
          if (b.type === "text" && b.text.trim()) { text = b.text.trim(); r.onText(text); }
          if (b.type === "tool_use") r.onTool(String(b.name).replace(MCP_PREFIX, ""), b.input);
        }
        noteUsage(m.message);
      } else if (m.type === "user" && !m.parent_tool_use_id && Array.isArray(m.message.content)) {
        r.messages.push({ role: "user", content: m.message.content as any });
        r.onMessage?.();
      } else if (m.type === "result") {
        results.push(m);
        // Out of turns with an allowance to spare: the session is still open (a streaming session
        // ends a turn with a result and waits for the next message), so the run is told to carry
        // on in it rather than ending and being briefed again from nothing.
        if (m.subtype === "error_max_turns" && carried < times && !abort.signal.aborted && !r.overBudget?.()) {
          carried++;
          allowanceFrom = replies.size;
          noted = 0;
          send(asUser(r.carryOn!.next(carried)));
          continue;
        }
        resultMsg = m;
        finished();
      }
    }
  } catch (err: any) {
    finished();
    if (abort.signal.aborted) return stopped();
    // Claude Code exits with an error after a result that isn't a success ("Claude Code returned an
    // error result: Reached maximum budget"). The result already says what happened, and it's read
    // below, so reaching a budget or running out of turns ends the run cleanly, not as a failure.
    // That includes a session that closed after its turn limit when it was asked to carry on.
    resultMsg ??= lastOutOfTurns();
    if (!resultMsg) throw failure(err, soFar());
  } finally {
    finished();
    r.signal?.removeEventListener("abort", onAbort);
    void refreshPlanUsage(); // the run used some of your plan: read how full its windows are now
  }

  if (abort.signal.aborted) return stopped();
  resultMsg ??= lastOutOfTurns();
  if (!resultMsg) throw failure(new Error("Claude Code ended without a result."), soFar());
  // A streaming session reports usage and turns per turn of its own (one per message it was sent),
  // so a run that carried on adds them up; its cost is a running total, so the last one is the whole.
  const usage = zero();
  let turns = 0;
  for (const res of results) {
    const u = res.usage as any;
    usage.input += u?.input_tokens ?? 0;
    usage.output += u?.output_tokens ?? 0;
    usage.cacheRead += u?.cache_read_input_tokens ?? 0;
    usage.cacheWrite += u?.cache_creation_input_tokens ?? 0;
    turns += res.num_turns ?? 0;
  }
  const base = { turns, usage, costUsd: resultMsg.total_cost_usd ?? spentLive, spentLive };
  if (resultMsg.subtype === "success" && !resultMsg.is_error) return { ...base, status: "done", text: (resultMsg.result || text).trim() };
  if (resultMsg.subtype === "error_max_turns") return { ...base, status: "out_of_turns", text }; // agent.ts adds the note
  if (resultMsg.subtype === "error_max_budget_usd") return { ...base, status: "over_budget", text: text + `\n\n[Stopped: this ${w("expedition")} reached its budget.]` };
  const why = ("errors" in resultMsg ? resultMsg.errors : []).join("; ") || ("result" in resultMsg && resultMsg.result) || resultMsg.subtype;
  throw failure(new Error(`Claude Code stopped with an error: ${why}`), { ...base, text });
}

// If the plan's usage limit is why it failed, say that (and when it resets) instead of a raw error.
function failure(err: any, partial: ClaudeCodeFailure["partial"]): ClaudeCodeFailure {
  const until = pausedUntil();
  const e: ClaudeCodeFailure = until ? new Error(pauseMessage(until)) : err instanceof Error ? err : new Error(String(err));
  e.partial = partial;
  return e;
}

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

// A single question with no tools (the eval judge, on the subscription).
export async function askClaudeCode(system: string, prompt: string, model: string): Promise<{ text: string; costUsd: number }> {
  const r = await runClaudeCode({
    model, system, task: prompt, tools: [], maxTurns: 1, messages: [],
    onDelta: () => {}, onText: () => {}, onTool: () => {},
  });
  return { text: r.text, costUsd: r.costUsd };
}

// ---------- Models your subscription can use ----------
// ---------- Your plan's usage ----------
// What Claude Code's `/usage` shows, as windows the camp understands. Percentages there are 0–100.
export function usageWindows(rate: any): UsageWindow[] {
  if (!rate || typeof rate !== "object") return [];
  const out: UsageWindow[] = [];
  const add = (type: string, w: any) => {
    if (!w || typeof w.utilization !== "number") return;
    const at = w.resets_at ? Date.parse(w.resets_at) : NaN;
    out.push({ type, utilization: w.utilization / 100, ...(Number.isFinite(at) ? { resetsAt: at } : {}) });
  };
  for (const type of ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"]) add(type, rate[type]);
  // A weekly limit of its own for one model, named as your plan names it.
  for (const m of Array.isArray(rate.model_scoped) ? rate.model_scoped : []) {
    const name = String(m?.display_name ?? "").replace(/[^\w .-]/g, "").trim().slice(0, 30);
    if (name) add(`model:${name}`, m);
  }
  return out;
}

// Reads your plan's usage from Claude Code and notes it. Like the model list, it opens a session
// and closes it without sending a message, so it uses none of your plan. At most once a minute;
// never throws (the meter just keeps what it had). Returns whether it got figures.
let usageAsked = 0;
let usageInFlight: Promise<boolean> | null = null;
export function refreshPlanUsage(force = false): Promise<boolean> {
  if (queryOverride) return Promise.resolve(false); // tests
  if (usageInFlight) return usageInFlight;
  if (!force && Date.now() - usageAsked < 60_000) return Promise.resolve(false);
  usageAsked = Date.now();
  usageInFlight = (async () => {
    try {
      if (!(await claudeLogin()).ok) return false;
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const abort = new AbortController();
      let release!: () => void;
      const held = new Promise<void>((ok) => (release = ok));
      async function* idle(): AsyncGenerator<SDKUserMessage> { await held; }
      const q = query({
        prompt: idle(),
        options: { abortController: abort, cwd: process.cwd(), ...claudeStart().sdk, tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, env: cliEnv() },
      });
      const drain = (async () => { try { for await (const _ of q) { /* nothing is sent, so nothing arrives */ } } catch { /* closed */ } })();
      try {
        // The SDK marks this call experimental: if it changes or goes, the meter falls back to what the run events say.
        const ask = (q as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
        if (typeof ask !== "function") return false;
        const u: any = await Promise.race([
          ask.call(q, { skipBehaviors: true }),
          new Promise<never>((_, no) => setTimeout(() => no(new Error("timed out")), 20_000)),
        ]);
        const windows = u?.rate_limits_available ? usageWindows(u.rate_limits) : [];
        // Credit first: noteUsage decides from it whether a used-up window means "on credit".
        noteCredit(u?.rate_limits?.extra_usage);
        noteUsage(windows);
        return windows.length > 0 || !!u?.rate_limits?.extra_usage;
      } finally {
        release();
        abort.abort();
        await drain;
      }
    } catch {
      return false;
    } finally {
      usageInFlight = null;
    }
  })();
  return usageInFlight;
}

export type ClaudeCodeModel = { id: string; name: string; efforts: string[] };
let modelsCache: { at: number; models: ClaudeCodeModel[] } | null = null;

// Asks Claude Code which models this login can use. It opens a session and closes it without
// sending a message, so it uses none of your plan. Cached for 10 minutes; null if it can't tell.
export async function claudeCodeModels(): Promise<ClaudeCodeModel[] | null> {
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60_000) return modelsCache.models;
  if (queryOverride) return null; // tests
  try {
    if (!(await claudeLogin()).ok) return null;
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const abort = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((ok) => (release = ok));
    async function* idle(): AsyncGenerator<SDKUserMessage> { await held; }
    const q = query({
      prompt: idle(),
      options: { abortController: abort, cwd: process.cwd(), ...claudeStart().sdk, tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, env: cliEnv() },
    });
    const drain = (async () => { try { for await (const _ of q) { /* nothing is sent, so nothing arrives */ } } catch { /* closed */ } })();
    try {
      const list = await Promise.race([
        q.supportedModels(),
        new Promise<never>((_, no) => setTimeout(() => no(new Error("timed out")), 30_000)),
      ]);
      const models = list
        .map((m) => ({ id: m.resolvedModel ?? m.value, name: prettyModel(m.resolvedModel ?? m.value), efforts: m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? []) }))
        .filter((m, i, all) => /^claude-/.test(m.id) && all.findIndex((x) => x.id === m.id) === i);
      if (!models.length) return null;
      modelsCache = { at: Date.now(), models };
      return models;
    } finally {
      release();
      abort.abort();
      await drain;
    }
  } catch {
    return null;
  }
}

// "claude-opus-5-5" → "Claude Opus 5.5" (Claude Code's own names are things like "Default (recommended)").
function prettyModel(id: string): string {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}` : id;
}
