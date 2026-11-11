// A few things one part of the page asks of another that sits far from it in the tree: an
// answer's file path asking for the file viewer, a worktree's row putting text in the message
// box, a typed /command or the command palette asking for a panel. Said here, heard in App.

export type Ask =
  | { do: "open-file"; path: string; line?: number }        // a path as the crew wrote it (links/…, or inside an attached folder)
  | { do: "compose"; text: string; replyTo?: string; task?: string } // put this in the message box (as a reply to a run, named by its request)
  | { do: "open-conversation"; id: string }                 // go to a conversation (a memory line's origin, say)
  | { do: "command"; name: string; arg?: string };          // /new, /focus, /good…

const NAME = "camp:ask";
export const say = (ask: Ask) => window.dispatchEvent(new CustomEvent<Ask>(NAME, { detail: ask }));
export function hear(fn: (ask: Ask) => void): () => void {
  const on = (ev: Event) => fn((ev as CustomEvent<Ask>).detail);
  window.addEventListener(NAME, on);
  return () => window.removeEventListener(NAME, on);
}

// The commands you can type at the start of a message (and find in the command palette).
export const COMMANDS: { name: string; arg?: string; does: string }[] = [
  { name: "new", does: "Start a new conversation" },
  { name: "focus", does: "Close the history, files and terminal (again brings them back)" },
  { name: "files", does: "Show or hide the files" },
  { name: "terminal", does: "Show or hide the terminal" },
  { name: "history", does: "Show or hide the history" },
  { name: "find", arg: "name", does: "Find a file, a conversation or a command" },
  { name: "next", does: "Go to the next decision waiting on you" },
  { name: "good", arg: "note", does: "Rate the last answer 👍, with an optional note" },
  { name: "bad", arg: "note", does: "Rate the last answer 👎, with an optional note" },
  { name: "ticket", does: "Start a ticket: pick it, check it, say where and who" },
  { name: "wiki", does: "Open the camp's wiki" },
  { name: "layout", does: "Arrange the page's zones" },
  { name: "settings", does: "Open Settings" },
];
// "/good nice work" → { name: "good", arg: "nice work" }; anything that isn't one of ours → null.
export function parseCommand(text: string): { name: string; arg: string } | null {
  const m = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/);
  return m && COMMANDS.some((c) => c.name === m[1]) ? { name: m[1], arg: (m[2] ?? "").trim() } : null;
}
