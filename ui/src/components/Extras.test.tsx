// Chained requests waiting to start, the weekly chronicle on a project's page, importing a
// packaged skill, and the switch that lets the camp write back to Jira.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { SkillEditor } from "../settings/SkillEditor.tsx";
import { SkillImport } from "../settings/SkillImport.tsx";
import { ChronicleSection, plainTerms } from "./Chronicle.tsx";
import { JiraWriteBack } from "./Jira.tsx";
import { Waiting } from "./Waiting.tsx";

const calls: { url: string; body?: any }[] = [];
let answer: (url: string, body?: any) => { status?: number; json: unknown } = () => ({ json: {} });
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const a = answer(url, body);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ---------- Waiting ----------
const queue = (queued: object[]) => ({ running: [{ id: "a", label: "expedition", task: "Build the Open button" }], queued }) as unknown as CampState;

test("chained requests are listed with what each waits for; one can be started now or taken off", async () => {
  const refresh = vi.fn(), onOpen = vi.fn();
  answer = () => ({ json: { ok: true } });
  const { rerender } = render(<Waiting S={queue([{ id: "plain", label: "expedition", task: "Just queued", after: null, held: null }])} refresh={refresh} onOpen={onOpen} />);
  expect(screen.queryByRole("group")).toBeNull(); // only chained ones are listed here
  rerender(<Waiting S={queue([{ id: "b", label: "@scribe", task: "Write the release notes", after: "a", held: null }, { id: "c", label: "expedition", task: "Deploy it", after: "gone", held: "stopped" }])} refresh={refresh} onOpen={onOpen} />);
  const box = screen.getByRole("group", { name: "Waiting to start" });
  expect(within(box).getByText('Starts when "Build the Open button" has finished.')).toBeTruthy();
  expect(within(box).getByText("The work it was waiting on ended as stopped, so it hasn't started.")).toBeTruthy();
  fireEvent.click(within(box).getByRole("button", { name: "Write the release notes" }));
  expect(onOpen).toHaveBeenCalledWith("b");
  fireEvent.click(within(box).getByRole("button", { name: "Start it anyway" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(calls[0]).toEqual({ url: "/api/queue/release", body: { id: "c" } });
  fireEvent.click(within(box).getAllByRole("button", { name: "Take it off" })[0]);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(calls[1]).toEqual({ url: "/api/stop", body: { id: "b" } });
  fireEvent.click(within(box).getByRole("button", { name: "Start now" }));
  await waitFor(() => expect(calls[2]).toEqual({ url: "/api/queue/release", body: { id: "b" } }));
});

// ---------- The chronicle ----------
const TEXT = "The week was about the Open button.\n\n## What got done\n- MP-544 shipped.\n\n## In plain terms\n- The Open button now works.\n- One review comment is still open.";
const PAGE = { weeks: [{ week: "2026-11-02", label: "Nov 2 to Nov 8, 2026", text: TEXT, written: "2026-11-09T09:00:00.000Z" }],
  open: [{ week: "2026-11-09", label: "Nov 9 to Nov 15, 2026", conversations: 3 }, { week: "2026-11-02", label: "Nov 2 to Nov 8, 2026", conversations: 2 }] };

test("a project's chronicle: the last one written is shown, its plain bullets copy, and another week can be written up", async () => {
  const write = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: write } });
  answer = (url) => (url.startsWith("/api/project/chronicle?") ? { json: PAGE } : { json: { ok: true, id: "run5", thread: "run5", position: 0 } });
  const onOpen = vi.fn();
  render(<ChronicleSection project={{ id: "p1", name: "Web app" }} reloadKey="1" onOpen={onOpen} />);
  expect(await screen.findByText("The week was about the Open button.")).toBeTruthy();
  expect(calls[0].url).toBe("/api/project/chronicle?id=p1");
  const week = screen.getByLabelText("Week") as HTMLSelectElement;
  expect(week.value).toBe("2026-11-02"); // the one that's written, rather than an empty week
  expect([...week.options].map((o) => o.textContent)).toEqual(["Nov 9 to Nov 15, 2026", "Nov 2 to Nov 8, 2026"]);
  fireEvent.click(screen.getByRole("button", { name: "Copy the plain bullets" }));
  await waitFor(() => expect(write).toHaveBeenCalledWith("- The Open button now works.\n- One review comment is still open."));
  expect(screen.getByRole("button", { name: "Write it again" })).toBeTruthy();
  // This week isn't written yet.
  fireEvent.change(week, { target: { value: "2026-11-09" } });
  expect(screen.getByText(/3 conversations had work in Web app\. Nothing is written up yet\./)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy the plain bullets" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Write it up" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith("run5"));
  expect(calls.find((c) => c.body)).toEqual({ url: "/api/project/chronicle", body: { id: "p1", week: "2026-11-09" } });
  expect(plainTerms("## In plain terms\n- a\n\n## After\n- b")).toBe("- a");
});

test("a project where nothing has happened shows no chronicle at all", async () => {
  answer = () => ({ json: { weeks: [], open: [{ week: "2026-11-09", label: "x", conversations: 0 }, { week: "2026-11-02", label: "y", conversations: 0 }] } });
  const { container } = render(<ChronicleSection project={{ id: "p1", name: "Web app" }} reloadKey="1" onOpen={() => {}} />);
  await waitFor(() => expect(calls.length).toBe(1));
  expect(container.textContent).toBe("");
});

// ---------- Importing a skill ----------
const S = { characters: [{ id: "quartermaster", name: "Quartermaster", emoji: "🎒" }, { id: "scout", name: "Scout", emoji: "🔭" }] } as unknown as CampState;
const PACK = { id: "abc", name: "pdf-tables", description: "Pull tables out of a PDF.", body: "---\nname: pdf-tables\n---\n# PDF tables", installed: ["scout"], skipped: ["pdf-tables/.env"],
  files: [{ path: "SKILL.md", size: 40 }, { path: "scripts/extract.py", size: 2048 }], scripts: [{ file: "scripts/extract.py", runner: "python3", text: "print('hi')" }] };

test("importing a skill: the file is opened and described first; installing says who gets it and what may run without asking", async () => {
  let refuse = true;
  answer = (url) => (url === "/api/skills/inspect" ? { json: PACK } : refuse ? { status: 400, json: { error: '"bash" on its own would let almost anything run without asking.' } }
    : { json: { ok: true, owner: "scout", name: "pdf-tables", files: 2, commands: ["python3 skills/scout/pdf-tables/scripts/extract.py", "pnpm add"] } });
  const refresh = vi.fn();
  render(<SkillImport S={S} refresh={refresh} />);
  fireEvent.change(screen.getByLabelText("A .skill file"), { target: { files: [new File(["PK-not-really"], "pdf-tables.skill")] } });
  const form = await screen.findByRole("form", { name: "Install pdf-tables" });
  expect(calls[0].url).toBe("/api/skills/inspect");
  expect(calls[0].body.name).toBe("pdf-tables.skill");
  expect(typeof calls[0].body.data).toBe("string");
  expect(within(form).getByText("Pull tables out of a PDF.")).toBeTruthy();
  expect(within(form).getByText("Not installed yet")).toBeTruthy(); // shared, where it starts, has none
  expect(within(form).getByText(/Left out.*pdf-tables\/\.env/)).toBeTruthy();
  expect(within(form).getByText("print('hi')")).toBeTruthy(); // the script is there to read
  const tick = within(form).getByRole("checkbox") as HTMLInputElement;
  expect(tick.checked).toBe(false); // nothing runs without asking unless you tick it
  fireEvent.change(within(form).getByLabelText("Who gets it"), { target: { value: "scout" } });
  expect(within(form).getByText("Replaces the one installed")).toBeTruthy();
  expect(within(form).getByText("python3 skills/scout/pdf-tables/scripts/extract.py")).toBeTruthy();
  fireEvent.click(tick);
  fireEvent.change(within(form).getByLabelText("Other commands it may run without asking"), { target: { value: "bash\n\n pnpm add " } });
  fireEvent.click(within(form).getByRole("button", { name: "Replace the installed skill" }));
  expect((await within(form).findByRole("alert")).textContent).toMatch(/would let almost anything run/);
  expect(calls[1]).toEqual({ url: "/api/skills/install", body: { id: "abc", owner: "scout", scripts: ["scripts/extract.py"], commands: ["bash", "pnpm add"], replace: true } });
  expect(refresh).not.toHaveBeenCalled();
  refuse = false;
  fireEvent.click(within(form).getByRole("button", { name: "Replace the installed skill" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.getByRole("status").textContent).toBe("Installed scout/pdf-tables (2 files), with 2 commands that run without asking.");
  expect(screen.queryByRole("form")).toBeNull();
});

test("a file that isn't a skill is turned away with the reason", async () => {
  answer = () => ({ status: 400, json: { error: "That isn't a .skill file (a .skill is a zip of a skill's folder)." } });
  render(<SkillImport S={S} refresh={() => {}} />);
  fireEvent.change(screen.getByLabelText("A .skill file"), { target: { files: [new File(["hello"], "notes.txt")] } });
  expect((await screen.findByRole("alert")).textContent).toMatch(/isn't a \.skill file/);
  expect(screen.queryByRole("form")).toBeNull();
});

// ---------- Writing back to Jira ----------
const jira = (jiraWrite: object) => ({ settings: { jiraWrite } }) as unknown as CampState;

test("writing back to Jira is off until you switch it on; the statuses are yours to name", async () => {
  answer = () => ({ json: { on: true, startStatus: "", prStatus: "" } });
  const refresh = vi.fn();
  const { rerender } = render(<JiraWriteBack S={jira({ on: false, startStatus: "", prStatus: "" })} refresh={refresh} />);
  const form = screen.getByRole("form", { name: "Writing back to Jira" });
  const sw = within(form).getByLabelText("Let the camp write to Jira") as HTMLInputElement;
  expect(sw.checked).toBe(false);
  expect(within(form).queryByLabelText("Status when work starts")).toBeNull();
  expect(within(form).getByText(/Off, nothing is ever written to Jira/)).toBeTruthy();
  fireEvent.click(sw);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(calls[0]).toEqual({ url: "/api/jira/write", body: { on: true, startStatus: "", reviewStatus: "", prStatus: "", doneStatus: "" } });
  rerender(<JiraWriteBack S={jira({ on: true, startStatus: "", prStatus: "" })} refresh={refresh} />);
  expect((within(form).getByRole("button", { name: "Keep these" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(form).getByLabelText("Status when work starts"), { target: { value: "In Progress" } });
  fireEvent.change(within(form).getByLabelText("Status when the pull request opens"), { target: { value: "In Review" } });
  fireEvent.change(within(form).getByLabelText("Status when the pull request is merged"), { target: { value: "Done" } });
  expect(within(form).getByLabelText("Status when the work is ready to look over")).toBeTruthy();
  fireEvent.click(within(form).getByRole("button", { name: "Keep these" }));
  await waitFor(() => expect(calls[1]).toEqual({ url: "/api/jira/write", body: { on: true, startStatus: "In Progress", reviewStatus: "", prStatus: "In Review", doneStatus: "Done" } }));
});

// ---------- Editing a skill ----------
const MD = "---\nname: pdf-tables\ndescription: Pull tables out of a PDF.\n---\n\n# PDF tables\n";
const DETAIL = { owner: "shared", name: "pdf-tables", commands: ["python3 skills/shared/pdf-tables/scripts/extract.py"],
  files: [{ path: "SKILL.md", size: MD.length, text: true }, { path: "assets/logo.png", size: 2048, text: false }, { path: "scripts/extract.py", size: 30, text: true }] };
const TEXTS: Record<string, string> = { "SKILL.md": MD, "scripts/extract.py": "print('hi')\n" };

test("editing a skill: its files open as text, a save goes to the camp, and a refusal is shown without losing what you typed", async () => {
  let refuse = true;
  answer = (url, body) => {
    const u = new URL(url, "http://camp");
    if (u.pathname === "/api/skills/files") return u.searchParams.get("path") ? { json: { path: u.searchParams.get("path"), text: TEXTS[u.searchParams.get("path")!] } } : { json: DETAIL };
    if (body?.create) return { json: { ...DETAIL, files: [...DETAIL.files, { path: body.path, size: 0, text: true }], saved: body.path, stillApproved: false } };
    return refuse ? { status: 400, json: { error: "SKILL.md needs its front matter." } } : { json: { ...DETAIL, saved: body.path, stillApproved: body.path !== "SKILL.md" } };
  };
  const onClose = vi.fn(), onSaved = vi.fn();
  render(<SkillEditor owner="shared" name="pdf-tables" onClose={onClose} onSaved={onSaved} />);
  const dialog = await screen.findByRole("dialog", { name: "Edit the skill shared/pdf-tables" });
  const box = await within(dialog).findByLabelText("The text of SKILL.md") as HTMLTextAreaElement;
  expect(box.value).toBe(MD);
  expect(calls.map((c) => c.url)).toEqual(["/api/skills/files?owner=shared&name=pdf-tables", "/api/skills/files?owner=shared&name=pdf-tables&path=SKILL.md"]);
  const files = within(within(dialog).getByRole("navigation", { name: "The skill's files" })).getAllByRole("button");
  expect(files.map((b) => b.textContent)).toEqual([`SKILL.md${MD.length} B`, "assets/logo.png2 KB", "scripts/extract.py30 B", "Add a file…"]);
  expect((files[1] as HTMLButtonElement).disabled).toBe(true); // not text: nothing to edit
  const save = within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true); // nothing changed yet

  fireEvent.change(box, { target: { value: "# No front matter" } });
  expect(within(dialog).getByText("changed, not saved")).toBeTruthy();
  fireEvent.click(save);
  expect((await within(dialog).findByRole("alert")).textContent).toBe("SKILL.md needs its front matter.");
  expect(box.value).toBe("# No front matter");
  expect(onSaved).not.toHaveBeenCalled();
  // Leaving with unsaved changes is asked about first.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("status").textContent).toMatch(/not saved it/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo changes" }));
  expect(box.value).toBe(MD);

  refuse = false;
  const better = MD + "\nCheck the totals too.\n";
  fireEvent.change(box, { target: { value: better } });
  fireEvent.keyDown(box, { key: "s", metaKey: true }); // ⌘S saves
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(calls.at(-1)).toEqual({ url: "/api/skills/save", body: { owner: "shared", name: "pdf-tables", path: "SKILL.md", text: better } });
  expect(within(dialog).getByRole("status").textContent).toBe("Saved. The crew reads it from their next run.");
  expect(within(dialog).getByText("saved")).toBeTruthy();

  // A script you let run without asking says so, and stays that way when you save it.
  fireEvent.click(files[2]);
  const script = await within(dialog).findByLabelText("The text of scripts/extract.py") as HTMLTextAreaElement;
  expect(script.value).toBe("print('hi')\n");
  expect(within(dialog).getByRole("status").textContent).toMatch(/You let this script run without asking/);
  fireEvent.change(script, { target: { value: "print('hello')\n" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Saved. It still runs without asking, as you've just written it."));

  // A new file is made empty, then opened to write in.
  fireEvent.click(within(dialog).getByRole("button", { name: "Add a file…" }));
  const name = within(dialog).getByLabelText("The new file's path");
  fireEvent.change(name, { target: { value: "references/notes.md" } });
  fireEvent.keyDown(name, { key: "Enter" });
  await waitFor(() => expect(calls.some((c) => c.body?.create)).toBe(true));
  expect(calls.find((c) => c.body?.create)!.body).toEqual({ owner: "shared", name: "pdf-tables", path: "references/notes.md", text: "", create: true });
  await within(dialog).findByRole("button", { name: /references\/notes\.md/ });
  // Nothing unsaved now: Escape closes.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
