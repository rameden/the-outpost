// Your week on Home: when Google Calendar is linked (Settings → Connectors), the primary
// calendar's seven days, Monday to Sunday, at the top of the page. It only reads: an event with a
// Google Calendar link opens there, and ‹ › step a week either way.
//
// What an event says was written by whoever made it, so it's shown as plain text and nothing else.

import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../api.ts";
import { cx } from "../format.ts";
import type { CalendarWeek, WeekEvent } from "../types.ts";

const DAY = 86_400_000;
// Midnight on the Monday of the week `d` is in, by the clock here.
export function weekStart(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Which of the week's days an event shows on: an all-day one on each day it covers (Google's end
// date is the day after), a timed one on each day it reaches into.
export function daysOf(e: WeekEvent, days: Date[]): string[] {
  const keys = days.map(dayKey);
  if (e.allDay) return keys.filter((k) => k >= e.start && k < (e.end > e.start ? e.end : `${e.start}~`));
  const s = new Date(e.start).getTime(), end = Math.max(new Date(e.end).getTime(), s + 1);
  return days.filter((d) => d.getTime() < end && d.getTime() + DAY > s).map(dayKey);
}

export function WeekCalendar({ now = new Date() }: { now?: Date }) {
  const [offset, setOffset] = useState(0); // weeks from this one
  const [week, setWeek] = useState<CalendarWeek | null>(null);
  const [error, setError] = useState("");
  const today = dayKey(now); // so a new Date each render doesn't fetch again; a new day does
  const start = useMemo(() => addDays(weekStart(new Date(`${today}T00:00:00`)), offset * 7), [today, offset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);

  useEffect(() => {
    let current = true;
    setError("");
    api<CalendarWeek>(`/api/gcal/week?from=${encodeURIComponent(start.toISOString())}`)
      .then((w) => { if (current) setWeek(w); }, (e) => { if (current) { setWeek(null); setError(errorText(e)); } });
    return () => { current = false; };
  }, [start]);

  const byDay = useMemo(() => {
    const m = new Map<string, WeekEvent[]>(days.map((d) => [dayKey(d), []]));
    for (const e of week?.events ?? []) for (const k of daysOf(e, days)) m.get(k)?.push(e);
    for (const list of m.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
    return m;
  }, [week, days]);

  const last = days[6];
  const span = `${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${last.toLocaleDateString([], { month: start.getMonth() === last.getMonth() ? undefined : "short", day: "numeric" })}`;

  return (
    <section aria-label="Your week">
      <div className="home-week-head">
        <div className="section-label">{offset === 0 ? "This week" : offset === 1 ? "Next week" : offset === -1 ? "Last week" : "Week"} · {span}</div>
        <div className="home-week-nav">
          <button type="button" className="btn small" aria-label="The week before" onClick={() => setOffset((o) => o - 1)}>‹</button>
          {offset !== 0 && <button type="button" className="btn small" onClick={() => setOffset(0)}>This week</button>}
          <button type="button" className="btn small" aria-label="The week after" onClick={() => setOffset((o) => o + 1)}>›</button>
        </div>
      </div>
      {error ? <div className="meta bad" role="alert">{error}</div> : (
        <ol className="home-week">
          {days.map((d) => {
            const k = dayKey(d), list = byDay.get(k) ?? [];
            return (
              <li key={k} className={cx("home-week-day", k === today && "today", k < today && "past")} aria-current={k === today ? "date" : undefined}>
                <div className="home-week-date"><span>{d.toLocaleDateString([], { weekday: "short" })}</span><b>{d.getDate()}</b></div>
                {!week ? <span className="meta">…</span> : list.length === 0 ? <span className="meta home-week-free">Free</span> : (
                  <ul className="home-week-events">
                    {list.map((e) => {
                      const label = <>{!e.allDay && <span className="home-week-time">{time(e.start)}</span>}<span className="home-week-title">{e.title}</span></>;
                      const title = [e.title, e.allDay ? "All day" : `${time(e.start)}–${time(e.end)}`, e.location, e.answer === "needsAction" ? "Not answered yet" : e.answer === "tentative" ? "Maybe" : e.answer === "declined" ? "Declined" : ""].filter(Boolean).join(" · ");
                      return (
                        <li key={`${e.id}:${k}`} className={cx("home-week-event", e.allDay && "all-day", e.answer && `answer-${e.answer}`)} title={title}>
                          {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {week?.more && <div className="meta">There's more this week than fits here: open Google Calendar for the rest.</div>}
    </section>
  );
}
