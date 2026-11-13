// The page's state: a light refresh says which history it already has, and keeps it when the
// camp leaves it out as unchanged.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCampEvents, useCampState } from "./camp.ts";
import { createFeedStore } from "./feed/store.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("an unchanged history isn't sent again, and the page keeps the one it has", async () => {
  const urls: string[] = [];
  const history = { projects: [{ id: "general", name: "General" }], conversations: [{ id: "c1" }] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    const light = url.includes("full=0");
    const body = light ? { running: [{ id: "r" }], historyVersion: "v1" } : { running: [], history, historyVersion: "v1", memory: "m" };
    return new Response(JSON.stringify(body));
  }));
  const { result } = renderHook(() => useCampState());
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.S?.history).toEqual(history));
  const first = result.current.S?.history;
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.S?.running).toEqual([{ id: "r" }]));
  expect(urls[0]).toMatch(/\/api\/state$/);
  expect(urls[1]).toMatch(/\/api\/state\?full=0&history=v1$/);
  expect(result.current.S?.history).toBe(first); // the same object: nothing that reads it redraws
});

test("an answer that arrives after a newer one is dropped, so the panels never go back in time", async () => {
  const waiting: ((body: object) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((answer) => waiting.push((body) => answer(new Response(JSON.stringify(body)))))));
  const { result } = renderHook(() => useCampState());
  act(() => result.current.refresh());
  await waitFor(() => expect(waiting.length).toBe(1));
  act(() => result.current.refresh());
  await waitFor(() => expect(waiting.length).toBe(2));
  // The second request is answered first; the first one's answer turns up after it.
  await act(async () => { waiting[1]({ running: [{ id: "newer" }], historyVersion: "v2" }); });
  await waitFor(() => expect(result.current.S?.running).toEqual([{ id: "newer" }]));
  await act(async () => { waiting[0]({ running: [{ id: "older" }], historyVersion: "v1" }); await new Promise((r) => setTimeout(r, 20)); });
  expect(result.current.S?.running).toEqual([{ id: "newer" }]);
});

test("a reload that fails is flagged as out of date until one works", async () => {
  let ok = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => (ok ? new Response(JSON.stringify({ running: [] })) : new Response(JSON.stringify({ error: "camp is restarting" }), { status: 502 }))));
  const { result } = renderHook(() => useCampState());
  expect(result.current.stale).toBe(false);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.stale).toBe(true));
  ok = true;
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.stale).toBe(false));
  expect(result.current.S?.running).toEqual([]);
  vi.restoreAllMocks();
});

// ---------- The live stream ----------
// A stand-in for the browser's EventSource: `drop` is a lost connection the browser retries by
// itself; `fail` is an error answer (401, 502), after which the browser gives up for good.
class Stream {
  static made: Stream[] = [];
  readyState = 0;
  closed = false;
  listeners: Record<string, (m: { data: string }) => void> = {};
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { Stream.made.push(this); }
  addEventListener(name: string, fn: (m: { data: string }) => void) { this.listeners[name] = fn; }
  close() { this.closed = true; this.readyState = 2; }
  hello(bootId: string) { this.readyState = 1; this.listeners.hello({ data: JSON.stringify({ bootId }) }); }
  drop() { this.readyState = 0; this.onerror?.(); }
  fail() { this.readyState = 2; this.onerror?.(); }
}

test("a stream the browser has given up on is opened again: after 1s, 2s, 5s, then every 10s, saying the camp isn't running after 30s", () => {
  vi.useFakeTimers();
  Stream.made = [];
  vi.stubGlobal("EventSource", Stream);
  const store = createFeedStore();
  const reset = vi.spyOn(store, "reset");
  const refresh = vi.fn();
  const { result, unmount } = renderHook(() => useCampEvents(store, refresh));
  const last = () => Stream.made.at(-1)!;
  const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  expect(result.current).toBe("connecting");
  act(() => last().hello("boot-1"));
  expect(result.current).toBe("live");
  expect(refresh).toHaveBeenCalledTimes(1);

  // A dropped connection: the browser is retrying by itself, so nothing new is opened.
  act(() => last().drop());
  expect(result.current).toBe("reconnecting");
  pass(20_000);
  expect(Stream.made.length).toBe(1);
  act(() => last().hello("boot-1"));
  expect(result.current).toBe("live");
  expect(reset).not.toHaveBeenCalled(); // the same camp: the feed carries on

  // The camp goes away and its port answers with an error: the browser stops, the page doesn't.
  act(() => last().fail());
  expect(result.current).toBe("reconnecting");
  expect(Stream.made[0].closed).toBe(true);
  pass(999);
  expect(Stream.made.length).toBe(1);
  pass(1);
  expect(Stream.made.length).toBe(2);
  expect(last().url).toBe(Stream.made[0].url); // the same link: the camp keeps its token across restarts
  for (const [wait, count] of [[2000, 3], [5000, 4], [10_000, 5], [10_000, 6]]) {
    act(() => last().fail());
    pass(wait - 1);
    expect(Stream.made.length).toBe(count - 1);
    pass(1);
    expect(Stream.made.length).toBe(count);
  }
  expect(result.current).toBe("reconnecting"); // 28 seconds in
  pass(2000);
  expect(result.current).toBe("offline");
  // It keeps trying quietly, and picks up when the camp is back (a new camp: the feed starts over).
  act(() => last().fail());
  expect(result.current).toBe("offline");
  pass(10_000);
  expect(Stream.made.length).toBe(7);
  act(() => last().hello("boot-2"));
  expect(result.current).toBe("live");
  expect(reset).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(3);

  // Leaving the page closes the stream and leaves nothing waiting to fire.
  pass(20); // (the feed's own redraw, from starting over)
  act(() => last().fail());
  unmount();
  expect(last().closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  pass(60_000);
  expect(Stream.made.length).toBe(7);
});
