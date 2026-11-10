// Approvals away from your desk, through ntfy (https://ntfy.sh, or your own ntfy server).
// Off unless you set a topic in camp/settings.json:
//   "phone": { "topic": "camp-<long random string>", "server": "https://ntfy.sh", "approve": ["plan", "job", "question"] }
// Subscribe to that topic in the ntfy app. You then get a notification when the camp needs a
// decision, when a scheduled job reports, and when a long expedition ends. Approve / Decline
// buttons on the notification answer it.
//
// What to know before turning it on:
//  - The text of each approval (the plan, the question, the command) is sent to the ntfy server.
//  - Anyone who knows the topic can read those and press the buttons, so make it long and random.
//  - Shell commands and connector writes are notify-only by default: you approve those at your
//    desk. Add "shell" or "tool" to "approve" if you want to allow them from the phone too.
//  - Mission control makes only outgoing connections for this; nothing new listens on your network.

import { randomBytes } from "node:crypto";
import { onEvent, type CampEvent } from "./events.js";
import { phoneSettings } from "./settings.js";

const DEFAULT_APPROVE = ["plan", "job", "question"];
const NONCE = randomBytes(4).toString("hex"); // replies only count for this launch's questions

type Answerer = (askId: string, answer: string) => boolean;

export function phoneConfig() {
  const p = phoneSettings();
  const topic = typeof p.topic === "string" ? p.topic.trim() : "";
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(topic)) return null; // short topics are guessable: ignored
  const server = (p.server?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(server)) return null;
  return { server, topic, approve: Array.isArray(p.approve) ? p.approve.map(String) : DEFAULT_APPROVE };
}

// "<nonce>:<ask id> <y|n>" from a notification button.
export function parseReply(message: string, nonce = NONCE): { askId: string; answer: "y" | "n" } | null {
  const m = String(message).trim().match(/^([0-9a-f]+):(ask_\d+) (y|n)$/);
  return m && m[1] === nonce ? { askId: m[2], answer: m[3] as "y" | "n" } : null;
}

async function publish(cfg: NonNullable<ReturnType<typeof phoneConfig>>, title: string, message: string, extra: Record<string, unknown> = {}) {
  try {
    await fetch(cfg.server, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: cfg.topic, title, message: message.replace(/\s+\n/g, "\n").slice(0, 1500), ...extra }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { /* no network: the dashboard still has it */ }
}

const ASK_TITLES: Record<string, string> = { plan: "Plan to approve", shell: "Shell command waiting", job: "New scheduled job", tool: "Connector call waiting", question: "The Quartermaster has a question" };

function onCampEvent(e: CampEvent, kinds: Map<string, string>, started: Map<string, number>) {
  const cfg = phoneConfig();
  if (!cfg) return;
  if (e.type === "ask") {
    kinds.set(e.id, e.kind);
    const remote = cfg.approve.includes(e.kind) && e.kind !== "question"; // questions need typing: answer at your desk
    const reply = `${cfg.server}/${cfg.topic}-reply`;
    const button = (label: string, a: string) => ({ action: "http", label, url: reply, method: "POST", body: `${NONCE}:${e.id} ${a}`, clear: true });
    void publish(cfg, `Guild Camp: ${ASK_TITLES[e.kind] ?? "Decision needed"}`, e.body + (remote ? "" : "\n\n(Answer this one in mission control.)"),
      { priority: 4, tags: ["compass"], ...(remote ? { actions: [button("Approve", "y"), button("Decline", "n")] } : {}) });
  } else if (e.type === "answered") kinds.delete(e.id);
  else if (e.type === "job" && e.outcome === "reported") void publish(cfg, `Guild Camp: ${e.name}`, e.text ?? "", { tags: ["incoming_envelope"] });
  else if (e.type === "expedition_start" && e.source !== "job") started.set(e.id, Date.now());
  else if (e.type === "expedition_end") {
    const t = started.get(e.id);
    started.delete(e.id);
    if (t && Date.now() - t > 60_000) void publish(cfg, `Guild Camp: expedition ${e.status === "done" ? "finished" : e.status.replace(/_/g, " ")}`, e.text, { tags: ["tent"] });
  }
}

// Listen for button presses on the reply topic (a long-lived outgoing request), reconnecting as needed.
async function listen(answer: Answerer, kinds: Map<string, string>, stop: AbortSignal) {
  let wait = 2000;
  while (!stop.aborted) {
    const cfg = phoneConfig();
    if (!cfg) { await sleep(30_000, stop); continue; }
    try {
      const res = await fetch(`${cfg.server}/${cfg.topic}-reply/json`, { signal: stop });
      if (!res.ok || !res.body) throw new Error(`ntfy answered ${res.status}`);
      wait = 2000;
      let pending = "";
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg?.event !== "message") continue;
          const r = parseReply(msg.message);
          // Only kinds you allowed can be answered from the phone, whatever the message says.
          if (r && phoneConfig()?.approve.includes(kinds.get(r.askId) ?? "")) answer(r.askId, r.answer);
        }
      }
    } catch { /* dropped: try again */ }
    await sleep(wait, stop);
    wait = Math.min(wait * 2, 60_000);
  }
}

const sleep = (ms: number, stop: AbortSignal) => new Promise<void>((ok) => {
  const t = setTimeout(ok, ms);
  stop.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true });
});

// Mission control calls this once. Returns a function that stops it.
export function startPhoneBridge(answer: Answerer): () => void {
  const kinds = new Map<string, string>();
  const started = new Map<string, number>();
  const stop = new AbortController();
  const off = onEvent((e) => onCampEvent(e, kinds, started));
  void listen(answer, kinds, stop.signal);
  return () => { off(); stop.abort(); };
}
