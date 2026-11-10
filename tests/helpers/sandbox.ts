// Every test file runs in its own throwaway camp folder, so tests never touch your real camp.
// Call this BEFORE importing anything from src/: the camp root is fixed when src/tools.ts loads.

import { cpSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..", "..");

// Tests run on the API runtime against a fake API; evals keep whatever runtime you've configured.
export function enterSandbox(name: string, opts: { keepRuntime?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), `satchel-${name}-`));
  cpSync(join(REPO, "skills"), join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "camp"), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  process.chdir(dir);
  if (!opts.keepRuntime) {
    process.env.CAMP_RUNTIME = "api";
    process.env.ANTHROPIC_API_KEY ??= "test-key-not-real";
  }
  return dir;
}
