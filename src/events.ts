// The camp's event stream. Everything a character does is emitted here once;
// the terminal prints it (attachConsole) and mission control streams it to the browser.

import { EventEmitter } from "node:events";
import { currentExpeditionId } from "./context.js";

// questId ties an adventurer's events to its quest, so parallel quests don't get mixed up.
type Who = { who: string; emoji: string; depth: number; questId?: string };

export type CampEventBody =
  | { type: "expedition_start"; id: string; task: string; source: "user" | "direct" | "job"; job?: string; replyTo?: string;
      thread?: string; // the conversation it belongs to (its first run's id); jobs have none
      attachments?: { kind: string; name: string; path?: string; url?: string }[] }
  // changed: files its file tools changed. workspaces: the worktrees it worked in, and where each stands.
  | { type: "expedition_end"; id: string; status: string; text: string; changed?: number;
      workspaces?: { link: string; path: string; branch: string; base?: string; created?: boolean; changed: number; commits: number }[] }
  | { type: "steer"; id: string; text: string } // you said something to a running expedition
  // Your rating of a finished run, and where its note was kept as a standing note (if you asked for that).
  | { type: "feedback"; id: string; rating: "up" | "down"; note?: string; kept?: string }
  | ({ type: "text"; text: string } & Who)
  | ({ type: "text_delta"; delta: string } & Who) // live streaming; not kept in the replay buffer
  | ({ type: "tool"; tool: string; input: string } & Who)
  | ({ type: "notice"; text: string } & Who)
  | { type: "dispatch"; who: string; emoji: string; questId?: string }
  | { type: "return"; who: string; emoji: string; status: string; questId?: string }
  | { type: "ask"; id: string; kind: AskKind; title: string; body: string; questId?: string }
  | { type: "answered"; id: string; answer: string; lapsed?: boolean } // lapsed: the camp restarted before you answered
  | { type: "job"; name: string; outcome: "running" | "quiet" | "reported" | "failed"; text?: string }
  | { type: "changed"; what: "jobs" | "wiki" | "skills" | "log" | "memory" | "inbox" | "snippets" | "settings" | "connectors" | "links" | "queue" | "limits" | "checkpoints" | "history" | "crew" | "prs" | "chronicle" };

export type AskKind = "plan" | "shell" | "job" | "tool" | "question";
// expeditionId: which expedition an event belongs to (several can run at once). Added by emit().
export type CampEvent = CampEventBody & { time: string; seq: number; expeditionId?: string };

const bus = new EventEmitter();
bus.setMaxListeners(50);
let seq = 0;
// Mission control reloads the saved feed on start and carries on numbering from where it ended.
export function continueSeqFrom(n: number) { seq = Math.max(seq, n); }

export function emit(body: CampEventBody & { expeditionId?: string }) {
  const expeditionId = body.expeditionId ?? currentExpeditionId();
  const event = { ...body, ...(expeditionId ? { expeditionId } : {}), time: new Date().toISOString(), seq: ++seq } as CampEvent;
  bus.emit("event", event);
}

export function onEvent(fn: (e: CampEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

// The terminal view: the same output the camp has always printed.
export function attachConsole() {
  onEvent((e) => {
    const pad = "depth" in e ? "    ".repeat(e.depth) : "";
    switch (e.type) {
      case "text":
        return console.log(`\n${pad}${e.emoji} ${e.who}: ${e.text.replace(/\n/g, "\n" + pad)}`);
      case "tool":
        return console.log(`${pad}  🔧 ${e.tool} ${e.input}`);
      case "notice":
        return console.log(`${pad}  ${e.text}`);
      case "dispatch":
        return console.log(`\n📜 Quartermaster dispatches ${e.emoji} ${e.who}`);
      case "return":
        return console.log(`\n📬 ${e.who} returns to camp.`);
      case "job":
        if (e.outcome === "running") return console.log(`\n⏰ ${new Date(e.time).toLocaleString()}: running "${e.name}"`);
        if (e.outcome === "quiet") return console.log(`🤫 "${e.name}": nothing new.`);
        if (e.outcome === "reported") return console.log(`📨 "${e.name}" reported. See camp/inbox.md.`);
        return console.error(`💥 "${e.name}" failed: ${e.text ?? ""}`);
    }
  });
}
