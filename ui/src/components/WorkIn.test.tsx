// The "where to work" panel: a card for each folder, with a switch for whether it's used and, for a
// git repository, where in it the crew works. Your checkout's branch is switched from behind its
// name; a long list of worktrees folds away; and what git says when it refuses is shown, not swallowed.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { RepoInfo } from "../types.ts";
import { WorkIn, WorkOptions, chosenWorkspaces, leftOut, outOnReply, outsideChoice, outsidePick, replyPick, usedIn, workingOn } from "./WorkIn.tsx";

afterEach(cleanup);
const wt = (branch: string) => ({ path: `/w/web-quests/${branch.replace("/", "-")}`, branch });
const repo = { link: "web", branch: "main", access: "write", worktrees: [wt("camp/fix-nav")], branches: ["main", "mp-544", "camp/fix-nav", "release", "mp-601"] } as unknown as RepoInfo;

// The panel, read as text: each card's name and switch, then its rows (the chosen one ticked), or the line it shows instead.
function panel() {
  return [...document.querySelectorAll(".work-card")].map((c) => {
    const sw = c.querySelector<HTMLInputElement>('[role="switch"]');
    const rows = [...c.querySelectorAll(".work-choices > .work-row > .work-pick, .work-more, .work-fixed, .work-card-note")].map((r) =>
      r.matches(".work-fixed") ? [...r.children].map((e) => e.textContent).join(" ")
        : r.matches(".work-card-note") ? r.textContent
        : r.querySelector(".work-pick-name")!.textContent + (r.getAttribute("aria-checked") === "true" || r.querySelector(".work-dot.on") ? " ✓" : ""));
    return [`${c.getAttribute("aria-label")}${sw ? (sw.checked ? " (on)" : " (off)") : ""}`, ...rows].join(" | ");
  });
}
const switchOf = (link: string) => screen.getByRole("switch", { name: `Use ${link}` });

function show(onBranch = vi.fn(async () => {}), r: RepoInfo = repo, locked = false) {
  const onPick = vi.fn();
  render(<WorkOptions repos={[r]} choice={{}} locked={locked} onPick={onPick} onBranch={onBranch} />);
  fireEvent.click(screen.getByRole("button", { name: `Switch the branch of your checkout of web (now ${r.branch})` }));
  const box = screen.getByLabelText("Switch or create a branch in web") as HTMLInputElement;
  return { onBranch, onPick, box };
}
const branches = () => within(screen.getByRole("group", { name: "Branches of web" })).getAllByRole("button").map((b) => b.textContent);

test("your checkout's branch is switched from behind its name, out of the way until you open it", () => {
  render(<WorkOptions repos={[repo]} choice={{}} locked={false} onPick={() => {}} onBranch={async () => {}} />);
  expect(panel()).toEqual(["web | Your checkout ✓ | New worktree | Existing worktree"]);
  expect(screen.queryByLabelText("Switch or create a branch in web")).toBeNull();
  const name = screen.getByRole("button", { name: "Switch the branch of your checkout of web (now main)" });
  fireEvent.click(name);
  expect(name.getAttribute("aria-expanded")).toBe("true");
  const box = screen.getByLabelText("Switch or create a branch in web");
  expect(document.activeElement).toBe(box);
  expect(branches()).toEqual(["mp-544", "release", "mp-601"]); // not the one you're on, nor one that's in a worktree
  expect(screen.getByText(/Switches your own checkout now/)).toBeTruthy();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.queryByLabelText("Switch or create a branch in web")).toBeNull();
});

test("typing in the branch box narrows the branches, and offers to make one that isn't there", () => {
  const { box } = show();
  fireEvent.change(box, { target: { value: "mp" } });
  expect(branches()).toEqual(["Create mpA new branch from main", "mp-544", "mp-601"]);
  fireEvent.change(box, { target: { value: "mp-544" } });
  expect(branches()).toEqual(["mp-544"]); // it exists: nothing to create
});

test("pick a branch to switch to it; a name that isn't there makes the branch", async () => {
  const { onBranch, box } = show();
  fireEvent.click(screen.getByRole("button", { name: "mp-544" }));
  expect(onBranch).toHaveBeenLastCalledWith("web", "mp-544", false);
  expect((await screen.findByRole("status")).textContent).toBe("Switched to mp-544.");

  fireEvent.change(box, { target: { value: "  mp-777-new  " } });
  fireEvent.click(screen.getByRole("button", { name: /^Create mp-777-new/ }));
  expect(onBranch).toHaveBeenLastCalledWith("web", "mp-777-new", true);
  await waitFor(() => expect(box.value).toBe(""));
  expect(screen.getByRole("status").textContent).toBe("Made mp-777-new and switched to it.");
});

test("Enter does what you typed: that branch if there is one, a new one if there isn't", async () => {
  const { onBranch, box } = show();
  fireEvent.change(box, { target: { value: "release" } });
  fireEvent.submit(box.closest("form")!);
  expect(onBranch).toHaveBeenLastCalledWith("web", "release", false);
  await waitFor(() => expect(box.disabled).toBe(false)); // it's busy until git has answered
  fireEvent.change(box, { target: { value: "mp" } }); // part of two names, the whole of none: it's a new branch
  fireEvent.submit(box.closest("form")!);
  expect(onBranch).toHaveBeenLastCalledWith("web", "mp", true);
  await waitFor(() => expect(box.disabled).toBe(false));
  const calls = onBranch.mock.calls.length;
  fireEvent.change(box, { target: { value: "camp/fix-nav" } }); // checked out in a worktree: can't be here too
  fireEvent.submit(box.closest("form")!);
  fireEvent.change(box, { target: { value: "main" } });         // where you already are
  fireEvent.submit(box.closest("form")!);
  expect(onBranch.mock.calls.length).toBe(calls);
  expect(screen.getByText("You're on that branch.")).toBeTruthy();
});

test("when git refuses, it says why, and what you typed stays", async () => {
  const { box } = show(vi.fn(async () => { throw new Error("Your local changes to the following files would be overwritten by checkout: src/app.ts"); }));
  fireEvent.change(box, { target: { value: "rel" } });
  fireEvent.click(screen.getByRole("button", { name: "release" }));
  expect((await screen.findByRole("alert")).textContent).toContain("would be overwritten by checkout: src/app.ts");
  expect(box.value).toBe("rel");
});

test("worktrees fold away under one row that names the one chosen; unfolded, they're listed whole and can be found by name", () => {
  const many = { ...repo, worktrees: ["a", "b", "c", "d", "e", "f"].map((n) => wt(`guild/q10${n}`)) } as unknown as RepoInfo;
  const onPick = vi.fn();
  render(<WorkOptions repos={[many]} choice={{ web: "/w/web-quests/guild-q10e" }} locked={false} onPick={onPick} onBranch={async () => {}} />);
  expect(panel()).toEqual(["web | Your checkout | New worktree | Existing worktree ✓"]);
  const more = screen.getByRole("button", { name: "Existing worktree: guild/q10e (6)" });
  expect(more.textContent).toContain("guild/q10e");
  expect(screen.queryByRole("radiogroup", { name: "Worktrees of web" })).toBeNull();
  fireEvent.click(more);
  const names = () => within(screen.getByRole("radiogroup", { name: "Worktrees of web" })).getAllByRole("radio").map((b) => b.textContent + (b.getAttribute("aria-checked") === "true" ? " ✓" : ""));
  expect(names()).toEqual(["guild/q10a", "guild/q10b", "guild/q10c", "guild/q10d", "guild/q10e ✓", "guild/q10f"]);
  fireEvent.change(screen.getByLabelText("Find a worktree of web"), { target: { value: "q10b" } });
  expect(names()).toEqual(["guild/q10b"]);
  fireEvent.click(screen.getByRole("radio", { name: "guild/q10b" }));
  expect(onPick).toHaveBeenLastCalledWith("web", "/w/web-quests/guild-q10b");
});

test("on a follow-up there are no choices it can't make: where it works is said once, and your checkout's branch can still be switched", () => {
  const { onBranch } = show(undefined, repo, true);
  expect(screen.getByText(/A follow-up stays where its conversation was working/)).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(panel()).toEqual(["web (on) | Your checkout main"]);
  fireEvent.click(screen.getByRole("button", { name: "release" }));
  expect(onBranch).toHaveBeenLastCalledWith("web", "release", false);
});

test("without a way to switch (a read of the choices only), the branch is just named", () => {
  render(<WorkOptions repos={[repo]} choice={{}} locked={false} onPick={() => {}} />);
  expect(screen.queryByRole("button", { name: /Switch the branch/ })).toBeNull();
  expect(screen.getByText("main")).toBeTruthy();
});

test("a new worktree can be given its branch's name (starting work from a ticket does)", () => {
  expect(chosenWorkspaces({ web: "new", api: "new:MP-544-open-button", docs: "/code/docs-camp/x" })).toEqual({
    web: { mode: "new" }, api: { mode: "new", branch: "MP-544-open-button" }, docs: { mode: "existing", path: "/code/docs-camp/x" },
  });
  expect(chosenWorkspaces({})).toBeUndefined();
  const r = { link: "web", access: "write", branch: "main", worktrees: [], branches: ["main"] } as RepoInfo;
  expect(workingOn(r, "new:MP-544-open-button")).toBe("MP-544-open-button");
  expect(workingOn(r, "new")).toBe("new branch");
  expect(workingOn(r, "")).toBe("main");
  // In the panel it's still "New worktree", chosen, saying which branch.
  render(<WorkOptions repos={[r]} choice={{ web: "new:MP-544-open-button" }} locked={false} onPick={() => {}} />);
  expect(panel()).toEqual(["web | Your checkout | New worktree ✓"]);
  expect(screen.getByText("MP-544-open-button")).toBeTruthy();
});

test("a project's folder can be switched off for a conversation, and back on where it was working", () => {
  const r = { link: "web", access: "write", branch: "main", worktrees: [], branches: ["main"] } as RepoInfo;
  expect(leftOut({ web: "none", api: "new" })).toEqual(["web"]);
  expect(leftOut({ api: "new" })).toBeUndefined();
  expect(chosenWorkspaces({ web: "none", api: "new" })).toEqual({ api: { mode: "new" } }); // no worktree for a folder that's out
  expect(chosenWorkspaces({ web: "none" })).toBeUndefined();
  expect(workingOn(r, "none")).toBe("not used");

  const onPick = vi.fn();
  const { rerender } = render(<WorkOptions repos={[r]} choice={{ web: "new" }} locked={false} onPick={onPick} canLeaveOut />);
  expect(panel()).toEqual(["web (on) | Your checkout | New worktree ✓"]);
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "none");
  rerender(<WorkOptions repos={[r]} choice={{ web: "none" }} locked={false} onPick={onPick} canLeaveOut />);
  expect(panel()).toEqual(["web (off) | Not used: the crew is given nothing from it."]);
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "new"); // back where it was
  // Outside a project's own folders, with nothing to leave out, there's no switch.
  rerender(<WorkOptions repos={[r]} choice={{}} locked={false} onPick={onPick} />);
  expect(screen.queryByRole("switch")).toBeNull();
  // A reply in a conversation that's without it: shown as it is, and it can be brought in.
  rerender(<WorkOptions repos={[r]} choice={{}} locked onPick={onPick} without={["web"]} />);
  expect(panel()).toEqual(["web (off) | Not part of this conversation. Turn it on to bring it in."]);
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "");
});

test("the label beside Send says when a folder isn't being used", () => {
  const r = { link: "web", access: "write", branch: "main", worktrees: [], branches: ["main"] } as RepoInfo;
  const { rerender } = render(<WorkIn repos={[r]} choice={{ web: "none" }} setChoice={() => {}} followUp={false} open={false} onOpen={() => {}} />);
  const label = screen.getByRole("button", { name: "Where to work in web: not used" });
  expect(label.className).toContain("left-out");
  expect(label.title).toMatch(/leaves links\/web out: the crew is given nothing from it/);
  rerender(<WorkIn repos={[r]} choice={{}} setChoice={() => {}} followUp open={false} onOpen={() => {}} without={["web"]} />);
  expect(screen.getByRole("button", { name: "Where to work in web: not used" }).title).toMatch(/This conversation is without links\/web: the crew sees nothing of it here\. Click to bring it in\./);
  rerender(<WorkIn repos={[r]} choice={{}} setChoice={() => {}} followUp={false} open={false} onOpen={() => {}} />);
  expect(screen.getByRole("button", { name: "Where to work in web: main" }).className).not.toContain("left-out");
});


test("many worktrees stay folded; one button leaves every folder out; a folder that isn't a repository can be switched off too", () => {
  const wt = (n: number) => ({ path: `/code/web-camp/w${n}`, branch: `camp/w${n}`, head: "abc", main: false });
  const web = { link: "web", access: "write", branch: "main", worktrees: Array.from({ length: 20 }, (_, i) => wt(i)), branches: ["main"] } as RepoInfo;
  const api = { link: "api", access: "read", branch: "dev", worktrees: [], branches: ["dev"] } as RepoInfo;
  const onPick = vi.fn(), onPickAll = vi.fn();
  const { rerender } = render(<WorkOptions repos={[web, api]} plain={["notes"]} choice={{}} locked={false} onPick={onPick} onPickAll={onPickAll} canLeaveOut />);
  expect(panel()).toEqual([
    "web (on) | Your checkout ✓ | New worktree | Existing worktree", // all 20 behind one row
    "api (on) | Your checkout ✓",                                    // read-only: no new worktree
    "notes (on) | Used as it is (not a git repository, so no branch to pick).",
  ]);
  expect(within(screen.getByRole("group", { name: "api" })).getByText("read-only")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use none" }));
  expect(onPickAll).toHaveBeenCalledWith("none");
  fireEvent.click(switchOf("notes"));
  expect(onPick).toHaveBeenCalledWith("notes", "none");

  // Everything left out: the button brings them back.
  rerender(<WorkOptions repos={[web, api]} plain={["notes"]} choice={{ web: "none", api: "none", notes: "none" }} locked={false} onPick={onPick} onPickAll={onPickAll} canLeaveOut />);
  fireEvent.click(screen.getByRole("button", { name: "Use all" }));
  expect(onPickAll).toHaveBeenLastCalledWith("");
  // Nothing to leave out: no button, no plain folders.
  rerender(<WorkOptions repos={[web]} plain={["notes"]} choice={{}} locked={false} onPick={onPick} onPickAll={onPickAll} />);
  expect(screen.queryByRole("button", { name: /^Use (none|all)$/ })).toBeNull();
  expect(screen.queryByRole("group", { name: "notes" })).toBeNull();
});

test("the label says when a folder that isn't a repository is left out, and a project with no repository still has a way into the panel", () => {
  const onOpen = vi.fn();
  const { rerender } = render(<WorkIn repos={[]} plain={["notes", "specs"]} choice={{}} setChoice={() => {}} followUp={false} open={false} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Which of this project's folders to use" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  rerender(<WorkIn repos={[]} plain={["notes", "specs"]} choice={{ notes: "none" }} setChoice={() => {}} followUp={false} open={false} onOpen={onOpen} />);
  expect(screen.getByRole("button", { name: "Folder notes: not used" }).className).toContain("left-out");
  expect(screen.queryByRole("button", { name: "Folder specs: not used" })).toBeNull();
  rerender(<WorkIn repos={[]} plain={["notes"]} choice={{}} setChoice={() => {}} followUp open={false} onOpen={onOpen} without={["notes"]} />);
  expect(screen.getByRole("button", { name: "Folder notes: not used" }).title).toMatch(/This conversation is without links\/notes/);
  // No project, no repository: nothing to show.
  rerender(<WorkIn repos={[]} choice={{}} setChoice={() => {}} followUp={false} open={false} onOpen={onOpen} />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("outside a project nothing is used until it's picked: what's kept, what's sent, and what the picker is shown", () => {
  // A pick there: the linked checkout is asked for by name, and "don't use it" is no pick at all.
  expect([outsidePick(""), outsidePick("none"), outsidePick("new"), outsidePick("/code/web-camp/w1")]).toEqual(["use", "", "new", "/code/web-camp/w1"]);
  // What goes with the message: the folders to use as they are, apart from the ones that get a worktree.
  const picks = { web: "use", api: "new", notes: "use" };
  expect(usedIn(picks)).toEqual(["web", "notes"]);
  expect(chosenWorkspaces(picks)).toEqual({ api: { mode: "new" } });
  expect(leftOut(picks)).toBeUndefined();
  expect(usedIn({ api: "new" })).toBeUndefined();
  // What the picker shows: everything else is "not used", and a folder attached to the message counts as used.
  expect(outsideChoice(picks, ["web", "api", "docs", "notes", "specs"], [])).toEqual({ api: "new", docs: "none", specs: "none" });
  expect(outsideChoice({}, ["web", "docs"], ["docs"])).toEqual({ web: "none" });
  expect(outsideChoice({}, ["web", "docs"], [])).toEqual({ web: "none", docs: "none" });
});

test("outside a project the label is 'No folder' until one is picked, then only the folders in use", () => {
  const web = { link: "web", access: "write", branch: "main", worktrees: [], branches: ["main"] } as RepoInfo;
  const api = { link: "api", access: "write", branch: "dev", worktrees: [], branches: ["dev"] } as RepoInfo;
  const onOpen = vi.fn();
  const at = (choice: Record<string, string>, more: Partial<Parameters<typeof WorkIn>[0]> = {}) =>
    <WorkIn repos={[web, api]} plain={["notes"]} choice={choice} setChoice={() => {}} followUp={false} open={false} onOpen={onOpen} optIn {...more} />;
  const labels = () => screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
  const { rerender } = render(at(outsideChoice({}, ["web", "api", "notes"], [])));
  expect(labels()).toEqual(["Which folders to use: none"]);
  expect(screen.getByRole("button").textContent).toBe("No folder");
  expect(screen.getByRole("button").title).toMatch(/Outside a project the crew is given no linked folder unless you pick one/);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledTimes(1);
  // One picked: it alone is shown, with its branch. A folder that isn't a repository shows by name.
  rerender(at(outsideChoice({ web: "use" }, ["web", "api", "notes"], [])));
  expect(labels()).toEqual(["Where to work in web: main"]);
  rerender(at(outsideChoice({ api: "new:fix-it", notes: "use" }, ["web", "api", "notes"], [])));
  expect(labels()).toEqual(["Folder notes: used", "Where to work in api: fix-it"]);
  // Attached to the message instead: the same.
  rerender(at(outsideChoice({}, ["web", "api", "notes"], ["api"])));
  expect(labels()).toEqual(["Where to work in api: dev"]);
  // A reply: what its conversation has, and nothing else. With nothing, it says so.
  rerender(at({}, { followUp: true, without: ["web", "notes"], working: { api: "camp/fix" } }));
  expect(labels()).toEqual(["Where to work in api: camp/fix"]);
  rerender(at({}, { followUp: true, without: ["web", "api", "notes"] }));
  expect(labels()).toEqual(["Which folders to use: none"]);
  expect(screen.getByRole("button").title).toMatch(/This conversation has no linked folder\. Click to bring one in\./);
});

test("outside a project every folder starts switched off; switching one on uses your checkout", () => {
  const wt = (n: number) => ({ path: `/code/web-camp/w${n}`, branch: `camp/w${n}`, head: "abc", main: false });
  const web = { link: "web", access: "write", branch: "main", worktrees: [wt(1)], branches: ["main", "next"] } as RepoInfo;
  const api = { link: "api", access: "read", branch: "dev", worktrees: [], branches: ["dev"] } as RepoInfo;
  const every = ["web", "api", "notes"];
  const onPick = vi.fn(), onPickAll = vi.fn();
  const at = (picks: Record<string, string>, locked = false, without?: string[]) =>
    <WorkOptions repos={[web, api]} plain={["notes"]} choice={locked ? {} : outsideChoice(picks, every, [])} locked={locked} without={without} onPick={onPick} onPickAll={onPickAll} onBranch={async () => {}} canLeaveOut optIn />;
  const { rerender } = render(at({}));
  expect(panel()).toEqual(["web (off)", "api (off)", "notes (off)"]); // off says it all: no line repeated under each
  expect(screen.getByText("Outside a project, the crew is given only the folders you turn on here or attach to the message.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use none" })).toBeNull(); // nothing in use: nothing to take out
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "");
  fireEvent.click(switchOf("notes"));
  expect(onPick).toHaveBeenLastCalledWith("notes", "");

  // Two in use: each can be switched off again, and one button takes out both.
  rerender(at({ web: "use", notes: "use" }));
  expect(panel()).toEqual([
    "web (on) | Your checkout ✓ | New worktree | Existing worktree",
    "api (off)",
    "notes (on) | Used as it is (not a git repository, so no branch to pick)."]);
  const all = screen.getByRole("button", { name: "Use none" });
  expect(all.title).toBe("Take out the 2 in use: the crew is given nothing from them");
  fireEvent.click(all);
  expect(onPickAll).toHaveBeenLastCalledWith("none");
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "none");

  // A reply: what the conversation has is shown as it is. Where it works can't change; what it's given can.
  rerender(at({}, true, ["api", "notes"]));
  expect(panel()).toEqual(["web (on) | Your checkout main", "api (off)", "notes (off)"]);
  expect(screen.getByText(/You can still take a folder out, or bring one back\./)).toBeTruthy();
});

test("on a reply a folder can be taken out of the conversation, or brought in, and the pick can be taken back", () => {
  // What a click keeps, given whether the conversation is without the folder as things stand.
  expect(replyPick("none", false)).toBe("none");               // in, and taken out
  expect(replyPick("", false)).toBe("");                       // …and put back: no pick
  expect(replyPick("/code/web-camp/w1", false)).toBe("");      // (its worktree's own row puts it back too)
  expect(replyPick("", true)).toBe("use");                     // out, and brought in
  expect(replyPick("none", true)).toBe("");                    // …and left out again: no pick
  expect(outOnReply({}, ["web"], "web")).toBe(true);
  expect(outOnReply({ web: "use" }, ["web"], "web")).toBe(false);
  expect(outOnReply({ api: "none" }, ["web"], "api")).toBe(true);
  expect(outOnReply({}, ["web"], "api")).toBe(false);
  // What goes with the reply.
  expect([leftOut({ api: "none", web: "use" }), usedIn({ api: "none", web: "use" })]).toEqual([["api"], ["web"]]);
  expect(chosenWorkspaces({ api: "none", web: "use" })).toBeUndefined(); // never a new place to work

  const wt = (n: number) => ({ path: `/code/web-camp/w${n}`, branch: `camp/w${n}`, head: "abc", main: false });
  const web = { link: "web", access: "write", branch: "main", worktrees: [wt(1), wt(2)], branches: ["main"] } as RepoInfo;
  const api = { link: "api", access: "write", branch: "dev", worktrees: [], branches: ["dev"] } as RepoInfo;
  const onPick = vi.fn(), onPickAll = vi.fn();
  // A project's conversation, working in web's worktree camp/w2 and in api's linked checkout; it was started without notes.
  const at = (choice: Record<string, string>) =>
    <WorkOptions repos={[web, api]} plain={["notes"]} choice={choice} locked without={["notes"]} working={{ web: "camp/w2" }} onPick={onPick} onPickAll={onPickAll} canLeaveOut />;
  const { rerender } = render(at({}));
  expect(panel()).toEqual([
    "web (on) | Its own worktree camp/w2", // where it's working, said once: only out is on offer
    "api (on) | Your checkout dev",
    "notes (off) | Not part of this conversation. Turn it on to bring it in."]);
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "none");
  fireEvent.click(switchOf("notes"));
  expect(onPick).toHaveBeenLastCalledWith("notes", "");
  fireEvent.click(screen.getByRole("button", { name: "Use none" }));
  expect(onPickAll).toHaveBeenLastCalledWith("none");

  // With those picked: web is out, notes is in, and each can be put back the way it was.
  rerender(at({ web: "none", notes: "use" }));
  expect(panel()).toEqual([
    "web (off) | Taken out from this message on: the crew is given nothing from it.",
    "api (on) | Your checkout dev",
    "notes (on) | Used as it is (not a git repository, so no branch to pick)."]);
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "/code/web-camp/w2");
  // A repository that's out, but worked in a worktree before: bringing it in picks that worktree up again.
  cleanup();
  render(<WorkOptions repos={[web]} choice={{}} locked without={["web"]} working={{ web: "camp/w2" }} onPick={onPick} canLeaveOut />);
  expect(panel()).toEqual(["web (off) | Not part of this conversation. Turn it on to bring it in."]);
  fireEvent.click(switchOf("web"));
  expect(onPick).toHaveBeenLastCalledWith("web", "/code/web-camp/w2");
  cleanup();
  render(<WorkOptions repos={[web]} choice={{ web: "use" }} locked without={["web"]} working={{ web: "camp/w2" }} onPick={onPick} canLeaveOut />);
  expect(panel()).toEqual(["web (on) | Its own worktree camp/w2"]);

  // Beside Send: what the reply will leave the conversation with.
  cleanup();
  const label = (choice: Record<string, string>) => {
    cleanup();
    render(<WorkIn repos={[web, api]} plain={["notes"]} choice={choice} setChoice={() => {}} followUp open={false} onOpen={() => {}} without={["notes"]} working={{ web: "camp/w2" }} />);
    return screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
  };
  expect(label({})).toEqual(["Folder notes: not used", "Where to work in web: camp/w2", "Where to work in api: dev"]);
  expect(label({ web: "none", notes: "use" })).toEqual(["Where to work in web: not used", "Where to work in api: dev"]);
  expect(screen.getByRole("button", { name: "Where to work in web: not used" }).title).toMatch(/From this message on, links\/web is out of this conversation/);
});
