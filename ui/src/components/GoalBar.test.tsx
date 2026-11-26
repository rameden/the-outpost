// The goal set on a conversation, above the message box.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Goal } from "../goal.ts";
import { GoalBar } from "./GoalBar.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const goal = (over: Partial<Goal> = {}): Goal => ({ thread: "c1", goal: "Get the suite green", status: "active", rounds: 2, maxRounds: 5, set: "2026-11-01T00:00:00.000Z", ...over }) as Goal;
function camp(status = 200, answer: unknown = { ok: true }) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${init.body}` : ""}`);
    return new Response(JSON.stringify(answer), { status });
  }));
  return asked;
}

test("no goal, no bar", () => {
  const { container } = render(<GoalBar refresh={vi.fn()} />);
  expect(container.innerHTML).toBe("");
});

test("a goal being worked on: what it is, the round, what the judge last said, and Clear", async () => {
  const asked = camp();
  const refresh = vi.fn();
  render(<GoalBar goal={goal({ lastReason: "2 tests still fail" })} refresh={refresh} />);
  const bar = screen.getByRole("status", { name: "This conversation's goal" });
  expect(bar.textContent).toContain("Get the suite green");
  expect(bar.textContent).toContain("Round 2 of 5");
  expect(bar.textContent).toContain("2 tests still fail");
  const rounds = screen.getByRole("progressbar", { name: "Round 2 of 5" }) as HTMLProgressElement;
  expect([rounds.value, rounds.max]).toEqual([2, 5]);
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull(); // it's already going

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(asked).toEqual([`POST /api/goal ${JSON.stringify({ thread: "c1", action: "clear" })}`]);
});

test("paused: the bar says the goal is held", () => {
  render(<GoalBar goal={goal()} paused refresh={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toContain("Held while paused · round 2 of 5");
});

test("a goal that's over says how it ended, and can be taken up again", async () => {
  const asked = camp();
  const refresh = vi.fn();
  const { rerender } = render(<GoalBar goal={goal({ status: "stopped", rounds: 5, lastReason: "Not reached after 5 rounds, the most this goal allows." })} refresh={refresh} />);
  expect(screen.getByRole("status").textContent).toContain("Stopped");
  expect(screen.getByRole("status").textContent).toContain("Not reached after 5 rounds");
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(asked).toEqual([`POST /api/goal ${JSON.stringify({ thread: "c1", action: "resume" })}`]);

  rerender(<GoalBar goal={goal({ status: "done", lastReason: "All green." })} refresh={refresh} />);
  expect(screen.getByRole("status").textContent).toContain("Reached");
  rerender(<GoalBar goal={goal({ status: "blocked", lastReason: "It needs your key." })} refresh={refresh} />);
  expect(screen.getByRole("status").textContent).toContain("Needs you");
});

test("a refusal from the server changes nothing on the page", async () => {
  const asked = camp(409, { error: "Outpost is paused." });
  const refresh = vi.fn();
  render(<GoalBar goal={goal({ status: "stopped" })} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(asked.length).toBe(1));
  await waitFor(() => expect((screen.getByRole("button", { name: "Resume" }) as HTMLButtonElement).disabled).toBe(false));
  expect(refresh).not.toHaveBeenCalled();
});
