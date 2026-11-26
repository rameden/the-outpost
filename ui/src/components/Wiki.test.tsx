// The wiki's own page: its pages as cards under Facts and Notes, narrowing, and one page read.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { parseView } from "../feed/conversation.ts";
import type { CampState } from "../types.ts";
import { WikiHome, pageName } from "./Wiki.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const S = { wiki: [
  { section: "facts", path: "camp/wiki/facts/release-process.md", summary: "How releases go out, and who signs off.", updated: "2026-11-02" },
  { section: "notes", path: "camp/wiki/notes/agent-memory-2026.md", summary: "What other harnesses do about memory.", updated: "2026-11-09" },
  { section: "notes", path: "camp/wiki/notes/vite-upgrade.md", summary: "", updated: "" },
] } as unknown as CampState;

test("every page is a card under Facts or Notes; narrowing finds one by name or words", () => {
  const onOpen = vi.fn();
  render(<WikiHome S={S} onOpen={onOpen} />);
  expect(screen.getByRole("heading", { name: "Wiki" })).toBeTruthy();
  const facts = within(screen.getByRole("region", { name: "Facts" })), notes = within(screen.getByRole("region", { name: "Notes" }));
  expect(facts.getAllByRole("button").map((b) => b.textContent)).toEqual(["release-processHow releases go out, and who signs off.updated 2026-11-02"]);
  expect(notes.getAllByRole("button").map((b) => b.querySelector("b")!.textContent)).toEqual(["agent-memory-2026", "vite-upgrade"]);
  expect(notes.getByText("No summary.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Narrow the wiki"), { target: { value: "memory harness" } });
  expect(screen.queryByRole("region", { name: "Facts" })).toBeNull(); // a section with nothing left steps aside
  expect(within(screen.getByRole("region", { name: "Notes" })).getAllByRole("button").length).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: /agent-memory-2026/ }));
  expect(onOpen).toHaveBeenCalledWith("camp/wiki/notes/agent-memory-2026.md");
  fireEvent.change(screen.getByLabelText("Narrow the wiki"), { target: { value: "zzz" } });
  fireEvent.click(screen.getByRole("button", { name: "Show them all" }));
  expect(screen.getAllByRole("button", { name: /:/ }).length).toBe(3);
});

test("a page is read in place, without its front matter, and Back returns to them all", async () => {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(url); return new Response(JSON.stringify({ text: "---\nsummary: How releases go out.\nupdated: 2026-11-02\n---\n# Release process\n\nTag, then <script>alert(1)</script> deploy." })); }));
  const onOpen = vi.fn();
  render(<WikiHome S={S} open="camp/wiki/facts/release-process.md" onOpen={onOpen} />);
  expect(await screen.findByRole("heading", { name: "Release process" })).toBeTruthy();
  expect(fetched).toEqual(["/api/wiki?path=camp%2Fwiki%2Ffacts%2Frelease-process.md"]);
  expect(screen.getByText(/A fact: treated as true · updated 2026-11-02/)).toBeTruthy();
  expect(screen.queryByText(/summary: How releases/)).toBeNull();
  expect(document.querySelector("script")).toBeNull(); // what a page holds is only ever shown as text
  fireEvent.click(screen.getByRole("button", { name: "← All pages" }));
  expect(onOpen).toHaveBeenCalledWith(null);
});

test("an empty wiki says what it's for; a page that can't be read says why", async () => {
  const { rerender } = render(<WikiHome S={{ wiki: [] } as unknown as CampState} onOpen={() => {}} />);
  expect(screen.getByText(/The wiki is empty/)).toBeTruthy();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No such page" }), { status: 404 })));
  rerender(<WikiHome S={S} open="camp/wiki/notes/gone.md" onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("No such page"));
});

test("Memory and Activity are somewhere you can be, and come back to after a reload; the old wiki page lands in Memory", () => {
  expect(parseView(JSON.stringify({ kind: "wiki" }))).toEqual({ kind: "memory" });
  expect(parseView(JSON.stringify({ kind: "wiki", page: "camp/wiki/facts/x.md" }))).toEqual({ kind: "memory", page: "camp/wiki/facts/x.md" });
  expect(parseView(JSON.stringify({ kind: "memory", tab: "member", member: "scout" }))).toEqual({ kind: "memory", tab: "member", member: "scout" });
  expect(parseView(JSON.stringify({ kind: "memory", tab: "bogus", page: 7 }))).toEqual({ kind: "memory" });
  expect(parseView(JSON.stringify({ kind: "activity", tab: "jobs" }))).toEqual({ kind: "activity", tab: "jobs" });
  expect(parseView(JSON.stringify({ kind: "activity", tab: "nope" }))).toEqual({ kind: "activity" });
});

test("a new page: its title, whether it's a fact or a note, a summary, and the page itself", async () => {
  const calls: { url: string; body?: any }[] = [];
  let refuse = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return refuse ? new Response(JSON.stringify({ error: "There's already a fact called release-process." }), { status: 400 })
      : new Response(JSON.stringify({ ok: true, page: { section: "notes", path: "camp/wiki/notes/deploy-checklist.md", summary: body.summary, updated: "2026-11-10" } }));
  }));
  const onOpen = vi.fn(), refresh = vi.fn();
  render(<WikiHome S={S} onOpen={onOpen} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: /New page/ }));
  const form = screen.getByRole("form", { name: "A new wiki page" });
  const add = within(form).getByRole("button", { name: "Add the page" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true); // nothing to add yet
  fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Deploy checklist!" } });
  expect(within(form).getByText("camp/wiki/facts/deploy-checklist.md")).toBeTruthy(); // a fact, unless you say otherwise
  fireEvent.click(within(form).getByRole("radio", { name: /A note/ }));
  expect(within(form).getByText("camp/wiki/notes/deploy-checklist.md")).toBeTruthy();
  fireEvent.change(within(form).getByLabelText("Summary"), { target: { value: "What to check before a deploy." } });
  expect(add.disabled).toBe(true);
  fireEvent.change(within(form).getByLabelText("The page"), { target: { value: "- Tests green\n- Changelog written" } });
  expect(add.disabled).toBe(false);
  fireEvent.click(add);
  expect((await within(form).findByRole("alert")).textContent).toMatch(/already a fact called/);
  expect((within(form).getByLabelText("The page") as HTMLTextAreaElement).value).toBe("- Tests green\n- Changelog written"); // nothing typed is lost
  refuse = false;
  fireEvent.click(add);
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith("camp/wiki/notes/deploy-checklist.md")); // it opens the page it made
  expect(calls.at(-1)).toEqual({ url: "/api/wiki/save", body: { create: true, section: "notes", title: "Deploy checklist!", summary: "What to check before a deploy.", text: "- Tests green\n- Changelog written" } });
  expect(refresh).toHaveBeenCalled();
  expect(pageName("  Ünïcode & symbols ")).toBe("unicode-symbols");
});

test("a page can be edited (its summary and text) or deleted, after being asked", async () => {
  const calls: { url: string; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.startsWith("/api/wiki?")) return new Response(JSON.stringify({ text: "---\nsummary: How releases go out, and who signs off.\nupdated: 2026-11-02\n---\n\n# Release process\n\nTag, then deploy.\n" }));
    if (url === "/api/wiki/save") return new Response(JSON.stringify({ ok: true, page: { section: "facts", path: body.path, summary: body.summary, updated: "2026-11-10" } }));
    return new Response(JSON.stringify({ ok: true }));
  }));
  const onOpen = vi.fn(), refresh = vi.fn();
  const path = "camp/wiki/facts/release-process.md";
  render(<WikiHome S={S} open={path} onOpen={onOpen} refresh={refresh} />);
  await screen.findByRole("heading", { name: "Release process" });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const form = screen.getByRole("form", { name: "Edit release-process" });
  expect(within(form).queryByLabelText("Title")).toBeNull(); // its name and kind stay as they are
  expect((within(form).getByLabelText("Summary") as HTMLInputElement).value).toBe("How releases go out, and who signs off.");
  const box = await within(form).findByLabelText("The page") as HTMLTextAreaElement;
  expect(box.value).toBe("# Release process\n\nTag, then deploy."); // without the file's front matter
  fireEvent.change(box, { target: { value: "# Release process\n\nTag, get sign-off, then deploy." } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(path));
  expect(calls.find((c) => c.url === "/api/wiki/save")!.body).toEqual({ path, summary: "How releases go out, and who signs off.", text: "# Release process\n\nTag, get sign-off, then deploy." });

  // Back reading it: Delete asks first.
  await screen.findByRole("heading", { name: "Release process" });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const ask = await screen.findByRole("alertdialog");
  expect(ask.textContent).toContain("can't be brought back from here");
  expect(calls.some((c) => c.url === "/api/wiki/remove")).toBe(false);
  fireEvent.click(within(ask).getByRole("button", { name: "Delete the page" }));
  await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith(null));
  expect(calls.at(-1)).toEqual({ url: "/api/wiki/remove", body: { path } });
});
