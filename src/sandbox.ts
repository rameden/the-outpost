// The shell sandbox (macOS and Linux): when it's on, commands the crew runs can't reach the network, can't
// write outside the folder they're working in (plus temp folders), and can't read your keys or
// .env files. Because of those limits they run without asking you first, which is what lets tests
// and type checks run unattended. Anything that needs more (an install, a push) is asked for the
// usual way and runs outside the sandbox only if you approve it.
//
// Turn it on in mission control (Quests tab) or with "shell": { "sandbox": true } in
// camp/settings.json. On macOS it uses the system's own sandbox-exec. On Linux it uses bubblewrap
// (bwrap, from your distribution's "bubblewrap" package), when it's installed and the system lets
// it make a namespace (it's tried once). Elsewhere it stays off and every command asks, as before.
//
// Allowed hosts (macOS): "shell": { "allowHosts": ["registry.npmjs.org", "*.github.com"] } lets
// sandboxed commands reach those hosts, and only those, through a proxy the camp runs (netproxy.ts),
// so installs and fetches stop needing an unsandboxed approval. On Linux a sandboxed command has
// its own network with nothing but its own localhost, so allowed hosts don't apply there yet.
//
// Linux differences: .env files are hidden in the folder the command works in (to a few levels
// deep, outside node_modules and .git) rather than anywhere on disk, and localhost is the
// sandbox's own: a server you run outside it can't be reached from inside.
//
// What it does not do: protect the working folder itself. A sandboxed command can still change or
// delete files there (that's what running a build or a formatter needs). Use a worktree for work
// you want kept apart from your own checkout.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
export type SandboxKind = "seatbelt" | "bwrap";
let bwrapPath: string | null | undefined;
// bubblewrap is there and works here (some systems don't allow unprivileged namespaces): tried once.
function findBwrap(): string | null {
  if (bwrapPath !== undefined) return bwrapPath;
  bwrapPath = null;
  for (const p of ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]) {
    if (!existsSync(p)) continue;
    try { execFileSync(p, ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", "/bin/true"], { stdio: "ignore", timeout: 5000 }); bwrapPath = p; } catch { /* not allowed here */ }
    break;
  }
  return bwrapPath;
}
export function sandboxKind(): SandboxKind | null {
  if (process.platform === "darwin") return existsSync(SANDBOX_EXEC) ? "seatbelt" : null;
  if (process.platform === "linux") return findBwrap() ? "bwrap" : null;
  return null;
}
export const sandboxAvailable = () => sandboxKind() !== null;
export const SANDBOX_NEEDS = "The sandbox needs macOS (sandbox-exec) or Linux with bubblewrap (bwrap) installed.";

const q = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const HOME = homedir();
// Credentials no command needs for building or testing.
const PRIVATE_HOME = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".claude", ".config/gh", ".config/gcloud", "Library/Keychains"];

export type SandboxPlan = {
  writable: string[];      // folders the command may write in (real paths)
  readOnly?: string[];     // inside those, paths that stay read-only
  unreadable?: string[];   // extra paths the command can't read
};

export function sandboxProfile(plan: SandboxPlan): string {
  const sub = (paths: string[]) => paths.map((p) => `(subpath ${q(p)})`).join(" ");
  return [
    "(version 1)",
    "(allow default)",
    // No network, except talking to itself: test servers on localhost keep working.
    "(deny network*)",
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-bind (local ip "localhost:*") (local ip "*:*"))',
    // Writes: only the working folder and temp folders.
    "(deny file-write*)",
    `(allow file-write* ${sub([...plan.writable, "/private/tmp", "/private/var/folders", "/dev"])})`,
    plan.readOnly?.length ? `(deny file-write* ${sub(plan.readOnly)})` : "",
    // Reads: not your credentials, and not .env files anywhere.
    `(deny file-read* ${sub([...PRIVATE_HOME.map((p) => join(HOME, p)), ...(plan.unreadable ?? [])])} (regex #"/\\.env[^/]*$"))`,
  ].filter(Boolean).join("\n");
}

// Linux: everything read-only, then the writable folders (and /tmp) bound back writable, the
// read-only ones inside them bound read-only again, and what mustn't be read covered over.
// --unshare-net: no network but its own localhost. --die-with-parent: Stop ends it.
export function bwrapArgs(plan: SandboxPlan, command: string): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session"];
  for (const w of [...plan.writable, "/tmp", "/var/tmp"]) if (existsSync(w)) args.push("--bind", w, w);
  for (const r of plan.readOnly ?? []) if (existsSync(r)) args.push("--ro-bind", r, r);
  const hide = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) args.push("--tmpfs", p);
    else args.push("--ro-bind", "/dev/null", p);
  };
  for (const p of [...PRIVATE_HOME.map((x) => join(HOME, x)), ...(plan.unreadable ?? [])]) hide(p);
  for (const root of plan.writable) for (const env of envFilesIn(root)) hide(env);
  return [...args, "/bin/sh", "-c", command];
}
// .env files a few levels down (bwrap can't match a pattern the way sandbox-exec can).
function envFilesIn(root: string, depth = 4): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      if (/^\.env/.test(n)) { out.push(p); continue; }
      if (d > 0 && n !== "node_modules" && n !== ".git") { try { if (statSync(p).isDirectory()) walk(p, d - 1); } catch { /* gone */ } }
    }
  };
  walk(root, depth);
  return out.slice(0, 500);
}

// The command line that runs `command` inside the sandbox. env: what to add to its environment
// (the allowed-hosts proxy, when there is one).
export function sandboxed(command: string, plan: SandboxPlan, kind: SandboxKind | null = sandboxKind()): { file: string; args: string[] } {
  if (kind === "bwrap") return { file: findBwrap() ?? "bwrap", args: bwrapArgs(plan, command) };
  return { file: SANDBOX_EXEC, args: ["-p", sandboxProfile(plan), "/bin/sh", "-c", command] };
}
