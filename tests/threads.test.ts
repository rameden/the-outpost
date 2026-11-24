// The record of every run: nothing written before is lost when a run is added or the file is tidied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("threads");
const { recordTurn, copyTurns, allTurns, compactThreads, threadLines, THREADS_PATH } = await import("../src/threads.ts");

const turn = (i: number, status = "done") => ({ thread: `t${i}`, expedition: `r${i}`, agent: "scout", direct: true, task: `ask ${i}`, reply: status === "done" ? `answer ${i}` : "", status });
const line = (i: number, status = "done") => JSON.stringify({ ...turn(i, status), time: new Date(1_700_000_000_000 + i * 1000).toISOString() });
const onDisk = () => readFileSync(THREADS_PATH, "utf8").split("\n").filter(Boolean);
// Runs already on record that this process hasn't read: what the camp finds when it starts.
function leftBehind(runs: number, deadLines = 0) {
  mkdirSync("camp", { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < runs; i++) {
    if (i < deadLines) lines.push(line(i, "running"));
    lines.push(line(i));
  }
  writeFileSync(THREADS_PATH, lines.join("\n") + "\n");
}

test("a run added before anything was read keeps every run already on record", () => {
  leftBehind(300);
  recordTurn(turn(1000));
  assert.equal(allTurns().length, 301);
  assert.equal(allTurns()[0].expedition, "r0");
  assert.equal(allTurns().at(-1)!.expedition, "r1000");
});

test("a run that ends takes the place of its start, and keeps the time it started", () => {
  leftBehind(3);
  assert.equal(allTurns().length, 3); // read once, so the next writes add to what's known
  recordTurn(turn(7, "running"));
  const started = allTurns().find((t) => t.expedition === "r7")!.time;
  recordTurn(turn(7));
  assert.equal(allTurns().length, 4);
  const ended = allTurns().find((t) => t.expedition === "r7")!;
  assert.deepEqual([ended.status, ended.reply, ended.time], ["done", "answer 7", started]);
  assert.equal(onDisk().length, 5);
});

test("tidying the file by itself, as runs pile up, loses none of them", () => {
  leftBehind(300, 250); // 250 lines nothing reads any more: enough for the tidy to happen
  for (let i = 0; i < 40; i++) recordTurn(turn(2000 + i));
  assert.equal(allTurns().length, 340);
  assert.equal(onDisk().length, 340, "the file was tidied to one line per run, all 340 of them");
  recordTurn(turn(3000)); // the first write after a tidy
  assert.equal(allTurns().length, 341);
  assert.equal(onDisk().length, 341);
});

test("a run added right after a tidy keeps the rest", () => {
  leftBehind(50, 50);
  assert.equal(compactThreads(), 50);
  recordTurn(turn(4000));
  copyTurns([{ ...turn(4001), time: new Date().toISOString() }, { ...turn(4002), time: new Date().toISOString() }]);
  assert.equal(allTurns().length, 53);
  assert.deepEqual(threadLines(), { lines: 53, runs: 53 });
});

test("a file changed from outside is read again, not added to from memory", () => {
  leftBehind(10);
  assert.equal(allTurns().length, 10);
  leftBehind(25); // another process, or a hand edit
  recordTurn(turn(5000));
  assert.equal(allTurns().length, 26);
});
