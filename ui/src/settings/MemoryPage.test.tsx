// Settings → Memory: what's waiting for you, the note about you, and each memory line by line.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState, MemoryPlace, Proposal } from "../types.ts";
import { MemoryPage } from "./MemoryPage.tsx";

const posts: { path: string; body: any }[] = [];
let answer: (path: string) => Response = () => new Response(JSON.stringify({ ok: true }));
const asked: object[] = [];
const hear = (ev: Event) => asked.push((ev as CustomEvent).detail);
beforeEach(() => {
  posts.length = 0; asked.length = 0; answer = () => new Response(JSON.stringify({ ok: true }));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => { posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) }); return answer(path); }));
  window.addEventListener("camp:ask", hear);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.removeEventListener("camp:ask", hear); });

const about: MemoryPlace = { where: "about", name: "About you", kind: "about", size: 40, limit: 2500, unloaded: 0, other: 1, raw: "Call it Mira.\n- 2026-03-01 Eastern time", lines: [{ text: "Eastern time", date: "2026-03-01", loaded: true }] };
const scribe: MemoryPlace = { where: "agent:scribe", name: "Scribe's memory", emoji: "✒️", kind: "agent", size: 5600, limit: 5000, unloaded: 2, other: 0, lines: [
  { text: "Use British spelling", date: "2026-01-02", loaded: false },
  { text: "Use British spelling in docs", date: "2026-01-05", loaded: false },
  { text: "Headings in sentence case", date: "2026-01-09", loaded: true, origin: { how: "remember", run: "r1", thread: "t1", title: "Write the release notes" } },
  { text: "No emoji in headings", date: "2026-02-03", loaded: true, pinned: true, origin: { how: "feedback" } },
] };
const scout: MemoryPlace = { where: "agent:scout", name: "Scout's memory", emoji: "🏹", kind: "agent", size: 0, limit: 5000, unloaded: 0, other: 0, lines: [] };
const tidy: Proposal = { id: "p1", kind: "tidy", where: "agent:scribe", name: "Scribe's memory", created: "2026-03-02T10:00:00Z", before: "- a\n- b\n- c\n- d", after: "- 2026-01-05 Use British spelling\n- 2026-01-09 Headings in sentence case" };
const keep: Proposal = { id: "p2", kind: "keep", where: "about", name: "About you", created: "2026-03-02T11:00:00Z", text: "Wants a test with every change", run: "r9", thread: "t9", title: "Add the share button" };
const state = (memoryProposals: Proposal[] = [], care = { tidy: true, suggest: false }) => ({ memory: [about, scribe, scout], memoryProposals, settings: { memoryCare: care } }) as unknown as CampState;

test("each memory: how full it is, what no longer fits, where a line came from, and forgetting one", async () => {
  const refresh = vi.fn();
  render(<MemoryPage S={state()} refresh={refresh} />);
  expect(screen.queryByRole("region", { name: "Waiting for you" })).toBeNull();
  const place = within(screen.getByRole("region", { name: "Scribe's memory" }));
  expect(place.getByText("5,600 of 5,000 characters")).toBeTruthy();
  expect(place.getByRole("status").textContent).toMatch(/^This no longer all fits in a prompt\. 2 older lines are loaded only when a request is about them \(recall can still find them\)\. Pin a line to load it every time/);
  // Newest first; a line that isn't loaded says so.
  const rows = place.getAllByRole("listitem").map((li) => li.textContent);
  expect(rows[0]).toContain("No emoji in headings");
  expect(rows[0]).toContain("your feedback");
  expect(rows[0]).toContain("pinned");
  expect(place.getByRole("button", { name: "Unpin: No emoji in headings" }).getAttribute("aria-pressed")).toBe("true");
  expect(rows[3]).toMatch(/Use British spelling2026-01-02only when relevant/);
  // Pinning a line keeps it in every prompt; a pinned one says so and can be unpinned.
  fireEvent.click(place.getByRole("button", { name: "Pin: Use British spelling" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(posts.at(-1)).toEqual({ path: "/api/memory/pin", body: { where: "agent:scribe", line: "Use British spelling", on: true } });
  await waitFor(() => expect((place.getByRole("button", { name: "Forget: Use British spelling in docs" }) as HTMLButtonElement).disabled).toBe(false));
  // Where it came from is a way back to that conversation.
  fireEvent.click(place.getByRole("button", { name: "Write the release notes" }));
  expect(asked).toEqual([{ do: "open-conversation", id: "t1" }]);
  fireEvent.click(place.getByRole("button", { name: "Forget: Use British spelling in docs" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts.at(-1)).toEqual({ path: "/api/memory/forget", body: { where: "agent:scribe", line: "Use British spelling in docs" } });
  // Asking for a tidy; what the camp says when there's nothing to propose is shown.
  answer = () => new Response(JSON.stringify({ error: "It came back no shorter, so there's nothing to propose. It may already be tidy." }), { status: 400 });
  fireEvent.click(place.getByRole("button", { name: "Tidy…" }));
  expect((await place.findByRole("alert")).textContent).toMatch(/no shorter/);
  expect(posts.at(-1)).toEqual({ path: "/api/memory/tidy", body: { where: "agent:scribe" } });
  // An empty memory has nothing to tidy.
  expect(within(screen.getByRole("region", { name: "Scout's memory" })).queryByRole("button", { name: "Tidy…" })).toBeNull();
  expect(within(screen.getByRole("region", { name: "Scout's memory" })).getByText("Nothing remembered yet.")).toBeTruthy();
});

test("about you is yours to write, whole; and the two switches say what each costs", async () => {
  const refresh = vi.fn();
  render(<MemoryPage S={state()} refresh={refresh} />);
  const box = screen.getByLabelText("About you", { selector: "textarea" }) as HTMLTextAreaElement;
  expect(box.value).toBe("Call it Mira.\n- 2026-03-01 Eastern time"); // as written, the free-form line too
  const save = within(screen.getByRole("region", { name: "About you" })).getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(box, { target: { value: box.value + "\n- Lead with the answer" } });
  fireEvent.click(save);
  expect((await screen.findByText("Saved. The crew starts with it from their next run.")).getAttribute("role")).toBe("status");
  expect(posts.at(-1)).toEqual({ path: "/api/memory/about", body: { text: "Call it Mira.\n- 2026-03-01 Eastern time\n- Lead with the answer" } });

  expect((screen.getByRole("checkbox", { name: /Offer a tidy when a memory is nearly full/ }) as HTMLInputElement).checked).toBe(true);
  const suggest = screen.getByRole("checkbox", { name: /After each run, suggest what's worth keeping/ }) as HTMLInputElement;
  expect(suggest.checked).toBe(false);
  expect(screen.getByText(/one small call per run, so it uses a little of your plan each time/)).toBeTruthy();
  fireEvent.click(suggest);
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/memory/care", body: { suggest: true } }));
});

test("what's waiting: a tidy you can read, edit and approve; a suggestion you can reword, keep or drop", async () => {
  const refresh = vi.fn();
  render(<MemoryPage S={state([tidy, keep])} refresh={refresh} />);
  const waiting = within(screen.getByRole("region", { name: "Waiting for you" }));
  expect(waiting.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["A tidy of Scribe's memory", "Suggested for About you"]);
  const t = within(waiting.getByRole("listitem", { name: "A tidy of Scribe's memory" }));
  expect(t.getByText(/^4 lines to 2 · 15 characters to 7\d$/)).toBeTruthy();
  expect(t.queryByText("- a", { exact: false, selector: "pre" })).toBeNull();
  fireEvent.click(t.getByRole("button", { name: "Show what's there now" }));
  expect(t.getByText(/- a\s+- b/, { selector: "pre" })).toBeTruthy();
  fireEvent.change(t.getByLabelText("The tidied Scribe's memory"), { target: { value: "- 2026-01-09 Headings in sentence case" } });
  fireEvent.click(t.getByRole("button", { name: "Replace it with this" }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/memory/proposal", body: { id: "p1", action: "approve", text: "- 2026-01-09 Headings in sentence case" } }));
  // While one is waiting for a memory, another can't be asked for.
  expect((within(screen.getByRole("region", { name: "Scribe's memory" })).getByRole("button", { name: "Tidy…" }) as HTMLButtonElement).disabled).toBe(true);

  const s = within(waiting.getByRole("listitem", { name: "Suggested for About you" }));
  fireEvent.click(s.getByRole("button", { name: "Add the share button" }));
  expect(asked.at(-1)).toEqual({ do: "open-conversation", id: "t9" });
  fireEvent.change(s.getByLabelText("What to keep"), { target: { value: "Every change comes with a test" } });
  fireEvent.click(s.getByRole("button", { name: "Keep it" }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/memory/proposal", body: { id: "p2", action: "approve", text: "Every change comes with a test" } }));
  fireEvent.click(s.getByRole("button", { name: "Don't keep" }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/memory/proposal", body: { id: "p2", action: "dismiss" } }));
  // A proposal the camp can no longer apply says why.
  answer = () => new Response(JSON.stringify({ error: "Scribe's memory has changed since this was drafted, so it wasn't applied. Ask for a new tidy." }), { status: 400 });
  fireEvent.click(t.getByRole("button", { name: "Replace it with this" }));
  expect((await t.findByRole("alert")).textContent).toMatch(/has changed since this was drafted/);
});
