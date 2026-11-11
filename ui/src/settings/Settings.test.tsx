// The Settings page: moving between sections, the approval level, the allow-lists, and the
// limits that used to live on the Quests card.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { Settings, type SettingsSection } from "./Settings.tsx";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, models: [], live: false }), { status: 200 });
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const camp = (over: Partial<CampState["settings"]> = {}) => ({
  characters: [], skills: [], installedSkills: [], wiki: [], connectors: [], links: [], inbox: [],
  parallel: 3, budgetUsd: null, runtime: "api", login: null, sandbox: { on: false, available: true },
  settings: {
    approval: "safe", allow: ["npm run build"], exact: ["npm test -- --watch=false"], defaultAllow: ["ls", "git status"],
    questsAtOnce: 4, questsMax: 16, parallelMax: 8, selfEdit: false,
    phone: { topic: "", server: "", approve: null, on: false }, runtimeLocked: null, ...over,
  },
}) as unknown as CampState;

function show(section: SettingsSection, S = camp()) {
  const refresh = vi.fn();
  const setSection = vi.fn();
  const onClose = vi.fn();
  render(<Settings S={S} section={section} setSection={setSection} refresh={refresh} onAttachLink={() => {}} onClose={onClose} />);
  return { refresh, setSection, onClose };
}

test("the nav moves between sections and Escape closes", () => {
  const { setSection, onClose } = show("general");
  expect(screen.getByText("What runs the crew")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Approvals/ }));
  expect(setSection).toHaveBeenCalledWith("approvals");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("the approval level, the allow-list, and removing an always-allowed command", async () => {
  const { refresh } = show("approvals");
  expect((screen.getByRole("radio", { name: /Allow safe commands/ }) as HTMLInputElement).checked).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: /Ask every time/ })); });
  fireEvent.change(screen.getByLabelText("Allowed command prefixes"), { target: { value: "npm run build\npytest" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
  expect(posts).toEqual([
    { path: "/api/approvals", body: { level: "ask" } },
    { path: "/api/shell", body: { allow: ["npm run build", "pytest"] } },
    { path: "/api/shell", body: { exact: [] } },
  ]);
  expect(refresh).toHaveBeenCalledTimes(3);
});

test("the sandbox level is off where the sandbox isn't available", () => {
  const S = { ...camp(), sandbox: { on: false, available: false } } as CampState;
  show("approvals", S);
  expect((screen.getByRole("radio", { name: /Sandbox the rest/ }) as HTMLInputElement).disabled).toBe(true);
});

test("limits: budget, expeditions at once, and quests at once", async () => {
  const { container } = render(<Settings S={camp()} section="limits" setSection={() => {}} refresh={() => {}} onAttachLink={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Budget per expedition"), { target: { value: "2.5" } });
  await act(async () => { fireEvent.submit(container.querySelector(".inline-form")!); });
  await act(async () => { fireEvent.change(screen.getByLabelText("Expeditions at once"), { target: { value: "5" } }); });
  await act(async () => { fireEvent.change(screen.getByLabelText("Quests at once"), { target: { value: "6" } }); });
  expect(posts).toEqual([
    { path: "/api/budget", body: { usd: 2.5 } },
    { path: "/api/parallel", body: { parallel: 5 } },
    { path: "/api/quests-at-once", body: { n: 6 } },
  ]);
});

test("it's a modal over the camp: clicking outside closes it, clicking or dragging inside doesn't", () => {
  const { onClose } = show("general");
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  const backdrop = dialog.parentElement!;
  expect(backdrop.className).toBe("settings-backdrop");

  fireEvent.mouseDown(dialog); fireEvent.click(dialog);
  expect(onClose).not.toHaveBeenCalled();
  // A text selection that starts in a field and ends outside isn't a click outside.
  fireEvent.mouseDown(screen.getByText("What runs the crew")); fireEvent.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.mouseDown(backdrop); fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the camp's records that used to be in the side panel are sections here", () => {
  const { setSection } = show("usage", { ...camp(), quests: [], spend: { today: 0, week: 0, total: 0 }, limits: [], inbox: [{ heading: "2026-11-10 · Digest", body: "Hi" }] } as unknown as CampState);
  expect(screen.getByText("No budget · up to 3 at once")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Change limits" }));
  expect(setSection).toHaveBeenCalledWith("limits");
  for (const name of ["Scheduled jobs", "Memory", "Skills", "Connectors"]) expect(screen.getByRole("button", { name: new RegExp(name) })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Wiki/ })).toBeNull(); // the wiki has a page of its own now, in the sidebar
  expect(screen.getByRole("button", { name: /Inbox/ }).textContent).toContain("1");
});
