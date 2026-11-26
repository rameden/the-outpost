// Every CAMP_ setting answers to an OUTPOST_ name too (scripts/env.mjs, which every entry point
// loads first). The CAMP_ name still works, and wins when both are set: the star chart sets
// CAMP_PORT for each outpost it starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// A file:// URL: --import won't take a bare Windows path (D:\…).
const ENV = pathToFileURL(join(import.meta.dirname, "..", "scripts", "env.mjs")).href;
const read = (env: Record<string, string>, names: string[], cwd?: string) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CAMP_") && !k.startsWith("OUTPOST_")));
  const out = execFileSync(process.execPath, ["--import", ENV, "-e", `console.log(JSON.stringify(${JSON.stringify(names)}.map((n) => process.env[n] ?? null)))`],
    { env: { ...clean, ...env }, cwd: cwd ?? tmpdir(), encoding: "utf8" });
  return JSON.parse(out);
};

test("an OUTPOST_ name sets its CAMP_ setting", () => {
  assert.deepEqual(read({ OUTPOST_PORT: "4848", OUTPOST_LAN: "1" }, ["CAMP_PORT", "CAMP_LAN", "OUTPOST_PORT"]), ["4848", "1", "4848"]);
});

test("the CAMP_ name still works, and wins over an OUTPOST_ one", () => {
  assert.deepEqual(read({ CAMP_PORT: "4949" }, ["CAMP_PORT"]), ["4949"]);
  assert.deepEqual(read({ CAMP_PORT: "4949", OUTPOST_PORT: "4848" }, ["CAMP_PORT"]), ["4949"]);
});

test("an OUTPOST_ name in .env works too", () => {
  const dir = mkdtempSync(join(tmpdir(), "outpost-env-"));
  try {
    writeFileSync(join(dir, ".env"), "OUTPOST_RUNTIME=api\n");
    assert.deepEqual(read({}, ["CAMP_RUNTIME"], dir), ["api"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
