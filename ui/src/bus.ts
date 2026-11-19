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
  | { do: "tell"; text: string; error?: boolean };          // a line back to you, shown by the message box (StatusLine)

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

// The commands you can type at the start of a message (and find in the command palette).
export const COMMANDS: { name: string; arg?: string; does: string }[] = [
  { name: "today", does: "Open Today: your brief, and where things stand (the logo goes there too)" },
  { name: "new", does: "Start a new conversation" },
  { name: "orbit", arg: "demo", does: "Watch the crew at work as a solar system, full screen (/orbit demo plays a pretend camp)" },
  { name: "trail", does: "See the plan as a trail: each step, who's on it, and what it waits for, full screen" },
  { name: "focus", does: "Close the history, files, notes and terminal (again brings them back)" },
  { name: "files", does: "Show or hide the files" },
  { name: "terminal", does: "Show or hide the terminal" },
  { name: "history", does: "Show or hide the history" },
  { name: "notes", does: "Show or hide your notes" },
  { name: "note", arg: "text", does: "Jot down a new note" },
  { name: "find", arg: "name", does: "Find a file, a conversation or a command" },
  { name: "next", does: "Go to the next decision waiting on you" },
  { name: "good", arg: "note", does: "Rate the last answer 👍, with an optional note" },
  { name: "bad", arg: "note", does: "Rate the last answer 👎, with an optional note" },
  { name: "ticket", does: "Start a ticket: pick it, check it, say where and who" },
  { name: "wiki", does: "Open the camp's wiki" },
  { name: "constellation", does: "See everything the crew remembers as a map of stars, full screen" },
  { name: "layout", does: "Arrange the page's zones" },
  { name: "settings", does: "Open Settings" },
];
// "/good nice work" → { name: "good", arg: "nice work" }; anything that isn't one of ours → null.
export function parseCommand(text: string): { name: string; arg: string } | null {
  const m = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/);
  return m && COMMANDS.some((c) => c.name === m[1]) ? { name: m[1], arg: (m[2] ?? "").trim() } : null;
}

// An expedition just finished well (said by camp.ts as the event arrives, not for old ones played
// back). Decorations listen for it: New Year's confetti.
export const RUN_DONE = "camp:run-done";
