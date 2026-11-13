// What's happening in each conversation (running? decisions waiting?), read from the feed many
// times a second: it hands back the very same object until one of those answers changes, so the
// page isn't drawn again for every word of a reply.
import { expect, test } from "vitest";
import type { CampEvent } from "../types.ts";
import { activityOf } from "./conversation.ts";
import { applyEvent, emptyFeed, type FeedState } from "./reducer.ts";

let seq = 0;
const after = (s: FeedState, ...bodies: object[]) => bodies.reduce<FeedState>((was, b) => applyEvent(was, { ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent), s);
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };

test("words arriving in a reply don't change it: the same object comes back until a run starts, ends, or asks", () => {
  let s = after(emptyFeed,
    { type: "expedition_start", id: "a1", task: "One", source: "user", thread: "a" },
    { type: "expedition_start", id: "b1", task: "Two", source: "user", thread: "b" });
  const first = activityOf(s);
  expect(first).toEqual({ a: { running: true, needs: 0 }, b: { running: true, needs: 0 } });

  for (const word of ["Looking ", "into ", "it"]) {
    const next = after(s, { type: "text_delta", ...qm, delta: word, expeditionId: "a1" });
    expect(next.items).not.toBe(s.items); // the feed did change…
    s = next;
    expect(activityOf(s)).toBe(first);    // …but not what this says about it
  }

  s = after(s, { type: "ask", id: "k1", kind: "plan", title: "Plan", body: "1.", expeditionId: "a1" });
  const asked = activityOf(s);
  expect(asked).not.toBe(first);
  expect(asked).toEqual({ a: { running: true, needs: 1 }, b: { running: true, needs: 0 } });

  s = after(s, { type: "expedition_end", id: "b1", status: "done", text: "Done." });
  const ended = activityOf(s);
  expect(ended).toEqual({ a: { running: true, needs: 1 } });
  expect(activityOf(after(s, { type: "text_delta", ...qm, delta: "…", expeditionId: "a1" }))).toBe(ended);
});
