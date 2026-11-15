// The + menu's fly-out panels: a row opens its panel beside the menu; the crew panel filters as
// you type and picks with Enter; resting on another row swaps or closes the panel.

import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AttachMenu, type MenuView } from "./AttachMenu.tsx";
import type { CampState, RepoInfo } from "../types.ts";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const S = {
  characters: [
    { id: "quartermaster", name: "Quartermaster", emoji: "🧭", role: "Plans" },
    { id: "scout", name: "Scout", emoji: "🏹", role: "Researches" },
    { id: "scribe", name: "Scribe", emoji: "🪶", role: "Writes" },
  ],
  links: [], snippets: [{ id: "s1", title: "Standup", text: "Summarize yesterday" }],
} as unknown as CampState;

const repo = { link: "web", branch: "main", access: "write", worktrees: [{ path: "/w/web/fix-nav", branch: "fix-nav" }] } as unknown as RepoInfo;

function show(repos: RepoInfo[] = []) {
  const onTalkTo = vi.fn();
  const onWork = vi.fn();
  const onInsertSnippet = vi.fn();
  const noop = () => {};
  function Harness() {
    const [view, setView] = useState<MenuView>("main");
    return <AttachMenu S={S} view={view} setView={setView} text="" repos={repos} work={{}} workLocked={false} onWork={onWork} onClose={noop} onTalkTo={onTalkTo} onPick={noop} onPaste={noop}
      onUrl={noop} onAttachLink={noop} onLinked={noop} onInsertSnippet={onInsertSnippet} onSnippets={noop} />;
  }
  render(<Harness />);
  return { onTalkTo, onInsertSnippet, onWork };
}

test("the crew flies out from its row, and Enter picks the lit one", () => {
  const { onTalkTo } = show();
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Crew" }));
  const search = screen.getByRole("combobox", { name: "Find a crew member" });
  expect(screen.getAllByRole("option").map((o) => o.querySelector(".fly-name")?.textContent)).toEqual(["Quartermaster", "Scout", "Scribe"]);
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onTalkTo).toHaveBeenCalledWith("scout");
});

test("typing narrows the crew, and the Quartermaster means no one in particular", () => {
  const { onTalkTo } = show();
  fireEvent.click(screen.getByRole("menuitem", { name: "Crew" }));
  const search = screen.getByRole("combobox", { name: "Find a crew member" });
  fireEvent.change(search, { target: { value: "scri" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "" } });
  fireEvent.click(screen.getAllByRole("option")[0]);
  expect(onTalkTo).toHaveBeenCalledWith(null);
});

test("URL, Link a folder and Prompt snippets each open their own panel", () => {
  const { onInsertSnippet } = show();
  fireEvent.click(screen.getByRole("menuitem", { name: "URL" }));
  expect(screen.getByRole("dialog", { name: "Attach a link" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Link a folder" }));
  expect(screen.queryByRole("dialog", { name: "Attach a link" })).toBeNull();
  expect(screen.getByRole("button", { name: "Choose folder…" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Prompt snippets" }));
  fireEvent.click(screen.getByText("Standup"));
  expect(onInsertSnippet).toHaveBeenCalledWith("Summarize yesterday");
});

test("resting on a plain row puts the panel away, but only after a moment", () => {
  vi.useFakeTimers();
  show();
  fireEvent.click(screen.getByRole("menuitem", { name: "Crew" }));
  fireEvent.mouseOver(screen.getByRole("menuitem", { name: "Files…" }));
  expect(screen.queryByRole("listbox")).toBeTruthy(); // a pointer just passing over doesn't close it
  act(() => { vi.advanceTimersByTime(200); });
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("the left arrow in a panel goes back to the menu", () => {
  show();
  fireEvent.click(screen.getByRole("menuitem", { name: "Crew" }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Find a crew member" }), { key: "ArrowLeft" });
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("the branch row shows where the next request works, and its panel changes it", () => {
  const { onWork } = show([repo]);
  const row = screen.getByRole("menuitem", { name: /Branch/ });
  expect(row.textContent).toContain("main");
  fireEvent.click(row);
  expect(screen.getAllByRole("radio").map((o) => o.textContent)).toEqual(["Your checkout", "New worktree"]);
  expect(screen.getByRole("radio", { name: "Your checkout" }).getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Your checkout" })); // the panel opens on the choice that's made
  fireEvent.click(screen.getByRole("button", { name: /^Existing worktree/ }));
  fireEvent.click(screen.getByRole("radio", { name: "fix-nav" }));
  expect(onWork).toHaveBeenCalledWith("web", "/w/web/fix-nav");
});

test("no linked repositories, no branch row", () => {
  show();
  expect(screen.queryByRole("menuitem", { name: /Branch/ })).toBeNull();
});
