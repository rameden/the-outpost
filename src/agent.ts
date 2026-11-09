// One agent loop, reused by every character in camp.
// A character = persona + tools + skill folders. The loop doesn't care who it's running.

import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolOutput } from "./tools.js";
import { wikiIndex } from "./wiki.js";
import { emit } from "./events.js";
import { identityBlock, type CrewId } from "./crew.js";
import { continuityBlock, ensureWorkspace, recordSession, type SessionSource } from "./memory.js";
import { requestText, type RequestContent } from "./attachments.js";
import { agentSettings, EFFORTS, type Effort } from "./settings.js";
import { currentLedger, currentQuestId, currentSignal } from "./context.js";
import { costOf, priceLabel, usd } from "./costs.js";
import { mcpToolsFor } from "./mcp.js";
export type { Effort } from "./settings.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_TOOL_OUTPUT = 10_000;
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

let modelCache: { at: number; models: ModelInfo[]; live: boolean } | null = null;

// The models this API key can use, with the effort levels each one supports (from the Models API).
export async function listModels(): Promise<{ models: ModelInfo[]; live: boolean }> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache;
  try {
    const models: ModelInfo[] = [];
    for await (const m of client.models.list()) {
      const caps = (m as unknown as { capabilities?: any }).capabilities;
      const efforts = EFFORTS.filter((level) => caps?.effort?.[level]?.supported);
      models.push({ id: m.id, name: m.display_name, efforts, price: priceLabel(m.id) });
    }
    if (!models.length) throw new Error("no models");
    modelCache = { at: Date.now(), models, live: true };
  } catch {
    modelCache = { at: Date.now() - 9 * 60_000, models: FALLBACK_MODELS, live: false }; // retry in a minute
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

export type AgentResult = {
  text: string;        // the character's final words: a report, or the Quartermaster's summary
  status: "done" | "refused" | "cut_off" | "out_of_turns" | "over_budget" | "stopped";
  turns: number;
  usage: Usage;
  model: string;
  effort?: Effort;
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
  ensureWorkspace(spec.id);
  // Order matters for caching and for the model: who you are first, then how you work,
  // then what you remember, then the shared camp knowledge.
  const system =
    `${identityBlock(spec.id)}\n\n## How you work\n${spec.persona}\n\n` +
    `${continuityBlock(spec.id)}\n\n## Your skills\n` +
    `When a task matches one, read its SKILL.md first and follow it.\n${skillIndex(spec.skillDirs)}` +
    `\n\n${wikiIndex()}` +
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
    recordSession(spec.id, { source: opts.source ?? "user", task: asked, result: result.text, status, messages });
    return result;
  };

  const budgetNote = () => `\n\n[Stopped: this expedition reached its ${usd(ledger?.budget ?? 0)} budget.]`;
  const signal = currentSignal(); // set when the user can press Stop
  const stoppedNote = "\n\n[Stopped by the user.]";

  for (turn = 1; turn <= (spec.maxTurns ?? 20); turn++) {
    if (signal?.aborted) {
      turn--;
      return finish("stopped", stoppedNote);
    }
    if (overBudget()) {
      turn--;
      return finish("over_budget", budgetNote());
    }
    const stream = client.beta.messages.stream({
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
    // No tool requested: this character is done.
    if (resp.stop_reason !== "tool_use") return finish("done");

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
        if (typeof out === "string" && out.length > MAX_TOOL_OUTPUT) out = out.slice(0, MAX_TOOL_OUTPUT) + "\n…[truncated]";
        return { type: "tool_result" as const, tool_use_id: block.id, content: out };
      })
    );
    messages.push({ role: "user", content: results });
  }
  turn--; // the loop counter ran one past the last turn
  return finish("out_of_turns", "\n\n[Stopped: ran out of turns before finishing.]");
}
