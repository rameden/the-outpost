import { fillWords } from "./words.ts";
import { commandsOn, findCommand, parseSlash, type BusyPolicy, type Category, type SurfaceCommand } from "../../src/commands.ts";

// A few things one part of the page asks of another that sits far from it in the tree: an
// answer's file path asking for the file viewer, a worktree's row putting text in the message
// box, a typed /command or the command palette asking for a panel. Said here, heard in App
// (and, for a line the page says back to you, in the status line by the message box).

export type Ask =
  | { do: "open-file"; path: string; line?: number }        // a path as the crew wrote it (links/…, or inside an attached folder)
  | { do: "compose"; text: string; replyTo?: string; task?: string } // put this in the message box (as a reply to a run, named by its request)
  | { do: "send"; text: string; sent?: (how: Sent) => void } // send this for you, past the message box: to the working run now, else as a reply
  | { do: "open-conversation"; id: string }                 // go to a conversation (a memory line's origin, say)
  | { do: "command"; name: string; arg?: string }           // /new, /focus, /good…
  | { do: "note"; text: string; fresh?: boolean }           // keep this in a note: the one that's open, or (fresh) a new one
  | { do: "tell"; text: string; error?: boolean; inFeed?: boolean };          // a line back to you, shown by the message box (StatusLine); inFeed: All runs shows it too

// How a message sent for you went: "now" told the working run (the crew reads it on their next step),
// "sent" went as a new request (no run was working), null didn't go (the message box says why).
export type Sent = "now" | "sent" | null;

const NAME = "camp:ask";
export const say = (ask: Ask) => window.dispatchEvent(new CustomEvent<Ask>(NAME, { detail: ask }));
export function hear(fn: (ask: Ask) => void): () => void {
  const on = (ev: Event) => fn((ev as CustomEvent<Ask>).detail);
  window.addEventListener(NAME, on);
  return () => window.removeEventListener(NAME, on);
}

// The commands you can type at the start of a message (and find in the command palette): the
// page's share of the one registry (src/commands.ts), which the terminal's /help reads too. What
// each does is App.tsx's command(). arg is what it takes, as the / menu shows it ("[demo]").
export type PageCommand = { name: string; aliases: readonly string[]; arg?: string; does: string; category: Category; busy: BusyPolicy };
const page = (c: SurfaceCommand): PageCommand => ({ name: c.name, aliases: c.aliases, arg: c.args, get does() { return fillWords(c.description); }, category: c.category, busy: c.busy });
export const COMMANDS: PageCommand[] = commandsOn("ui").map(page);
// "/good nice work" → { name: "good", arg: "nice work" }; an alias gives the command's own name;
// anything that isn't one of ours (a path, a word we don't know) → null, and goes to the crew.
export function parseCommand(text: string): { name: string; arg: string } | null {
  const p = parseSlash(text, "ui");
  return p && "command" in p ? { name: p.command.name, arg: p.arg } : null;
}
// A command by name or alias, hidden ones too (connectors), for the busy policy.
export const pageCommand = (name: string): PageCommand | undefined => { const c = findCommand(name, "ui"); return c && page(c); };

// An expedition just finished well (said by camp.ts as the event arrives, not for old ones played
// back). Decorations listen for it: New Year's confetti.
export const RUN_DONE = "camp:run-done";
