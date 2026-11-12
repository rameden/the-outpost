// Picking up a ticket step by step: each step comes filled in, anything can be changed, and
// nothing is sent until Start on the last one.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { AlwaysOn } from "../settings/Settings.tsx";
import { TicketWizard, kickoff } from "./TicketWizard.tsx";

const ISSUES = [{ key: "MP-544", summary: "Open button on file citations", type: "Story", status: "To Do" }, { key: "MP-601", summary: "Fix the nav on small screens", type: "Bug", status: "To Do" }];
const DETAIL = { key: "MP-544", summary: "Open button on file citations", type: "Story", status: "To Do", priority: "High", assignee: "Ryley", epic: null,
  description: "Add an **Open** button.", criteria: ["An Open button on web reports", "Closing returns to the chat"] };
const calls: { url: string; body?: any }[] = [];
let refuse = false;
beforeEach(() => {
  calls.length = 0; refuse = false;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const u = new URL(url, "http://camp");
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (u.pathname === "/api/jira/issues") return json({ issues: ISSUES.filter((i) => !u.searchParams.get("q") || i.summary.toLowerCase().includes(u.searchParams.get("q")!)) });
    if (u.pathname === "/api/jira/ticket") return json({ ...DETAIL, key: u.searchParams.get("key") });
    if (u.pathname === "/api/repos") return json({ repos: [{ link: "web", access: "write", branch: "main", worktrees: [], branches: [] }, { link: "docs", access: "read", branch: "main", worktrees: [], branches: [] }] });
    if (u.pathname === "/api/upload") return body.name === "huge.bin" ? json({ error: "That file couldn't be saved." }, 400) : json({ name: body.name, path: `camp/uploads/b7/${body.name}`, batch: "b7" });
    if (u.pathname === "/api/jira/attach") return json({ name: "MP-544.md", path: "camp/uploads/b1/MP-544.md", batch: "b1" });
    if (u.pathname === "/api/send") return refuse ? json({ error: "links/web isn't a git repository, so it can't have a worktree." }, 400) : json({ ok: true, id: "run1", thread: "run1", position: 0, attached: 1 });
    return json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const S = {
  characters: [{ id: "quartermaster", name: "Quartermaster", emoji: "🎒", role: "Plans" }, { id: "scout", name: "Scout", emoji: "🔭", role: "Researches." }, { id: "artificer", name: "Artificer", emoji: "🔧", role: "Builds." }],
  history: { projects: [{ id: "general", name: "General" }, { id: "p1", name: "Web app", links: ["web"] }, { id: "p2", name: "Docs", links: ["docs"], settings: { review: "on" } }], conversations: [] },
  settings: { reviewChanges: false, jiraWrite: { on: true, startStatus: "In Progress", prStatus: "" } },
} as unknown as CampState;
const next = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Next: ${name}` }));

test("Next, Next, Next, Start: every step is filled in, and what's sent is what the last step shows", async () => {
  const onStarted = vi.fn();
  render(<TicketWizard S={S} onClose={() => {}} onStarted={onStarted} />);
  const dialog = screen.getByRole("dialog", { name: "Start a ticket" });
  const steps = () => within(within(dialog).getByRole("list", { name: "Steps" })).getAllByRole("button") as HTMLButtonElement[];
  expect(steps().map((b) => b.textContent)).toEqual(["1Ticket", "2Details", "3Where", "4Who", "5Start"]);
  expect(steps().map((b) => b.disabled)).toEqual([false, true, true, true, true]); // not past where you've been

  // 1: the tickets your filter pulls in; picking one moves on.
  fireEvent.click(await within(dialog).findByRole("option", { name: /MP-544/ }));
  // 2: its acceptance criteria, ticked.
  await within(dialog).findByLabelText("Criterion 1");
  expect((within(dialog).getByLabelText("Criterion 2") as HTMLInputElement).value).toBe("Closing returns to the chat");
  expect(steps()[1].getAttribute("aria-current")).toBe("step");
  next("Where");
  // 3: the first project with a folder, in a new worktree named after the ticket.
  expect((within(dialog).getByLabelText("Project") as HTMLSelectElement).value).toBe("p1");
  await waitFor(() => expect((within(dialog).getByLabelText("Branch") as HTMLInputElement).placeholder).toBe("MP-544-open-button-on-file-citations"));
  next("Who");
  // 4: the Quartermaster, with review as the project and camp have it.
  expect((within(dialog).getByRole("radio", { name: /Quartermaster/ }) as HTMLInputElement).checked).toBe(true);
  expect(within(dialog).getByText(/Have the Warden review the changes before it reports \(off for this project\)/)).toBeTruthy();
  next("Start");
  // 5: what will happen, and the brief word for word.
  const summary = dialog.querySelector(".wizard-summary")!.textContent!;
  expect(summary).toContain("2 criteria");
  expect(summary).toContain("Web app · a new worktree on MP-544-open-button-on-file-citations");
  expect(summary).toContain("Quartermaster · no review before it reports");
  expect(summary).toContain("a comment says work has started, and the ticket moves to In Progress");
  const brief = (within(dialog).getByLabelText("The brief") as HTMLTextAreaElement).value;
  expect(brief).toContain("Work on MP-544: Open button on file citations");
  expect(brief).toContain("- [ ] An Open button on web reports\n- [ ] Closing returns to the chat");
  expect(calls.some((c) => c.url === "/api/send")).toBe(false); // nothing sent yet
  fireEvent.click(within(dialog).getByRole("button", { name: "Start the work" }));
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run1"));
  expect(calls.find((c) => c.url === "/api/jira/attach")!.body).toEqual({ key: "MP-544" });
  expect(calls.find((c) => c.url === "/api/send")!.body).toEqual({
    text: brief, attachments: [{ kind: "file", name: "MP-544.md", path: "camp/uploads/b1/MP-544.md" }], jira: "MP-544", project: "p1",
    workspaces: { web: { mode: "new", branch: "MP-544-open-button-on-file-citations" } },
  });
  expect(localStorage.getItem("camp-jira-project")).toBe("p1"); // where you started the last one
});

test("anything can be changed on the way: the criteria, the notes, where, who, and the brief itself", async () => {
  const onStarted = vi.fn();
  render(<TicketWizard S={S} start={{ key: "MP-544", summary: "Open button on file citations" }} onClose={() => {}} onStarted={onStarted} />);
  const dialog = screen.getByRole("dialog", { name: "Start a ticket" });
  // Opened on a ticket: it starts at its details.
  fireEvent.click(await within(dialog).findByLabelText("Include: Closing returns to the chat")); // untick one
  fireEvent.change(within(dialog).getByLabelText("Criterion 1"), { target: { value: "An Open button on every report" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add one" }));
  fireEvent.change(within(dialog).getByLabelText("Criterion 3"), { target: { value: "It works from the keyboard" } });
  fireEvent.change(within(dialog).getByLabelText("Anything else the crew should know"), { target: { value: "Leave the old nav alone." } });
  next("Where");
  // A project whose folder is read-only has no branch to make.
  fireEvent.change(within(dialog).getByLabelText("Project"), { target: { value: "p2" } });
  await waitFor(() => expect(within(dialog).queryByLabelText("Branch")).toBeNull());
  expect(within(dialog).getByText(/no git repository the crew may edit/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Project"), { target: { value: "p1" } });
  fireEvent.change(await within(dialog).findByLabelText("Branch"), { target: { value: "feat/open-button" } });
  next("Who");
  fireEvent.click(within(dialog).getByText(/Have the Warden review the changes before it reports/)); // ask for a review, this once
  next("Start");
  const box = within(dialog).getByLabelText("The brief") as HTMLTextAreaElement;
  expect(box.value).toContain("- [ ] An Open button on every report\n- [ ] It works from the keyboard\n\nAlso, from me:\nLeave the old nav alone.");
  expect(box.value).not.toContain("Closing returns to the chat");
  expect(dialog.querySelector(".wizard-summary")!.textContent).toContain("the Warden reviews the changes before it reports");
  // Your own words in the brief are kept, even if you go back and forward.
  fireEvent.change(box, { target: { value: `${box.value}\n\nPS: small commits, please.` } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  fireEvent.click(within(dialog).getByRole("radio", { name: /Artificer/ })); // straight to one crew member instead
  expect(within(dialog).getByText(/A review isn't part of a direct chat/)).toBeTruthy();
  next("Start");
  expect((within(dialog).getByLabelText("The brief") as HTMLTextAreaElement).value).toMatch(/PS: small commits, please\.$/);

  // The camp refuses: the reason is shown and the stepper stays, with everything as it was.
  refuse = true;
  fireEvent.click(within(dialog).getByRole("button", { name: "Start the work" }));
  expect((await within(dialog).findByRole("alert")).textContent).toMatch(/isn't a git repository/);
  expect(onStarted).not.toHaveBeenCalled();
  refuse = false;
  fireEvent.click(within(dialog).getByRole("button", { name: "Start the work" }));
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run1"));
  const sent = calls.filter((c) => c.url === "/api/send").at(-1)!.body;
  expect(sent.text).toMatch(/^@artificer Work on MP-544: /);
  expect(sent.workspaces).toEqual({ web: { mode: "new", branch: "feat/open-button" } });
  expect("review" in sent).toBe(false); // a review is the Quartermaster's to arrange
});

test("what's sent, from what was chosen", () => {
  const attachment = { name: "MP-1.md", path: "camp/uploads/b/MP-1.md" };
  const base = { key: "MP-1", brief: " Do it. ", project: "general", repos: [], branch: "MP-1-x", attachment };
  expect(kickoff({ ...base, who: "quartermaster", review: null })).toEqual({ text: "Do it.", attachments: [{ kind: "file", ...attachment }], jira: "MP-1" });
  expect(kickoff({ ...base, who: "quartermaster", review: true }).review).toBe(true);
  expect(kickoff({ ...base, who: "quartermaster", review: false }).review).toBe(false);
  expect(kickoff({ ...base, who: "scout", review: true })).toEqual({ text: "@scout Do it.", attachments: [{ kind: "file", ...attachment }], jira: "MP-1" });
  expect(kickoff({ ...base, who: "quartermaster", review: null, project: "p1", repos: ["web", "api"] }).workspaces).toEqual({ web: { mode: "new", branch: "MP-1-x" }, api: { mode: "new", branch: "MP-1-x" } });
});

test("searching narrows the tickets; a project that reviews by default says so", async () => {
  localStorage.setItem("camp-jira-project", "p2");
  render(<TicketWizard S={S} onClose={() => {}} onStarted={() => {}} />);
  const dialog = screen.getByRole("dialog", { name: "Start a ticket" });
  await within(dialog).findByRole("option", { name: /MP-601/ });
  fireEvent.change(within(dialog).getByLabelText("Find a ticket"), { target: { value: "nav" } });
  await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["MP-601Fix the nav on small screensBug · To Do"]));
  expect((within(dialog).getByRole("button", { name: "Next: Details" }) as HTMLButtonElement).disabled).toBe(true); // nothing picked yet
  fireEvent.click(within(dialog).getByRole("option", { name: /MP-601/ }));
  await within(dialog).findByLabelText("Criterion 1");
  next("Where");
  expect((within(dialog).getByLabelText("Project") as HTMLSelectElement).value).toBe("p2"); // the one you used last
  next("Who");
  expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(within(dialog).getByText(/\(on for this project\)/)).toBeTruthy();
});

test("a skill can be set always on for the crew members who can use it", async () => {
  const refresh = vi.fn();
  const skill = { owner: "shared", name: "plain-words", description: "d", path: "skills/shared/plain-words/SKILL.md", commands: [], alwaysFor: ["scout"] };
  const { rerender } = render(<AlwaysOn S={S} skill={skill} refresh={refresh} />);
  const group = screen.getByRole("group", { name: "Who always follows plain-words" });
  const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes.map((b) => b.checked)).toEqual([false, true, false]); // everyone can use a shared skill; the Scout always does
  fireEvent.click(boxes[2]);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(calls.at(-1)).toEqual({ url: "/api/skills/always", body: { owner: "shared", name: "plain-words", agents: ["scout", "artificer"] } });
  fireEvent.click(boxes[1]);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(calls.at(-1)!.body.agents).toEqual([]);
  // A crew member's own skill: only they are offered.
  rerender(<AlwaysOn S={S} skill={{ ...skill, owner: "scout", alwaysFor: [] }} refresh={refresh} />);
  expect(within(screen.getByRole("group", { name: "Who always follows plain-words" })).getAllByRole("checkbox").length).toBe(1);
});

test("extra context: files, images and links added on the details step go with the ticket, and the brief says to look at them", async () => {
  const onStarted = vi.fn();
  render(<TicketWizard S={S} start={{ key: "MP-544", summary: "Open button on file citations" }} onClose={() => {}} onStarted={onStarted} />);
  const dialog = screen.getByRole("dialog", { name: "Start a ticket" });
  await within(dialog).findByLabelText("Criterion 1");
  expect(within(dialog).getByRole("heading", { name: "Extra context" })).toBeTruthy();

  // A design and a spec, picked from disk: uploaded straight away, into one batch.
  const design = new File(["png"], "open-button.png", { type: "image/png" }), spec = new File(["# Spec"], "spec.md", { type: "text/markdown" });
  fireEvent.change(within(dialog).getByLabelText("Files to attach"), { target: { files: [design, spec] } });
  await waitFor(() => expect(calls.filter((c) => c.url === "/api/upload").map((c) => [c.body.name, c.body.batch])).toEqual([["open-button.png", undefined], ["spec.md", "b7"]]));
  const chips = () => [...within(dialog).getByLabelText("Attached for context").querySelectorAll(".chip-att")].map((c) => c.textContent!.replace("×", ""));
  await waitFor(() => expect(chips()).toEqual(["open-button.png", "spec.md"]));
  // A link: https:// is assumed; something that isn't a link is refused; the same one isn't added twice.
  const link = within(dialog).getByLabelText("A link to attach") as HTMLInputElement;
  fireEvent.change(link, { target: { value: "not a link" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
  expect(within(dialog).getByRole("alert").textContent).toBe("That doesn't look like a link.");
  fireEvent.change(link, { target: { value: "figma.com/file/abc/MP-544" } });
  fireEvent.keyDown(link, { key: "Enter" });
  expect(link.value).toBe("");
  expect(within(dialog).queryByRole("alert")).toBeNull();
  fireEvent.change(link, { target: { value: "https://figma.com/file/abc/MP-544" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
  expect(chips()).toEqual(["open-button.png", "spec.md", "figma.com/file/abc/MP-544"]);
  expect(within(dialog).getByRole("heading", { name: "Extra context" })).toBeTruthy(); // Enter in the link box didn't move on a step
  // One that fails says so and isn't sent; one you remove isn't either.
  fireEvent.change(within(dialog).getByLabelText("Files to attach"), { target: { files: [new File(["x"], "huge.bin")] } });
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("That file couldn't be saved."));
  expect(chips().at(-1)).toBe("huge.bin · failed");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove spec.md" }));

  next("Where"); next("Who"); next("Start");
  expect(dialog.querySelector(".wizard-summary")!.textContent).toContain("Also attachedopen-button.png, figma.com/file/abc/MP-544");
  const brief = (within(dialog).getByLabelText("The brief") as HTMLTextAreaElement).value;
  expect(brief).toContain("I've also attached these for context (designs, references): open-button.png, figma.com/file/abc/MP-544. Look at them before you plan, and say so if any of them disagree with the ticket.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Start the work" }));
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(calls.find((c) => c.url === "/api/jira/attach")!.body).toEqual({ key: "MP-544", batch: "b7" }); // the ticket joins the same batch
  expect(calls.find((c) => c.url === "/api/send")!.body.attachments).toEqual([
    { kind: "file", name: "MP-544.md", path: "camp/uploads/b1/MP-544.md" },
    { kind: "file", name: "open-button.png", path: "camp/uploads/b7/open-button.png" },
    { kind: "url", name: "figma.com/file/abc/MP-544", url: "https://figma.com/file/abc/MP-544" },
  ]);
});

test("dropping files on the details step, or pasting an image there, attaches them", async () => {
  render(<TicketWizard S={S} start={{ key: "MP-544", summary: "Open button on file citations" }} onClose={() => {}} onStarted={() => {}} />);
  const dialog = screen.getByRole("dialog", { name: "Start a ticket" });
  await within(dialog).findByLabelText("Criterion 1");
  const shot = new File(["png"], "screenshot.png", { type: "image/png" });
  fireEvent.drop(dialog, { dataTransfer: { files: [shot], types: ["Files"] } });
  await waitFor(() => expect(within(dialog).getByLabelText("Attached for context").textContent).toContain("screenshot.png"));
  fireEvent.paste(dialog, { clipboardData: { files: [new File(["png"], "pasted.png", { type: "image/png" })] } });
  await waitFor(() => expect(within(dialog).getByLabelText("Attached for context").textContent).toContain("pasted.png"));
  // One attached: the brief speaks of "this", not "these".
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove pasted.png" }));
  next("Where"); next("Who"); next("Start");
  expect((within(dialog).getByLabelText("The brief") as HTMLTextAreaElement).value).toContain("I've also attached this for context (designs, references): screenshot.png. Look at it before you plan, and say so if it disagrees with the ticket.");
});
