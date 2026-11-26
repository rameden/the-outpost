// The command palette: type to narrow, arrows and Enter to go, files found by name in the
// folders attached where you are.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { matches, Palette, type PaletteItem } from "./Palette.tsx";

const gets: string[] = [];
beforeEach(() => {
  gets.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    gets.push(url);
    return new Response(JSON.stringify({ files: url.includes("q=butt") ? ["src/components/Button.tsx", "docs/buttons.md"] : [] }));
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function show(start = "", roots = [{ link: "demo" }]) {
  const ran: string[] = [], onClose = vi.fn(), onOpenFile = vi.fn();
  const item = (id: string, group: PaletteItem["group"], label: string, hint?: string): PaletteItem => ({ id, group, label, hint, icon: "file", run: () => ran.push(id) });
  const items = [item("do:new", "Do", "Start a new conversation", "/new"), item("do:focus", "Do", "Close the history, files and terminal", "/focus"),
    item("c:1", "Conversations", "Fix the flaky test", "mi-web-app"), item("c:2", "Conversations", "Rebuild the UI", "General"), item("p:1", "Projects", "mi-web-app", "links/mi-web-app")];
  render(<Palette items={items} roots={roots} start={start} onOpenFile={onOpenFile} onClose={onClose} />);
  const box = screen.getByRole("combobox") as HTMLInputElement;
  const options = () => screen.queryAllByRole("option").map((o) => o.querySelector(".palette-label")!.textContent);
  return { ran, onClose, onOpenFile, box, options };
}

test("everything is offered to begin with, and typing narrows it by every word", () => {
  const { box, options } = show();
  expect(options()).toEqual(["Start a new conversation", "Close the history, files and terminal", "Fix the flaky test", "Rebuild the UI", "mi-web-app"]);
  fireEvent.change(box, { target: { value: "flaky mi-web" } }); // the title and its project
  expect(options()).toEqual(["Fix the flaky test"]);
  fireEvent.change(box, { target: { value: "/focus" } });       // a command, by what you'd type
  expect(options()).toEqual(["Close the history, files and terminal"]);
  expect(matches({ label: "Rebuild the UI", hint: "General" }, "ui GEN")).toBe(true);
  expect(matches({ label: "Rebuild the UI" }, "ui zzz")).toBe(false);
});

test("arrows move, Enter goes there and closes, Escape just closes", () => {
  const { box, ran, onClose } = show();
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(box, { key: "ArrowUp" });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(ran).toEqual(["do:focus"]);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("files are looked for by name once there's enough to go on, and open in the viewer", async () => {
  const { box, options, onOpenFile } = show();
  fireEvent.change(box, { target: { value: "b" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(gets).toEqual([]); // one letter: not yet
  fireEvent.change(box, { target: { value: "butt" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(gets).toEqual(["/api/tree/find?link=demo&path=&q=butt"]);
  expect(options()).toEqual(["Button.tsx", "buttons.md"]);
  expect(screen.getAllByRole("option")[0].textContent).toContain("links/demo/src/components");
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onOpenFile).toHaveBeenCalledWith({ link: "demo" }, "src/components/Button.tsx");
});

test("with no folder attached, files aren't looked for; opened with words, it starts from them", async () => {
  const { box, options } = show("rebuild", []);
  expect(box.value).toBe("rebuild");
  expect(options()).toEqual(["Rebuild the UI"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(gets).toEqual([]);
});

// Settings, Activity, Tickets, Notes and Memory are found by typing; the box opens short.
function showMore(extra: Partial<Parameters<typeof Palette>[0]> = {}) {
  const ran: string[] = [], onOpenJira = vi.fn();
  const item = (id: string, group: PaletteItem["group"], label: string, hint?: string): PaletteItem => ({ id, group, label, hint, icon: "file", run: () => ran.push(id) });
  const items = [item("do:new", "Do", "Start a new conversation", "/new"),
    item("s:limits", "Settings", "Settings: Limits & budget", "Safety"), item("s:memory", "Settings", "Settings: Memory", "Knowledge"),
    item("a:usage", "Activity", "Activity: Usage"), item("a:inbox", "Activity", "Activity: Inbox"),
    item("t:MAE-1", "Tickets", "MAE-1: Write the tour", "Mae"), item("n:1", "Notes", "Release checklist", "Note"),
    item("m:1", "Memory", "Prefers short answers", "You"),
    ...Array.from({ length: 9 }, (_, i) => item(`t:MAE-${i + 10}`, "Tickets", `MAE-${i + 10}: Chore ${i}`, "Mae"))];
  render(<Palette items={items} roots={[]} jira onOpenJira={onOpenJira} onOpenFile={() => {}} onClose={() => {}} {...extra} />);
  const box = screen.getByRole("combobox") as HTMLInputElement;
  const options = () => screen.queryAllByRole("option").map((o) => o.querySelector(".palette-label")!.textContent);
  return { ran, onOpenJira, box, options };
}

test("the quiet groups wait for a word, then each is capped; Enter jumps straight to a Settings section", () => {
  const { box, options, ran } = showMore();
  expect(options()).toEqual(["Start a new conversation"]); // nothing from the quiet groups yet
  fireEvent.change(box, { target: { value: "limits" } });
  expect(options()).toEqual(["Settings: Limits & budget"]);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(ran).toEqual(["s:limits"]);
  fireEvent.change(box, { target: { value: "activity" } });
  expect(options()).toEqual(["Activity: Usage", "Activity: Inbox"]);
  fireEvent.change(box, { target: { value: "note" } });
  expect(options()).toEqual(["Release checklist"]);
  fireEvent.change(box, { target: { value: "short" } });
  expect(options()).toEqual(["Prefers short answers"]);
  fireEvent.change(box, { target: { value: "mae" } }); // ten Mae tickets match: five show
  expect(options().length).toBe(5);
});

test("Jira tickets are found by key or title once two letters are typed, and open on the Tickets page", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    gets.push(url);
    return new Response(JSON.stringify({ issues: url.includes("q=nav") ? [{ key: "MP-601", summary: "Fix the nav" }] : [] }));
  }));
  const { box, options, onOpenJira } = showMore();
  fireEvent.change(box, { target: { value: "nav" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(gets).toEqual(["/api/jira/issues?q=nav"]);
  expect(options()).toEqual(["MP-601: Fix the nav"]);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onOpenJira).toHaveBeenCalledWith("MP-601");
});
