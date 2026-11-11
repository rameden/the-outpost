// The "where to work" choices: your checkout's branch is switched, or a new one made, in a box
// right under "Linked checkout"; a long list of worktrees doesn't push it out of reach; and
// what git says when it refuses is shown, not swallowed.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { RepoInfo } from "../types.ts";
import { WorkOptions, chosenWorkspaces, workingOn } from "./WorkIn.tsx";

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
