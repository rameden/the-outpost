// One agent loop, reused by every character in camp.
// A character = persona + tools + skill folders. The loop doesn't care who it's running.

import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clipOutput, displayPath, steerNote, wrapUpNote, type Tool, type ToolOutput } from "./tools.js";
import { wikiIndex } from "./wiki.js";
import { emit } from "./events.js";
import { identityBlock, type CrewId } from "./crew.js";
import { continuityBlock, ensureWorkspace, recordSession, type SessionSource } from "./memory.js";
import { requestText, type RequestContent } from "./attachments.js";
import { agentSettings, campRuntime, DEFAULT_TURNS, EFFORTS, type Effort, type Runtime } from "./settings.js";
import { runClaudeCode, claudeCodeModels, type ClaudeCodeFailure } from "./claude-code.js";
import { currentLedger, currentQuestId, currentRunKey, currentSignal, currentSteering } from "./context.js";
import { filesWrittenBy } from "./checkpoints.js";
import { costOf, priceLabel, usd } from "./costs.js";
import { mcpToolsFor } from "./mcp.js";
import { linksBlock, projectInstructions } from "./links.js";
export type { Effort } from "./settings.js";

// Created on first use: on the Claude Code runtime there may be no API key at all.
let apiClient: Anthropic | null = null;
const client = () => (apiClient ??= new Anthropic()); // reads ANTHROPIC_API_KEY
export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 32_000; // replies stream, so long ones can't time out; thinking counts against this too
const MAX_CUTOFFS = 3;     // give up if a character keeps hitting the token limit

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

// ---------- Models you can pick from ----------
export type ModelInfo = { id: string; name: string; efforts: Effort[]; price?: string };

// Used when the Models API can't be reached.
const FALLBACK_MODELS: ModelInfo[] = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", efforts: EFFORTS },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: EFFORTS },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", efforts: EFFORTS },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", efforts: EFFORTS },
].map((m) => ({ ...m, price: priceLabel(m.id) }));

let modelCache: { at: number; models: ModelInfo[]; live: boolean; runtime: Runtime } | null = null;

// The models you can use, with the effort levels each one supports: from Claude Code on your
// subscription, or from the Models API with an API key.
export async function listModels(): Promise<{ models: ModelInfo[]; live: boolean }> {
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

// What this agent actually runs on: your override from mission control, else the code default.
// An effort level the model doesn't support is dropped rather than sent (it would be a 400).
export function resolveModel(spec: Pick<AgentSpec, "id" | "model" | "effort">): { model: string; effort?: Effort } {
  const s = agentSettings(spec.id);
  const model = s.model ?? spec.model ?? DEFAULT_MODEL;
  let effort = s.effort ?? spec.effort;
  const info = knownModel(model);
  if (effort && info && !info.efforts.includes(effort)) effort = undefined;
  return { model, effort };
}

// How many turns this agent gets per run: your override, else the code default, else 20.
export function resolveTurns(spec: Pick<AgentSpec, "id" | "maxTurns">): number {
  return agentSettings(spec.id).maxTurns ?? spec.maxTurns ?? DEFAULT_TURNS;
}

// What a run that used every turn says at the end, so whoever reads it knows what to do next.
const turnsNote = (name: string, n: number) =>
  `\n\n[Stopped: used all ${n} turns before finishing. Send ${name} back to continue, or raise the turn limit in ${name}'s model picker.]`;

// The newer web search/fetch versions (which filter results before they reach the model) only run
// on Opus and Sonnet models; anything else gets the basic versions so the Scout keeps working.
const DYNAMIC_WEB_TOOLS = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))/;
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
};

// Progressive disclosure: only name + description go in the prompt.
export function skillIndex(dirs: string[]): string {
  const lines: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const sub of readdirSync(dir)) {
      const path = join(dir, sub, "SKILL.md");
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      const name = text.match(/^name:\s*(.+)$/m)?.[1] ?? sub;
      const desc = text.match(/^description:\s*(.+)$/m)?.[1] ?? "";
      lines.push(`- ${name}: ${desc} (read ${path} before using)`);
    }
  }
  return lines.join("\n") || "(none)";
}

function preview(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

export async function runAgent(
  spec: AgentSpec,
  task: RequestContent, // text, or text plus image/PDF blocks the user attached
  opts: { extraSystem?: string; depth?: number; source?: SessionSource } = {}
): Promise<AgentResult> {
  const me = { who: spec.name, emoji: spec.emoji, depth: opts.depth ?? 0, questId: currentQuestId() };
  await listModels(); // so effort support is known (cached for 10 minutes)
  const { model, effort } = resolveModel(spec);
  const maxTurns = resolveTurns(spec);
  ensureWorkspace(spec.id);
  // Order matters for caching and for the model: who you are first, then how you work,
  // then what you remember, then the shared camp knowledge.
  const system =
    `${identityBlock(spec.id)}\n\n## How you work\n${spec.persona}\n\n` +
    `${continuityBlock(spec.id)}\n\n## Your skills\n` +
    `When a task matches one, read its SKILL.md first and follow it.\n${skillIndex(spec.skillDirs)}` +
    `\n\n${wikiIndex()}` +
    (linksBlock() ? `\n\n${linksBlock()}` : "") +
    (projectInstructions() ? `\n\n${projectInstructions()}` : "") +
    (opts.extraSystem ? `\n\n${opts.extraSystem}` : "");

  // The character's own tools plus any MCP connectors assigned to it (camp/mcp.json).
  const tools = [...spec.tools, ...(await mcpToolsFor(spec.id))];
  const defs = toolsFor(model, tools.map((t) => t.def));
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
  const finish = (status: AgentResult["status"], note = ""): AgentResult => {
    const result: AgentResult = { text: lastText + note, status, turns: turn, usage, model, effort };
    // Every conversation lands in this agent's own session history, so the next one can build on it.
    const asked = requestText(task).replace(/^\(Sent directly by the user[^)]*\)\s*/, "");
    result.session = recordSession(spec.id, { source: opts.source ?? "user", task: asked, result: result.text, status, messages });
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
  const work = async (): Promise<AgentResult> => {
    // ---------- On your Claude subscription, through Claude Code ----------
    if (campRuntime() === "claude-code") {
      if (signal?.aborted) return finish("stopped", stoppedNote);
      if (overBudget()) return finish("over_budget", budgetNote());
      let spentLive = 0;
      const r = await runClaudeCode({
        model, effort, system, task, tools, signal, messages, steering,
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
      const stream = client().beta.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        betas: ["context-management-2025-06-27"],
        context_management: CONTEXT_MANAGEMENT,
        ...(effort ? { output_config: { effort } } : {}),
        // Two cache layers: an explicit breakpoint on the static prefix (tools + system),
        // and automatic caching for the conversation, which grows by one turn each loop.
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: defs as unknown as Anthropic.Beta.BetaToolUnion[],
        messages: messages as unknown as Anthropic.Beta.BetaMessageParam[],
      }, { signal });
      // Words appear in mission control as they're written.
      stream.on("text", (delta) => emit({ type: "text_delta", ...me, delta }));
      let resp;
      try {
        resp = await stream.finalMessage();
      } catch (err) {
        if (signal?.aborted) return finish("stopped", stoppedNote); // Stop cut the reply off mid-stream
        throw err;
      }
      messages.push({ role: "assistant", content: resp.content as unknown as Anthropic.ContentBlockParam[] });
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
      if (ledger) ledger.spent += costOf(model, turnUsage);

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
        const cut = resp.content.flatMap((b) => (b.type === "tool_use" ? [b] : []));
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

      // Run every tool call from this turn at the same time (e.g. two dispatches = two parallel
      // quests), then return all the results together, in order, in one message.
      const uses = resp.content.flatMap((b) => (b.type === "tool_use" ? [b] : []));
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        uses.map(async (block) => {
          emit({ type: "tool", ...me, tool: block.name, input: preview(block.input) });
          const handler = handlers.get(block.name);
          let out: ToolOutput;
          try {
            out = handler ? await handler(block.input) : `Unknown tool: ${block.name}`;
          } catch (err: any) {
            out = `Error: ${err.stderr || err.message}`; // let the model adapt instead of crashing
          }
          return { type: "tool_result" as const, tool_use_id: block.id, content: clipOutput(out) };
        })
      );
      // Riding along with the results: anything the user said meanwhile, and a heads-up near the turn limit.
      const notes = [takeSteer(), maxTurns >= 6 ? wrapUpNote(maxTurns - turn) : null].filter((n): n is string => !!n);
      messages.push({ role: "user", content: [...results, ...notes.map((text) => ({ type: "text" as const, text }))] });
    }
    turn--; // the loop counter ran one past the last turn
    return finish("out_of_turns", turnsNote(spec.name, maxTurns) + handoff());
  };
  try {
    return await work();
  } catch (err: any) {
    if (signal?.aborted) return finish("stopped", stoppedNote);
    const e: AgentFailure = err instanceof Error ? err : new Error(String(err));
    const partial = finish("error", `\n\n[Failed: ${e.message}]`);
    e.partial = campRuntime() === "claude-code" ? { ...partial, runtime: "claude-code", costUsd: failedCost ?? 0 } : partial;
    throw e;
  }
}
