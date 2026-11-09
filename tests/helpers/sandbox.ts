// Every test file runs in its own throwaway camp folder, so tests never touch your real camp.
// Call this BEFORE importing anything from src/: the camp root is fixed when src/tools.ts loads.

import { cpSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..", "..");

export function enterSandbox(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `guild-camp-${name}-`));
  cpSync(join(REPO, "skills"), join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "camp"), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  process.chdir(dir);
  process.env.ANTHROPIC_API_KEY ??= "test-key-not-real";
  return dir;
}
