// The replay's timeline: the day's events played into a feed of their own, and scrubbed.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent } from "../types.ts";
import { reelOf, realAt } from "./replay.ts";
import { Timeline, type Time } from "./Timeline.tsx";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
// Ten events, ten seconds apart: the line is 90s + 4s long, which plays in 30s at 94/30 line-seconds a second.
const ev = (i: number) => ({ type: "text", who: "Scout", emoji: "🏹", depth: 1, text: `t${i}`, seq: i + 1, time: new Date(T0 + i * 10_000).toISOString() }) as CampEvent;
const reel = reelOf(Array.from({ length: 10 }, (_, i) => ev(i)));
const PACE = reel.span / 30_000; // line-ms per real ms

function mount() {
  const store = createFeedStore();
  const time: Time = { now: null, quiet: false };
  const onLeave = vi.fn();
  const r = render(<Timeline reel={reel} store={store} time={time} onLeave={onLeave} />);
  const played = () => store.getState().lastSeq;
  const range = () => screen.getByRole("slider", { name: "Where in the day" }) as HTMLInputElement;
  return { ...r, store, time, onLeave, played, range };
}
const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

test("it starts at the first event and plays the rest in as time goes by", () => {
  const { played, time } = mount();
  expect(played()).toBe(1);
  expect(time.now).toBe(T0);
  pass(10_000 / PACE + 100); // far enough along the line for the second event, not the third
  expect(played()).toBe(2);
  expect(time.now).toBeGreaterThan(T0);
  pass(30_000);
  expect(played()).toBe(10); // all of it, and it stops there
  expect(screen.getByRole("button", { name: "Play the replay" })).toBeTruthy();
});

test("pausing holds it where it is, and playing carries on", () => {
  const { played, range } = mount();
  pass(5000);
  fireEvent.click(screen.getByRole("button", { name: "Pause the replay" }));
  const at = played(), pos = range().value;
  pass(10_000);
  expect(played()).toBe(at);
  expect(range().value).toBe(pos);
  fireEvent.click(screen.getByRole("button", { name: "Play the replay" }));
  pass(10_000);
  expect(played()).toBeGreaterThan(at);
});

test("dragging forward plays the events up to there, with the clock on the moment shown", () => {
  const { played, range, time } = mount();
  fireEvent.change(range(), { target: { value: "50000" } });
  expect(played()).toBe(6);
  expect(time.now).toBe(realAt(reel, 50_000));
  expect(range().value).toBe("50000");
});

test("dragging back starts the feed over and plays up to the point, and leaves no later event in it", () => {
  const { store, played, range, time } = mount();
  fireEvent.change(range(), { target: { value: "80000" } });
  expect(played()).toBe(9);
  fireEvent.change(range(), { target: { value: "20000" } });
  expect(played()).toBe(3);
  expect(store.getState().crew.Scout).toBeTruthy();
  expect(JSON.stringify(store.getState().items)).not.toContain("t5");
  expect(time.now).toBe(realAt(reel, 20_000));
  expect(time.quiet).toBe(false); // (catching up is over by the time it returns)
});

test("while it catches up after a jump the view is told to be quiet", () => {
  const { store, time, range } = mount();
  const seen: boolean[] = [];
  store.onEvent(() => seen.push(time.quiet));
  fireEvent.change(range(), { target: { value: "30000" } });
  expect(seen).toEqual([true, true, true]);
  seen.length = 0;
  pass(300); // ordinary playing
  expect(seen.every((q) => !q)).toBe(true);
});

test("the speed buttons say which is on, and a faster one gets through the day sooner", () => {
  const { played } = mount();
  const x = (label: string) => screen.getByRole("button", { name: label });
  expect(x("1×").getAttribute("aria-pressed")).toBe("true");
  expect(x("½×").getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(x("4×"));
  expect(x("4×").getAttribute("aria-pressed")).toBe("true");
  expect(x("1×").getAttribute("aria-pressed")).toBe("false");
  pass(30_000 / 4 + 200);
  expect(played()).toBe(10);
});

test("once it has played out, play starts it again from the top", () => {
  const { played } = mount();
  pass(31_000);
  expect(played()).toBe(10);
  fireEvent.click(screen.getByRole("button", { name: "Play the replay" }));
  expect(played()).toBe(1);
  expect(screen.getByRole("button", { name: "Pause the replay" })).toBeTruthy();
});

test("Back to now leaves, and taking it away puts the clock back to the real time", () => {
  const { onLeave, time, unmount } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Back to now" }));
  expect(onLeave).toHaveBeenCalledTimes(1);
  expect(time.now).not.toBeNull();
  unmount();
  expect(time.now).toBeNull();
  expect(time.quiet).toBe(false);
});

test("the line is labelled, and shows the time of the moment it's at", () => {
  const { range } = mount();
  expect(screen.getByRole("region", { name: "Replay of the last day" })).toBeTruthy();
  expect(range().max).toBe(String(reel.span));
  expect(range().getAttribute("aria-valuetext")).toMatch(/^\d\d:\d\d$/);
});

test("expeditions setting out and decisions waiting are marked on the line, in classes of their own", () => {
  const withMarks = reelOf([
    { ...ev(0), type: "expedition_start", id: "A", task: "Dig", source: "user" } as unknown as CampEvent,
    ev(1),
    { ...ev(2), type: "ask", id: "k", kind: "plan", title: "Approve", body: "" } as unknown as CampEvent,
  ]);
  const { container } = render(<Timeline reel={withMarks} store={createFeedStore()} time={{ now: null, quiet: false }} onLeave={vi.fn()} />);
  const marks = [...container.querySelectorAll(".orb-reel-marks i")];
  expect(marks.map((m) => m.className)).toEqual(["m-start", "m-ask"]);
  expect(marks.map((m) => m.getAttribute("title"))).toEqual(["Dig", "Approve"]);
});
