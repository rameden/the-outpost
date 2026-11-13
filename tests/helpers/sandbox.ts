// Every test file runs in its own throwaway camp folder, so tests never touch your real camp.
// Call this BEFORE importing anything from src/: the camp root is fixed when src/tools.ts loads.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..", "..");

// What a test can't check on Windows, and why. Each is given to node:test's `skip`, so the
// Windows run says what it left out instead of failing on something that isn't about the camp.
export const WINDOWS = process.platform === "win32";
// The stand-ins for gh and claude are shell scripts: Windows can't start one as a program.
export const NEEDS_SH: string | false = WINDOWS ? "stands a shell script in for a program (gh, claude…), which Windows can't start" : false;
// File modes, the sandbox, a POSIX shell in the terminal, symlinks without special rights.
export const NEEDS_POSIX: string | false = WINDOWS ? "checks something only macOS and Linux have (file modes, the sandbox, a POSIX shell, plain symlinks)" : false;

// Tests run on the API runtime against a fake API; evals keep whatever runtime you've configured.
export function enterSandbox(name: string, opts: { keepRuntime?: boolean } = {}): string {
  // (By its full name: on Windows mkdtemp can hand back the short one, C:\\Users\\RUNNER~1\\…, which git never uses.)
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `satchel-${name}-`)));
  // The skills that come with the camp (the ones git tracks), not ones you've imported or been
  // proposed since: a test shouldn't pass or fail on what happens to be installed here.
  const shipped = execFileSync("git", ["ls-files", "-z", "skills"], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of shipped) cpSync(join(REPO, file), join(dir, file), { recursive: true });
  mkdirSync(join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "camp"), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "junction"); // (a junction on Windows, which needs no special rights; an ordinary symlink elsewhere)
  process.chdir(dir);
  if (!opts.keepRuntime) {
    process.env.CAMP_RUNTIME = "api";
    process.env.ANTHROPIC_API_KEY ??= "test-key-not-real";
  }
  return dir;
}
