// Your week on Home: Monday to Sunday from the linked Google Calendar, events on the days they
// cover, today marked, and a link only when it's Google Calendar's own.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { CalendarWeek } from "../types.ts";
import { WeekCalendar, daysOf, weekStart } from "./WeekCalendar.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const now = new Date(2026, 10, 26, 10, 0); // Thursday 26 November 2026
const week: CalendarWeek = {
  from: "", to: "", timeZone: "Europe/London", more: false, events: [
    { id: "a", title: "Standup", start: new Date(2026, 10, 26, 9, 0).toISOString(), end: new Date(2026, 10, 26, 9, 15).toISOString(), allDay: false, location: null, url: "https://calendar.google.com/event?eid=a", answer: null },
    { id: "b", title: "Offsite", start: "2026-11-27", end: "2026-11-29", allDay: true, location: null, url: null, answer: null },
  ],
};

test("the week starts on Monday, and an all-day event covers each of its days", () => {
  expect(weekStart(now).getDate()).toBe(23);
  const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 23 + i));
  expect(daysOf(week.events[1], days)).toEqual(["2026-11-27", "2026-11-28"]);
  expect(daysOf(week.events[0], days)).toEqual(["2026-11-26"]);
});

test("shows the seven days with today marked, and steps to the next week", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(week), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  render(<WeekCalendar now={now} />);
  const today = await screen.findByText("Standup");
  const cell = today.closest("li.home-week-day")!;
  expect(cell.getAttribute("aria-current")).toBe("date");
  expect(today.closest("a")!.getAttribute("href")).toBe("https://calendar.google.com/event?eid=a");
  expect(screen.getAllByText("Offsite")).toHaveLength(2);
  expect(document.querySelectorAll("li.home-week-day")).toHaveLength(7);
  expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain(encodeURIComponent(new Date(2026, 10, 23).toISOString()));
  fireEvent.click(screen.getByRole("button", { name: "The week after" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(String((fetch.mock.calls[1] as unknown[])[0])).toContain(encodeURIComponent(new Date(2026, 10, 30).toISOString()));
  expect(screen.getByText(/Next week/)).toBeTruthy();
});
