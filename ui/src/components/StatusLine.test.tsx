// The line above the message box: what the page says back to you. A plain line goes after a few
// seconds; something that went wrong stays until you dismiss it.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { StatusLine, tell } from "./StatusLine.tsx";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("a plain line shows for about four seconds; an error stays until dismissed; both go into the feed too", () => {
  const store = createFeedStore();
  render(<StatusLine />);
  const line = screen.getByRole("status");
  expect(line.getAttribute("aria-live")).toBe("polite");
  expect(line.childElementCount).toBe(0); // there from the start, so what appears in it is announced

  act(() => tell(store, "Rated 👍"));
  act(() => tell(store, "Couldn't find src/a.ts in the folders attached here.", true));
  expect(within(line).getByText("Rated 👍")).toBeTruthy();
  expect(within(line).getByText("Couldn't find src/a.ts in the folders attached here.").parentElement!.className).toBe("status-msg bad");
  expect(store.getState().items.map((n) => n.kind === "sys" && n.text)).toEqual(["Rated 👍", "Couldn't find src/a.ts in the folders attached here."]);

  act(() => { vi.advanceTimersByTime(3900); });
  expect(within(line).queryByText("Rated 👍")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(200); });
  expect(within(line).queryByText("Rated 👍")).toBeNull();
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(within(line).getByText(/Couldn't find/)).toBeTruthy(); // the error is still there

  fireEvent.click(within(line).getByRole("button", { name: "Dismiss" }));
  expect(line.childElementCount).toBe(0);
});

test("lines that come one after another each get their own few seconds, and only the last three are kept", () => {
  const store = createFeedStore();
  render(<StatusLine />);
  const texts = () => [...screen.getByRole("status").querySelectorAll(".status-msg > span")].map((s) => s.textContent);
  act(() => tell(store, "one"));
  act(() => { vi.advanceTimersByTime(2000); });
  act(() => { tell(store, "two"); tell(store, "three"); tell(store, "four"); });
  expect(texts()).toEqual(["two", "three", "four"]);
  act(() => { vi.advanceTimersByTime(3900); });
  expect(texts()).toEqual(["two", "three", "four"]);
  act(() => { vi.advanceTimersByTime(200); });
  expect(texts()).toEqual([]);
});
