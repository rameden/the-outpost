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
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { getProject } from "./conversations.js";
import { loadLinks } from "./links.js";
import { CAMP_ROOT } from "./tools.js";

type Pty = {
  onData: (fn: (d: string) => void) => void; onExit: (fn: (e: { exitCode: number }) => void) => void;
  write: (d: string) => void; resize: (cols: number, rows: number) => void; kill: (signal?: string) => void;
};
// clients: the pages watching it, each with what to tidy up when it stops watching.
type Session = { id: string; title: string; cwd: string; pty: Pty; buffer: string; clients: Map<ServerResponse, () => void>; exited: number | null; opened: number };

const MAX_SESSIONS = 8;
const MAX_BUFFER = 300_000; // characters of recent output kept for a page that reattaches
const sessions = new Map<string, Session>();
export type TerminalInfo = { id: string; title: string; cwd: string; exited: number | null };
const info = (s: Session): TerminalInfo => ({ id: s.id, title: s.title, cwd: s.cwd, exited: s.exited });
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

// Where a new session starts: the first folder of the project you're in, else the camp folder.
function startFolder(project?: string): string {
  const first = getProject(project)?.links?.[0];
  const link = first ? loadLinks().find((l) => l.name === first) : undefined;
  try { if (link && statSync(link.path).isDirectory()) return link.path; } catch { /* gone: fall through */ }
  return CAMP_ROOT;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => { const v = Math.floor(Number(n)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback; };
const sse = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function openTerminal(o: { project?: string; cols?: unknown; rows?: unknown }): TerminalInfo {
  if ([...sessions.values()].filter((s) => s.exited === null).length >= MAX_SESSIONS) throw new Error(`That's ${MAX_SESSIONS} terminals already. Close one first.`);
  const cwd = startFolder(o.project);
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
  const pty = loadPty().spawn(shell, process.platform === "win32" ? [] : ["-l"], {
    name: "xterm-256color", cols: clamp(o.cols, 20, 400, 100), rows: clamp(o.rows, 5, 200, 24), cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", GUILD_CAMP_TERMINAL: "1" },
  });
  const s: Session = { id: randomBytes(6).toString("hex"), title: cwd === homedir() ? "~" : basename(cwd), cwd, pty, buffer: "", clients: new Map(), exited: null, opened: Date.now() };
  sessions.set(s.id, s);
  pty.onData((d) => {
    s.buffer += d;
    if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(-Math.floor(MAX_BUFFER * 0.8));
    for (const res of s.clients.keys()) sse(res, "data", d);
  });
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

export function resizeTerminal(id: string, cols: unknown, rows: unknown): boolean {
  const s = sessions.get(id);
  if (!s || s.exited !== null) return false;
  try { s.pty.resize(clamp(cols, 20, 400, 100), clamp(rows, 5, 200, 24)); } catch { /* it just exited */ }
  return true;
}

export function closeTerminal(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (s.exited === null) { try { s.pty.kill(); } catch { /* already gone */ } }
  for (const [res, done] of s.clients) { res.end(); done(); }
  return true;
}

// The camp is stopping: its shells go with it.
export function closeAllTerminals() { for (const id of [...sessions.keys()]) closeTerminal(id); }
process.once("exit", closeAllTerminals);
