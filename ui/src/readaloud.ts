// Reading aloud: text goes to the camp a part at a time (/api/voice/speak, which asks ElevenLabs
// or finds the speech it already has), and each part plays as it arrives. The first part is short
// so the voice starts quickly; the next is fetched while the current one plays.
//
// One thing is read at a time: starting another read stops the one that's playing.

import { TOKEN, errorText, storeGet, storeSet } from "./api.ts";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SPEED_KEY = "camp-voice-speed";
export function keptSpeed(): number {
  const v = Number(storeGet(SPEED_KEY));
  return SPEEDS.includes(v) ? v : 1;
}

// Split text into parts that end on a sentence. A sentence longer than a part is cut at a space.
export function chunkText(text: string, firstMax = 500, max = 1800): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g) ?? [clean];
  const parts: string[] = [];
  let cur = "";
  let limit = firstMax;
  for (let s of sentences) {
    while (s.length > max) {
      const cut = s.lastIndexOf(" ", max);
      const head = s.slice(0, cut > 0 ? cut : max);
      if (cur) { parts.push(cur.trim()); cur = ""; limit = max; }
      parts.push(head.trim());
      s = s.slice(head.length).trimStart();
    }
    if ((cur + s).length > limit && cur) {
      parts.push(cur.trim());
      cur = s;
      limit = max;
    } else cur += s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Markdown as it should be said: no code blocks, link addresses, table rules or list marks, and
// every heading, item and row ending like a sentence so the voice pauses there.
export function spoken(markdown: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let code = false;
  const done = (s: string) => (/[.!?:;。！？]["'”’)\]]*$/.test(s) ? s : `${s}.`);
  const flush = () => { if (para.length) out.push(done(para.join(" "))); para = []; };
  for (const raw of String(markdown ?? "").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      if (!code) out.push("There's a code block here.");
      code = !code;
      continue;
    }
    if (code) continue;
    let line = raw.trim().replace(/^(>\s*)+/, "");
    if (!line) { flush(); continue; }
    if (/^([-*_])(\s*\1){2,}$/.test(line) || /^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) { flush(); continue; } // a rule, or a table's own
    const own = /^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/.exec(line);
    const row = /^\|.*\|$/.test(line);
    if (own) line = line.slice(own[0].length).replace(/\s+#+$/, "");
    if (row) line = line.slice(1, -1).split("|").map((c) => c.trim()).filter(Boolean).join(", ");
    line = line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<?https?:\/\/(?:www\.)?([^\s/>)]+)[^\s>)]*>?/g, "a link to $1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=[\s).,;:!?]|$)/g, "$1$3")
      .replace(/`+([^`]*)`+/g, "$1")
      .trim();
    if (!line) continue;
    if (own || row) { flush(); out.push(done(line)); } else para.push(line);
  }
  flush();
  return out.join(" ");
}

// Text picked off the page: each line is its own thing (a heading, a list item), so each ends like a sentence.
export function spokenLines(text: string): string {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (/[.!?:;,。！？]["'”’)\]]*$/.test(l) ? l : `${l}.`)).join(" ");
}

// What's being read right now, for the player and every Read aloud button to show.
// part: which part is playing, from 1 (0 when nothing is). what: a few words naming the thing
// being read. from: the button that started it. error: why a read ended early.
export type Reading = { state: "idle" | "loading" | "playing" | "paused"; part: number; parts: number; speed: number; what: string; from?: string; error?: string };

let now: Reading = { state: "idle", part: 0, parts: 0, speed: 1, what: "" };
const watching = new Set<() => void>();
const set = (r: Reading) => { now = r; for (const f of watching) f(); };
export const reading = () => now;
export const onReading = (f: () => void) => { watching.add(f); return () => { watching.delete(f); }; };

async function speech(text: string): Promise<string> {
  const r = await fetch("/api/voice/speak", { method: "POST", headers: { "x-camp-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || r.statusText || "The voice couldn't be fetched.");
  }
  return URL.createObjectURL(await r.blob());
}

type Controls = { pause(): void; resume(): void; stop(): void; setSpeed(v: number): void; skip(by: number): void };
let current: Controls | null = null;

// The player's buttons: they act on whatever is being read, and do nothing when nothing is.
export const player = {
  pause: () => current?.pause(),
  resume: () => current?.resume(),
  stop: () => current?.stop(),
  skip: (by: number) => current?.skip(by),
  setSpeed(v: number) {
    storeSet(SPEED_KEY, String(v));
    if (current) current.setSpeed(v); else set({ ...now, speed: v });
  },
  // Put away what a read that failed said.
  dismiss: () => { if (now.state === "idle") set({ state: "idle", part: 0, parts: 0, speed: now.speed, what: "" }); },
};

export function readAloud(text: string, { what = "", from }: { what?: string; from?: string } = {}): void {
  current?.stop();
  const parts = chunkText(text);
  const audio = new Audio();
  const fetched = new Map<number, Promise<string>>();
  let at = 0;
  let turn = 0; // which play() is the latest: an earlier one that lands late is dropped
  let over = false;
  let paused = false;
  let speed = keptSpeed();

  const tell = (state: Reading["state"]) => { if (!over) set({ state, part: at + 1, parts: parts.length, speed, what, from }); };
  const fetchPart = (n: number) => {
    if (!fetched.has(n)) fetched.set(n, speech(parts[n]));
    return fetched.get(n)!;
  };
  const end = (error?: string) => {
    if (over) return;
    over = true;
    audio.onended = audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    // (A part still on its way is let go when it lands.)
    for (const p of fetched.values()) void p.then((u) => URL.revokeObjectURL(u), () => {});
    if (current === controls) current = null;
    set(error ? { state: "idle", part: 0, parts: 0, speed, what, error } : { state: "idle", part: 0, parts: 0, speed, what: "" });
  };
  async function play(n: number) {
    const mine = ++turn;
    at = n;
    audio.pause();
    tell("loading");
    try {
      const url = await fetchPart(n);
      if (over || mine !== turn) return;
      audio.src = url;
      audio.playbackRate = speed; // (a new source starts at 1× again)
      if (n + 1 < parts.length) void fetchPart(n + 1).catch(() => { /* said when its turn comes */ });
      if (!paused) await audio.play();
      if (mine === turn) tell(paused ? "paused" : "playing");
    } catch (e) { if (mine === turn) end(errorText(e)); }
  }
  audio.onended = () => { if (at + 1 < parts.length) void play(at + 1); else end(); };
  audio.onerror = () => end("The sound couldn't be played.");

  const controls: Controls = {
    stop: () => end(),
    pause() { if (over) return; paused = true; audio.pause(); tell(now.state === "loading" ? "loading" : "paused"); },
    resume() {
      if (over) return;
      paused = false;
      if (now.state === "loading") return; // still fetching: it plays when it lands
      const mine = turn;
      audio.play().then(() => { if (mine === turn) tell("playing"); }, (e) => { if (mine === turn) end(errorText(e)); });
    },
    setSpeed(v: number) { speed = v; audio.playbackRate = v; tell(now.state); },
    skip(by: number) {
      const n = at + by;
      if (!over && n >= 0 && n < parts.length) void play(n);
    },
  };
  current = controls;
  if (!parts.length) end("There's nothing to read.");
  else void play(0);
}
