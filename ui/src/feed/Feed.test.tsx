// The feed on screen: two expeditions side by side, each with its own Stop, and an approval.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampEvent } from "../types.ts";
import { Feed } from "./Feed.tsx";
import { createFeedStore } from "./store.ts";
import { player, reading } from "../readaloud.ts";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

let seq = 0;
function send(store: ReturnType<typeof createFeedStore>, ...bodies: object[]) {
  act(() => {
    for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent);
    vi.advanceTimersByTime(20); // the store tells React once per frame
  });
}
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };
const card = (task: string) => screen.getByRole("heading", { name: task }).closest("article")!;

function twoExpeditions(stopInBox?: string) {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} stopInBox={stopInBox} />);
  send(store,
    { type: "expedition_start", id: "exp-a", task: "Research memory", source: "user" },
    { type: "expedition_start", id: "exp-b", task: "Write the changelog", source: "user" },
    { type: "text_delta", ...qm, delta: "Working on A", expeditionId: "exp-a" },
    { type: "text", ...qm, text: "Plan for **B**", expeditionId: "exp-b" },
  );
  return store;
}

test("two running expeditions show as two cards, each with its own words", () => {
  twoExpeditions();
  expect(within(card("Research memory")).getByText("Working on A")).toBeTruthy();
  expect(within(card("Write the changelog")).getByText("B").tagName).toBe("STRONG"); // the finished reply is formatted
  expect(within(card("Research memory")).queryByText(/Plan for/)).toBeNull();
});

test("Stop posts that expedition's id, and only that card stops", async () => {
  const store = twoExpeditions();
  await act(async () => { fireEvent.click(within(card("Write the changelog")).getByRole("button", { name: "Stop" })); });
  expect(posts).toEqual([{ path: "/api/stop", body: { id: "exp-b" } }]);
  expect(within(card("Write the changelog")).getByRole("button", { name: "Stopping…" })).toHaveProperty("disabled", true);
  expect(within(card("Research memory")).getByRole("button", { name: "Stop" })).toHaveProperty("disabled", false);

  send(store, { type: "expedition_end", id: "exp-b", status: "stopped", text: "Stopped by you." });
  expect(within(card("Write the changelog")).queryByRole("button", { name: /Stop/ })).toBeNull();
  expect(within(card("Write the changelog")).getByText("stopped")).toBeTruthy();
  expect(within(card("Research memory")).getByRole("button", { name: "Stop" })).toBeTruthy(); // A is still running
});

test("the run whose Stop is the message box's button doesn't show its own; the one beside it still does", () => {
  twoExpeditions("exp-b");
  expect(within(card("Write the changelog")).queryByRole("button", { name: "Stop" })).toBeNull();
  expect(within(card("Research memory")).getByRole("button", { name: "Stop" })).toBeTruthy();
});

test("a plan card offers Approve (now or later) and changes, but no Stop of its own", () => {
  const store = twoExpeditions("exp-a");
  send(store, { type: "ask", id: "ask-p", kind: "plan", title: "📜 Plan", body: "1. Scout reads the code", expeditionId: "exp-a" });
  const a = within(card("Research memory"));
  expect(a.getByRole("button", { name: "Approve and start" })).toBeTruthy();
  expect(a.getByRole("button", { name: "Approve, start later" })).toBeTruthy();
  expect(a.getByRole("button", { name: "Request changes" })).toBeTruthy();
  expect(a.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a plan approved to start later waits on its card until you start it, once", async () => {
  const store = twoExpeditions("exp-a");
  send(store, { type: "ask", id: "ask-p", kind: "plan", title: "📜 Plan", body: "1. Scout reads the code\n2. Scribe writes it up", expeditionId: "exp-a" });
  const a = within(card("Research memory"));
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Approve, start later" })); });
  expect(posts).toEqual([{ path: "/api/answer", body: { id: "ask-p", answer: "later" } }]);

  send(store, { type: "answered", id: "ask-p", answer: "later" });
  expect(a.getByText("⏸ Plan approved, to start later")).toBeTruthy();
  expect(a.getByText(/Scribe writes it up/)).toBeTruthy(); // the plan stays readable while it waits
  expect(a.queryByRole("button", { name: "Approve and start" })).toBeNull();
  send(store, { type: "expedition_end", id: "exp-a", status: "done", text: "The plan is ready." });

  posts.length = 0;
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Start plan" })); });
  expect(posts).toEqual([{ path: "/api/send", body: { start: "ask-p" } }]);
  send(store, { type: "plan_started", ask: "ask-p", run: "exp-c" });
  expect(a.getByText("▶ Plan approved, and started")).toBeTruthy();
  expect(a.queryByRole("button", { name: /Start plan|Starting/ })).toBeNull();
});

test("a plan in a conversation that already has one waiting asks whether it updates that one or is new", async () => {
  const store = twoExpeditions("exp-a");
  send(store, { type: "ask", id: "ask-new", kind: "plan", title: "📜 Plan", body: "1. Scout reads the code", expeditionId: "exp-a", waiting: [{ ask: "ask-old", held: "2026-11-16T19:56:00Z" }] });
  const a = within(card("Research memory"));
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Approve, start later" })); });
  expect(posts).toEqual([]); // it asks first
  expect(a.getByText(/already has a plan waiting to start/)).toBeTruthy();
  fireEvent.click(a.getByRole("button", { name: "Back" }));
  expect(a.getByRole("button", { name: "Approve, start later" })).toBeTruthy();

  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Approve, start later" })); });
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Update the waiting plan" })); });
  expect(posts).toEqual([{ path: "/api/answer", body: { id: "ask-new", answer: "later+replace" } }]);
  send(store, { type: "answered", id: "ask-new", answer: "later+replace" });
  expect(a.getByText("⏸ Plan approved, to start later, in place of the one that was waiting")).toBeTruthy();
  expect(a.getByRole("button", { name: "Start plan" })).toBeTruthy(); // the new one waits on its card

  posts.length = 0;
  send(store, { type: "ask", id: "ask-3", kind: "plan", title: "📜 Plan", body: "1. Scribe writes", expeditionId: "exp-b", waiting: [{ ask: "ask-new", held: "2026-11-16T19:56:00Z" }] });
  const b = within(card("Write the changelog"));
  await act(async () => { fireEvent.click(b.getByRole("button", { name: "Approve and start" })); });
  await act(async () => { fireEvent.click(b.getByRole("button", { name: "Keep both" })); });
  expect(posts).toEqual([{ path: "/api/answer", body: { id: "ask-3", answer: "" } }]);
});

test("a held plan that's set aside stops offering Start plan", () => {
  const store = twoExpeditions("exp-a");
  send(store, { type: "ask", id: "ask-p", kind: "plan", title: "📜 Plan", body: "1. Scout reads the code", expeditionId: "exp-a" },
    { type: "answered", id: "ask-p", answer: "later" }, { type: "expedition_end", id: "exp-a", status: "done", text: "Ready." });
  const a = within(card("Research memory"));
  expect(a.getByRole("button", { name: "Start plan" })).toBeTruthy();
  send(store, { type: "plan_aside", ask: "ask-p", by: "ask-new" });
  expect(a.getByText("↺ Set aside: a newer plan took its place")).toBeTruthy();
  expect(a.queryByRole("button", { name: "Start plan" })).toBeNull();
});

test("an approval card answers with its id and closes when the camp confirms", async () => {
  const store = twoExpeditions();
  send(store, { type: "ask", id: "ask-1", kind: "shell", title: "🖥️ Run a shell command", body: "npm test", expeditionId: "exp-a" });
  const a = within(card("Research memory"));
  expect(a.getByText("npm test")).toBeTruthy();
  expect(a.getByRole("button", { name: "Always allow this command" })).toBeTruthy();
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Run command" })); });
  expect(posts).toEqual([{ path: "/api/answer", body: { id: "ask-1", answer: "y" } }]);

  send(store, { type: "answered", id: "ask-1", answer: "y" });
  expect(a.queryByRole("button", { name: "Run command" })).toBeNull();
  // Answered, it's behind-the-scenes work: folded into the condensed line until you open it.
  expect(a.getByText("1 approved")).toBeTruthy();
  fireEvent.click(a.getByRole("button", { name: /Approvals/ }));
  expect(a.getByText("✓ Command allowed")).toBeTruthy();
});

test("condensed (the default) folds tool calls into one line that opens to every call; detailed shows them all", () => {
  const calls = (store: ReturnType<typeof createFeedStore>) => send(store,
    { type: "expedition_start", id: "exp-c", task: "Dig in", source: "user" },
    { type: "tool", ...qm, tool: "read_file", input: '{"path":"a.ts"}', expeditionId: "exp-c" },
    { type: "tool", ...qm, tool: "read_file", input: '{"path":"b.ts"}', expeditionId: "exp-c" },
    { type: "tool", ...qm, tool: "grep", input: '{"pattern":"x"}', expeditionId: "exp-c" },
    { type: "tool", ...qm, tool: "bash", input: '{"command":"ls"}', expeditionId: "exp-c" },
  );
  const store = createFeedStore();
  const { unmount } = render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  calls(store);
  const head = screen.getByRole("button", { name: /Read 2 files, 1 search, ran 1 command/ });
  expect(head.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText('{"path":"a.ts"}')).toBeNull();
  // Still running: the line says what it's on now.
  expect(screen.getByText('bash {"command":"ls"}')).toBeTruthy();
  fireEvent.click(head);
  expect(screen.getByText('{"path":"a.ts"}')).toBeTruthy();
  unmount();

  const shown = createFeedStore();
  render(<Feed store={shown} onReply={() => {}} onExample={() => {}} detail="detailed" />);
  calls(shown);
  expect(screen.queryByRole("button", { name: /Read 2 files/ })).toBeNull();
  expect(screen.getByText('{"path":"b.ts"}')).toBeTruthy();
});

test("what you said to a run shows in it, and Resume and a worktree's Commit each post to the right place", async () => {
  const store = twoExpeditions();
  const a = within(card("Research memory"));
  // You talk to a working run from the message box, not from a box of its own.
  expect(a.queryByRole("textbox")).toBeNull();
  send(store, { type: "steer", id: "exp-a", text: "Focus on 2026 papers", expeditionId: "exp-a" });
  expect(a.getByText("Focus on 2026 papers")).toBeTruthy();

  const ws = { link: "site", path: "/repos/site-wt", branch: "camp/memory", created: true, changed: 2, commits: 0 };
  send(store, { type: "expedition_end", id: "exp-a", status: "out_of_turns", text: "partial", workspaces: [ws] });
  expect(a.getByText("camp/memory")).toBeTruthy();
  expect(a.getByText("2 uncommitted files")).toBeTruthy();

  posts.length = 0;
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Resume" })); });
  expect(posts).toEqual([{ path: "/api/send", body: { resume: "exp-a" } }]);

  posts.length = 0;
  // Commit asks for the message in the page's own dialog, starting from the request.
  fireEvent.click(a.getByRole("button", { name: "Commit…" }));
  const dialog = within(screen.getByRole("dialog", { name: "Commit to camp/memory" }));
  expect((dialog.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Research memory");
  fireEvent.change(dialog.getByLabelText("Message"), { target: { value: "Summarize memory papers" } });
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Commit" })); });
  expect(a.queryByRole("button", { name: "PR feedback…" })).toBeNull(); // feedback is brought in from the strip at the top, in one place
  expect(posts[0]).toEqual({ path: "/api/repo/commit", body: { link: "site", path: "/repos/site-wt", message: "Summarize memory papers" } });
  expect(within(card("Write the changelog")).queryByRole("button", { name: "Resume" })).toBeNull(); // still running
});

test("feedback: a thumb is saved at once, a note on Save, and it shows where the note was kept", async () => {
  vi.useRealTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    posts.push({ path, body });
    return new Response(JSON.stringify({ ok: true, rating: body.rating, note: body.note ?? "", kept: body.note && body.keep ? "the Quartermaster's memory" : null }), { status: 200 });
  }));
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const apply = (...bodies: object[]) => act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); });
  apply({ type: "expedition_start", id: "f1", task: "Plan the release", source: "user", expeditionId: "f1" });
  await vi.waitFor(() => expect(screen.getByRole("heading", { name: "Plan the release" })).toBeTruthy());
  expect(screen.queryByRole("group", { name: "How was this?" })).toBeNull(); // not while it's running
  apply({ type: "expedition_end", id: "f1", status: "done", text: "Planned.", expeditionId: "f1" });
  await vi.waitFor(() => expect(screen.getByRole("group", { name: "How was this?" })).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Not what I wanted" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/feedback", body: { id: "f1", rating: "down", note: "" } }));
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Not what I wanted" }).getAttribute("aria-pressed")).toBe("true"));
  const note = screen.getByRole("textbox", { name: "Feedback note" });
  expect(note.getAttribute("placeholder")).toMatch(/do differently next time/);
  fireEvent.change(note, { target: { value: "Too many quests. Batch the small ones." } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await vi.waitFor(() => expect(screen.getByText("Kept in the Quartermaster's memory")).toBeTruthy());
  expect(posts.at(-1)!.body).toEqual({ id: "f1", rating: "down", note: "Too many quests. Batch the small ones.", keep: true });
  expect(screen.queryByRole("textbox", { name: "Feedback note" })).toBeNull();
});

test("feedback given earlier comes back with the feed, and jobs aren't rated", async () => {
  vi.useRealTimers();
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  act(() => {
    for (const b of [
      { type: "expedition_start", id: "g1", task: "Summarize the wiki", source: "user", expeditionId: "g1" },
      { type: "expedition_end", id: "g1", status: "done", text: "ok", expeditionId: "g1" },
      { type: "feedback", id: "g1", rating: "up", note: "Right length.", kept: "the Quartermaster's memory", expeditionId: "g1" },
      { type: "expedition_start", id: "j1", task: "Nightly check", source: "job", job: "nightly", expeditionId: "j1" },
      { type: "expedition_end", id: "j1", status: "done", text: "ok", expeditionId: "j1" },
    ]) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent);
  });
  await vi.waitFor(() => expect(screen.getByRole("group", { name: "Your feedback" })).toBeTruthy());
  const rated = card("Summarize the wiki");
  expect(within(rated).getByRole("button", { name: "Good answer" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(rated).getByText("“Right length.”")).toBeTruthy();
  expect(within(card("Nightly check")).queryByRole("button", { name: "Good answer" })).toBeNull();
});

test("a run reads as an exchange: your message, formatted, then the answer; no card header", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store, { type: "expedition_start", id: "exp-m", task: "Swap the buttons in `mp-544`: it should be **Open** then Export\n- keep the icons", source: "user" });
  const ask = screen.getByRole("heading", { level: 3 });
  // What you typed is shown the way the message box showed it, not with its markers.
  expect(ask.className).toBe("ask-bubble");
  expect(within(ask).getByText("mp-544").tagName).toBe("CODE");
  expect(within(ask).getByText("Open").tagName).toBe("STRONG");
  expect(within(ask).getByRole("listitem").textContent).toBe("keep the icons");
  const run = ask.closest("article")!;
  expect(run.querySelector(".exp-head")).toBeNull();
  expect(within(run).queryByText("Expedition")).toBeNull();
  expect(within(run).queryByText(/Follow-up/)).toBeNull();
  expect(run.querySelector(".exp-ask time")).toBeTruthy();
  // Your message first, the answer after it, and while it runs, Stop under the answer. Until something comes back, the answer says it's on its way.
  expect([...run.children].map((c) => c.className)).toEqual(["exp-ask", "exp-reply", "run-stop"]);
  expect(within(run).getByRole("status").textContent).toBe("Reading your message…");
  // Stop floats under the answer: an icon, not a row inside it.
  const stop = within(run).getByRole("button", { name: "Stop" });
  expect(stop.closest(".run-stop")).toBeTruthy();
  expect(stop.closest(".exp-reply")).toBeNull();
  expect(stop.textContent).toBe("");
  send(store, { type: "text", ...qm, text: "On it.", expeditionId: "exp-m" });
  expect(within(run).queryByRole("status")).toBeNull();
  expect(within(run.querySelector(".exp-reply") as HTMLElement).getByText("On it.")).toBeTruthy();
});

test("under the message: a reply says it follows on, and a scheduled job says it wasn't typed just now", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store,
    { type: "expedition_start", id: "exp-1", task: "First question", source: "user" },
    { type: "expedition_end", id: "exp-1", status: "done", text: "Answered." },
    { type: "expedition_start", id: "exp-2", task: "And another thing", source: "user", replyTo: "exp-1" },
    { type: "expedition_start", id: "exp-3", task: "Summarise the wiki", source: "job", job: "wiki-digest" },
  );
  expect(card("First question").querySelector(".ask-meta")!.textContent).not.toMatch(/Follow-up|job/);
  expect(within(card("And another thing")).getByText("Follow-up").title).toBe("Carries the earlier conversation");
  const job = card("Summarise the wiki");
  expect(within(job).getByText("Scheduled job · wiki-digest")).toBeTruthy();
  // A job has nobody to talk to: it can be stopped, and that's all.
  expect(within(job).getByText("A scheduled job is running.")).toBeTruthy();
  expect(within(job).getByRole("button", { name: "Stop" })).toBeTruthy();
  expect(within(job).getByRole("status").textContent).toBe("Starting…");
});

test("a very long message is folded until you ask for all of it", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const brief = "Pick up APP-12\n" + Array.from({ length: 20 }, (_, i) => `- criterion ${i + 1}`).join("\n");
  send(store, { type: "expedition_start", id: "exp-long", task: brief, source: "user" }, { type: "expedition_start", id: "exp-short", task: "Short one", source: "user" });
  const ask = card("Short one").parentElement!.querySelector<HTMLElement>('[data-id="exp-long"] .ask-bubble')!;
  expect(ask.className).toBe("ask-bubble folded");
  const more = within(ask.closest("article")!).getByRole("button", { name: "Show all of it" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(ask.className).toBe("ask-bubble");
  expect(within(ask.closest("article")!).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  expect(within(card("Short one")).queryByRole("button", { name: /Show/ })).toBeNull();
});

test("each quest's own block says what it's for, so two by the same crew member can be told apart", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const smith = { who: "Artificer", emoji: "🔨", depth: 1 };
  send(store, { type: "expedition_start", id: "exp-p", task: "Share a whole thread", source: "user" },
    { type: "dispatch", ...smith, questId: "q1", expeditionId: "exp-p", brief: "Backend: thread links" },
    { type: "dispatch", ...smith, questId: "q2", expeditionId: "exp-p", brief: "Studio UI: Share in the menu" });
  const blocks = [...document.querySelectorAll(".quest")];
  expect(blocks.map((b) => b.querySelector(".quest-brief")?.textContent)).toEqual(["Backend: thread links", "Studio UI: Share in the menu"]);
  expect(blocks.every((b) => /^quest-q\d+$/.test(b.id))).toBe(true); // the crew bar's rows lead here
  expect(document.querySelector(".whos-out")).toBeNull();            // nothing floats over the answer
});

test("a file the crew wrote shows as a card in place of its tool line, and opens in the viewer", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const scribe = { who: "Scribe", emoji: "✒️", depth: 0 };
  const path = "camp/agents/scribe/outputs/release-notes.md";
  send(store,
    { type: "expedition_start", id: "exp-f", task: "@scribe write the release notes", source: "direct" },
    { type: "tool", ...scribe, tool: "write_file", input: JSON.stringify({ path, content: "# Notes" }), expeditionId: "exp-f" },
    { type: "file", ...scribe, path, change: "created", bytes: 2300, expeditionId: "exp-f" },
  );
  const art = screen.getByRole("button", { name: "Open release-notes.md, created by Scribe" });
  expect(art.textContent).toContain("release-notes.md");
  expect(art.querySelector(".art-meta")?.textContent).toBe("Created · Markdown · 2 KB · camp/agents/scribe/outputs");
  expect(art.className).toContain("fk-doc");
  expect(screen.queryByText("write_file")).toBeNull(); // the card stands in for the call

  const heard: unknown[] = [];
  const on = (ev: Event) => heard.push((ev as CustomEvent).detail);
  window.addEventListener("camp:ask", on);
  fireEvent.click(art);
  window.removeEventListener("camp:ask", on);
  expect(heard).toEqual([{ do: "open-file", path }]);
});

test("the approved plan is a live list: each step's state and who has it, and a step takes you to its quest", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const smith = { who: "Artificer", emoji: "🔨", depth: 1 };
  send(store, { type: "expedition_start", id: "exp-pl", task: "Share a whole thread", source: "user" },
    { type: "ask", id: "pl-1", kind: "plan", title: "🗺️  The Quartermaster's plan:", body: "1. Backend\n2. Studio UI\n3. I read the diffs", expeditionId: "exp-pl" });
  expect(screen.queryByRole("group", { name: "The plan, step by step" })).toBeNull(); // not until it's approved
  send(store, { type: "answered", id: "pl-1", answer: "" },
    { type: "plan", steps: [{ n: 1, text: "Backend" }, { n: 2, text: "Studio UI" }, { n: 3, text: "I read the diffs" }], expeditionId: "exp-pl" },
    { type: "dispatch", ...smith, questId: "q1", expeditionId: "exp-pl", brief: "Backend", step: 1 },
    { type: "dispatch", ...smith, questId: "q2", expeditionId: "exp-pl", brief: "Studio UI", step: 2 },
    { type: "return", ...smith, status: "done", questId: "q1", expeditionId: "exp-pl" });
  const list = screen.getByRole("group", { name: "The plan, step by step" });
  expect([...list.querySelectorAll(".plan-head > b, .plan-head > b + span")].map((x) => x.textContent)).toEqual(["Plan", "1 of 3 done · 1 out"]);
  const rows = within(list).getAllByRole("listitem").map((li) => [...li.firstElementChild!.children].map((c) => c.textContent).join(" | "));
  expect(rows).toEqual(["✓ | 1 | Backend | 🔨 Artificer | Done", "● | 2 | Studio UI | 🔨 Artificer | Out", "○ | 3 | I read the diffs | Not started"]);
  // The plan's own card keeps its wording a click away, not twice on the page.
  const card = document.getElementById("ask-pl-1")!;
  expect(card.querySelector("details.ask-written summary")!.textContent).toBe("The plan as it was written");
  expect(card.querySelector(":scope > .ask-body")).toBeNull();
  // Each quest's block says which step it is, and a step with a quest leads there.
  expect([...document.querySelectorAll(".quest-step")].map((x) => x.textContent)).toEqual(["Step 1", "Step 2"]);
  const seen = vi.fn();
  (document.querySelectorAll(".quest")[1] as HTMLElement).scrollIntoView = seen;
  const steps = within(within(list).getByRole("list"));
  fireEvent.click(steps.getAllByRole("button")[1]);
  expect(seen).toHaveBeenCalled();
  expect(steps.getAllByRole("button").length).toBe(2); // the Quartermaster's own step has nowhere to go
});

// A plan with steps that wait for others, part-way through: 1 done, 2 out, and a quest sent on no step.
function planOnTheTrail(id = "exp-tr") {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const smith = { who: "Artificer", emoji: "🔨", depth: 1 }, scout = { who: "Scout", emoji: "🔭", depth: 1 };
  send(store, { type: "expedition_start", id, task: "Share a whole thread", source: "user" },
    { type: "plan", steps: [{ n: 1, text: "Read the code" }, { n: 2, text: "Backend", after: [1] }, { n: 3, text: "Page", after: [1] }, { n: 4, text: "I read the diffs", after: [2, 3] }], expeditionId: id },
    { type: "dispatch", ...scout, questId: "q1", expeditionId: id, brief: "Read the code", step: 1 },
    { type: "return", ...scout, status: "done", questId: "q1", expeditionId: id },
    { type: "dispatch", ...smith, questId: "q2", expeditionId: id, brief: "Backend", step: 2 },
    { type: "dispatch", ...scout, questId: "q3", expeditionId: id, brief: "Check the kiosk browsers" });
  const card = screen.getByRole("group", { name: "The plan, step by step" });
  const [asList, asTrail] = within(within(card).getByRole("group", { name: "How the plan is shown" })).getAllByRole("button");
  return { card, asList, asTrail };
}

test("the plan's card shows its steps as a list or as a trail: waypoints, what waits for what, who's out, and the quests off the trail", () => {
  const { card, asList, asTrail } = planOnTheTrail();
  expect([asList.textContent, asList.getAttribute("aria-pressed"), asTrail.textContent, asTrail.getAttribute("aria-pressed")]).toEqual(["List", "true", "Trail", "false"]);
  expect(within(within(card).getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
  expect(within(card).queryByRole("group", { name: "The plan as a trail" })).toBeNull();

  fireEvent.click(asTrail);
  expect([asList.getAttribute("aria-pressed"), asTrail.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
  expect([...card.querySelectorAll(".plan-head > b, .plan-head > b + span")].map((x) => x.textContent)).toEqual(["Plan", "1 of 4 done · 1 out"]); // the count stays over either
  const trail = within(card).getByRole("group", { name: "The plan as a trail" });
  expect(trail.tabIndex).toBe(0); // a trail wider than the card is scrolled from the keyboard too
  expect(within(trail).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
    "Step 1, done: Read the code.", "Step 2, out: Backend. Waits for step 1.", "Step 3, not started: Page. Waits for step 1.", "Step 4, not started: I read the diffs. Waits for steps 2 and 3.",
  ]);
  expect(within(trail).getAllByRole("listitem").map((li) => `${li.dataset.n}@${li.dataset.col} ${li.dataset.state}`)).toEqual(["1@1 done", "2@2 out", "3@2 todo", "4@3 todo"]);
  const lines = [...trail.querySelectorAll<SVGElement>("[data-line]")];
  expect(lines.map((g) => g.dataset.line).sort()).toEqual(["1-2", "1-3", "2-4", "3-4"]);
  expect(lines.filter((g) => g.classList.contains("walked")).map((g) => g.dataset.line).sort()).toEqual(["1-2", "1-3"]);
  expect(lines.filter((g) => g.classList.contains("live")).map((g) => g.dataset.line)).toEqual(["1-2"]);
  expect(within(trail).getByText("Nobody sent yet", { selector: '[data-n="3"] *' })).toBeTruthy();

  // Whoever is on a step takes you to their quest, further down the conversation.
  const quests = [...document.querySelectorAll<HTMLElement>(".quest")];
  const seen = quests.map((q) => (q.scrollIntoView = vi.fn()));
  fireEvent.click(within(trail).getByRole("button", { name: /^Artificer, out now: go to this/ }));
  expect(seen.map((f) => f.mock.calls.length)).toEqual([0, 1, 0]);
  // The quest sent without a step is listed under the trail, on no waypoint, and goes to its quest too.
  const loose = within(card).getByRole("group", { name: /sent without a step$/ });
  expect(loose.textContent).toMatch(/^Off the trail \(sent without a step\)/);
  fireEvent.click(within(loose).getByRole("button", { name: /^Scout, out now: go to this/ }));
  expect(seen.map((f) => f.mock.calls.length)).toEqual([0, 1, 1]);

  fireEvent.click(asList);
  expect(within(card).queryByRole("group", { name: "The plan as a trail" })).toBeNull();
  expect(within(within(card).getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
});

test("list or trail is remembered, and Full screen on the card opens the trail map on that card's plan", () => {
  const first = planOnTheTrail();
  fireEvent.click(first.asTrail);
  expect(localStorage.getItem("camp-plan-view")).toBe("trail");
  cleanup();
  const { card, asList, asTrail } = planOnTheTrail("exp-again");
  expect(asTrail.getAttribute("aria-pressed")).toBe("true");
  expect(within(card).getByRole("group", { name: "The plan as a trail" })).toBeTruthy();

  const heard: unknown[] = [];
  const on = (ev: Event) => heard.push((ev as CustomEvent).detail);
  window.addEventListener("camp:ask", on);
  const full = within(card).getByRole("button", { name: "Open the trail map, full screen" });
  expect(full.textContent).toBe("Full screen");
  fireEvent.click(full);
  fireEvent.click(asList);
  fireEvent.click(full); // from the list too
  window.removeEventListener("camp:ask", on);
  expect(heard).toEqual([{ do: "command", name: "trail", arg: "exp-again" }, { do: "command", name: "trail", arg: "exp-again" }]);
  expect(localStorage.getItem("camp-plan-view")).toBe("list");
});

test("a blank page outside a project offers a plain chat, and says how to bring the crew in", () => {
  const onExample = vi.fn();
  const { rerender } = render(<Feed store={createFeedStore()} onReply={() => {}} onExample={onExample} view={{ kind: "new" }} plain
    waiting="Outside a project this is a plain chat: what you ask goes straight to the model named beside the message box." />);
  expect(screen.getByRole("heading", { name: "Ask anything" })).toBeTruthy();
  expect(screen.getByText(/Outside a project this is a plain chat/)).toBeTruthy();
  const examples = screen.getAllByRole("button").map((b) => b.textContent!);
  expect(examples[0]).toMatch(/^Explain the difference between a rebase and a merge/);
  expect(examples.filter((e) => e.startsWith("@")).length).toBe(2); // the crew is an @ away
  fireEvent.click(screen.getAllByRole("button")[0]);
  expect(onExample).toHaveBeenCalledWith(examples[0]);
  // In a project the page is the Quartermaster's, as before.
  rerender(<Feed store={createFeedStore()} onReply={() => {}} onExample={onExample} view={{ kind: "new" }} />);
  expect(screen.getByRole("heading", { name: "A new conversation" })).toBeTruthy();
  expect(screen.getAllByRole("button")[0].textContent).toMatch(/^Have the Scout look into how other agent harnesses/);
});

test("Note under a finished answer asks for the answer itself to be kept in a note", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store,
    { type: "expedition_start", id: "n1", task: "How do I rebase?", source: "user" },
    { type: "tool", ...qm, tool: "read_file", input: "docs/git.md", expeditionId: "n1" },
    { type: "text", ...qm, text: "Looking it up.", expeditionId: "n1" },
    { type: "text", ...qm, text: "Run `git rebase main`, then force-push.", expeditionId: "n1" },
  );
  expect(within(card("How do I rebase?")).queryByRole("button", { name: "Note" })).toBeNull(); // not while it's still being written
  send(store, { type: "expedition_end", id: "n1", status: "done", text: "done" });
  const heard: unknown[] = [];
  const on = (ev: Event) => heard.push((ev as CustomEvent).detail);
  window.addEventListener("camp:ask", on);
  fireEvent.click(within(card("How do I rebase?")).getByRole("button", { name: "Note" }));
  window.removeEventListener("camp:ask", on);
  expect(heard).toEqual([{ do: "note", text: "Run `git rebase main`, then force-push." }]);
});

test("Read aloud under a finished answer reads the answer, said without its Markdown", async () => {
  const asked: string[] = [];
  vi.stubGlobal("Audio", class { src = ""; playbackRate = 1; onended = null; onerror = null; play() { return Promise.resolve(); } pause() {} removeAttribute() {} });
  URL.createObjectURL = vi.fn(() => "blob:speech");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => { asked.push(JSON.parse(String(init?.body)).text); return new Response(new Blob(["mp3"])); }));
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store,
    { type: "expedition_start", id: "r1", task: "How do I rebase?", source: "user" },
    { type: "text", ...qm, text: "Run `git rebase main`, then **force-push**.", expeditionId: "r1" },
  );
  expect(within(card("How do I rebase?")).queryByRole("button", { name: "Read aloud" })).toBeNull(); // not while it's still being written
  send(store, { type: "expedition_end", id: "r1", status: "done", text: "done" });
  fireEvent.click(within(card("How do I rebase?")).getByRole("button", { name: "Read aloud" }));
  expect(asked).toEqual(["Run git rebase main, then force-push."]);
  expect(reading().what).toBe("Quartermaster's answer");
  expect(within(card("How do I rebase?")).getByRole("button", { name: "Stop reading" })).toBeTruthy();
  player.stop();
  vi.unstubAllGlobals();
});

// A conversation written on the starship, opened after a switch to the Guild: what the camp wrote
// (a notice, an approval's title) reads in the Guild's words. The page draws the feed again on a
// switch (App keys it by pack), which a fresh render stands in for here.
test("a notice and an approval written under one pack read in the pack that's on now", async () => {
  const { PACKS } = await import("../../../src/packs.ts");
  const { setCrewColors } = await import("../format.ts");
  const { setWords } = await import("../words.ts");
  const crewOf = (id: string) => Object.entries(PACKS.find((p) => p.id === id)!.crew).map(([cid, c]) => ({ id: cid, name: c.name, emoji: c.emoji, role: "" }));
  const store = createFeedStore();
  const draw = (pack: string) => {
    setCrewColors(crewOf(pack), PACKS);
    setWords(pack, PACKS);
    cleanup();
    render(<Feed key={pack} store={store} onReply={() => {}} onExample={() => {}} />);
  };
  try {
    draw("starship");
    send(store,
      { type: "expedition_start", id: "exp-s", task: "Check the release", source: "user" },
      { type: "notice", text: "The {camp} was restarted while this {quest} was running.", expeditionId: "exp-s" },
      { type: "text", who: "Commander", emoji: "🚀", depth: 0, text: "Reading the notes.", expeditionId: "exp-s" },
      { type: "ask", id: "ask-q", kind: "question", title: "❓ The Commander asks: which branch?", body: "main or next?", expeditionId: "exp-s" },
      { type: "answered", id: "ask-q", answer: "n", lapsed: true, expeditionId: "exp-s" },
    );
    const avatars = () => [...document.querySelectorAll(".avatar")].map((a) => a.textContent);
    expect(screen.getByText("The ship was restarted while this mission was running.")).toBeTruthy();
    expect(screen.getByText("The Commander asks: which branch?")).toBeTruthy();
    expect(screen.getByText("Not answered (the ship was restarted)")).toBeTruthy();
    expect(avatars()).toContain("🚀");
    draw("guild");
    expect(screen.getByText("The camp was restarted while this quest was running.")).toBeTruthy();
    expect(screen.getByText("The Quartermaster asks: which branch?")).toBeTruthy();
    expect(screen.getByText("Not answered (the camp was restarted)")).toBeTruthy();
    expect(screen.getByText("Quartermaster")).toBeTruthy();
    expect(avatars()).toContain("🧭");
    expect(avatars()).not.toContain("🚀");
    expect(screen.queryByText(/\bship\b|Commander/)).toBeNull();
    // What you were asked is shown as it was written.
    expect(screen.getByText("main or next?")).toBeTruthy();
  } finally { setWords(undefined); setCrewColors([]); }
});
