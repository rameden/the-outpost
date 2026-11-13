// The changed files at the foot of the Files drawer: every file git reports as changed, in one
// list. A file opens at what changed in it, a new folder is shown in the tree, the filter narrows
// the list, and the section can be sized, or folded down to a rail that says what changed.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { changesSummary, type Change } from "./Changes.tsx";
import { FilesPanel } from "./Files.tsx";

const gets: string[] = [];
let changed: Record<string, string> = {};
beforeEach(() => {
  gets.length = 0;
  changed = { "src/app.ts": "M", "src/deep/in/here/list.tsx": "A", "notes/": "U", "old.md": "D", "README.md": "M" };
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    gets.push(url);
    const path = new URL(url, "http://camp").searchParams.get("path");
    if (url.startsWith("/api/tree/diff")) return new Response(JSON.stringify({ diff: "@@ -1,2 +1,2 @@\n # Demo\n-Hi.\n+Hello.\n", untracked: false }));
    if (url.startsWith("/api/tree/file")) return new Response(JSON.stringify({ path, abs: `/work/demo/${path}`, size: 14, text: "# Demo\nHello.\n" }));
    if (path === "") return new Response(JSON.stringify({ root: "/work/demo", changed, entries: [{ name: "notes", dir: true }, { name: "src", dir: true }, { name: "README.md", dir: false, size: 14 }] }));
    if (path === "notes") return new Response(JSON.stringify({ root: "/work/demo", entries: [{ name: "todo.md", dir: false, size: 3 }] }));
    return new Response(JSON.stringify({ root: "/work/demo", entries: [] }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function show(roots = [{ link: "demo" }]) {
  const onMention = vi.fn();
  const r = render(<FilesPanel roots={roots} onHide={() => {}} onMention={onMention} />);
  return { ...r, onMention };
}
const section = () => screen.findByRole("region", { name: "Changed files" });
const names = (el: HTMLElement) => [...el.querySelectorAll(".ch-open")].map((b) => b.getAttribute("aria-label"));

test("it lists every changed file under the tree: the folder dimmed, the name, and what happened to it", async () => {
  show();
  const box = await section();
  expect(box.previousElementSibling?.getAttribute("role")).toBe("separator");
  expect(box.previousElementSibling?.previousElementSibling?.getAttribute("role")).toBe("tree"); // under the tree, in the same drawer
  expect(box.querySelector(".changes-sum")?.textContent).toBe("5 changed files");
  expect(names(box)).toEqual(["notes/: new (git doesn't know it yet)", "old.md: deleted", "README.md: modified", "src/app.ts: modified", "src/deep/in/here/list.tsx: added"]);
  const deep = within(box).getByRole("button", { name: "src/deep/in/here/list.tsx: added" });
  expect(deep.querySelector(".ch-dir")?.textContent).toBe("src/deep/in/here");
  expect(deep.querySelector(".ch-name")?.textContent).toBe("/list.tsx");
  expect(deep.querySelector(".ch-mark")?.getAttribute("class")).toBe("ch-mark ch-A");
  expect(within(box).getByRole("button", { name: "README.md: modified" }).querySelector(".ch-dir")).toBeNull(); // nothing to dim at the top
});

test("with nothing changed there's no section, and no rail", async () => {
  changed = {};
  show();
  await screen.findByText("README.md");
  expect(screen.queryByRole("region", { name: "Changed files" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Show the changed files/ })).toBeNull();
});

test("a changed file opens at what changed in it; a deleted one has nothing to open", async () => {
  show();
  const box = await section();
  fireEvent.click(within(box).getByRole("button", { name: "old.md: deleted" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "src/app.ts: modified" }));
  const dialog = await screen.findByRole("dialog", { name: "links/demo/src/app.ts" });
  await waitFor(() => expect(dialog.querySelectorAll(".fd-row").length).toBe(2));
  expect(within(dialog).getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")).toBe("true");
  expect(gets.slice(-2)).toEqual(["/api/tree/file?link=demo&path=src%2Fapp.ts", "/api/tree/diff?link=demo&path=src%2Fapp.ts"]);
  // The file itself is a tab away, as it is when opened from the tree.
  fireEvent.click(within(dialog).getByRole("tab", { name: "File" }));
  expect(dialog.querySelector(".file-code")?.textContent).toBe("# Demo\nHello.");
});

test("a new folder is shown in the tree, and the @ puts a change in your message", async () => {
  const { onMention } = show();
  const box = await section();
  const tree = within(screen.getByRole("tree"));
  expect(tree.queryByText("todo.md")).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "notes/: new (git doesn't know it yet)" }));
  await tree.findByText("todo.md");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "Mention the changed file src/app.ts in your message" }));
  fireEvent.click(within(box).getByRole("button", { name: "Mention the changed folder notes in your message" }));
  expect(onMention.mock.calls.map((c) => c[0])).toEqual(["links/demo/src/app.ts", "links/demo/notes/"]);
  expect(within(box).queryByRole("button", { name: /Mention the changed file old\.md/ })).toBeNull();
});

test("the filter narrows the list to the paths that hold what you typed", async () => {
  show();
  const box = await section();
  const filter = within(box).getByRole("searchbox", { name: "Filter the changed files" });
  fireEvent.change(filter, { target: { value: "SRC ts" } });
  expect(names(box)).toEqual(["src/app.ts: modified", "src/deep/in/here/list.tsx: added"]);
  expect(box.querySelector(".changes-sum")?.textContent).toBe("2 of 5 changed files");
  fireEvent.change(filter, { target: { value: "nowhere" } });
  expect(names(box)).toEqual([]);
  expect(box.textContent).toContain("Nothing matches “nowhere”.");
  fireEvent.change(filter, { target: { value: "" } });
  expect(names(box).length).toBe(5);
});

test("it starts at 30% of the drawer, the line above it resizes it, and the size is remembered", async () => {
  const first = show();
  const box = await section();
  expect(box.style.flexBasis).toBe("30%");
  const line = screen.getByRole("separator", { name: "Resize the changed files" });
  fireEvent.keyDown(line, { key: "ArrowUp" });
  expect(box.style.flexBasis).toBe("34%");
  fireEvent.keyDown(line, { key: "ArrowDown" });
  fireEvent.keyDown(line, { key: "ArrowDown" });
  expect(box.style.flexBasis).toBe("26%");
  expect(localStorage.getItem("camp-changes-share")).toBe("0.26");
  for (let i = 0; i < 10; i++) fireEvent.keyDown(line, { key: "ArrowDown" });
  expect(box.style.flexBasis).toBe("12%"); // it stops while there's still a list to see
  first.unmount();
  show();
  expect((await section()).style.flexBasis).toBe("12%");
});

test("its header folds it down to a rail that says what changed; the rail opens it again, and that's remembered", async () => {
  const first = show();
  const box = await section();
  fireEvent.click(within(box).getByRole("button", { name: "Hide the changed files" }));
  expect(screen.queryByRole("region", { name: "Changed files" })).toBeNull();
  expect(screen.queryByRole("separator", { name: "Resize the changed files" })).toBeNull();
  const rail = screen.getByRole("button", { name: "Show the changed files (5 files · 2 modified · 2 new · 1 deleted)" });
  expect(rail.className).toContain("zone-rail"); // the same rail History, Files and the terminal have
  // Condensed: the total, then a count beside each kind's square. The words are in its tooltip.
  expect(rail.textContent).toBe("Changes5221");
  expect([...rail.querySelectorAll(".rail-counts .ch-mark")].map((m) => m.getAttribute("class"))).toEqual(["ch-mark ch-M", "ch-mark ch-A", "ch-mark ch-D"]);
  expect(rail.title).toContain("5 files · 2 modified · 2 new · 1 deleted");
  expect(rail.parentElement!.className).toBe("files");
  expect(rail.previousElementSibling?.getAttribute("role")).toBe("tree");
  expect(localStorage.getItem("camp-changes")).toBe("closed");
  first.unmount();
  show();
  fireEvent.click(await screen.findByRole("button", { name: /Show the changed files/ }));
  expect(await section()).toBeTruthy();
  expect(localStorage.getItem("camp-changes")).toBe("open");
});

test("with more than one folder on show, each folder's changes sit under its name", async () => {
  show([{ link: "demo" }, { link: "other" }]);
  const box = await section();
  await waitFor(() => expect([...box.querySelectorAll(".ch-root")].map((h) => h.textContent)).toEqual(["demo", "other"]));
  expect(box.querySelector(".changes-sum")?.textContent).toBe("10 changed files");
});

test("the summary counts what changed, and leaves out what didn't happen", () => {
  const of = (...marks: string[]): Change[] => marks.map((mark, i) => ({ root: { link: "demo" }, path: `f${i}`, mark }));
  expect(changesSummary(of("M"))).toBe("1 file · 1 modified");
  expect(changesSummary(of("M", "A", "U", "U", "D"))).toBe("5 files · 1 modified · 3 new · 1 deleted");
});
