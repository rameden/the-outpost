// The shell sandbox (macOS): when it's on, commands the crew runs can't reach the network, can't
// write outside the folder they're working in (plus temp folders), and can't read your keys or
// .env files. Because of those limits they run without asking you first, which is what lets tests
// and type checks run unattended. Anything that needs more (an install, a push) is asked for the
// usual way and runs outside the sandbox only if you approve it.
//
// Turn it on in mission control (Quests tab) or with "shell": { "sandbox": true } in
// camp/settings.json. It uses macOS's own sandbox-exec; on other systems it stays off and every
// command asks, as before.
//
// What it does not do: protect the working folder itself. A sandboxed command can still change or
// delete files there (that's what running a build or a formatter needs). Use a worktree for work
// you want kept apart from your own checkout.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
export const sandboxAvailable = () => process.platform === "darwin" && existsSync(SANDBOX_EXEC);

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

// The command line that runs `command` inside the sandbox.
export function sandboxed(command: string, plan: SandboxPlan): { file: string; args: string[] } {
  return { file: SANDBOX_EXEC, args: ["-p", sandboxProfile(plan), "/bin/sh", "-c", command] };
}
