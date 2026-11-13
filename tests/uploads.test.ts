// Clearing out uploads: only what nothing uses any more, only once it's old enough, and only
// when you ask (or have said how long to keep them).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("uploads");
const { saveUpload } = await import("../src/attachments.ts");
const { uploadBatches, uploadsUsage, pruneUploads } = await import("../src/uploads.ts");
const { saveToFeed } = await import("../src/feed.ts");
const { recordTurn } = await import("../src/threads.ts");
const c = await import("../src/conversations.ts");
const settings = await import("../src/settings.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const DAY = 86_400_000;
const now = Date.now();
// One uploaded file in a batch of its own, made to look `days` old.
function upload(batch: string, name: string, days: number, bytes = 1000) {
  const u = saveUpload({ name, data: Buffer.alloc(bytes, 1).toString("base64"), batch });
  const then = new Date(now - days * DAY);
  utimesSync(u.path, then, then);
  utimesSync(join("camp", "uploads", batch), then, then);
  return u.path;
}
// A run that was sent these files, in a conversation of its own.
function sent(run: string, paths: string[]) {
  recordTurn({ thread: run, expedition: run, agent: "scout", direct: true, task: "Look at this", reply: "Looked.", status: "done" });
  saveToFeed({ type: "expedition_start", id: run, task: "Look at this", source: "direct", thread: run, expeditionId: run, seq: 1, time: "",
    attachments: paths.map((path) => ({ kind: "file", name: path.split("/").pop()!, path })) } as any);
}

test("what's in use is kept; what nothing uses goes once it's old enough, and never sooner than a day", () => {
  const kept = upload("2026-01-01-aaaaaa", "diagram.png", 40);     // a conversation still in history was sent it
  const loose = upload("2026-01-02-bbbbbb", "old-shot.png", 40, 3000); // attached once, to a conversation since removed
  const fresh = upload("2026-03-01-cccccc", "draft.pdf", 0.2);     // attached to a message not sent yet
  const pinned = upload("2026-01-03-dddddd", "spec.pdf", 40);      // a project pins it
  const cited = upload("2026-01-04-eeeeee", "table.csv", 40);      // a wiki page points at it
  const recent = upload("2026-02-20-ffffff", "week-old.png", 7);   // unused, a week old
  sent("run-kept", [kept]);
  sent("run-gone", [loose]);
  c.removeConversation("run-gone");
  c.addProject({ name: "Web app", pins: [pinned] });
  mkdirSync("camp/wiki/notes", { recursive: true });
  writeFileSync("camp/wiki/notes/data.md", `---\nsummary: where the numbers are\n---\nSee ${cited}.`);

  const byName = Object.fromEntries(uploadBatches().map((b) => [b.name, b.inUse]));
  assert.deepEqual(byName, { "2026-01-01-aaaaaa": true, "2026-01-02-bbbbbb": false, "2026-03-01-cccccc": false, "2026-01-03-dddddd": true, "2026-01-04-eeeeee": true, "2026-02-20-ffffff": false });

  // What a clear-out would take: the unused ones a day old or more (not the one attached a few hours ago).
  let u = uploadsUsage(undefined, now);
  assert.equal(u.batches, 6);
  assert.deepEqual(u.clearable, { batches: 2, files: 2, bytes: 4000 });
  assert.equal(uploadsUsage(30, now).clearable.batches, 1, "asked for 30 days, the week-old one stays");
  assert.equal(uploadsUsage(0, now).olderThanDays, 1, "a day is the least");

  // Thirty days: only the old loose one goes.
  assert.deepEqual(pruneUploads(30, now), { batches: 1, files: 1, bytes: 3000 });
  assert.ok(!existsSync(loose) && !existsSync(join("camp", "uploads", "2026-01-02-bbbbbb")));
  for (const p of [kept, fresh, pinned, cited, recent]) assert.ok(existsSync(p), `${p} is still there`);
  // The button (a day): the week-old one too; the fresh one and everything in use stay.
  assert.deepEqual(pruneUploads(undefined, now), { batches: 1, files: 1, bytes: 1000 });
  for (const p of [kept, fresh, pinned, cited]) assert.ok(existsSync(p), `${p} is still there`);
  assert.deepEqual(pruneUploads(undefined, now), { batches: 0, files: 0, bytes: 0 });
  u = uploadsUsage(undefined, now);
  assert.equal(u.batches, 4);
});

test("only upload batches are ever touched, and how long to keep them is yours to set", () => {
  mkdirSync("camp/uploads/notes", { recursive: true }); // not a batch the camp made (too short a name)
  writeFileSync("camp/uploads/notes/mine.txt", "keep");
  writeFileSync("camp/uploads/loose-file.txt", "keep");
  const old = new Date(now - 400 * DAY);
  utimesSync("camp/uploads/notes/mine.txt", old, old); utimesSync("camp/uploads/notes", old, old); utimesSync("camp/uploads/loose-file.txt", old, old);
  pruneUploads(1, now);
  assert.ok(existsSync("camp/uploads/notes/mine.txt") && existsSync("camp/uploads/loose-file.txt"));

  assert.equal(settings.uploadKeepDays(), null, "by default nothing is ever deleted");
  settings.setUploadKeepDays(30);
  assert.equal(settings.uploadKeepDays(), 30);
  settings.setUploadKeepDays(0.2);
  assert.equal(settings.uploadKeepDays(), null);
  settings.setUploadKeepDays(null);
  assert.equal(settings.uploadKeepDays(), null);
});
