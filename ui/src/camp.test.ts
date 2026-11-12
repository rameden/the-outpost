// The page's state: a light refresh says which history it already has, and keeps it when the
// camp leaves it out as unchanged.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCampState } from "./camp.ts";

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
