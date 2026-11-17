// One agent loop, reused by every character in camp.
// A character = persona + tools + skill folders. The loop doesn't care who it's running.

import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { campPath, clipOutput, displayPath, steerNote, wrapUpNote, type Tool, type ToolOutput } from "./tools.js";
import { wikiIndex } from "./wiki.js";
import { emit } from "./events.js";
import { identityBlock, type CrewId } from "./crew.js";
import { continuityBlock, ensureWorkspace, recordSession, type SessionSource } from "./memory.js";
import { aboutBlock } from "./memlog.js";
import { requestText, type RequestContent } from "./attachments.js";
import { agentSettings, alwaysSkills, campRuntime, DEFAULT_TURNS, EFFORTS, refusalFallbackOn, type Effort, type Runtime } from "./settings.js";
import { runClaudeCode, claudeCodeModels, SIDE_BY_SIDE, type ClaudeCodeFailure } from "./claude-code.js";
import { PROVIDERS, ProviderError, anthropicKey, maySend, otherModel, providerChat, providerModels, providersState } from "./providers.js";
import { currentExpeditionId, currentLedger, currentQuestId, currentReplyTo, currentRunKey, currentSignal, currentSteering, currentThread, conversationModel } from "./context.js";
import { autoLabel, isAutoChoice, parseChoice, profileTask, requestTokens as sizeOf, routeId, type Decision, type Route } from "./routing.js";
import { TaskRouter, Verification, autoMode, coolDown, gradeOf, lastRouteOf, logOutcome, noteOutcome, tierOf, type RouteStep, type RouteUse } from "./autoroute.js";
import { OpJournal, journaled } from "./oplog.js";
import { filesWrittenBy } from "./checkpoints.js";
import { costOf, priceLabel, usd } from "./costs.js";
import { connectorsFor, mcpToolsFor } from "./mcp.js";
import { linksBlock, projectInstructions } from "./links.js";
import { getProject } from "./conversations.js";
import { leftOutBlock, projectBlock, projectRemember } from "./projects.js";
import { feedbackBlock } from "./feedback.js";
import { currentProjectId } from "./context.js";
export type { Effort } from "./settings.js";
// Paths inside the camp are written with forward slashes on every system (Windows takes them too),
// so what the crew and the page are shown reads the same everywhere.
const join = posix.join;

// Created on first use: on the Claude Code runtime there may be no API key at all.
let apiClient: Anthropic | null = null;
const client = () => {
  const apiKey = anthropicKey();
  if (!apiClient || apiClient.apiKey !== apiKey) apiClient = new Anthropic({ apiKey });
  return apiClient;
};
export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 32_000; // replies stream, so long ones can't time out; thinking counts against this too
const MAX_CUTOFFS = 3;     // give up if a character keeps hitting the token limit

// A reply that fails for a passing reason (the API is overloaded, the connection dropped part-way
// through the stream) is asked for again, after a pause, instead of ending the whole run: by then
// an expedition can be many turns and several quests in. The SDK already retries a request that
// fails before it starts answering; this covers one that breaks once the reply is streaming.
// Nothing was added to the transcript for the failed reply, so asking again is safe.
const RETRY_WAITS_MS = [2_000, 8_000, 20_000];
const PASSING_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const PASSING_TYPE = new Set(["overloaded_error", "api_error", "rate_limit_error", "timeout_error"]);
export function isPassingFailure(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) return (err.status != null && PASSING_STATUS.has(err.status)) || PASSING_TYPE.has(String(err.type));
  // A connection that drops once the reply is streaming isn't one of the SDK's typed errors: it
  // comes up from the network layer ("terminated", ECONNRESET…), sometimes wrapped a level or two.
  for (let e: any = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(String(e.code ?? ""))) return true;
    if (e instanceof TypeError && /^(terminated|fetch failed)$/.test(e.message)) return true;
  }
  return false;
}
// Tests shorten the waits.
let retryWaits = RETRY_WAITS_MS;
export const setRetryWaitsForTests = (ms: number[] | null) => { retryWaits = ms ?? RETRY_WAITS_MS; };
// Wait, unless Stop comes first (true: waited it out; false: stopped).
const pause = (ms: number, signal?: AbortSignal) => new Promise<boolean>((ok) => {
  if (signal?.aborted) return ok(false);
  const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); ok(!signal?.aborted); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener("abort", done, { once: true });
});

// Long quests: once a prompt passes 120k tokens, the API clears the oldest tool results (keeping
// the 8 most recent) so the run doesn't run out of context. Reports, plans, and memory writes are
// never cleared. Clearing happens on the server, so what we send stays append-only.
const CONTEXT_MANAGEMENT: Anthropic.Beta.BetaContextManagementConfig = {
  edits: [{
    type: "clear_tool_uses_20250919",
    trigger: { type: "input_tokens", value: 120_000 },
    keep: { type: "tool_uses", value: 8 },
    exclude_tools: ["dispatch", "submit_plan", "remember"],
  }],
};

// ---------- When a model declines ----------
// The newest models run safety checks that now and then decline a request that was fine (security
// tooling, a biology question). Left alone that ends the run: "the model declined". With the
// API's server-side fallback the same request is carried on by another Claude model inside the
// same call, chosen by Anthropic for the kind of refusal it was. The camp asks for that on the
// models that have it; the feed says when it happens and who took over, and the run's cost counts
// each attempt at the rate of the model that made it. Turn it off with "refusalFallback": false in
// camp/settings.json. (Only on the API. On your subscription Claude Code decides for itself, and
// the feed passes on what it reports.)
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const HAS_FALLBACK = /^claude-(fable-5(-[12])?|mythos-5(-[12])?|opus-5(-5)?|sonnet-5-5)$/; // not Haiku: it has none
export const fallsBack = (model: string) => HAS_FALLBACK.test(model) && refusalFallbackOn();

// A reply that fell back holds a "fallback" block where the switch happened. What the first
// model wrote before it stays in the reply, but only its words carry over: its thinking and any
// tool call it had begun belong to the attempt that was declined. So of what comes before the
// last switch, the transcript keeps the text (and web tool calls that have their results) and the
// switch marks themselves, exactly where they were; everything after it is kept whole. Tool
// calls before the switch are never run.
export function afterFallback(content: any[]): { content: any[]; live: any[] } {
  const at = content.map((b) => b?.type).lastIndexOf("fallback");
  if (at < 0) return { content, live: content };
  const answered = new Set(content.slice(0, at).flatMap((b) => (typeof b?.type === "string" && b.type.endsWith("_tool_result") && b.tool_use_id ? [b.tool_use_id] : [])));
  const before = content.slice(0, at).filter((b) =>
    b?.type === "text" || b?.type === "fallback" ||
    (b?.type === "server_tool_use" && answered.has(b.id)) ||
    (typeof b?.type === "string" && b.type.endsWith("_tool_result") && b.type !== "tool_result"));
  return { content: [...before, ...content.slice(at)], live: content.slice(at + 1) };
}

// What one reply cost. Usually the model asked, at its rate. When a fallback served it, each
// attempt is listed with the model that made it, and is costed at that model's rate.
export function replyCost(model: string, turn: Usage, iterations: unknown): number {
  const list = Array.isArray(iterations) ? iterations : [];
  if (!list.some((i: any) => i?.type === "fallback_message")) return costOf(model, turn);
  return list.reduce((sum: number, i: any) => sum + (typeof i?.model === "string"
    ? costOf(i.model, { input: i.input_tokens ?? 0, output: i.output_tokens ?? 0, cacheRead: i.cache_read_input_tokens ?? 0, cacheWrite: i.cache_creation_input_tokens ?? 0 })
    : 0), 0);
}

// ---------- Models you can pick from ----------
// provider: a model from another company (DeepSeek, Gemini, Groq, OpenRouter), named "<provider>:<model>". free: it costs nothing there.
export type ModelInfo = { id: string; name: string; efforts: Effort[]; price?: string; provider?: string; free?: boolean };

// Used when the Models API can't be reached.
const FALLBACK_MODELS: ModelInfo[] = [
  { id: "claude-fable-5-2", name: "Claude Fable 5.2", efforts: EFFORTS },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", efforts: EFFORTS },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: EFFORTS },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", efforts: EFFORTS },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", efforts: EFFORTS },
].map((m) => ({ ...m, price: priceLabel(m.id) }));

let modelCache: { at: number; models: ModelInfo[]; live: boolean; runtime: Runtime } | null = null;

// The models you can use, with the effort levels each one supports: from Claude Code on your
// subscription, or from the Models API with an API key.
export async function listModels(): Promise<{ models: ModelInfo[]; live: boolean }> {
  const claude = await claudeModels();
  // After Claude's: the models of each provider you've connected (none of them takes an effort level).
  const others: ModelInfo[] = [];
  for (const p of PROVIDERS) {
    try {
      // OpenRouter lists hundreds: only its free ones are offered here.
      for (const m of (await providerModels(p.id)).filter((m) => p.id !== "openrouter" || m.free)) {
        const id = `${p.id}:${m.id}`, price = priceLabel(id); // a price is known for DeepSeek's own models only
        others.push({ id, name: m.name, efforts: [], provider: p.name, ...(m.free ? { free: true, price: "free" } : price ? { price } : {}) });
      }
    } catch { /* it can't be reached just now: its models are left off the list */ }
  }
  return { models: [...claude.models, ...others], live: claude.live };
}
async function claudeModels(): Promise<{ models: ModelInfo[]; live: boolean }> {
  const runtime = campRuntime();
  if (modelCache && modelCache.runtime === runtime && Date.now() - modelCache.at < 10 * 60_000) return modelCache;
  if (runtime === "claude-code") {
    const mine = await claudeCodeModels();
    const models = mine?.map((m) => ({ id: m.id, name: m.name, efforts: EFFORTS.filter((e) => m.efforts.includes(e)), price: priceLabel(m.id) }));
    modelCache = models?.length
      ? { at: Date.now(), models, live: true, runtime }
      : { at: Date.now() - 9 * 60_000, models: FALLBACK_MODELS, live: false, runtime }; // retry in a minute
    return modelCache;
  }
  try {
    const models: ModelInfo[] = [];
    for await (const m of client().models.list()) {
      const caps = (m as unknown as { capabilities?: any }).capabilities;
      const efforts = EFFORTS.filter((level) => caps?.effort?.[level]?.supported);
      models.push({ id: m.id, name: m.display_name, efforts, price: priceLabel(m.id) });
    }
    if (!models.length) throw new Error("no models");
    modelCache = { at: Date.now(), models, live: true, runtime };
  } catch {
    modelCache = { at: Date.now() - 9 * 60_000, models: FALLBACK_MODELS, live: false, runtime }; // retry in a minute
  }
  return modelCache;
}

function knownModel(id: string): ModelInfo | undefined {
  return modelCache?.models.find((m) => m.id === id) ?? FALLBACK_MODELS.find((m) => m.id === id);
}

// What a prompt is told about models: the one it's running on, and the ones this camp can run.
// A model knows a model's name only from its training or from what it's told here. Without
// this, a newer model you mention ("we have a large Fable 5.2 budget") can be news to whoever
// you're talking to, in a camp whose own model picker lists it.
export function modelsBlock(model: string, models: ModelInfo[] = modelCache?.models ?? FALLBACK_MODELS): string {
  const label = (m: ModelInfo) => `${m.name} (${m.id})`;
  const mine = models.find((m) => m.id === model);
  let others: string[] = [];
  try { others = providersState().filter((p) => p.connected).map((p) => p.name); } catch { /* the Claude models are the ones that matter here */ }
  return "## The models here\n" +
    `You are running on ${mine ? label(mine) : model}. The Claude models this camp can run: ${models.filter((m) => !m.provider).map(label).join(", ")}.` +
    (others.length ? ` Models from ${others.join(", ")} are connected as well.` : "") +
    " These are real models the user can pick for a conversation or a crew member, whether or not you've heard of them. When the user names one, take it as that model. Don't describe what a model you don't know can do: say you don't know it beyond its name.";
}

// What this agent actually runs on: your override from mission control, else the code default.
// An effort level the model doesn't support is dropped rather than sent (it would be a 400).
export function resolveModel(spec: Pick<AgentSpec, "id" | "model" | "effort">): { model: string; effort?: Effort } {
  const s = agentSettings(spec.id);
  // A project can put a crew member on a different model for its own conversations.
  const here = getProject(currentProjectId())?.settings?.agents?.[spec.id];
  const model = here?.model ?? s.model ?? spec.model ?? DEFAULT_MODEL;
  let effort = (here?.model ? (here.effort as Effort | undefined) : undefined) ?? s.effort ?? spec.effort;
  if (isAutoChoice(model)) return { model }; // Auto chooses the effort along with the model, task by task
  const info = knownModel(model);
  if (effort && info && !info.efforts.includes(effort)) effort = undefined;
  return { model, effort };
}

// How many turns this agent gets per run: your override, else the code default, else 20.
export function resolveTurns(spec: Pick<AgentSpec, "id" | "maxTurns">): number {
  return agentSettings(spec.id).maxTurns ?? spec.maxTurns ?? DEFAULT_TURNS;
}

// What the Quartermaster is told about a crew member, so its plans and briefs fit how they really
// run: model, effort, turn limit, tools, skills and connectors, as set right now (your overrides
// and the project's included). It's worked out each time the Quartermaster sets out.
// A model's name, with a 1M-context id ("claude-fable-5-2[1m]") named after its base model.
const modelName = (id: string): string => {
  const known = knownModel(id)?.name;
  if (known) return known;
  const base = knownModel(id.replace(/\[1m\]$/i, ""))?.name;
  return base ? `${base} (1M context)` : id;
};

export function crewSetup(spec: AgentSpec): string {
  const { model, effort } = resolveModel(spec);
  const choice = parseChoice(model);
  const runsOn = choice.kind === "auto"
    ? `${autoLabel(choice.preference)} (picks the model and effort quest by quest)`
    : `${modelName(model)}, ${effort ? `${effort} effort` : "the model's default effort"}`;
  const webOff = getProject(currentProjectId())?.settings?.web === "off";
  const tools = spec.tools.map((t) => ("name" in t.def ? t.def.name : "")).filter((n) => n && !(webOff && (n === "web_search" || n === "web_fetch")));
  const skills = skillNames(spec.skillDirs);
  const connectors = connectorsFor(spec.id);
  return [
    `runs on ${runsOn}`,
    `${resolveTurns(spec)} turns per quest`,
    `tools: ${tools.join(", ") || "none"}`,
    `skills: ${skills.join(", ") || "none"}`,
    ...(connectors.length ? [`connectors: ${connectors.join(", ")}`] : []),
  ].join("; ");
}

// What a run that used every turn says at the end, so whoever reads it knows what to do next.
const turnsNote = (name: string, n: number) =>
  `\n\n[Stopped: used all ${n} turns before finishing. Send ${name} back to continue, or raise the turn limit in ${name}'s model picker.]`;

// The newer web search/fetch versions (which filter results before they reach the model) only run
// on Fable, Mythos, Opus and Sonnet models; anything else gets the basic versions so the Scout keeps working.
const DYNAMIC_WEB_TOOLS = /^claude-((fable|mythos)-|opus-(5|4-[678])|sonnet-(5|4-6))/;
function toolsFor(model: string, defs: Anthropic.ToolUnion[]): Anthropic.ToolUnion[] {
  if (DYNAMIC_WEB_TOOLS.test(model)) return defs;
  return defs.map((d) => {
    const type = (d as { type?: string }).type;
    if (type === "web_search_20260209") return { ...d, type: "web_search_20250305" } as Anthropic.ToolUnion;
    if (type === "web_fetch_20260209") return { ...d, type: "web_fetch_20250910" } as Anthropic.ToolUnion;
    return d;
  });
}

export type AgentSpec = {
  id: CrewId;          // ties the agent to its fixed identity (crew.ts) and workspace (camp/agents/<id>/)
  name: string;
  emoji: string;
  role: string;        // one line; the Quartermaster sees this when choosing who to send
  persona: string;     // how this character works (identity, crew, and boundaries are added from crew.ts)
  tools: Tool[];
  skillDirs: string[]; // folders of skills this character may use
  maxTurns?: number;
  model?: string;      // e.g. give the Quartermaster a bigger model, scouts a cheaper one
  effort?: Effort;     // how hard this character thinks; lower is cheaper and faster
};

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

// A run that failed part-way: the error carries what it had done and spent, so it's still logged.
export type AgentFailure = Error & { partial?: AgentResult };

export type AgentResult = {
  text: string;        // the character's final words: a report, or the Quartermaster's summary
  status: "done" | "refused" | "cut_off" | "out_of_turns" | "over_budget" | "stopped" | "error";
  turns: number;
  usage: Usage;
  model: string;
  effort?: Effort;
  session?: string;    // where this run's full transcript was saved
  runtime?: Runtime;   // what ran it: your subscription (claude-code) or the API
  costUsd?: number;    // Claude Code's own figure at API prices (an estimate on a subscription)
  // Auto: what you picked ("auto:balanced"…), each route it ran on and why, and what each one cost.
  route?: { choice: string; steps: RouteStep[]; use: RouteUse[] };
};

// Skills you set to "always on" for a crew member: their instructions, in full, in every prompt.
// (Only skills that member can use anyway: their own and the shared ones.)
const ALWAYS_EACH = 8000, ALWAYS_ALL = 24_000;
export function alwaysOn(id: string, dirs: string[]): { key: string; name: string; dir: string; body: string }[] {
  const out: { key: string; name: string; dir: string; body: string }[] = [];
  let used = 0;
  for (const key of alwaysSkills()[id] ?? []) {
    const dir = join("skills", key);
    const path = join(dir, "SKILL.md");
    if (!dirs.some((d) => dir.startsWith(`${d}/`)) || !/^[a-z0-9_-]+\/[a-z0-9-]+$/.test(key) || !existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    let body = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    const room = Math.min(ALWAYS_EACH, ALWAYS_ALL - used);
    if (room <= 0) break;
    if (body.length > room) body = `${body.slice(0, room)}\n…[cut for length: read the rest in ${path}]`;
    used += body.length;
    out.push({ key, name: text.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? key.split("/")[1], dir, body });
  }
  return out;
}
export function alwaysBlock(id: string, dirs: string[]): string {
  const on = alwaysOn(id, dirs);
  if (!on.length) return "";
  return "\n\n## Skills you always follow\nThe user has set these to apply to everything you do. Their instructions are here in full: follow them without being asked, and without opening them first. " +
    "Where one doesn't bear on the task in front of you, it simply doesn't apply.\n\n" +
    on.map((s) => `### ${s.name}\n${s.body}\n(Anything else it refers to, scripts or reference pages, is in ${s.dir}/.)`).join("\n\n");
}

// A front-matter value as it reads, not as it's written: one in quotes (as a description with a
// colon in it must be) comes out without them and without its backslashes.
function unquoted(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) { try { return String(JSON.parse(v)); } catch { return v.slice(1, -1); } }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

// Progressive disclosure: only name + description go in the prompt.
// always: skills whose instructions are in the prompt already (see alwaysBlock), marked so.
// The names of the skills in these folders (what skillIndex lists, without the descriptions).
export function skillNames(dirs: string[]): string[] {
  return dirs.filter(existsSync).flatMap((dir) => readdirSync(dir).flatMap((sub) => {
    const path = join(dir, sub, "SKILL.md");
    if (!existsSync(path)) return [];
    return [unquoted(readFileSync(path, "utf8").match(/^name:\s*(.+)$/m)?.[1] ?? sub)];
  }));
}

export function skillIndex(dirs: string[], always: string[] = []): string {
  const lines: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const sub of readdirSync(dir)) {
      const path = join(dir, sub, "SKILL.md");
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      const name = unquoted(text.match(/^name:\s*(.+)$/m)?.[1] ?? sub);
      const desc = unquoted(text.match(/^description:\s*(.+)$/m)?.[1] ?? "");
      lines.push(always.includes(join(dir, sub)) ? `- ${name}: ${desc} (always on: its instructions are below)` : `- ${name}: ${desc} (read ${path} before using)`);
    }
  }
  return lines.join("\n") || "(none)";
}

// write_file, made to say what it made: once a file is written, the feed gets a card for it (the
// same in both runtimes, since they share these handlers). Edits to a file that's already there
// are left to "View changes"; a write that was refused, or left the file as it was, says nothing.
function announcingFiles(t: Tool, self: string, me: { who: string; emoji: string; depth: number; questId?: string }): Tool {
  const run = t.run;
  if (!run || !("name" in t.def) || t.def.name !== "write_file") return t;
  return {
    ...t,
    run: async (input: any) => {
      let abs: string | null = null;
      try { abs = campPath(String(input?.path ?? ""), "write", self); } catch { /* the tool itself says why */ }
      const was = abs && existsSync(abs) ? statSync(abs) : null;
      const out = await run(input);
      const now = abs && existsSync(abs) ? statSync(abs) : null;
      if (abs && now?.isFile() && (!was || now.mtimeMs !== was.mtimeMs || now.size !== was.size)) {
        emit({ type: "file", ...me, path: displayPath(abs), change: was ? "updated" : "created", bytes: now.size });
      }
      return out;
    },
  };
}

let runCount = 0;
const resultText = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (b?.type === "text" ? String(b.text) : "")).join("\n") : "";

function preview(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

export async function runAgent(
  spec: AgentSpec,
  task: RequestContent, // text, or text plus image/PDF blocks the user attached
  // plain: not a crew member at all (a plain chat with a model): no identity, memory, skills,
  // wiki or session history of its own; just what it's told here, and the tools it's handed.
  opts: { extraSystem?: string; depth?: number; source?: SessionSource; plain?: boolean } = {}
): Promise<AgentResult> {
  const me = { who: spec.name, emoji: spec.emoji, depth: opts.depth ?? 0, questId: currentQuestId() };
  const startedAt = Date.now();
  await claudeModels(); // so effort support is known (cached for 10 minutes). Only Claude's list: other providers' models take no effort level, and asking each of them here would hold up every run's start.
  // A conversation can name its own model (picked beside the message box): whoever you're talking
  // to answers on it. Crew sent out on quests keep the models they're set to (see withQuest).
  const picked = conversationModel();
  const own = resolveModel(spec);
  // Auto ("auto", "auto:economy"…) is a choice, not a model: the route is chosen below, once the
  // request it has to carry is known. Anything else is a model you pinned, used as it always was.
  const choice = parseChoice(picked ?? own.model);
  let model = choice.kind === "manual" ? choice.model : DEFAULT_MODEL;
  let effort = choice.kind === "auto" ? undefined
    : picked && picked !== own.model ? (knownModel(picked)?.efforts.includes(own.effort as Effort) ? own.effort : undefined) : own.effort;
  const maxTurns = resolveTurns(spec);
  if (!opts.plain) ensureWorkspace(spec.id);
  // The prompt comes in two parts, and the order is for caching as much as for the model. First
  // what stays the same from one run to the next: who you are, how you work, your skills. Then
  // what moves: memory and recent sessions (which change after every run), the wiki, the project,
  // feedback, the conversation so far. The API caches a prompt up to a breakpoint and only if
  // everything before it is byte-for-byte what it was: with the moving part first (as it once
  // was) no run could reuse the one before it; now the fixed part, and the tools ahead of it, are
  // read back from the cache when the same crew member runs again within a few minutes (sent back
  // to fix a failing check, a quick follow-up, two quests side by side).
  const parts = (list: (string | false | undefined)[]) => list.filter((p): p is string => !!p).join("\n\n");
  const always = opts.plain ? [] : alwaysOn(spec.id, spec.skillDirs);
  const fixed = opts.plain
    ? spec.persona
    : parts([
        identityBlock(spec.id),
        `## How you work\n${spec.persona}`,
        `## Your skills\nWhen a task matches one, read its SKILL.md first and follow it.\n${skillIndex(spec.skillDirs, always.map((s) => s.dir))}` + alwaysBlock(spec.id, spec.skillDirs),
      ]);
  const movingRest = parts([
    !opts.plain && continuityBlock(spec.id, requestText(task)),
    aboutBlock(),
    !opts.plain && wikiIndex(),
    linksBlock(),
    projectInstructions(),
    !opts.plain && projectBlock(spec.id, undefined, requestText(task)),
    leftOutBlock(),
    !opts.plain && feedbackBlock(spec.id, currentProjectId()),
    opts.extraSystem,
  ]);
  // What's said about models names the one answering, so it's worked out for each route.
  const movingFor = (m: string) => parts([modelsBlock(m), movingRest]);
  const systemFor = (m: string) => parts([fixed, movingFor(m)]); // as one text, for the runtimes that take it that way

  // The character's own tools plus any MCP connectors assigned to it (camp/mcp.json).
  // In a project, the crew can keep notes about it; a project can also turn the web tools off.
  const project = getProject(currentProjectId());
  const inProject = !!project && project.id !== "general";
  const webOff = project?.settings?.web === "off";
  const isWeb = (t: Tool) => "name" in t.def && (t.def.name === "web_search" || t.def.name === "web_fetch");
  // A task in a conversation can be picked up again (after a dropped connection, a crash, a switch
  // of model): what its tools changed is journaled so it's never done twice (oplog.ts).
  const thread = currentThread();
  // (A crew member sent back to the same quest, to fix a failing check, is a run of its own.)
  const runId = `${currentExpeditionId() ?? "solo"}:${currentQuestId() ?? "-"}:${spec.id}:${(++runCount).toString(36)}`;
  const journal = thread ? new OpJournal(`${thread}:${spec.id}`, runId, currentReplyTo()) : null;
  const notice = (text: string) => emit({ type: "notice", ...me, text });
  const tools = [...spec.tools.filter((t) => !(webOff && isWeb(t))), ...(inProject && !opts.plain ? [projectRemember] : []), ...(opts.plain ? [] : await mcpToolsFor(spec.id))]
    .map((t) => announcingFiles(t, spec.id, me))
    .map((t) => (journal ? journaled(t, journal, notice) : t));
  const defsFor = (m: string) => toolsFor(m, tools.map((t) => t.def));
  let defs = defsFor(model);
  const handlers = new Map<string, NonNullable<Tool["run"]>>();
  for (const t of tools) {
    if (t.run && "name" in t.def) handlers.set(t.def.name, t.run);
  }
  const ledger = currentLedger(); // shared by everyone in this expedition
  const overBudget = () => !!ledger?.budget && ledger.spent >= ledger.budget;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let lastText = "";
  let cutoffs = 0;
  let turn = 0;
  let spentHere = 0;      // what this run's replies cost, attempt by attempt
  let fellBack = false;   // another model carried on for at least one reply
  const finish = (status: AgentResult["status"], note = ""): AgentResult => {
    // (After a fallback the tokens were used at two models' rates: the cost worked out reply by reply is the right one.)
    const result: AgentResult = { text: lastText + note, status, turns: turn, usage, model, effort, ...(fellBack || router ? { costUsd: spentHere } : {}),
      ...(router ? { route: { choice: autoMode(router.mode), steps: router.steps, use: [...router.use.values()] } } : {}) };
    // Every conversation lands in this agent's own session history, so the next one can build on it.
    const asked = requestText(task).replace(/^\(Sent directly by the user[^)]*\)\s*/, "");
    // (A plain chat has no crew member to keep it for: its conversation is its record.)
    if (!opts.plain) result.session = recordSession(spec.id, { source: opts.source ?? "user", task: asked, result: result.text, status, messages });
    return result;
  };

  // Messages the user sends while this expedition runs reach every agent working in it.
  const steering = currentSteering();
  let steerSeen = steering?.messages.length ?? 0;
  const takeSteer = (): string | null => {
    if (!steering || steering.messages.length <= steerSeen) return null;
    const fresh = steering.messages.slice(steerSeen).map((m) => m.text);
    steerSeen = steering.messages.length;
    return steerNote(fresh);
  };

  // When a run uses every turn, the report says what it got done, so the next run (or you) can
  // pick up without redoing it.
  const handoff = (): string => {
    const calls: string[] = [];
    for (const m of messages) {
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      for (const b of m.content as any[]) if (b.type === "tool_use") calls.push(`${String(b.name).replace(/^mcp__camp__/, "")} ${preview(b.input)}`);
    }
    const files = filesWrittenBy(currentRunKey()).map(displayPath);
    if (!calls.length && !files.length) return "";
    return `\n\n[Handoff for whoever continues. Files this run changed: ${files.join(", ") || "none"}. ` +
      `Its last steps:\n${calls.slice(-12).map((c) => `- ${c}`).join("\n")}\nBrief the next run with this so it doesn't repeat finished work.]`;
  };

  const budgetNote = () => `\n\n[Stopped: this expedition reached its ${usd(ledger?.budget ?? 0)} budget.]`;
  const signal = currentSignal(); // set when the user can press Stop
  const stoppedNote = "\n\n[Stopped by the user.]";

  // A failure part-way (a network error, the plan's limit) still leaves a transcript and a cost.
  let failedCost: number | undefined;
  // A model from another provider ("groq:…"): the same loop as the API's, talking to them instead.
  let other = otherModel(model);

  // ---------- Auto ----------
  // The route is chosen here, right before the first dispatch, from what the request has to carry,
  // and looked at again before each one after that (routing.ts decides; autoroute.ts knows the camp).
  const reqTokens = () => sizeOf({ system: systemFor(model), tools: defs, messages });
  const confidential = ["careful", "off"].includes(String(getProject(currentProjectId())?.settings?.web ?? ""));
  let router: TaskRouter | null = null;
  const pinnedChecks = new Verification(); // a pinned model's run: whether it checked its own work (Auto's router keeps its own)
  const applyRoute = (r: Route) => { model = r.model; effort = r.effort; other = otherModel(model); defs = defsFor(model); };
  const announce = (d: Extract<Decision, { kind: "selected" }>, switched: boolean) =>
    emit({ type: "route", ...me, model: d.primary.model, ...(d.primary.effort ? { effort: d.primary.effort } : {}), choice: autoMode(router!.mode), trigger: d.trigger, reason: d.reason, switched });
  // Look again (a trigger fired, or the route can't take the next request). Waits, cancellably,
  // when every route is cooling down but one will be back before the task's deadline.
  // The first choice is made the same way, with no route yet: a task picked up again starts from
  // the route it was on (and changes only if it's worth it); a new one from nothing.
  const reroute = async (trigger: Parameters<TaskRouter["decide"]>[0], evidence?: string, incumbent?: string): Promise<AgentResult | null> => {
    const first = !router!.route;
    for (;;) {
      if (signal?.aborted) return finish("stopped", stoppedNote);
      const before = router!.route?.id;
      const size = reqTokens();
      const d = first ? router!.decide(trigger, size, 0, evidence, incumbent) : router!.decide(trigger, size, size, evidence);
      if (d.kind === "selected") {
        if (d.primary.id !== before) { applyRoute(d.primary); announce(d, !first); }
        else if (trigger === "scope_change" || trigger === "repeated_failure") announce(d, false);
        return null;
      }
      if (d.retryAfterMs != null && d.retryAfterMs <= router!.waitLeft()) {
        notice(`⏳ ${d.reason}`);
        if (!(await pause(d.retryAfterMs, signal))) return finish("stopped", stoppedNote);
        continue;
      }
      throw new Error(`Auto couldn't ${first ? "pick a model" : "carry on"}: ${d.reason}`);
    }
  };
  if (choice.kind === "auto") {
    const { models } = await listModels();
    const text = requestText(task);
    router = new TaskRouter({
      mode: choice.preference, task: `${thread ?? currentExpeditionId() ?? "solo"}:${spec.id}`, run: runId, agent: spec.id, models, confidential,
      budgetLeft: () => (ledger?.budget != null ? ledger.budget - ledger.spent : undefined),
      profile: { text, context: opts.extraSystem, role: spec.id, hasImages: Array.isArray(task) && task.some((b: any) => b?.type === "image"), tools: tools.some((t) => !!t.run),
        serverTools: tools.some(isWeb) && /\b(web|online|internet|latest|news|website|search the)\b|https?:\/\//i.test(text) },
      requestTokens: reqTokens(),
    });
  }
  // On a switch, each provider gets a transcript it can take: reasoning another model wrote stays
  // with that model (Claude only takes back its own signed thinking), and tool-call ids are made
  // unique and in the form every provider accepts.
  const authorOf = new WeakMap<object, string>();
  const usedIds = new Set<string>();
  const forRoute = (list: Anthropic.MessageParam[], target: string): Anthropic.MessageParam[] => list.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content) || authorOf.get(m) === target) return m;
    const toClaude = !otherModel(target);
    const kept = (m.content as any[]).filter((b) => !(b?.type === "thinking" || b?.type === "redacted_thinking") || (toClaude && !!b.signature && !otherModel(authorOf.get(m) ?? "")));
    return kept.length === m.content.length ? m : { ...m, content: kept.length ? kept : [{ type: "text", text: "(continued)" }] } as Anthropic.MessageParam;
  });
  const fixIds = (content: any[]) => content.map((b, i) => {
    if (b?.type !== "tool_use") return b;
    let id = String(b.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || usedIds.has(id)) id = `toolu_auto_${turn}_${i}`;
    usedIds.add(id);
    return id === b.id ? b : { ...b, id };
  });
  const retryAfterOf = (err: any): number | undefined => {
    if (err instanceof ProviderError) return err.retryAfterMs;
    const h = err?.headers;
    const v = Number(typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"]);
    return Number.isFinite(v) && v >= 0 && (typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"]) != null ? v * 1000 : undefined;
  };
  const pinnedHint = " Pick Auto for this conversation (beside the message box) or for the crew member to let another model carry on.";

  const work = async (): Promise<AgentResult> => {
    if (router) {
      const was = thread ? lastRouteOf(`${thread}:${spec.id}`, spec.id) : undefined;
      const stopped = await reroute(was ? "resume" : "new_task", was ? "the task was picked up again" : undefined, was);
      if (stopped) return stopped;
    }
    if (other) {
      // A project you've marked confidential (web: careful, or off) keeps its files with Claude:
      // another provider would be sent the prompt, and with it whatever the crew reads there.
      // The exception is a provider you've approved for confidential work (Settings → Models).
      if (!maySend(other.provider, getProject(currentProjectId())?.settings?.web)) {
        throw new Error(`${spec.name} is set to run on ${other.name} (${other.model}), but this project is marked confidential, so nothing from it is sent to another provider. ` +
          `If ${other.name} is approved for this work, say so under Settings → Models. Otherwise put ${spec.name} back on a Claude model for this project (the project's page → Crew).`);
      }
    }
    // ---------- On your Claude subscription, through Claude Code ----------
    if (campRuntime() === "claude-code" && !other) {
      if (signal?.aborted) return finish("stopped", stoppedNote);
      if (overBudget()) return finish("over_budget", budgetNote());
      let spentLive = 0;
      const r = await runClaudeCode({
        model, effort, system: systemFor(model), task, tools, signal, messages, steering,
        // The shared tally moves with every reply, so parallel quests and the Quartermaster see
        // each other's spending while they run, and the run ends itself once the budget is gone.
        onSpend: (usd) => { spentLive += usd; if (ledger) ledger.spent += usd; },
        overBudget,
        // Claude Code counts each tool round trip as a turn, like the API loop does.
        maxTurns,
        budgetLeftUsd: ledger?.budget != null ? ledger.budget - ledger.spent : undefined,
        onDelta: (delta) => emit({ type: "text_delta", ...me, delta }),
        onText: (text) => emit({ type: "text", ...me, text }),
        onTool: (tool, input) => emit({ type: "tool", ...me, tool, input: preview(input) }),
        onNotice: (text) => emit({ type: "notice", ...me, text }),
      }).catch((err: ClaudeCodeFailure) => {
        if (err.partial) { Object.assign(usage, err.partial.usage); turn = err.partial.turns; lastText = err.partial.text; failedCost = err.partial.costUsd; }
        throw err;
      });
      if (ledger) ledger.spent += r.costUsd - spentLive; // settle up with Claude Code's own total
      Object.assign(usage, r.usage);
      turn = r.turns;
      lastText = r.text;
      const result = finish(r.status, r.status === "out_of_turns" ? turnsNote(spec.name, maxTurns) + handoff() : "");
      return { ...result, runtime: "claude-code", costUsd: r.costUsd };
    }

    // ---------- On the API, with an API key ----------
    for (turn = 1; turn <= maxTurns; turn++) {
      if (signal?.aborted) {
        turn--;
        return finish("stopped", stoppedNote);
      }
      if (overBudget()) {
        turn--;
        return finish("over_budget", budgetNote());
      }
      // Auto: the route is checked before every dispatch (still available, still big enough), and
      // looked at again if the last turn's tool calls turned up a reason to.
      if (router) {
        const t = router.check(reqTokens());
        if (t) { const stopped = await reroute(t.trigger, t.evidence); if (stopped) { turn--; return stopped; } }
      }
      let resp!: { content: any[]; stop_reason: string | null; model?: string; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; iterations?: unknown } };
      const servedBy = () => router?.route;
      let route = servedBy();
      for (let attempt = 0, got = false; !got; attempt++) {
        if (signal?.aborted) { turn--; return finish("stopped", stoppedNote); }
        route = servedBy();
        const outgoing = router ? forRoute(messages, model) : messages;
        try {
          if (other) {
            resp = await providerChat({ provider: other.provider, model: other.model, system: systemFor(model), messages: outgoing as any, tools: defs, maxTokens: MAX_TOKENS, signal,
              onDelta: (delta) => emit({ type: "text_delta", ...me, delta }) });
          } else {
            const moving = movingFor(model);
            const stream = client().beta.messages.stream({
              model,
              max_tokens: MAX_TOKENS,
              betas: ["context-management-2025-06-27", ...(fallsBack(model) ? [FALLBACK_BETA] : [])],
              context_management: CONTEXT_MANAGEMENT,
              ...(fallsBack(model) ? { fallbacks: "default" as const } : {}),
              ...(effort ? { output_config: { effort } } : {}),
              // Three cache layers: a breakpoint after the fixed part of the prompt (with the tools
              // ahead of it), one after the moving part, and automatic caching for the conversation,
              // which grows by one turn each loop.
              cache_control: { type: "ephemeral" },
              system: [
                { type: "text" as const, text: fixed, cache_control: { type: "ephemeral" as const } },
                ...(moving ? [{ type: "text" as const, text: moving, cache_control: { type: "ephemeral" as const } }] : []),
              ],
              tools: defs as unknown as Anthropic.Beta.BetaToolUnion[],
              messages: outgoing as unknown as Anthropic.Beta.BetaMessageParam[],
            // Under Auto the router owns retries, so one budget covers the whole task across models.
            }, { signal, ...(router ? { maxRetries: 0 } : {}) });
            // Words appear in mission control as they're written.
            stream.on("text", (delta) => emit({ type: "text_delta", ...me, delta }));
            resp = await stream.finalMessage();
          }
          got = true;
        } catch (err: any) {
          if (signal?.aborted) return finish("stopped", stoppedNote); // Stop cut the reply off mid-stream
          const passing = err instanceof ProviderError ? err.passing : isPassingFailure(err);
          if (router && (passing || err instanceof ProviderError)) {
            // A provider that refused outright (a spent balance, a key it no longer takes) is set aside for longer.
            const next = err instanceof ProviderError && !err.passing
              ? (coolDown(`provider:${otherModel(model)?.provider ?? "anthropic"}`, 10 * 60_000, "refused"), { do: "switch" as const, evidence: `${model} couldn't be used (${String(err.message).slice(0, 100)})` })
              : router.failed(retryAfterOf(err), retryWaits);
            if (next.do === "give_up") { err.message = `${err.message} (Auto ${next.why}.)`; throw err; }
            if (next.do === "wait") {
              notice(`⏳ The reply was cut off (${String(err?.message ?? err).slice(0, 120)}). Asking ${model} again in ${Math.round(next.ms / 1000)}s.`);
              if (!(await pause(next.ms, signal))) return finish("stopped", stoppedNote);
              continue;
            }
            const stopped = await reroute("provider_unavailable", next.evidence);
            if (stopped) { turn--; return stopped; }
            continue;
          }
          if (other || attempt >= retryWaits.length || !passing) {
            if (passing && err instanceof Error) err.message += pinnedHint;
            throw err;
          }
          notice(`⏳ The reply was cut off (${String(err?.message ?? err).slice(0, 120)}). Asking again in ${Math.round(retryWaits[attempt] / 1000)}s (${attempt + 1} of ${retryWaits.length}).`);
          if (!(await pause(retryWaits[attempt], signal))) return finish("stopped", stoppedNote);
        }
      }
      if (router) resp.content = fixIds(resp.content);
      // Another model carried on after this one declined: say so, and keep only what carries over.
      const { content: kept, live } = afterFallback(resp.content);
      for (const b of resp.content) {
        if (b?.type !== "fallback") continue;
        fellBack = true;
        const why = b.trigger?.category ? ` (${String(b.trigger.category).replace(/_/g, " ")})` : "";
        emit({ type: "notice", ...me, text: `↪️ ${b.from?.model ?? model} declined this request${why}; ${b.to?.model ?? resp.model ?? "another model"} carried on.` });
      }
      if (Array.isArray(resp.usage.iterations) && resp.usage.iterations.some((i: any) => i?.type === "fallback_message")) fellBack = true; // (a later reply in a conversation that already fell back has no block)
      const reply: Anthropic.MessageParam = { role: "assistant", content: kept as unknown as Anthropic.ContentBlockParam[] };
      authorOf.set(reply, model);
      messages.push(reply);
      const turnUsage = {
        input: resp.usage.input_tokens,
        output: resp.usage.output_tokens,
        cacheRead: resp.usage.cache_read_input_tokens ?? 0,
        cacheWrite: resp.usage.cache_creation_input_tokens ?? 0,
      };
      usage.input += turnUsage.input;
      usage.output += turnUsage.output;
      usage.cacheRead += turnUsage.cacheRead;
      usage.cacheWrite += turnUsage.cacheWrite;
      const cost = replyCost(model, turnUsage, resp.usage.iterations);
      spentHere += cost;
      if (router && route) router.account(route, cost, turnUsage.input + turnUsage.cacheRead + turnUsage.cacheWrite, turnUsage.output);
      if (ledger) ledger.spent += cost;

      const text = resp.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n")
        .trim();
      if (text) {
        lastText = text;
        emit({ type: "text", ...me, text });
      }

      // Server tools (web search) can pause a long turn; sending it back resumes it.
      if (resp.stop_reason === "pause_turn") continue;

      // A refusal can cut a tool call off mid-input, so never run that turn's tools.
      if (resp.stop_reason === "refusal") {
        emit({ type: "notice", ...me, text: `🚫 ${spec.name} declined this request.` });
        return finish("refused", "\n\n[Stopped: the model declined this request.]");
      }

      // Cut off at the token limit: any tool call in this response may have truncated input
      // (a half-written file, say), so don't run it. Ask the character to retry or continue.
      if (resp.stop_reason === "max_tokens") {
        if (++cutoffs > MAX_CUTOFFS) {
          return finish("cut_off", "\n\n[Stopped: responses kept hitting the output token limit.]");
        }
        emit({ type: "notice", ...me, text: `✂️  ${spec.name} hit the token limit; asking them to retry.` });
        const cut = live.flatMap((b) => (b.type === "tool_use" ? [b] : []));
        messages.push({
          role: "user",
          content: cut.length
            ? cut.map((b) => ({
                type: "tool_result" as const,
                tool_use_id: b.id,
                is_error: true,
                content:
                  "Not run: your response hit the output token limit, so this call's input may be " +
                  "cut off. Retry it, splitting large content into smaller pieces if needed.",
              }))
            : "Your response was cut off by the output token limit. Continue from where you stopped.",
        });
        continue;
      }
      // No tool requested: this character is done, unless the user said something in the meantime.
      if (resp.stop_reason !== "tool_use") {
        const said = takeSteer();
        if (!said) return finish("done");
        messages.push({ role: "user", content: said });
        continue;
      }

      if (signal?.aborted) return finish("stopped", stoppedNote);
      // Over budget: stop before running more tools (a dispatch would start a whole new quest).
      if (overBudget()) {
        emit({ type: "notice", ...me, text: `💰 Budget reached; ${spec.name} is stopping.` });
        return finish("over_budget", budgetNote());
      }

      // This turn's tool calls, with all the results returned together, in order, in one message.
      // Calls that only read, and dispatches (two dispatches = two quests side by side), run at the
      // same time. Anything that writes, runs a command, or asks you goes one at a time, in the
      // order it was called: two commands at once could trip over each other, and two approvals
      // at once would have you answering out of order. The Claude Code runtime works the same way.
      const uses = live.flatMap((b) => (b.type === "tool_use" ? [b] : []));
      const runOne = async (block: any): Promise<Anthropic.ToolResultBlockParam> => {
        emit({ type: "tool", ...me, tool: block.name, input: preview(block.input) });
        const handler = handlers.get(block.name);
        try {
          const out: ToolOutput = handler ? await handler(block.input) : `Unknown tool: ${block.name}`;
          return { type: "tool_result" as const, tool_use_id: block.id, content: clipOutput(out), ...(handler ? {} : { is_error: true }) };
        } catch (err: any) {
          // Let the model adapt instead of crashing, and tell it plainly that the call failed.
          return { type: "tool_result" as const, tool_use_id: block.id, content: clipOutput(`Error: ${err.stderr || err.message}`), is_error: true };
        }
      };
      const together = uses.map((b) => (SIDE_BY_SIDE.has(b.name) ? runOne(b) : null));
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const [i, block] of uses.entries()) results[i] = await (together[i] ?? runOne(block));
      // Riding along with the results: anything the user said meanwhile, and a heads-up near the turn limit.
      const notes = [takeSteer(), maxTurns >= 6 ? wrapUpNote(maxTurns - turn) : null].filter((n): n is string => !!n);
      messages.push({ role: "user", content: [...results, ...notes.map((text) => ({ type: "text" as const, text }))] });
      // What the tools turned up: a failure reproduced after distinct fixes, or a bigger task than it looked.
      const calls = uses.map((b, i) => ({ name: b.name, input: b.input, output: resultText(results[i]?.content), failed: !!results[i]?.is_error }));
      if (router) router.observe(calls, reqTokens());
      else pinnedChecks.note(calls);
    }
    turn--; // the loop counter ran one past the last turn
    return finish("out_of_turns", turnsNote(spec.name, maxTurns) + handoff());
  };
  // Every run's outcome goes in the routing log: Auto's, and a pinned model's (the baseline Auto is
  // compared with). The journal is closed for a run that ended on its own terms, and left open for
  // one that failed part-way, so the run that picks it up again can reuse what it did.
  const settle = (r: AgentResult) => {
    const total = r.costUsd ?? spentHere;
    try {
      if (router) return router.finish(r.status, total);
      const { family, difficulty } = profileTask({ text: requestText(task), role: spec.id, requestTokens: 0 });
      const id = routeId(model, effort);
      const grade = gradeOf(r.status, pinnedChecks.state);
      const tier = tierOf(model);
      logOutcome({ task: `${thread ?? currentExpeditionId() ?? "solo"}:${spec.id}`, run: runId, agent: spec.id, mode: "manual", status: r.status, ok: r.status === "done", ...(grade ? { grade } : {}),
        seconds: Math.round((Date.now() - startedAt) / 1000), usd: total, switches: 0, family,
        routes: [{ route: id, usd: total, input: usage.input + usage.cacheRead + usage.cacheWrite, output: usage.output, turns: r.turns }] });
      if (grade && tier) noteOutcome({ id, tier, effort }, family, difficulty, grade);
    } catch { /* the log is a record, never a reason to fail a run */ }
  };
  journal?.begin();
  try {
    const r = await work();
    journal?.end();
    settle(r);
    return r;
  } catch (err: any) {
    if (signal?.aborted) { journal?.end(); const r = finish("stopped", stoppedNote); settle(r); return r; }
    journal?.abandon();
    const e: AgentFailure = err instanceof Error ? err : new Error(String(err));
    const partial = finish("error", `\n\n[Failed: ${e.message}]`);
    e.partial = campRuntime() === "claude-code" && !other ? { ...partial, runtime: "claude-code", costUsd: failedCost ?? 0 } : partial;
    settle(e.partial);
    throw e;
  }
}
