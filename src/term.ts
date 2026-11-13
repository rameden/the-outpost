// The terminal pane at the bottom of mission control: real shell sessions on this machine,
// shown in the page. They are yours alone: no crew member has a tool that can see or type into
// them, and nothing from them goes into the camp's feed or files.
//
// Each session is a login shell on a pseudo-terminal (node-pty), started in the folder of the
// project you're in (or the camp folder). Sessions belong to the camp server, not the page: hide
// the pane or reload the page and they carry on, and the page gets the recent output back when
// it reattaches. They end when you close their tab, when the shell exits, or when the camp stops.
//
// Like the rest of mission control, this is only reachable from this machine with this launch's key.

import type { ServerResponse } from "node:http";
import { terminalShell } from "./platform.js";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { Terminal as Screen } from "@xterm/headless";
import { getProject } from "./conversations.js";
import { loadLinks } from "./links.js";
import { CAMP_ROOT } from "./tools.js";

type Pty = {
  onData: (fn: (d: string) => void) => void; onExit: (fn: (e: { exitCode: number }) => void) => void;
  write: (d: string) => void; resize: (cols: number, rows: number) => void; kill: (signal?: string) => void;
};
// clients: the pages watching it, each with what to tidy up when it stops watching.
// screen: the same output drawn off-page, so the camp can say what the shell last printed.
type Session = { id: string; title: string; action?: string; locked?: boolean; cwd: string; pty: Pty; screen: Screen | null; buffer: string; clients: Map<ServerResponse, () => void>; exited: number | null; opened: number };

const MAX_SESSIONS = 8;
const FIRST_PROMPT_SETTLE = 150, FIRST_PROMPT_WAIT = 1500; // ms: after a new shell's first output, and at most
const MAX_BUFFER = 300_000; // characters of recent output kept for a page that reattaches
const sessions = new Map<string, Session>();
// last: the last line the shell finished printing, as plain text (the hidden pane's rail shows it).
// action: the quick action that opened it (its name), so its chip can lead back here instead of starting it twice.
export type TerminalInfo = { id: string; title: string; cwd: string; exited: number | null; last: string; action?: string;
  locked?: boolean }; // you locked it: quick actions (other than the one that opened it) don't type into it
const info = (s: Session): TerminalInfo => ({ id: s.id, title: s.title, cwd: s.cwd, exited: s.exited, last: s.screen ? lastLine(s.screen) : "", ...(s.action ? { action: s.action } : {}), ...(s.locked ? { locked: true } : {}) });
export const listTerminals = (): TerminalInfo[] => [...sessions.values()].sort((a, b) => a.opened - b.opened).map(info);

// node-pty ships ready-built for macOS and Windows, but its macOS helper can arrive without its
// "executable" flag, and then no shell will start. Set it before the first session.
let ptyModule: { spawn: (file: string, args: string[], opts: object) => Pty } | null = null;
function loadPty() {
  if (ptyModule) return ptyModule;
  const require = createRequire(import.meta.url);
  let root: string;
  try { root = dirname(require.resolve("node-pty/package.json")); }
  catch { throw new Error("The terminal needs the node-pty package. Run `npm install` in the camp folder, then try again."); }
  for (const helper of [join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"), join(root, "build", "Release", "spawn-helper")]) {
    try { if (existsSync(helper)) chmodSync(helper, 0o755); } catch { /* not ours to change: spawn will say so */ }
  }
  try { ptyModule = require("node-pty"); }
  catch (e: any) { throw new Error(`The terminal couldn't start (node-pty didn't load: ${e.message}). Run \`npm rebuild node-pty\` in the camp folder.`); }
  return ptyModule!;
}

// A screen that follows a session's output the way the page's terminal does (colours, cursor
// moves, \r redraws and all), so its text can be read without the page. Without it (the package
// missing), a session simply has no last line to show.
let screenClass: (new (o: object) => Screen) | null | undefined;
export function makeScreen(cols: number, rows: number): Screen | null {
  if (screenClass === undefined) {
    try { screenClass = createRequire(import.meta.url)("@xterm/headless").Terminal; } catch { screenClass = null; }
  }
  return screenClass ? new screenClass({ cols, rows, scrollback: 200, allowProposedApi: true }) : null;
}

const LAST_MAX = 300;
// The last line the shell finished: the newest line above the cursor with any text. The cursor's
// own line is usually the prompt waiting for you, so it's only shown when nothing above it has
// text. A full-screen program (vim, less) draws on the other buffer, which this leaves alone:
// the shell's own lines stay where they were.
export function lastLine(screen: Screen): string {
  const b = screen.buffer.normal;
  let row = Math.min(b.baseY + b.cursorY, b.length - 1);
  // One whole line, ending at `end`: a long line wraps onto the rows below where it began.
  const lineEndingAt = (end: number) => {
    let text = "";
    let i = end;
    for (; i >= 0; i--) {
      const r = b.getLine(i);
      if (!r) break;
      text = r.translateToString(false) + text;
      if (!r.isWrapped) break;
    }
    return { text: text.trim(), start: i };
  };
  const atCursor = lineEndingAt(row);
  for (row = atCursor.start - 1; row >= 0; row--) {
    const line = lineEndingAt(row);
    if (line.text) return line.text.slice(0, LAST_MAX);
    row = line.start;
  }
  return atCursor.text.slice(0, LAST_MAX);
}

// Where a new session starts: the first folder of the project you're in, else the camp folder.
// A quick action can name a linked folder instead (and a folder inside it): that one has to be
// there, and inside the link, or nothing is opened (a command in the wrong folder is worse than none).
function startFolder(project?: string, folder?: string, sub?: string): string {
  if (folder) {
    const named = loadLinks().find((l) => l.name === folder);
    if (!named) throw new Error(`There's no linked folder called "${folder}" any more. Change this quick action in Settings → Terminal.`);
    const root = resolve(named.path), at = resolve(root, sub ?? "");
    let ok = false;
    try { ok = (at === root || at.startsWith(root + sep)) && statSync(at).isDirectory(); } catch { /* not there */ }
    if (!ok) throw new Error(`${sub ? `${folder}/${sub}` : folder} isn't a folder that's there. Change this quick action in Settings → Terminal.`);
    return at;
  }
  const first = getProject(project)?.links?.[0];
  const link = first ? loadLinks().find((l) => l.name === first) : undefined;
  try { if (link && statSync(link.path).isDirectory()) return link.path; } catch { /* gone: fall through */ }
  return CAMP_ROOT;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => { const v = Math.floor(Number(n)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback; };
const sse = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// title, action, type: a quick action's own tab name, the action's name, and what to type into the
// new shell once it's up (the action's commands, with or without Enter).
export function openTerminal(o: { project?: string; cols?: unknown; rows?: unknown; folder?: string; sub?: string; title?: string; action?: string; type?: string; locked?: boolean }): TerminalInfo {
  if ([...sessions.values()].filter((s) => s.exited === null).length >= MAX_SESSIONS) throw new Error(`That's ${MAX_SESSIONS} terminals already. Close one first.`);
  const cwd = startFolder(o.project, o.folder, o.sub);
  const shell = terminalShell(); // your login shell; on Windows, PowerShell (platform.ts)
  const cols = clamp(o.cols, 20, 400, 100), rows = clamp(o.rows, 5, 200, 24);
  const pty = loadPty().spawn(shell.file, shell.args, {
    name: "xterm-256color", cols, rows, cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", SATCHEL_TERMINAL: "1" },
  });
  const s: Session = { id: randomBytes(6).toString("hex"), title: o.title?.trim().slice(0, 40) || (cwd === homedir() ? "~" : basename(cwd)), ...(o.action ? { action: o.action.slice(0, 40) } : {}), ...(o.locked ? { locked: true } : {}), cwd, pty, screen: makeScreen(cols, rows), buffer: "", clients: new Map(), exited: null, opened: Date.now() };
  sessions.set(s.id, s);
  pty.onData((d) => {
    s.buffer += d;
    s.screen?.write(d);
    if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(-Math.floor(MAX_BUFFER * 0.8));
    for (const res of s.clients.keys()) sse(res, "data", d);
  });
  // Typed once the shell has drawn its prompt (a moment after its first output), so the command
  // is read by the shell's own line editor and shows once; or after a short wait if it stays quiet.
  if (o.type) {
    const text = o.type.slice(0, 8000);
    let typed = false;
    const type = () => { if (typed || s.exited !== null) return; typed = true; try { pty.write(text); } catch { /* it just exited */ } };
    let heard = false;
    pty.onData(() => { if (heard) return; heard = true; setTimeout(type, FIRST_PROMPT_SETTLE).unref(); });
    setTimeout(type, FIRST_PROMPT_WAIT).unref();
  }
  pty.onExit(({ exitCode }) => {
    s.exited = exitCode ?? 0;
    for (const [res, done] of s.clients) { sse(res, "exit", { code: s.exited }); res.end(); done(); }
    s.clients.clear();
  });
  return info(s);
}

// The page's live connection to one session: what it missed first, then output as it comes.
export function streamTerminal(id: string, res: ServerResponse, onClose: (fn: () => void) => void): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
  if (s.buffer) sse(res, "data", s.buffer);
  if (s.exited !== null) { sse(res, "exit", { code: s.exited }); res.end(); return true; }
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  ping.unref();
  const done = () => { clearInterval(ping); s.clients.delete(res); };
  s.clients.set(res, done);
  onClose(done);
  return true;
}

export function writeTerminal(id: string, data: unknown): boolean {
  const s = sessions.get(id);
  if (!s || s.exited !== null || typeof data !== "string") return false;
  s.pty.write(data.slice(0, 1_000_000));
  return true;
}

// Lock a terminal, or unlock it. A lock is a guard for your own clicks: the page won't let a quick
// action type into a locked terminal without asking. What you type yourself still goes in.
export function lockTerminal(id: string, on: boolean): TerminalInfo | null {
  const s = sessions.get(id);
  if (!s) return null;
  if (on) s.locked = true; else delete s.locked;
  return info(s);
}

export function resizeTerminal(id: string, cols: unknown, rows: unknown): boolean {
  const s = sessions.get(id);
  if (!s || s.exited !== null) return false;
  const c = clamp(cols, 20, 400, 100), r = clamp(rows, 5, 200, 24);
  try { s.pty.resize(c, r); } catch { /* it just exited */ }
  s.screen?.resize(c, r);
  return true;
}

export function closeTerminal(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (s.exited === null) { try { s.pty.kill(); } catch { /* already gone */ } }
  s.screen?.dispose();
  for (const [res, done] of s.clients) { res.end(); done(); }
  return true;
}

// The camp is stopping: its shells go with it.
export function closeAllTerminals() { for (const id of [...sessions.keys()]) closeTerminal(id); }
process.once("exit", closeAllTerminals);
