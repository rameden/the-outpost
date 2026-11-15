// The Notes panel: your notes as a list, one being written, and what a note can be sent to.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notesNow, resetNotes, flushNotes } from "../notes.ts";
import { ConfirmHost } from "./Confirm.tsx";
import { NotesPanel, NotesRail, PickToNote } from "./Notes.tsx";

const NOTES = [
  { id: "aaaaaa111111", title: "Release steps", text: "1. Tag\n2. Deploy", created: "2026-11-10T09:00:00.000Z", updated: "2026-11-12T09:00:00.000Z" },
  { id: "bbbbbb222222", title: "", text: "Ask about the flaky test\nIt fails on Windows only.", created: "2026-11-09T09:00:00.000Z", updated: "2026-11-11T09:00:00.000Z", from: { conversation: "c7", title: "CI trouble" } },
];
let sent: any[] = [];
beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ok: true })); }
    return new Response(JSON.stringify({ notes: NOTES }));
  }));
});
afterEach(() => { cleanup(); resetNotes(); vi.unstubAllGlobals(); localStorage.clear(); });

test("your notes are listed, newest change first, by title or first line; words narrow them", async () => {
  render(<NotesPanel onHide={() => {}} />);
  expect(await screen.findByRole("button", { name: /Release steps/ })).toBeTruthy();
  expect(screen.getAllByRole("listitem").map((li) => li.querySelector("b")!.textContent)).toEqual(["Release steps", "Ask about the flaky test"]);
  expect(screen.getByText(/from CI trouble/)).toBeTruthy();
  expect(screen.getByText("It fails on Windows only.")).toBeTruthy(); // the first line is its name, so the excerpt starts after it
  fireEvent.change(screen.getByLabelText("Narrow your notes"), { target: { value: "windows flaky" } });
  expect(screen.getAllByRole("listitem").length).toBe(1);
  fireEvent.change(screen.getByLabelText("Narrow your notes"), { target: { value: "zzz" } });
  fireEvent.click(screen.getByRole("button", { name: "Show them all" }));
  expect(screen.getAllByRole("listitem").length).toBe(2);
});

test("with none yet, the panel says what notes are for; closed, it's a tab", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ notes: [] }))));
  const onShow = vi.fn();
  render(<><NotesPanel onHide={() => {}} /><NotesRail onShow={onShow} /></>);
  expect(await screen.findByText("Nothing noted yet.")).toBeTruthy();
  expect(screen.getByText(/The crew sees one only when you put it in a message/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show notes" }));
  expect(onShow).toHaveBeenCalled();
});

test("a new note opens ready to write, and what you type is saved by itself", async () => {
  render(<NotesPanel onHide={() => {}} />);
  await screen.findByRole("button", { name: /Release steps/ });
  fireEvent.click(screen.getByRole("button", { name: /New note/ }));
  const box = screen.getByLabelText("The note") as HTMLTextAreaElement;
  expect(document.activeElement).toBe(box);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Standup" } });
  fireEvent.change(box, { target: { value: "- shipped the parser" } });
  expect(screen.getByRole("status").textContent).toBe("Saving…");
  await act(() => flushNotes());
  expect(sent).toEqual([{ action: "save", id: notesNow().open, title: "Standup", text: "- shipped the parser" }]);
  expect(screen.getByRole("status").textContent).toBe("Saved");
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  expect(screen.getAllByRole("listitem")[0].querySelector("b")!.textContent).toBe("Standup");
});

test("a note goes into your message as text (all of it, or the part selected) or as a file", async () => {
  const onInsert = vi.fn(), onAttach = vi.fn(), onOpenConversation = vi.fn();
  render(<NotesPanel onHide={() => {}} onInsert={onInsert} onAttach={onAttach} onOpenConversation={onOpenConversation} />);
  fireEvent.click(await screen.findByRole("button", { name: /Ask about the flaky test/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(onInsert).toHaveBeenLastCalledWith("Ask about the flaky test\nIt fails on Windows only.");
  const box = screen.getByLabelText("The note") as HTMLTextAreaElement;
  box.setSelectionRange(0, 24);
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(onInsert).toHaveBeenLastCalledWith("Ask about the flaky test");
  fireEvent.click(screen.getByRole("button", { name: "Attach as a file" }));
  expect(onAttach.mock.lastCall![0].id).toBe("bbbbbb222222");
  fireEvent.click(screen.getByRole("button", { name: "From CI trouble" }));
  expect(onOpenConversation).toHaveBeenCalledWith("c7");
});

test("on a page with no message box there's nowhere to send a note; Preview shows it formatted", async () => {
  render(<NotesPanel onHide={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Release steps/ }));
  expect((screen.getByRole("button", { name: "Add to message" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Attach as a file" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.queryByLabelText("The note")).toBeNull();
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Tag", "Deploy"]);
});

test("deleting a note asks first, then takes it off the camp", async () => {
  render(<><NotesPanel onHide={() => {}} /><ConfirmHost /></>);
  fireEvent.click(await screen.findByRole("button", { name: /Release steps/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete note" }));
  await waitFor(() => expect(sent).toEqual([{ action: "remove", id: "aaaaaa111111" }]));
  expect(screen.getAllByRole("listitem").length).toBe(1);
});

// Select the text of an element, the way a drag across it would.
function select(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

test("text selected in the thread can be kept in a note: the open one, or a new one", async () => {
  vi.useFakeTimers();
  const onAdd = vi.fn();
  const { rerender } = render(<><div id="feed"><p>Rebase before the PR.</p></div><p data-testid="outside">Not the thread.</p><PickToNote active={false} onAdd={onAdd} /></>);
  const up = () => { fireEvent.pointerUp(document); act(() => { vi.advanceTimersByTime(1); }); };
  select(screen.getByTestId("outside"));
  up();
  expect(screen.queryByRole("toolbar")).toBeNull(); // only the thread's text
  select(document.querySelector("#feed p")!);
  up();
  fireEvent.click(screen.getByRole("button", { name: "Add to a note" }));
  expect(onAdd).toHaveBeenLastCalledWith("Rebase before the PR.", true);
  expect(screen.queryByRole("toolbar")).toBeNull();
  vi.useRealTimers();

  // With a note open in the panel, it's offered first.
  render(<NotesPanel onHide={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Release steps/ }));
  vi.useFakeTimers();
  rerender(<><div id="feed"><p>Rebase before the PR.</p></div><p data-testid="outside">Not the thread.</p><PickToNote active onAdd={onAdd} /></>);
  select(document.querySelector("#feed p")!);
  up();
  fireEvent.click(screen.getByRole("button", { name: "Add to “Release steps”" }));
  expect(onAdd).toHaveBeenLastCalledWith("Rebase before the PR.", false);
  vi.useRealTimers();
});

// ---------- What the camp does with a note ----------
const TICKET = { title: "Add a Copy link button to report cards", criteria: ["Each card has a Copy link button", "A toast confirms the copy"],
  description: "## Summary\nReport cards get a button that copies their link.\n\n## Technical notes\nIn `src/ReportCard.tsx`.", written: "2026-11-12T10:00:00.000Z", conversation: "run-9" };
const WEB = { id: "p1", name: "Web app" };
// The camp, answering each address with what a test gives it (and remembering what it was sent).
function camp(notes: object[], answers: Record<string, (body: any) => object> = {}) {
  const posts: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(JSON.stringify({ notes }));
    const body = JSON.parse(String(init.body));
    posts.push({ url: String(url), body });
    return new Response(JSON.stringify(answers[String(url)]?.(body) ?? { ok: true }));
  }));
  return posts;
}

test("a note is written up as a ticket when you ask, from the code of the project you're in", async () => {
  const writing = { ...NOTES[0], writing: { run: "run-9", started: new Date().toISOString() } };
  const posts = camp(NOTES, { "/api/notes/ticket": () => ({ ok: true, thread: "run-9", notes: [writing, NOTES[1]] }) });
  const onOpenConversation = vi.fn();
  render(<NotesPanel onHide={() => {}} onInsert={() => {}} onAttach={() => {}} onOpenConversation={onOpenConversation} project={WEB} />);
  fireEvent.click(await screen.findByRole("button", { name: /Release steps/ }));
  expect(screen.queryByRole("tablist")).toBeNull(); // no ticket yet: nothing to switch to
  const ask = screen.getByRole("button", { name: "Write up as a ticket" });
  expect(ask.getAttribute("title")).toMatch(/read Web app's code/);
  fireEvent.click(ask);
  await waitFor(() => expect(posts).toEqual([{ url: "/api/notes/ticket", body: { id: "aaaaaa111111", project: "p1" } }]));
  expect(await screen.findByText(/Writing the ticket: the Scout is reading Web app's code first/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Write up as a ticket" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Watch" }));
  expect(onOpenConversation).toHaveBeenCalledWith("run-9");
});

test("a note's ticket sits beside it: read it, start work from it, or have it written again", async () => {
  const posts = camp([{ ...NOTES[0], ticket: { ...TICKET, stale: true } }, NOTES[1]], { "/api/notes/ticket": () => ({ ok: true, thread: "run-10", notes: [] }) });
  const onInsert = vi.fn(), onAttach = vi.fn(), onOpenConversation = vi.fn();
  render(<NotesPanel onHide={() => {}} onInsert={onInsert} onAttach={onAttach} onOpenConversation={onOpenConversation} />);
  expect(await screen.findByText(/has a ticket/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Release steps/ }));
  expect(screen.getByRole("tab", { name: "Note" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("button", { name: "Write up as a ticket" })).toBeNull(); // it has one: writing it again is on the ticket's side
  fireEvent.click(screen.getByRole("tab", { name: "Ticket" }));
  const panel = screen.getByRole("tabpanel", { name: "Ticket" });
  expect(panel.textContent).toMatch(/Add a Copy link button to report cards/);
  expect(panel.textContent).toMatch(/Each card has a Copy link button/);
  expect(panel.textContent).toMatch(/The note has changed since this was written/);
  fireEvent.click(screen.getByRole("button", { name: "Start work" }));
  expect(onAttach.mock.calls[0][0]).toMatchObject({ title: TICKET.title, text: expect.stringMatching(/^# Add a Copy link button to report cards\n\n## Acceptance criteria\n- \[ \] Each card has a Copy link button/) });
  expect(onInsert.mock.calls[0][0]).toMatch(/^Work on this: Add a Copy link button to report cards\n\nThe ticket is attached: read it first\.\n\nAcceptance criteria \(from the ticket\):\n- \[ \] Each card has a Copy link button/);
  fireEvent.click(screen.getByRole("button", { name: "How it was written" }));
  expect(onOpenConversation).toHaveBeenCalledWith("run-9");
  fireEvent.click(screen.getAllByRole("button", { name: "Write it again" })[0]);
  await waitFor(() => expect(posts).toEqual([{ url: "/api/notes/ticket", body: { id: "aaaaaa111111" } }]));
});

test("ideas are suggested for the project you're in; one is kept, or the unkept are replaced", async () => {
  const IDEA = { id: "cccccc333333", title: "Retry the export on timeout", text: "The last run left it for later.", created: "2026-11-13T09:00:00.000Z", updated: "2026-11-13T09:00:00.000Z",
    idea: { project: "p1", criteria: ["A timed-out export is retried once"], suggested: "2026-11-13T09:00:00.000Z" } };
  const posts = camp(NOTES, {
    "/api/ideas": (body) => (body.replace ? { ok: true, added: 0, cleared: 1, notes: NOTES } : { ok: true, added: 1, cleared: 0, notes: [IDEA, ...NOTES] }),
    "/api/notes": (body) => (body.action === "keep" ? { ok: true, note: { ...IDEA, idea: { ...IDEA.idea, kept: true } } } : { ok: true }),
  });
  const { unmount } = render(<NotesPanel onHide={() => {}} />);
  const off = await screen.findByRole("button", { name: "Suggest ideas" }) as HTMLButtonElement;
  expect(off.disabled).toBe(true); // outside a project there's no record to suggest from
  expect(off.title).toMatch(/Open a project/);
  unmount();

  render(<NotesPanel onHide={() => {}} project={WEB} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest ideas" }));
  expect(await screen.findByText("1 idea added.")).toBeTruthy();
  expect(posts[0]).toEqual({ url: "/api/ideas", body: { project: "p1" } });
  expect(screen.getByRole("button", { name: /Retry the export on timeout/ }).textContent).toMatch(/Suggested · /);
  expect(screen.getByRole("button", { name: "Replace the 1 you haven't kept" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Retry the export on timeout/ }));
  expect(screen.getByText(/The camp suggested this/)).toBeTruthy();
  expect(screen.getByText("A timed-out export is retried once")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  await waitFor(() => expect(screen.queryByText(/The camp suggested this/)).toBeNull());
  expect(posts[1]).toEqual({ url: "/api/notes", body: { action: "keep", id: "cccccc333333" } });
  expect(screen.getByText("A timed-out export is retried once")).toBeTruthy(); // what done would mean stays with it
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  expect(screen.queryByRole("button", { name: /Replace the/ })).toBeNull(); // nothing unkept is left to replace
});
