// Reading aloud: ElevenLabs turns a debrief (or any text the page hands over) into speech.
//
// Your ElevenLabs key is kept beside the other keys in camp/providers.json, readable only by you
// and off limits to the crew, and is never sent to the page. ELEVENLABS_API_KEY set where the camp
// starts is used instead. Which voice and model read is in camp/voice.json.
//
// Every piece of speech is kept in camp/voice-cache/ under a name made from its text, voice and
// model, so hearing the same thing again is instant and costs nothing. The oldest are cleared
// once there are more than CACHE_MAX.
//
// The page sends text a part at a time (ui/src/readaloud.ts splits it at sentences), so a long
// read starts after the first short part instead of after the whole thing.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeAtomic, writeJsonAtomic } from "./atomic.js";
import { emit } from "./events.js";
import { ProviderError, keepSideKey, sideKey } from "./providers.js";

export const VOICE_PATH = "camp/voice.json";
export const VOICE_CACHE = "camp/voice-cache";
const CACHE_MAX = 400;
// The most one request may ask to have read: a part is at most 1,800 characters (readaloud.ts).
export const SPEAK_MAX = 2500;
const CALL_TIMEOUT_MS = 20_000;
const SPEAK_TIMEOUT_MS = 60_000;

export const VOICE_MODELS = [
  { id: "eleven_multilingual_v2", name: "Multilingual v2 (best quality)" },
  { id: "eleven_flash_v2_5", name: "Flash v2.5 (fastest, half the cost)" },
  { id: "eleven_turbo_v2_5", name: "Turbo v2.5 (balanced)" },
] as const;

export type Voice = { id: string; name: string; about: string };
// ElevenLabs' own library voices, which any account can use, including with a key that isn't allowed to list voices.
export const LIBRARY_VOICES: Voice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", about: "American, calm" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", about: "American, soft" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", about: "American, upbeat" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", about: "British, confident" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", about: "American, friendly" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", about: "American, expressive" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", about: "British, warm" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", about: "American, confident" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", about: "Australian, natural" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", about: "British, warm" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", about: "Transatlantic, intense" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", about: "American, articulate" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", about: "American, friendly" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", about: "American, friendly" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", about: "American, casual" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", about: "American, deep" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", about: "British, authoritative" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", about: "American, trustworthy" },
];
const DEFAULTS = { voice: LIBRARY_VOICES[0].id, voiceName: LIBRARY_VOICES[0].name, model: VOICE_MODELS[0].id as string };

// Tests point this at a stand-in (ELEVENLABS_BASE_URL=http://127.0.0.1:…).
const baseUrl = () => (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io").replace(/\/+$/, "");
const envKey = () => process.env.ELEVENLABS_API_KEY?.trim() || undefined;
const key = () => envKey() ?? sideKey("elevenlabs");

type Prefs = typeof DEFAULTS;
function prefs(): Prefs {
  const kept = readJsonFile<Partial<Prefs>>(VOICE_PATH, {}) as Partial<Prefs> | null;
  return { ...DEFAULTS, ...(kept && typeof kept === "object" ? kept : {}) };
}

// What the page may know: whether there's a key and where it came from, and what reads. Never the key.
export function voiceState() {
  const p = prefs();
  return { connected: !!key(), from: envKey() ? "env" as const : sideKey("elevenlabs") ? "camp" as const : null, voice: p.voice, voiceName: p.voiceName, model: p.model, models: VOICE_MODELS };
}
export type VoiceState = ReturnType<typeof voiceState>;

// What ElevenLabs said went wrong, in its words when it gave any. code: its own name for the failure ("missing_permissions", "quota_exceeded"…).
async function problem(res: Response): Promise<{ message: string; code: string }> {
  let message = `ElevenLabs answered ${res.status}.`;
  let code = "";
  try {
    const j: any = await res.json();
    const d = j?.detail;
    message = (typeof d === "string" ? d : d?.message) || j?.message || message;
    code = typeof d?.status === "string" ? d.status : "";
  } catch { /* no JSON: the status says it */ }
  return { message, code };
}
async function call(path: string, init: RequestInit & { timeout?: number } = {}, k = key()): Promise<Response> {
  if (!k) throw new ProviderError("Connect ElevenLabs first, in Settings under Voice.");
  try {
    return await fetch(`${baseUrl()}${path}`, { ...init, headers: { "xi-api-key": k, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(init.timeout ?? CALL_TIMEOUT_MS) });
  } catch {
    throw new ProviderError("Couldn't reach ElevenLabs. Try again shortly.", { passing: true });
  }
}
// A key that may speak but not list voices answers 401 here too, with this code: it's still a good key.
const restricted = (status: number, p: { message: string; code: string }) => status === 401 && (p.code === "missing_permissions" || /permission/i.test(p.message));

// Keep a key once ElevenLabs has accepted it.
export async function connectVoice(given: unknown): Promise<VoiceState> {
  if (typeof given !== "string" || given.trim().length < 10 || /\s/.test(given.trim())) throw new ProviderError("That doesn't look like an API key.");
  const k = given.trim();
  const res = await call("/v1/voices", {}, k);
  if (!res.ok) {
    const p = await problem(res);
    if (!restricted(res.status, p)) throw new ProviderError(res.status === 401 ? "ElevenLabs didn't accept that key." : `Couldn't check the key with ElevenLabs: ${p.message}`);
  }
  keepSideKey("elevenlabs", k);
  emit({ type: "changed", what: "settings" });
  return voiceState();
}
export function disconnectVoice(): VoiceState {
  keepSideKey("elevenlabs", null);
  emit({ type: "changed", what: "settings" });
  return voiceState();
}

// The voices to choose from: everything on your account (clones included) when the key may list
// them, and ElevenLabs' library voices when it may not (limited: true).
export async function listVoices(): Promise<{ voices: Voice[]; limited: boolean }> {
  const res = await call("/v1/voices");
  if (!res.ok) {
    const p = await problem(res);
    if (restricted(res.status, p)) return { voices: LIBRARY_VOICES, limited: true };
    throw new ProviderError(res.status === 401 ? "ElevenLabs rejected the key. Connect it again in Settings under Voice." : p.message);
  }
  const j: any = await res.json().catch(() => ({}));
  const voices: Voice[] = (Array.isArray(j?.voices) ? j.voices : [])
    .filter((v: any) => typeof v?.voice_id === "string" && typeof v?.name === "string")
    .map((v: any) => ({ id: v.voice_id, name: v.name, about: [v.labels?.accent, v.labels?.description ?? v.labels?.style, v.category === "cloned" ? "your clone" : ""].filter((x) => typeof x === "string" && x).join(", ") }))
    .sort((a: Voice, b: Voice) => a.name.localeCompare(b.name));
  return voices.length ? { voices, limited: false } : { voices: LIBRARY_VOICES, limited: true };
}

const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
export function setVoice(o: { voice?: unknown; voiceName?: unknown; model?: unknown }): VoiceState {
  const now = prefs();
  if (o.model != null) {
    if (!VOICE_MODELS.some((m) => m.id === o.model)) throw new ProviderError(`Unknown voice model "${String(o.model)}".`);
    now.model = String(o.model);
  }
  if (o.voice != null) {
    const id = String(o.voice).trim();
    if (!VOICE_ID.test(id)) throw new ProviderError("That doesn't look like an ElevenLabs voice ID.");
    now.voice = id;
    now.voiceName = (typeof o.voiceName === "string" && o.voiceName.trim().slice(0, 80)) || LIBRARY_VOICES.find((v) => v.id === id)?.name || id;
  }
  writeJsonAtomic(VOICE_PATH, now);
  emit({ type: "changed", what: "settings" });
  return voiceState();
}

// ---------- Speech ----------
const cachePath = (text: string, p: Prefs) => join(VOICE_CACHE, `${createHash("sha256").update(`${p.model}\n${p.voice}\n${text}`).digest("hex")}.mp3`);
function prune() {
  try {
    const files = readdirSync(VOICE_CACHE).filter((f) => f.endsWith(".mp3"));
    if (files.length <= CACHE_MAX) return;
    const byAge = files.map((f) => ({ f, at: statSync(join(VOICE_CACHE, f)).mtimeMs })).sort((a, b) => a.at - b.at);
    for (const { f } of byAge.slice(0, files.length - CACHE_MAX)) rmSync(join(VOICE_CACHE, f), { force: true });
  } catch { /* clearing old speech is a nicety: reading goes on without it */ }
}

// One part of a read, as MP3. cached: it was already here, so ElevenLabs wasn't asked (or charged).
export async function speak(given: unknown): Promise<{ audio: Buffer; cached: boolean }> {
  const text = typeof given === "string" ? given.replace(/\s+/g, " ").trim() : "";
  if (!text) throw new ProviderError("There's nothing to read.");
  if (text.length > SPEAK_MAX) throw new ProviderError(`That's too long to read in one go (${text.length} characters; ${SPEAK_MAX} at most).`);
  const p = prefs();
  const at = cachePath(text, p);
  if (existsSync(at)) {
    const now = new Date();
    try { utimesSync(at, now, now); } catch { /* still there to read */ }
    return { audio: readFileSync(at), cached: true };
  }
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(p.voice)}?output_format=mp3_44100_128`, {
    method: "POST", timeout: SPEAK_TIMEOUT_MS,
    headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: p.model }),
  });
  if (!res.ok) {
    const e = await problem(res);
    if (e.code === "quota_exceeded") throw new ProviderError("Your ElevenLabs plan has no characters left this month.", { status: res.status });
    if (res.status === 401) throw new ProviderError("ElevenLabs rejected the key. Connect it again in Settings under Voice.", { status: 401 });
    throw new ProviderError(e.message, { status: res.status, passing: res.status === 429 || res.status >= 500 });
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length) throw new ProviderError("ElevenLabs sent back no sound.", { passing: true });
  try {
    mkdirSync(VOICE_CACHE, { recursive: true });
    writeAtomic(at, audio);
    prune();
  } catch { /* it's read this once all the same */ }
  return { audio, cached: false };
}
