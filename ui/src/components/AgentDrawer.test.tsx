// An agent's page, its chat box: one message at a time, like the main message box.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { AgentDrawer } from "./AgentDrawer.tsx";

const sends: any[] = [];
let landing: ((r: Response) => void)[] = []; // each /api/send waits here until the test lets it land
const SCOUT = { id: "scout", name: "Scout", emoji: "🔭", role: "Finds things out", model: "claude-sonnet-5", effort: "medium", xp: 10, overridden: false,
  stats: { runs: 0, successRate: null, cost: 0 }, sessions: [], runs: [] };
beforeEach(() => {
  sends.length = 0; landing = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/send") {
      sends.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((answer) => landing.push(answer));
    }
    return Promise.resolve(new Response(JSON.stringify(SCOUT)));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("a second Enter while a message is still on its way doesn't send it twice", async () => {
  render(<AgentDrawer agentId="scout" tab="chat" setTab={() => {}} S={null} store={createFeedStore()} pickerOpen={false} onOpenPicker={() => {}} onClose={() => {}} />);
  const box = await screen.findByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await screen.findByText("No conversations yet");
  const button = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  fireEvent.change(box, { target: { value: "What's new?" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(sends.length).toBe(1));
  expect(button.disabled).toBe(true);
  fireEvent.keyDown(box, { key: "Enter" });
  fireEvent.submit(box.form!);
  expect(sends).toEqual([{ text: "@scout What's new?", chat: true }]);
  await act(async () => { landing[0](new Response(JSON.stringify({ ok: true, id: "r1", position: 0, attached: 0, thread: "t1" }))); });
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(box.value).toBe("");
  expect(screen.getByText("What's new?").className).toBe("bubble you"); // said once
  // The next one goes as usual.
  fireEvent.change(box, { target: { value: "And then?" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(sends.length).toBe(2));
});

test("the memory tab links to that member's memory on the Memory page, and closes the drawer", async () => {
  const asked: unknown[] = [];
  const hear = (ev: Event) => asked.push((ev as CustomEvent).detail);
  window.addEventListener("camp:ask", hear);
  const onClose = vi.fn();
  render(<AgentDrawer agentId="scout" tab="memory" setTab={() => {}} S={null} store={createFeedStore()} pickerOpen={false} onOpenPicker={() => {}} onClose={onClose} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open in Memory" }));
  expect(asked).toEqual([{ do: "command", name: "memory", arg: "scout" }]);
  expect(onClose).toHaveBeenCalled();
  window.removeEventListener("camp:ask", hear);
});

// A table in a reply: drawn as a table while it's still coming in, and a row cut short isn't a line of pipes.
test("a reply with a table is drawn as a table while it comes in and after, with a cut-off row marked, never raw pipes", async () => {
  const table = "| # | Step | Status |\n|---|---|---|\n| 1 | Line up the trackers | RIGHT |\n| 4 | Trackin…";
  const scout = { ...SCOUT, sessions: [{ file: "s1.json", time: "2026-01-01T09:00:00.000Z", source: "direct", task: "Where are we?", result: table, status: "done" }] };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(scout)))));
  const store = createFeedStore();
  const { container } = render(<AgentDrawer agentId="scout" tab="chat" setTab={() => {}} S={null} store={store} pickerOpen={false} onOpenPicker={() => {}} onClose={() => {}} />);
  await screen.findByText("Where are we?");
  const saved = container.querySelector(".bubble.agent .md")!;
  expect(saved.querySelector(".md-table table")).toBeTruthy();
  expect(saved.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(saved.querySelector("tbody tr:last-child")!.classList.contains("md-row-cut")).toBe(true);
  expect(saved.textContent).not.toContain("|");

  // Now a reply streaming in: half a table so far.
  let seq = 0;
  const send = (body: object) => act(() => { store.apply({ ...body, seq: ++seq, time: new Date().toISOString() } as never); });
  send({ type: "text_delta", who: "Scout", emoji: "🔭", depth: 0, delta: "| Who | What |\n|---|---|\n| Scout | Readi" });
  const live = await waitFor(() => { const el = container.querySelector(".md.live"); expect(el).toBeTruthy(); return el!; });
  expect(live.querySelector("table")).toBeTruthy();
  expect(live.querySelector("tbody tr")!.classList.contains("md-row-cut")).toBe(true);
  expect(live.textContent).not.toContain("|");
  send({ type: "text_delta", who: "Scout", emoji: "🔭", depth: 0, delta: "ng the code |" });
  expect(container.querySelector(".md.live tbody tr")!.classList.contains("md-row-cut")).toBe(false);
  send({ type: "text", who: "Scout", emoji: "🔭", depth: 0, text: "| Who | What |\n|---|---|\n| Scout | Reading the code |" });
  expect(container.querySelector(".md.live")).toBeNull();
  expect([...container.querySelectorAll(".bubble.agent .md tbody td")].map((td) => td.textContent)).toContain("Reading the code");
});

// Opening a member's page while they're already working shows the run so far, then follows it.
test("opening the page partway through a run shows what they've done so far, and keeps following it", async () => {
  const store = createFeedStore();
  const ev = (e: object, seq: number) => store.apply({ time: "2026-01-01T09:00:00.000Z", seq, expeditionId: "x1", ...e } as any);
  ev({ type: "dispatch", who: "Scout", emoji: "🔭", questId: "q1", brief: "Look around" }, 1);
  ev({ type: "tool", who: "Scout", questId: "q1", tool: "web_search", input: "outposts" }, 2);
  ev({ type: "text_delta", who: "Scout", questId: "q1", delta: "Found three " }, 3);
  render(<AgentDrawer agentId="scout" tab="chat" setTab={() => {}} S={null} store={store} pickerOpen={false} onOpenPicker={() => {}} onClose={() => {}} />);
  await screen.findByText("web_search");
  expect(screen.getByText(/Found three/)).toBeTruthy();
  act(() => { ev({ type: "text_delta", who: "Scout", questId: "q1", delta: "camps." }, 4); });
  await screen.findByText(/Found three camps\./);
  // Once they're back the store forgets the run (it's in the saved conversation now).
  act(() => { ev({ type: "return", who: "Scout", emoji: "🔭", status: "done", questId: "q1" }, 5); });
  expect(store.runSoFar("Scout")).toEqual([]);
});

test("two quests by the same member at once both show, and one coming back leaves the other", async () => {
  const store = createFeedStore();
  let seq = 0;
  const ev = (e: object) => store.apply({ time: "2026-01-01T09:00:00.000Z", seq: ++seq, expeditionId: "x1", ...e } as any);
  ev({ type: "dispatch", who: "Scout", emoji: "🔭", questId: "q1" });
  ev({ type: "dispatch", who: "Scout", emoji: "🔭", questId: "q2" });
  ev({ type: "text", who: "Scout", questId: "q1", text: "First quest's word." });
  ev({ type: "text", who: "Scout", questId: "q2", text: "Second quest's word." });
  ev({ type: "return", who: "Scout", emoji: "🔭", status: "done", questId: "q1" });
  render(<AgentDrawer agentId="scout" tab="chat" setTab={() => {}} S={null} store={store} pickerOpen={false} onOpenPicker={() => {}} onClose={() => {}} />);
  await screen.findByText("Second quest's word.");
  expect(screen.queryByText("First quest's word.")).toBeNull();
});

test("a run you started by messaging them shows your message first", async () => {
  const store = createFeedStore();
  let seq = 0;
  const ev = (e: object) => store.apply({ time: "2026-01-01T09:00:00.000Z", seq: ++seq, ...e } as any);
  ev({ type: "expedition_start", id: "x2", task: "@scout What's new on the trail?", source: "direct" });
  ev({ type: "dispatch", who: "Scout", emoji: "🔭", questId: "q1", expeditionId: "x2" });
  ev({ type: "text_delta", who: "Scout", questId: "q1", expeditionId: "x2", delta: "Two new camps." });
  render(<AgentDrawer agentId="scout" tab="chat" setTab={() => {}} S={null} store={store} pickerOpen={false} onOpenPicker={() => {}} onClose={() => {}} />);
  const mine = await screen.findByText("What's new on the trail?");
  expect(mine.className).toBe("bubble you");
  expect(screen.queryByText(/sent them on/)).toBeNull(); // not dressed up as a brief from the lead
  expect(screen.getByText(/Two new camps\./)).toBeTruthy();
  // Its expedition ending forgets the run.
  ev({ type: "expedition_end", id: "x2", expeditionId: "x2", status: "done", text: "" });
  expect(store.runSoFar("Scout")).toEqual([]);
});
