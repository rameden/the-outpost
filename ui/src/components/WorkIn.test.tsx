// The "where to work" choices: your checkout's branch is switched, or a new one made, in a box
// right under "Linked checkout"; a long list of worktrees doesn't push it out of reach; and
// what git says when it refuses is shown, not swallowed.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { RepoInfo } from "../types.ts";
import { WorkIn, WorkOptions, chosenWorkspaces, leftOut, outOnReply, outsideChoice, outsidePick, replyPick, usedIn, workingOn } from "./WorkIn.tsx";

afterEach(cleanup);
const wt = (branch: string) => ({ path: `/w/web-quests/${branch.replace("/", "-")}`, branch });
const repo = { link: "web", branch: "main", access: "write", worktrees: [wt("camp/fix-nav")], branches: ["main", "mp-544", "camp/fix-nav", "release", "mp-601"] } as unknown as RepoInfo;

function show(onBranch = vi.fn(async () => {}), r: RepoInfo = repo, locked = false) {
  const onPick = vi.fn();
  render(<WorkOptions repos={[r]} choice={{}} locked={locked} onPick={onPick} onBranch={onBranch} />);
  const box = screen.getByLabelText("Switch or create a branch in web") as HTMLInputElement;
  return { onBranch, onPick, box };
}
const branches = () => within(screen.getByRole("group", { name: "Branches of web" })).getAllByRole("button").map((b) => b.textContent);

test("the branch box sits right under Linked checkout, before the worktrees", () => {
  const { box } = show();
  const order = [...screen.getByRole("group", { name: "web" }).querySelectorAll(".work-opt-name, input")].map((el) => el.textContent || "(branch box)");
  expect(order).toEqual(["Linked checkout", "(branch box)", "New worktree", "camp/fix-nav"]);
  expect(box.placeholder).toContain("now main");
});

test("focus the box for the other branches (not the one you're on, nor one that's in a worktree); typing narrows them", () => {
  const { box } = show();
  expect(screen.queryByRole("group", { name: "Branches of web" })).toBeNull(); // out of the way until you go to it
  fireEvent.focus(box);
  expect(branches()).toEqual(["mp-544", "release", "mp-601"]);
  fireEvent.change(box, { target: { value: "mp" } });
  expect(branches()).toEqual(["Create mpA new branch from main", "mp-544", "mp-601"]);
  fireEvent.change(box, { target: { value: "mp-544" } });
  expect(branches()).toEqual(["mp-544"]); // it exists: nothing to create
});

test("pick a branch to switch to it; a name that isn't there makes the branch", async () => {
  const { onBranch, box } = show();
  fireEvent.focus(box);
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
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: "rel" } });
  fireEvent.click(screen.getByRole("button", { name: "release" }));
  expect((await screen.findByRole("alert")).textContent).toContain("would be overwritten by checkout: src/app.ts");
  expect(box.value).toBe("rel");
});

test("a repository with many worktrees lists the first few, and the rest on request", () => {
  const many = { ...repo, worktrees: ["a", "b", "c", "d", "e", "f"].map((n) => wt(`guild/q10${n}`)) } as unknown as RepoInfo;
  cleanup();
  render(<WorkOptions repos={[many]} choice={{ web: "/w/web-quests/guild-q10e" }} locked={false} onPick={() => {}} onBranch={async () => {}} />);
  const names = () => [...screen.getByRole("group", { name: "web" }).querySelectorAll(".work-opt-name.mono")].map((el) => el.textContent);
  expect(names()).toEqual(["guild/q10a", "guild/q10b", "guild/q10c", "guild/q10e"]); // the first three, and the one chosen
  fireEvent.click(screen.getByRole("button", { name: "Show 2 more worktrees" }));
  expect(names().length).toBe(6);
});

test("on a follow-up the worktree choice is fixed, but your checkout's branch can still be switched", () => {
  const { onBranch, box } = show(undefined, repo, true);
  expect(screen.getByText(/A follow-up keeps working where its conversation was\. You can still switch your checkout's branch\./)).toBeTruthy();
  expect((screen.getByRole("menuitemradio", { name: /New worktree/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(box.disabled).toBe(false);
  fireEvent.focus(box);
  fireEvent.click(screen.getByRole("button", { name: "release" }));
  expect(onBranch).toHaveBeenLastCalledWith("web", "release", false);
});

test("without a way to switch (a read of the choices only), the box isn't there", () => {
  render(<WorkOptions repos={[repo]} choice={{}} locked={false} onPick={() => {}} />);
  expect(screen.queryByLabelText("Switch or create a branch in web")).toBeNull();
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
  // In the menu it's still "New worktree", ticked, saying which branch.
  render(<WorkOptions repos={[r]} choice={{ web: "new:MP-544-open-button" }} locked={false} onPick={() => {}} />);
  const row = screen.getByRole("menuitemradio", { name: /New worktree/ });
  expect(row.getAttribute("aria-checked")).toBe("true");
  expect(within(row).getByText("On a new branch, MP-544-open-button")).toBeTruthy();
});

test("a project's folder can be left out of a conversation: nothing is sent for it but its name", () => {
  const r = { link: "web", access: "write", branch: "main", worktrees: [], branches: ["main"] } as RepoInfo;
  expect(leftOut({ web: "none", api: "new" })).toEqual(["web"]);
  expect(leftOut({ api: "new" })).toBeUndefined();
  expect(chosenWorkspaces({ web: "none", api: "new" })).toEqual({ api: { mode: "new" } }); // no worktree for a folder that's out
  expect(chosenWorkspaces({ web: "none" })).toBeUndefined();
  expect(workingOn(r, "none")).toBe("not used");

  // In a project the menu offers it, last; outside one there's nothing to leave out.
  const onPick = vi.fn();
  const { rerender } = render(<WorkOptions repos={[r]} choice={{}} locked={false} onPick={onPick} canLeaveOut />);
  const rows = screen.getAllByRole("menuitemradio");
  expect(rows.map((b) => b.querySelector(".work-opt-name")!.textContent)).toEqual(["Linked checkout", "New worktree", "Leave it out"]);
  expect(within(rows[2]).getByText("Don't use links/web here: the crew is given nothing from it")).toBeTruthy();
  fireEvent.click(rows[2]);
  expect(onPick).toHaveBeenCalledWith("web", "none");
  rerender(<WorkOptions repos={[r]} choice={{ web: "none" }} locked={false} onPick={onPick} canLeaveOut />);
  expect(screen.getAllByRole("menuitemradio").map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  rerender(<WorkOptions repos={[r]} choice={{}} locked={false} onPick={onPick} />);
  expect(screen.queryByRole("menuitemradio", { name: /Leave it out/ })).toBeNull();
  // A reply in a conversation that's without it: shown as it is. It can be brought in, but not put somewhere new.
  rerender(<WorkOptions repos={[r]} choice={{}} locked onPick={onPick} without={["web"]} />);
  const kept = screen.getByRole("menuitemradio", { name: /Leave it out/ }) as HTMLButtonElement;
  expect(kept.getAttribute("aria-checked")).toBe("true");
  expect((screen.getByRole("menuitemradio", { name: /New worktree/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("menuitemradio", { name: /Linked checkout/ }) as HTMLButtonElement).disabled).toBe(false);
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

test("with many worktrees, Leave it out sits above them; one switch leaves every folder out; a folder that isn't a repository can be left out too", () => {
  const wt = (n: number) => ({ path: `/code/web-camp/w${n}`, branch: `camp/w${n}`, head: "abc", main: false });
  const web = { link: "web", access: "write", branch: "main", worktrees: Array.from({ length: 20 }, (_, i) => wt(i)), branches: ["main"] } as RepoInfo;
  const api = { link: "api", access: "read", branch: "dev", worktrees: [], branches: ["dev"] } as RepoInfo;
  const onPick = vi.fn(), onPickAll = vi.fn();
  const { rerender } = render(<WorkOptions repos={[web, api]} plain={["notes"]} choice={{}} locked={false} onPick={onPick} onPickAll={onPickAll} canLeaveOut />);
  // The whole panel, top to bottom.
  const names = [...document.querySelectorAll(".work-opt, .hist-all")].map((b) => b.querySelector(".work-opt-name")?.textContent ?? b.textContent);
  expect(names).toEqual(["No folders for this conversation",
    "Linked checkout", "New worktree", "Leave it out", "camp/w0", "camp/w1", "camp/w2", "Show 17 more worktrees",
    "Linked checkout", "Leave it out", // read-only: no new worktree
    "Use it", "Leave it out"]);        // not a repository: nothing to branch
  const all = screen.getByRole("menuitemcheckbox", { name: /No folders for this conversation/ });
  expect(all.getAttribute("aria-checked")).toBe("false");
  expect(within(all).getByText(/Leave out all 3 of this project's folders/)).toBeTruthy();
  fireEvent.click(all);
  expect(onPickAll).toHaveBeenCalledWith("none");
  const notes = within(screen.getByRole("group", { name: "notes" }));
  expect(notes.getByRole("menuitemradio", { name: /Use it/ }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(notes.getByRole("menuitemradio", { name: /Leave it out/ }));
  expect(onPick).toHaveBeenCalledWith("notes", "none");

  // Everything left out: the switch is on, and clicking it brings them back.
  rerender(<WorkOptions repos={[web, api]} plain={["notes"]} choice={{ web: "none", api: "none", notes: "none" }} locked={false} onPick={onPick} onPickAll={onPickAll} canLeaveOut />);
  const on = screen.getByRole("menuitemcheckbox", { name: /No folders for this conversation/ });
  expect(on.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(on);
  expect(onPickAll).toHaveBeenLastCalledWith("");
  // Outside a project there's nothing to leave out: no switch, no plain folders.
  rerender(<WorkOptions repos={[web]} plain={["notes"]} choice={{}} locked={false} onPick={onPick} onPickAll={onPickAll} />);
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
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

test("outside a project every folder starts on Don't use it, first in its group; picking one brings it in", () => {
  const wt = (n: number) => ({ path: `/code/web-camp/w${n}`, branch: `camp/w${n}`, head: "abc", main: false });
  const web = { link: "web", access: "write", branch: "main", worktrees: [wt(1)], branches: ["main", "next"] } as RepoInfo;
  const api = { link: "api", access: "read", branch: "dev", worktrees: [], branches: ["dev"] } as RepoInfo;
  const every = ["web", "api", "notes"];
  const onPick = vi.fn(), onPickAll = vi.fn();
  const at = (picks: Record<string, string>, locked = false, without?: string[]) =>
    <WorkOptions repos={[web, api]} plain={["notes"]} choice={locked ? {} : outsideChoice(picks, every, [])} locked={locked} without={without} onPick={onPick} onPickAll={onPickAll} onBranch={async () => {}} canLeaveOut optIn />;
  const { rerender } = render(at({}));
  const rows = () => [...document.querySelectorAll(".work-opt, .work-branch input")].map((b) => (b.querySelector(".work-opt-name")?.textContent ?? "(branch box)") + (b.getAttribute("aria-checked") === "true" ? " ✓" : ""));
  expect(rows()).toEqual([
    "Don't use it ✓", "Linked checkout", "New worktree", "camp/w1", // no branch box for a folder that isn't in use
    "Don't use it ✓", "Linked checkout",
    "Don't use it ✓", "Use it"]);
  expect(screen.getByText("Outside a project, the crew is given only the folders you pick here or attach to the message.")).toBeTruthy();
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull(); // nothing in use: nothing to take out
  fireEvent.click(within(screen.getByRole("group", { name: "web" })).getByRole("menuitemradio", { name: /Linked checkout/ }));
  expect(onPick).toHaveBeenLastCalledWith("web", "");
  fireEvent.click(within(screen.getByRole("group", { name: "notes" })).getByRole("menuitemradio", { name: /Use it/ }));
  expect(onPick).toHaveBeenLastCalledWith("notes", "");

  // Two in use: each can be taken out again, and one switch takes out both.
  rerender(at({ web: "use", notes: "use" }));
  expect(rows()).toEqual([
    "No folders for this conversation",
    "Don't use it", "Linked checkout ✓", "(branch box)", "New worktree", "camp/w1",
    "Don't use it ✓", "Linked checkout",
    "Don't use it", "Use it ✓"]);
  const all = screen.getByRole("menuitemcheckbox", { name: /No folders for this conversation/ });
  expect(within(all).getByText("Take out the 2 in use: the crew is given nothing from them")).toBeTruthy();
  fireEvent.click(all);
  expect(onPickAll).toHaveBeenLastCalledWith("none");
  fireEvent.click(within(screen.getByRole("group", { name: "web" })).getByRole("menuitemradio", { name: /Don't use it/ }));
  expect(onPick).toHaveBeenLastCalledWith("web", "none");

  // A reply: what the conversation has is shown as it is. Where it works can't change; what it's given can.
  rerender(at({}, true, ["api", "notes"]));
  expect(rows()).toEqual([
    "Don't use it", "Linked checkout ✓", "(branch box)", "New worktree", "camp/w1",
    "Don't use it ✓", "Linked checkout",
    "Don't use it ✓", "Use it"]);
  expect(screen.getAllByRole("menuitemradio").filter((b) => (b as HTMLButtonElement).disabled).map((b) => b.querySelector(".work-opt-name")!.textContent)).toEqual(["New worktree", "camp/w1"]);
  expect(screen.getByText(/A folder can be taken out, or brought in, from this message on\./)).toBeTruthy();
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
  const rows = () => [...document.querySelectorAll(".work-opt")].map((b) => b.querySelector(".work-opt-name")!.textContent + (b.getAttribute("aria-checked") === "true" ? " ✓" : "") + ((b as HTMLButtonElement).disabled ? " (fixed)" : ""));
  expect(rows()).toEqual([
    "No folders for this conversation",
    "Linked checkout (fixed)", "New worktree (fixed)", "Leave it out", "camp/w1 (fixed)", "camp/w2 ✓", // where it's working is ticked; only out is on offer
    "Linked checkout ✓", "New worktree (fixed)", "Leave it out",
    "Use it", "Leave it out ✓"]);
  const group = (name: string) => within(screen.getByRole("group", { name }));
  expect(group("web").getByText("From this message on, the crew is given nothing from links/web")).toBeTruthy();
  fireEvent.click(group("web").getByRole("menuitemradio", { name: /Leave it out/ }));
  expect(onPick).toHaveBeenLastCalledWith("web", "none");
  fireEvent.click(group("notes").getByRole("menuitemradio", { name: /Use it/ }));
  expect(onPick).toHaveBeenLastCalledWith("notes", "");
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /No folders for this conversation/ }));
  expect(onPickAll).toHaveBeenLastCalledWith("none");

  // With those picked: web is out, notes is in, and each can be put back the way it was.
  rerender(at({ web: "none", notes: "use" }));
  expect(rows()).toEqual([
    "No folders for this conversation",
    "Linked checkout (fixed)", "New worktree (fixed)", "Leave it out ✓", "camp/w1 (fixed)", "camp/w2",
    "Linked checkout ✓", "New worktree (fixed)", "Leave it out",
    "Use it ✓", "Leave it out"]);
  fireEvent.click(group("web").getByRole("menuitemradio", { name: /camp\/w2/ }));
  expect(onPick).toHaveBeenLastCalledWith("web", "/code/web-camp/w2");
  // A repository that's out, but worked in a worktree before: bringing it in picks that worktree up again.
  cleanup();
  render(<WorkOptions repos={[web]} choice={{}} locked without={["web"]} working={{ web: "camp/w2" }} onPick={onPick} canLeaveOut />);
  expect(rows()).toEqual(["Linked checkout (fixed)", "New worktree (fixed)", "Leave it out ✓", "camp/w1 (fixed)", "camp/w2"]);
  cleanup();
  render(<WorkOptions repos={[web]} choice={{ web: "use" }} locked without={["web"]} working={{ web: "camp/w2" }} onPick={onPick} canLeaveOut />);
  expect(rows()).toEqual(["Linked checkout (fixed)", "New worktree (fixed)", "Leave it out", "camp/w1 (fixed)", "camp/w2 ✓"]);

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
