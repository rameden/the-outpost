// What a crew member's shell commands change in its own outputs folder (not a repository, or
// one the camp ignores) is part of what the run changed: View changes shows it, Undo puts it back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("shell-outputs");
const { withExpedition } = await import("../src/context.ts");
const { snapshotFolderBeforeShell, sealSnapshots, changedFiles, checkpointDiff, undoCheckpoint } = await import("../src/checkpoints.ts");
const { recordTurn, threadFor } = await import("../src/threads.ts");

const outputs = resolve("camp", "agents", "artificer", "outputs");
const shown = "camp/agents/artificer/outputs";
const run = (id: string, work: () => void) =>
  withExpedition({ id }, async () => { await snapshotFolderBeforeShell(outputs, shown); work(); await snapshotFolderBeforeShell(outputs, shown); await sealSnapshots(id); });

test("files a command made or changed in the outputs folder are listed, with a diff", async () => {
  mkdirSync(join(outputs, "spike", "src"), { recursive: true });
  writeFileSync(join(outputs, "spike", "src", "main.ts"), "export const light = 1;\n");
  await run("so-1", () => {
    writeFileSync(join(outputs, "spike", "src", "main.ts"), "export const light = 2;\n");
    writeFileSync(join(outputs, "spike", "soak.log.txt"), "52/52 passing\n");
    mkdirSync(join(outputs, "spike", "node_modules", "x"), { recursive: true });
    writeFileSync(join(outputs, "spike", "node_modules", "x", "index.js"), "1\n"); // dependencies are left out
  });
  const files = changedFiles("so-1");
  assert.deepEqual(files.map((f) => `${f.change} ${f.path}`).sort(), [
    `created ${shown}/spike/soak.log.txt`,
    `modified ${shown}/spike/src/main.ts`,
  ]);
  const { diff } = checkpointDiff("so-1");
  assert.match(diff, /-export const light = 1;/);
  assert.match(diff, /\+export const light = 2;/);
});

test("undo puts the outputs folder back", async () => {
  const { restored } = undoCheckpoint("so-1");
  assert.equal(restored.length, 2);
  assert.equal(readFileSync(join(outputs, "spike", "src", "main.ts"), "utf8"), "export const light = 1;\n");
  assert.ok(!existsSync(join(outputs, "spike", "soak.log.txt")));
});

test("a folder that doesn't exist yet is made, so what the first command puts there counts", async () => {
  rmSync(outputs, { recursive: true, force: true });
  await run("so-2", () => writeFileSync(join(outputs, "notes.md"), "hi\n"));
  assert.deepEqual(changedFiles("so-2"), [{ path: `${shown}/notes.md`, change: "created" }]);
});

test("a run you stopped is picked up with the files it had changed in front of it", () => {
  recordTurn({ thread: "so-2", expedition: "so-2", agent: "quartermaster", direct: false, task: "Build the spike", reply: "Starting the soak test.\n\n[Stopped by the user.]", status: "stopped" } as any);
  const history = threadFor("so-2")!.history;
  assert.match(history, /stopped by the user part-way/);
  assert.match(history, new RegExp(`Files it changed: ${shown}/notes\\.md \\(created\\)`));
});
