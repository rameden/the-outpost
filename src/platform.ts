// What differs from one operating system to the next, in one place: which shell the crew's
// commands run in, which shell the terminal pane opens, how a command and everything it started
// is stopped, and where a program lives on Windows.
//
// macOS and Linux behave as they always have. On Windows:
//   - The crew's commands run in Git Bash when Git for Windows is installed (it nearly always
//     is: the camp needs git anyway), so the commands the crew writes (ls, grep, &&, pipes) mean
//     what they mean everywhere else. Without it they run in PowerShell, and the crew is told so.
//     CAMP_SHELL names another shell to use (a path to bash.exe, pwsh.exe or powershell.exe).
//   - There is no sandbox (it's built on macOS's and Linux's own), so commands ask first.
//   - The terminal pane opens PowerShell (PowerShell 7 if it's installed).
//
// Everything here takes the platform and environment as arguments, so the Windows side can be
// tested on any machine. No imports from the rest of the camp.

import { execFile, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;
type Exists = (file: string) => boolean;
// Windows keeps its variables' names in any case (Path, PATH): look one up whichever way it's written.
const envOf = (env: Env, name: string) => env[name] ?? env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ""];

export const isWindows = process.platform === "win32";

// ---------- One folder, one spelling ----------
// The same folder can be written more than one way: through a symlink (/var and /private/var on
// macOS), and on Windows by its short name (C:\Users\RUNNER~1) or its full one, in either case,
// with either slash. git answers with the full name; a path you typed or a temp folder may be
// the short one. So two paths are compared as the system itself names them.
export function canon(p: string): string {
  try { return realpathSync.native(p); } catch { return path.resolve(p); }
}
export function samePath(a: string, b: string): boolean {
  const x = canon(a), y = canon(b);
  return isWindows ? x.toLowerCase() === y.toLowerCase() : x === y;
}
// A path inside the camp, as the crew and the page are shown it: always with forward slashes
// (Windows takes them too), so "skills/shared/x" is the same text on every system.
export const slash = (p: string) => (path.sep === "/" ? p : p.split(path.sep).join("/"));

// A program on the PATH, as a full path (Windows: trying each extension it would). Null if it isn't there.
export function onPath(name: string, platform: NodeJS.Platform = process.platform, env: Env = process.env, exists: Exists = existsSync): string | null {
  const p = platform === "win32" ? path.win32 : path.posix;
  const dirs = (envOf(env, "PATH") ?? "").split(p.delimiter).filter(Boolean);
  const exts = platform === "win32" ? (p.extname(name) ? [""] : (envOf(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)) : [""];
  for (const dir of dirs) for (const ext of exts) {
    const file = p.join(dir, name + ext.toLowerCase());
    if (exists(file)) return file;
  }
  return null;
}

// ---------- The shell the crew's commands run in ----------
// null: the system's own (sh on macOS and Linux), exactly as before.
export type AgentShell = { kind: "bash" | "powershell"; file: string; args: (command: string) => string[] };

const bashArgs = (command: string) => ["-c", command];
// -NoProfile: your profile's aliases and prompts don't belong in the crew's commands. The exit
// code of the last program is passed on, so a failing test run still reads as a failure.
const psArgs = (command: string) => ["-NoProfile", "-NonInteractive", "-Command", `${command}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }`];
const asShell = (file: string): AgentShell => (/bash(\.exe)?$/i.test(file) ? { kind: "bash", file, args: bashArgs } : { kind: "powershell", file, args: psArgs });

export function agentShell(platform: NodeJS.Platform = process.platform, env: Env = process.env, exists: Exists = existsSync): AgentShell | null {
  if (platform !== "win32") return null;
  const w = path.win32;
  const named = envOf(env, "CAMP_SHELL")?.trim();
  if (named && exists(named)) return asShell(named);
  // Git Bash: where Git for Windows puts it, or beside the git that's on the PATH (…\Git\cmd\git.exe → …\Git\bin\bash.exe).
  // (bin\bash.exe, not usr\bin\bash.exe: it's the one that sets up the PATH its own tools need.)
  const roots = [envOf(env, "ProgramFiles"), envOf(env, "ProgramFiles(x86)"), envOf(env, "LocalAppData") && w.join(envOf(env, "LocalAppData")!, "Programs")]
    .filter((r): r is string => !!r).map((r) => w.join(r, "Git"));
  const git = onPath("git", platform, env, exists);
  if (git) roots.push(w.dirname(w.dirname(git)));
  for (const root of roots) {
    const bash = w.join(root, "bin", "bash.exe");
    if (exists(bash)) return { kind: "bash", file: bash, args: bashArgs };
  }
  return { kind: "powershell", file: onPath("pwsh", platform, env, exists) ?? "powershell.exe", args: psArgs };
}

// What the crew is told about the shell, when it isn't the one they'd assume.
export function shellNote(shell: AgentShell | null = agentShell()): string {
  if (!shell) return "";
  return shell.kind === "bash"
    ? " This machine runs Windows: commands run in Git Bash, so write them as you would for bash (ls, grep, &&, forward slashes); a drive is /c/…, and Windows programs (git, npm, node) work as usual."
    : " This machine runs Windows and has no bash: commands run in PowerShell, so write PowerShell (Get-ChildItem or ls, Select-String instead of grep, ';' between commands, $env:NAME for a variable), not bash.";
}

// ---------- The shell the terminal pane opens ----------
export function terminalShell(platform: NodeJS.Platform = process.platform, env: Env = process.env, exists: Exists = existsSync): { file: string; args: string[] } {
  if (platform === "win32") {
    // (SHELL, if something set it, is a path inside Git Bash's own world, which Windows can't start.)
    return { file: onPath("pwsh", platform, env, exists) ?? envOf(env, "CAMP_TERMINAL_SHELL") ?? "powershell.exe", args: [] };
  }
  const named = env.SHELL;
  const file = named && exists(named) ? named : ["/bin/zsh", "/bin/bash", "/bin/sh"].find(exists) ?? "/bin/sh";
  return { file, args: ["-l"] };
}

// ---------- Stopping a command and everything it started ----------
// macOS and Linux: the command leads its own process group (it's started "detached"), and the
// whole group is signalled. Windows has no groups to signal: taskkill ends the tree by its root.
export function stopTree(child: ChildProcess, platform: NodeJS.Platform = process.platform) {
  if (!child.pid) return;
  try {
    if (platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => { /* already gone */ });
    else process.kill(-child.pid, "SIGTERM");
  } catch { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
}

// ---------- Claude Code on Windows ----------
// "claude" on the PATH can be a real program (claude.exe, from the installer) or a small script
// npm leaves (claude.cmd), which Windows only runs through a shell. This says which, and for the
// script, where the program it starts really is, when that can be told.
//   run:  how to start it for a one-line question (its version, its sign-in). shell: through cmd.
//   path: what to hand the Agent SDK (a program or a .js file it can start), or undefined to let
//         the SDK use the copy it ships with (same sign-in, same account).
export function claudeOnWindows(name: string, env: Env = process.env, exists: Exists = existsSync): { run: { file: string; shell: boolean }; path: string | undefined } {
  const w = path.win32;
  const found = w.isAbsolute(name) ? (exists(name) ? name : null) : onPath(name, "win32", env, exists);
  if (!found) return { run: { file: name, shell: false }, path: name };
  if (!/\.(cmd|bat)$/i.test(found)) return { run: { file: found, shell: false }, path: found };
  const cli = w.join(w.dirname(found), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  return { run: { file: `"${found}"`, shell: true }, path: exists(cli) ? cli : undefined };
}

// ---------- Folders that can't be linked ----------
// Never linkable: a whole disk, the folder all the home folders are in, your whole home folder,
// the system's own folders, and where credentials are kept.
export function unlinkable(real: string, home: string, platform: NodeJS.Platform = process.platform, env: Env = process.env): boolean {
  const p = platform === "win32" ? path.win32 : path.posix;
  const same = (a: string, b: string) => p.relative(a, b) === "";
  const within = (child: string, parent: string) => { const rel = p.relative(parent, child); return rel === "" || (!rel.startsWith(".." + p.sep) && rel !== ".." && !p.isAbsolute(rel)); };
  const j = (...parts: string[]) => p.join(home, ...parts);
  const everywhere = [j(".ssh"), j(".aws"), j(".gnupg"), j(".config"), j(".kube"), j(".docker"), j(".claude"), j(".hermes")];
  if (p.parse(real).root === real || same(real, home) || same(real, p.dirname(home))) return true;
  if (platform === "win32") {
    const system = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "APPDATA", "LOCALAPPDATA"].map((n) => envOf(env, n)).filter((v): v is string => !!v);
    return [...system, j("AppData"), ...everywhere].some((f) => within(real, f));
  }
  if (["/Users", "/home", "/Volumes"].some((f) => same(real, f))) return true;
  return ["/etc", "/private/etc", "/var/db", "/private/var/db", "/var/root", "/private/var/root", "/var/log", "/private/var/log",
    "/System", "/Library", "/usr", "/bin", "/sbin", "/dev", "/proc", "/opt/homebrew/etc", j("Library"), ...everywhere].some((f) => within(real, f));
}
