// Reading aloud (voice.ts): connecting ElevenLabs with a key, what's kept and what's shown,
// choosing a voice, and speech that's asked for once and kept. A stand-in plays ElevenLabs.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { enterSandbox, WINDOWS } from "./helpers/sandbox.ts";

enterSandbox("voice");

const GOOD = "sk_good-key-123456";
const SPEAK_ONLY = "sk_speak-only-123456"; // may speak, may not list voices
const seen: { path: string; key: string; body: any }[] = [];
let speakStatus: { status: number; detail: object } | null = null;
const eleven = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const key = String(req.headers["xi-api-key"] ?? "");
    seen.push({ path: req.url ?? "", key, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: object) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (key !== GOOD && key !== SPEAK_ONLY) return json(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    if (req.url === "/v1/voices") {
      if (key === SPEAK_ONLY) return json(401, { detail: { status: "missing_permissions", message: "The API key you used is missing the permission voices_read" } });
      return json(200, { voices: [
        { voice_id: "zzzzClone0000000000001", name: "Ryley", category: "cloned", labels: { accent: "Australian" } },
        { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", labels: { accent: "American", description: "calm" } },
      ] });
    }
    if (req.url?.startsWith("/v1/text-to-speech/")) {
      if (speakStatus) return json(speakStatus.status, { detail: speakStatus.detail });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(Buffer.from(`mp3:${JSON.parse(raw).text}`));
    }
    json(404, { detail: "Not found" });
  });
});
await new Promise<void>((ok) => eleven.listen(0, "127.0.0.1", ok));
process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${(eleven.address() as AddressInfo).port}`;
delete process.env.ELEVENLABS_API_KEY;
after(() => eleven.close());

const { connectVoice, disconnectVoice, listVoices, setVoice, speak, voiceState, LIBRARY_VOICES, VOICE_CACHE, SPEAK_MAX } = await import("../src/voice.ts");
const { PROVIDERS_PATH } = await import("../src/providers.ts");

beforeEach(() => { seen.length = 0; speakStatus = null; });

test("a key is kept only once ElevenLabs accepts it, and the page never gets it", async () => {
  assert.equal(voiceState().connected, false);
  await assert.rejects(connectVoice("short"), /doesn't look like an API key/);
  await assert.rejects(connectVoice("sk_wrong-key-123456"), /didn't accept that key/);
  assert.equal(existsSync(PROVIDERS_PATH), false);

  const state = await connectVoice(`  ${GOOD}  `);
  assert.equal(state.connected, true);
  assert.equal(state.from, "camp");
  assert.equal(JSON.stringify(state).includes(GOOD), false);
  assert.equal(JSON.parse(readFileSync(PROVIDERS_PATH, "utf8")).elevenlabs.key, GOOD);
  if (!WINDOWS) assert.equal(statSync(PROVIDERS_PATH).mode & 0o777, 0o600);
});

test("your account's voices are listed by name, clones marked", async () => {
  const { voices, limited } = await listVoices();
  assert.equal(limited, false);
  assert.deepEqual(voices.map((v) => v.name), ["Rachel", "Ryley"]);
  assert.match(voices[1].about, /your clone/);
});

test("the voice and model that read can be changed, and a made-up model can't", () => {
  const s = setVoice({ voice: "zzzzClone0000000000001", voiceName: "Ryley", model: "eleven_flash_v2_5" });
  assert.deepEqual([s.voice, s.voiceName, s.model], ["zzzzClone0000000000001", "Ryley", "eleven_flash_v2_5"]);
  assert.throws(() => setVoice({ model: "eleven_made_up" }), /Unknown voice model/);
  assert.throws(() => setVoice({ voice: "../../etc" }), /voice ID/);
  assert.equal(voiceState().voice, "zzzzClone0000000000001");
});

test("speech is asked for once and kept: the same text again doesn't reach ElevenLabs", async () => {
  const first = await speak("Went well:   the tests passed.");
  assert.equal(first.cached, false);
  assert.equal(first.audio.toString(), "mp3:Went well: the tests passed.");
  const asked = seen.at(-1)!;
  assert.equal(asked.path, "/v1/text-to-speech/zzzzClone0000000000001?output_format=mp3_44100_128");
  assert.deepEqual(asked.body, { text: "Went well: the tests passed.", model_id: "eleven_flash_v2_5" });
  assert.equal(asked.key, GOOD);

  seen.length = 0;
  const again = await speak("Went well: the tests passed.");
  assert.equal(again.cached, true);
  assert.equal(again.audio.toString(), first.audio.toString());
  assert.equal(seen.length, 0);
  assert.equal(readdirSync(VOICE_CACHE).length, 1);

  // Another voice is another piece of speech.
  setVoice({ voice: LIBRARY_VOICES[0].id });
  assert.equal((await speak("Went well: the tests passed.")).cached, false);
});

test("nothing, and too much, are refused before ElevenLabs is asked", async () => {
  await assert.rejects(speak("   "), /nothing to read/);
  await assert.rejects(speak("a".repeat(SPEAK_MAX + 1)), /too long/);
  await assert.rejects(speak(undefined), /nothing to read/);
  assert.equal(seen.length, 0);
});

test("what ElevenLabs says went wrong is passed on plainly, and nothing is kept", async () => {
  const before = readdirSync(VOICE_CACHE).length;
  speakStatus = { status: 401, detail: { status: "quota_exceeded", message: "You have 0 credits remaining" } };
  await assert.rejects(speak("Out of characters."), /no characters left/);
  speakStatus = { status: 400, detail: { status: "voice_not_found", message: "A voice with that ID was not found." } };
  await assert.rejects(speak("No such voice."), /was not found/);
  assert.equal(readdirSync(VOICE_CACHE).length, before);
});

test("a key that may speak but not list voices is accepted, and offers the library voices", async () => {
  disconnectVoice();
  assert.equal(voiceState().connected, false);
  await assert.rejects(speak("Hello."), /Connect ElevenLabs first/);

  assert.equal((await connectVoice(SPEAK_ONLY)).connected, true);
  const { voices, limited } = await listVoices();
  assert.equal(limited, true);
  assert.deepEqual(voices, LIBRARY_VOICES);
  assert.equal((await speak("Hello there.")).audio.toString(), "mp3:Hello there.");
});

test("a key set where the camp starts is used, and says so", () => {
  disconnectVoice();
  process.env.ELEVENLABS_API_KEY = GOOD;
  try { assert.deepEqual([voiceState().connected, voiceState().from], [true, "env"]); }
  finally { delete process.env.ELEVENLABS_API_KEY; }
});
