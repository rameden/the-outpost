// Other models: DeepSeek, Gemini, Groq, OpenAI (ChatGPT's models) and OpenRouter, beside Claude.
//
// All five accept the same request shape (OpenAI's chat completions), so one adapter serves
// them. A model from one of them is named "<provider>:<model>" wherever the camp names a model
// ("groq:llama-3.3-70b-versatile"), and anything named that way is sent here instead of to
// Claude. The camp's own loop stays the same: this file turns its request into the provider's
// shape and the provider's reply back into the camp's.
//
// Your keys are kept in camp/providers.json, readable only by you and off limits to every crew
// member, and are never sent to the page. Each one is checked with the provider before it's kept.
// DEEPSEEK_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY and OPENROUTER_API_KEY set where
// the camp starts are used instead.
//
// What these providers don't have: Claude's web search and fetch (those tools are left out for a
// crew member running on one), effort levels, and a cost estimate (their usage counts as $0 here).
// DeepSeek is the exception on cost: it sells its own two models at listed prices, so costs.ts has them.

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emit } from "./events.js";
import { providerApproved, setProviderApproved } from "./settings.js";
import { writeJsonAtomic } from "./atomic.js";
import { fileStamp } from "./helpers.js";

export const PROVIDERS_PATH = "camp/providers.json";
export type ProviderId = "deepseek" | "gemini" | "groq" | "openai" | "openrouter";
// check: a path that only answers a valid key. OpenRouter's model list is public, so listing it proves nothing about a key.
// thinks: its models reason before they answer, and want that reasoning sent back with every later
// request of a run (DeepSeek answers 400 without it once tools are in play). paid: you pay by the
// token, and its limit is on requests at once rather than a free tier's requests a minute.
// completionTokens: it wants the reply's allowance as max_completion_tokens (OpenAI's reasoning
// models answer 400 to max_tokens). chat: which of its listed models can hold a conversation here.
// maxOut: the most a model may be asked to write, where it's less than the camp asks for.
// reasons: this model thinks before it answers, and that thinking counts against the allowance.
// tools: how this model calls tools through chat completions: "plain" only with its thinking
// turned off, "no" not at all (it needs OpenAI's Responses API, which the camp doesn't speak).
type Preset = { id: ProviderId; name: string; baseUrl: string; env: string; keysAt: string; privacy: string; check?: string; thinks?: true; paid?: true;
  completionTokens?: true; chat?: (id: string) => boolean; blind?: (id: string) => boolean; maxOut?: (id: string) => number | undefined; reasons?: (id: string) => boolean;
  tools?: (id: string) => "plain" | "no" | undefined; title?: (id: string) => string };
// OpenAI lists everything it sells under /models: images, speech, embeddings, moderation, and
// models that only its newer Responses API serves (the -pro and codex ones). Only the chat models
// are kept, and not their dated snapshots (gpt-4o-2024-08-06), which would crowd the pickers.
const openaiChat = (id: string) => /^(gpt-\d|chatgpt-|o[1-9])/.test(id) && !/^gpt-(3\.5|4)(-|$)/.test(id)
  && !/image|dall-e|moderation|realtime|audio|transcribe|tts|search|computer-use|instruct|codex|deep-research|embedding|cyber|rosalind|-pro(-|$)/.test(id)
  && !/-\d{4}(-\d{2}-\d{2})?$/.test(id);
// From OpenAI's model pages (developers.openai.com/api/docs/models, November 2026): GPT-6.1 Terra
// calls tools only through the Responses API; GPT-6 Luna, through chat completions, only with its
// reasoning effort set to none.
export const openaiTools = (id: string): "plain" | "no" | undefined => (/^gpt-6(\.\d+)?-terra/.test(id) ? "no" : /^gpt-6(\.\d+)?-luna/.test(id) ? "plain" : undefined);
export const PROVIDERS: Preset[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", env: "DEEPSEEK_API_KEY", keysAt: "https://platform.deepseek.com/api_keys", thinks: true, paid: true,
    privacy: "A Chinese company: its privacy policy says what it collects is kept in China. You pay up front, by the token. Check its terms cover your work before sending anything confidential." },
  { id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", env: "GEMINI_API_KEY", keysAt: "https://aistudio.google.com/apikey",
    privacy: "On the free tier, Google may use what you send to improve its products. Don't send it confidential work." },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", env: "GROQ_API_KEY", keysAt: "https://console.groq.com/keys",
    privacy: "Runs open models fast, with a free tier that's rate-limited. Check its data terms before sending anything confidential." },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", env: "OPENAI_API_KEY", keysAt: "https://platform.openai.com/api-keys", paid: true, completionTokens: true,
    chat: openaiChat, blind: (id) => /^o[13]-mini/.test(id), maxOut: (id) => (/4o/.test(id) ? 16_384 : undefined),
    reasons: (id) => /^(o[1-9]|gpt-([5-9]|\d{2}))/.test(id) && !/chat/.test(id), tools: openaiTools,
    title: (id) => id.replace(/^chatgpt/, "ChatGPT").replace(/^gpt/, "GPT"),
    privacy: "ChatGPT's models (GPT-6 and earlier), through OpenAI's API. Billed by the token from platform.openai.com, separately from a ChatGPT Plus or Pro subscription. OpenAI says it doesn't train on what's sent through its API unless you opt in." },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", env: "OPENROUTER_API_KEY", keysAt: "https://openrouter.ai/keys", check: "/key",
    privacy: "Passes your request on to whichever company hosts the model. Models marked free are often free because your prompts may be used for training." },
];
const preset = (id: string) => PROVIDERS.find((p) => p.id === id);
// Tests and the throwaway camp point a provider at a stand-in (PROVIDER_BASE_URL_GROQ=http://127.0.0.1:…).
const baseUrl = (p: Preset) => (process.env[`PROVIDER_BASE_URL_${p.id.toUpperCase()}`] ?? p.baseUrl).replace(/\/+$/, "");

// passing: a failure that may clear by itself (rate limited, overloaded, the connection dropped):
// Auto tries another model; a model you picked yourself says so and stops. retryAfterMs: how long
// the provider asked to be left alone, when it said.
export class ProviderError extends Error {
  fixable = true;
  passing = false;
  status?: number;
  retryAfterMs?: number;
  constructor(message: string, o: { passing?: boolean; status?: number; retryAfterMs?: number } = {}) {
    super(message);
    if (o.passing) this.passing = true;
    if (o.status != null) this.status = o.status;
    if (o.retryAfterMs != null) this.retryAfterMs = o.retryAfterMs;
  }
}

// ---------- Keys ----------
// A key for something that isn't a model (ElevenLabs, which reads aloud: voice.ts), kept in the same file under the same care.
export type SideKey = "elevenlabs";
type Saved = Partial<Record<ProviderId | "anthropic" | SideKey, { key: string; connected: string }>>;
let savedCache: { stamp: string; s: Saved } | null = null;
function load(): Saved {
  const stamp = fileStamp(PROVIDERS_PATH);
  if (savedCache?.stamp === stamp) return savedCache.s;
  let s: Saved = {};
  try { s = existsSync(PROVIDERS_PATH) ? (JSON.parse(readFileSync(PROVIDERS_PATH, "utf8")) as Saved) : {}; } catch { s = {}; }
  savedCache = { stamp, s };
  return s;
}
function save(s: Saved) {
  if (!Object.keys(s).length) { rmSync(PROVIDERS_PATH, { force: true }); savedCache = { stamp: fileStamp(PROVIDERS_PATH), s: {} }; return; }
  writeJsonAtomic(PROVIDERS_PATH, s, { mode: 0o600 });
  savedCache = { stamp: fileStamp(PROVIDERS_PATH), s };
}
function keyOf(p: Preset): { key: string; from: "env" | "camp" } | null {
  const env = process.env[p.env]?.trim();
  if (env) return { key: env, from: "env" };
  const kept = load()[p.id]?.key;
  return kept ? { key: kept, from: "camp" } : null;
}

export const sideKey = (id: SideKey): string | undefined => load()[id]?.key || undefined;
export function keepSideKey(id: SideKey, key: string | null) {
  const saved = load();
  if (key === null) delete saved[id];
  else saved[id] = { key, connected: new Date().toISOString() };
  save(saved);
}

export const anthropicKey = (): string | undefined => load().anthropic?.key || process.env.ANTHROPIC_API_KEY?.trim() || undefined;
export function anthropicKeyState() {
  const saved = !!load().anthropic?.key;
  const environment = !!process.env.ANTHROPIC_API_KEY?.trim();
  return { connected: saved || environment, saved, environment, from: saved ? "camp" as const : environment ? "env" as const : null };
}
export async function setAnthropicKey(key: unknown) {
  if (key === null) {
    const saved = load();
    delete saved.anthropic;
    save(saved);
  } else {
    if (typeof key !== "string" || key.trim().length < 10 || /\s/.test(key.trim())) throw new ProviderError("That doesn't look like an API key.");
    const value = key.trim();
    try {
      await new Anthropic({ apiKey: value, timeout: 20_000, maxRetries: 0 }).models.list({ limit: 1 });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ProviderError("Anthropic didn't accept that key.");
      throw new ProviderError("Couldn't verify the key with Anthropic. Try again shortly.");
    }
    save({ ...load(), anthropic: { key: value, connected: new Date().toISOString() } });
  }
  emit({ type: "changed", what: "settings" });
  return anthropicKeyState();
}

// A request with no Stop signal of its own (listing models, checking a key) gives up after this
// long, so a provider that has stopped answering can't hold up the page or a run's start.
const CALL_TIMEOUT_MS = 20_000;
// When a provider says "slow down" and says for how long (free tiers do, often), wait and ask
// again rather than ending the run: up to this many times, and only for waits this short.
const RATE_RETRIES = 2;
const RATE_WAIT_MAX_MS = 30_000;
const waitFor = (ms: number, signal?: AbortSignal | null) => new Promise<void>((ok, no) => {
  const stop = () => { clearTimeout(timer); no(Object.assign(new Error("Stopped."), { name: "AbortError" })); };
  if (signal?.aborted) return stop();
  const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); ok(); }, ms);
  signal?.addEventListener("abort", stop, { once: true });
});

async function call(p: Preset, key: string, path: string, init: RequestInit = {}, retries = 0): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(p)}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(p.id === "openrouter" ? { "x-title": "Outpost" } : {}), ...(init.headers ?? {}) } });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new ProviderError(e?.name === "TimeoutError" ? `${p.name} didn't answer within ${CALL_TIMEOUT_MS / 1000} seconds.` : `Couldn't reach ${p.name}: ${e?.message ?? e}`, { passing: true });
  }
  if (res.ok) return res;
  if (res.status === 429 && retries > 0) {
    const after = Number(res.headers.get("retry-after"));
    if (Number.isFinite(after) && after >= 0 && after * 1000 <= RATE_WAIT_MAX_MS) {
      await res.body?.cancel().catch(() => {});
      await waitFor(Math.max(250, after * 1000), init.signal);
      return call(p, key, path, init, retries - 1);
    }
  }
  const body = await res.text().catch(() => "");
  const afterS = Number(res.headers.get("retry-after"));
  const passing = { passing: res.status === 429 || res.status === 408 || res.status >= 500, status: res.status, ...(Number.isFinite(afterS) && afterS >= 0 && res.headers.has("retry-after") ? { retryAfterMs: afterS * 1000 } : {}) };
  let said = "";
  try { const j = JSON.parse(body); said = String((Array.isArray(j) ? j[0] : j)?.error?.message ?? j?.message ?? ""); } catch { said = body.slice(0, 200); }
  // Gemini answers a bad key with 400 ("Please pass a valid API key"), not 401.
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(said))) throw new ProviderError(`${p.name} didn't accept that key${said ? `: ${said}` : "."}`);
  // DeepSeek is paid for up front: 402 means the balance is spent.
  if (res.status === 402) throw new ProviderError(`${p.name} says your balance has run out${said ? `: ${said}` : "."} Top up with ${p.name}, then try again.`);
  // OpenAI says the same with 429 and insufficient_quota: no credit left, which waiting won't fix.
  let code = "";
  try { code = String(JSON.parse(body)?.error?.code ?? ""); } catch {}
  if (res.status === 429 && code === "insufficient_quota") throw new ProviderError(`${p.name} says your account has no credit left${said ? `: ${said}` : "."} Add credit with ${p.name}, then try again.`, { status: 429 });
  if (res.status === 429) throw new ProviderError(`${p.name} says you've hit its rate limit${said ? `: ${said}` : "."} ${p.paid ? "It allows only so many requests at once." : "Free tiers allow only so many requests a minute."}`, passing);
  throw new ProviderError(`${p.name} answered ${res.status}${said ? `: ${said}` : "."}`, passing);
}

// ---------- Models ----------
// noImages: the provider says this model takes text only (DeepSeek lists what each model can be shown).
export type ProviderModel = { id: string; name: string; free?: boolean; noImages?: true };
const modelCache = new Map<string, { at: number; models: ProviderModel[] }>();
async function fetchModels(p: Preset, key: string): Promise<ProviderModel[]> {
  const j: any = await (await call(p, key, "/models")).json();
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  return list.flatMap((m): ProviderModel[] => {
    const id = String(m?.id ?? "").replace(/^models\//, ""); // Gemini lists "models/gemini-…"
    if (!id || /embed|whisper|tts|guard|imagen|veo|aqa/i.test(id) || (p.chat && !p.chat(id))) return []; // not for conversation
    const free = p.id === "openrouter" && (id.endsWith(":free") || (m?.pricing?.prompt === "0" && m?.pricing?.completion === "0"));
    const blind = (Array.isArray(m?.input_modalities) && !m.input_modalities.includes("image")) || !!p.blind?.(id);
    return [{ id, name: String(m?.name ?? m?.display_name ?? p.title?.(id) ?? id), ...(free ? { free: true } : {}), ...(blind ? { noImages: true as const } : {}) }];
  }).sort((a, b) => Number(!!b.free) - Number(!!a.free) || a.id.localeCompare(b.id));
}
// A provider's conversational models (cached for ten minutes). Empty if it isn't connected.
export async function providerModels(id: string): Promise<ProviderModel[]> {
  const p = preset(id);
  const k = p && keyOf(p);
  if (!p || !k) return [];
  const at = `${process.cwd()}|${id}`;
  const hit = modelCache.get(at);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const models = await fetchModels(p, k.key);
  modelCache.set(at, { at: Date.now(), models });
  return models;
}

// For the page: which are connected and how, never the key itself.
// approved: you've said this provider may be sent confidential projects' work.
export type ProviderState = { id: ProviderId; name: string; connected: boolean; from?: "env" | "camp"; since?: string; keysAt: string; privacy: string; models: number; free: number; approved: boolean };
export function providersState(): ProviderState[] {
  return PROVIDERS.map((p) => {
    const k = keyOf(p);
    const models = modelCache.get(`${process.cwd()}|${p.id}`)?.models ?? [];
    return { id: p.id, name: p.name, connected: !!k, ...(k ? { from: k.from } : {}), ...(k?.from === "camp" ? { since: load()[p.id]?.connected } : {}),
      keysAt: p.keysAt, privacy: p.privacy, models: models.length, free: models.filter((m) => m.free).length, approved: providerApproved(p.id) };
  });
}
// Keep a key, once the provider has accepted it (by listing its models).
export async function connectProvider(id: string, key: unknown): Promise<ProviderState> {
  const p = preset(id);
  if (!p) throw new ProviderError("There's no such provider.");
  const k = String(key ?? "").trim();
  if (k.length < 10 || /\s/.test(k)) throw new ProviderError("That doesn't look like an API key.");
  if (p.check) await call(p, k, p.check);
  const models = await fetchModels(p, k);
  save({ ...load(), [p.id]: { key: k, connected: new Date().toISOString() } });
  modelCache.set(`${process.cwd()}|${p.id}`, { at: Date.now(), models });
  emit({ type: "changed", what: "settings" });
  return providersState().find((s) => s.id === p.id)!;
}
export function disconnectProvider(id: string): boolean {
  const s = load();
  if (!preset(id) || !s[id as ProviderId]) return false;
  delete s[id as ProviderId];
  save(s);
  setProviderApproved(id, false); // an approval belongs to the key it was given for
  modelCache.delete(`${process.cwd()}|${id}`);
  emit({ type: "changed", what: "settings" });
  return true;
}

// Say (or take back) that a provider may be sent confidential projects' work.
export function approveProvider(id: string, on: boolean): boolean {
  if (!preset(id)) return false;
  setProviderApproved(id, on);
  emit({ type: "changed", what: "settings" });
  return true;
}
// May this provider be sent text from this project? Always, unless the project is confidential
// (web: careful, or off) and you haven't approved the provider for that.
export const maySend = (provider: string, web: string | undefined) => !(web === "careful" || web === "off") || providerApproved(provider);

// ---------- Naming a model ----------
// "groq:llama-3.3-70b-versatile" → that provider and its model; a Claude model (no prefix) → null.
const NAMED = new RegExp(`^(${PROVIDERS.map((p) => p.id).join("|")}):(.+)$`);
export function otherModel(model: string | undefined): { provider: ProviderId; name: string; model: string } | null {
  const m = String(model ?? "").match(NAMED);
  return m ? { provider: m[1] as ProviderId, name: preset(m[1])!.name, model: m[2] } : null;
}

// ---------- One reply ----------
// The camp speaks Anthropic's message shape; these turn it into the provider's and back.
type Block = { type: string; [k: string]: any };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
export type ProviderReply = { content: Block[]; stop_reason: "end_turn" | "tool_use" | "max_tokens" | "refusal"; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } };

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (b?.type === "text" ? b.text : b?.type === "image" ? "[an image]" : "")).join("\n") : String(c ?? ""));

// reasoning: send each reply's thinking back as reasoning_content (see "thinks" above).
// images: false for a model that can't be shown them, so a picture is named in words instead.
export function toChatMessages(system: string, messages: Msg[], o: { reasoning?: boolean; images?: boolean } = {}): any[] {
  const out: any[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const calls = m.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      const thought = o.reasoning ? { reasoning_content: m.content.filter((b) => b.type === "thinking").map((b) => String(b.thinking ?? "")).join("\n") } : {};
      out.push({ role: "assistant", content: text || null, ...thought, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // A user turn: each tool result is a message of its own, before anything said alongside them.
    for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: textOf(b.content) || "(no output)" });
    const parts = m.content.flatMap((b): any[] =>
      b.type === "text" ? [{ type: "text", text: b.text }]
      : b.type === "image" && o.images === false ? [{ type: "text", text: "[An image was attached. This model can't be shown images: say so, or ask for what's in it.]" }]
      : b.type === "image" && b.source?.type === "base64" ? [{ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }]
      : b.type === "document" ? [{ type: "text", text: "[A PDF was attached. This model can't be shown PDFs here: read its text another way or say so.]" }]
      : []);
    if (parts.length) out.push({ role: "user", content: parts.every((p) => p.type === "text") ? parts.map((p) => p.text).join("\n") : parts });
  }
  return out;
}
// The camp's own tools, as functions. Claude's server tools (web search, web fetch) have no input
// schema of ours and no equivalent here, so they're left out.
export function toChatTools(defs: any[]): any[] {
  return defs.filter((d) => d && typeof d.name === "string" && d.input_schema).map((d) => ({ type: "function", function: { name: d.name, description: String(d.description ?? "").slice(0, 4000), parameters: d.input_schema } }));
}

// Ask a provider for one reply, streaming the words as they come.
// quick: a short answer is wanted, so a model that thinks first is told not to (its thinking
// counts against max_tokens, and would use up a small job's whole allowance before a word is said).
export async function providerChat(o: { provider: string; model: string; system: string; messages: Msg[]; tools?: any[]; maxTokens?: number; signal?: AbortSignal; onDelta?: (text: string) => void; quick?: boolean }): Promise<ProviderReply> {
  const p = preset(o.provider);
  const k = p && keyOf(p);
  if (!p || !k) throw new ProviderError(`${p?.name ?? o.provider} isn't connected. Add its key under Settings → Models.`);
  const tools = toChatTools(o.tools ?? []);
  const toolWay = tools.length ? p.tools?.(o.model) : undefined;
  if (toolWay === "no") throw new ProviderError(`${o.model} can only call tools through ${p.name}'s Responses API, which this outpost doesn't use. Pick another model for work that uses tools; it can still do small jobs.`);
  // A picture goes as words to a model its provider lists as text-only (the list is cached).
  const pictured = o.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image"));
  const blind = pictured && !!(await providerModels(p.id).catch(() => [])).find((m) => m.id === o.model)?.noImages;
  // A model that reasons first spends part of its allowance thinking, so a small job's few dozen
  // tokens would go before a word was written: it's asked to think briefly and given room to.
  const reasons = !!p.reasons?.(o.model);
  const allowance = Math.min(Math.max(o.maxTokens ?? 8192, reasons && o.quick ? 2048 : 0), p.maxOut?.(o.model) ?? Infinity);
  const res = await call(p, k.key, "/chat/completions", {
    method: "POST", signal: o.signal,
    body: JSON.stringify({ model: o.model, messages: toChatMessages(o.system, o.messages, { reasoning: !!p.thinks, images: !blind }), ...(tools.length ? { tools } : {}),
      [p.completionTokens ? "max_completion_tokens" : "max_tokens"]: allowance,
      ...(p.thinks && o.quick ? { thinking: { type: "disabled" } } : {}), ...(toolWay === "plain" ? { reasoning_effort: "none" } : reasons && o.quick ? { reasoning_effort: "low" } : {}), stream: true, stream_options: { include_usage: true } }),
  }, RATE_RETRIES);
  let text = "", thought = "", finish = "", buffer = "";
  const calls: { id: string; name: string; args: string }[] = [];
  const usage: ProviderReply["usage"] = { input_tokens: 0, output_tokens: 0 };
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: any;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new ProviderError(`${p.name}: ${j.error.message ?? "the request failed"}`);
    if (j.usage) {
      usage.input_tokens = j.usage.prompt_tokens ?? usage.input_tokens;
      usage.output_tokens = j.usage.completion_tokens ?? usage.output_tokens;
      // DeepSeek says how much of the prompt it had cached, which it charges far less for.
      // OpenAI says so as prompt_tokens_details.cached_tokens.
      const hit = Number(j.usage.prompt_cache_hit_tokens ?? j.usage.prompt_tokens_details?.cached_tokens);
      if (hit > 0 && hit <= usage.input_tokens) { usage.input_tokens -= hit; usage.cache_read_input_tokens = hit; }
    }
    const choice = j.choices?.[0];
    if (!choice) return;
    const d = choice.delta ?? choice.message ?? {};
    if (typeof d.content === "string" && d.content) { text += d.content; o.onDelta?.(d.content); }
    if (p.thinks && typeof d.reasoning_content === "string") thought += d.reasoning_content;
    for (const tc of d.tool_calls ?? []) {
      const at = typeof tc.index === "number" ? tc.index : calls.length;
      const slot = (calls[at] ??= { id: "", name: "", args: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (typeof tc.function?.arguments === "string") slot.args += tc.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderError(`${p.name} sent nothing back.`);
  const decode = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decode.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) { take(buffer.slice(0, nl).trim()); buffer = buffer.slice(nl + 1); }
  }
  if (buffer.trim()) take(buffer.trim());
  // DeepSeek's two ways of saying it gave up part-way: neither is a finished reply.
  if (finish === "insufficient_system_resource") throw new ProviderError(`${p.name} ran out of capacity part-way through the reply. Try again in a moment.`, { passing: true });
  if (finish === "aborted") throw new ProviderError(`${p.name} stopped the reply part-way. Try again.`, { passing: true });
  // A stream that ended without saying how it finished was cut off: a tool call in it may be
  // missing part of its input, so none of it is used (and none of its calls run).
  if (!finish) throw new ProviderError(`${p.name}'s reply was cut off part-way.`, { passing: true });

  const content: Block[] = [];
  if (thought) content.push({ type: "thinking", thinking: thought }); // kept with the reply, so the next request can send it back
  if (text.trim()) content.push({ type: "text", text });
  let cut = false;
  for (const [i, c] of calls.filter(Boolean).entries()) {
    let input: unknown = {};
    try { input = c.args.trim() ? JSON.parse(c.args) : {}; } catch { cut = true; } // arguments that don't parse were cut off: don't run them
    content.push({ type: "tool_use", id: c.id || `call_${Date.now()}_${i}`, name: c.name, input });
  }
  const hasCalls = content.some((b) => b.type === "tool_use");
  const stop_reason = cut || finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : hasCalls ? "tool_use" : "end_turn";
  return { content, stop_reason, usage };
}

// One short answer, no tools (the camp's own small jobs).
export async function providerAsk(ref: { provider: string; model: string }, system: string, prompt: string, maxTokens = 1500): Promise<string> {
  const r = await providerChat({ ...ref, system, messages: [{ role: "user", content: prompt }], maxTokens, quick: true });
  return r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}
