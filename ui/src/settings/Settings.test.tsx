// The Settings page: moving between sections, the approval level, the allow-lists, and the
// limits that used to live on the Quests card.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { Settings, type SettingsSection } from "./Settings.tsx";
import { SETTINGS_SECTIONS } from "./sections.ts";
import { Header } from "../components/Header.tsx";
import { createFeedStore } from "../feed/store.ts";

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
    approval: "safe", allow: ["npm run build"], exact: ["npm test -- --watch=false"], deny: ["git push*"], askAlways: [], reviewer: false, allowHosts: [], defaultAllow: ["ls", "git status"],
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

test("the section names the page knows without loading Settings are the ones its nav lists", () => {
  const { setSection } = show("general");
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  for (const b of nav.querySelectorAll("button")) fireEvent.click(b);
  expect(setSection.mock.calls.map(([id]) => id).sort()).toEqual([...SETTINGS_SECTIONS].sort());
});

test("the nav moves between sections and Escape closes", () => {
  const { setSection, onClose } = show("general");
  expect(screen.getByText("What runs the crew")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Approvals/ }));
  expect(setSection).toHaveBeenCalledWith("approvals");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("General keeps runtime selection while Anthropic key management lives in Models", () => {
  show("general", { ...camp(), anthropic: { connected: true, saved: true, environment: false, from: "camp" } });
  expect(screen.getByRole("radiogroup", { name: "Runtime" })).toBeTruthy();
  expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull();
});

test("the approval level, the allow-list, and removing an always-allowed command", async () => {
  const { refresh } = show("approvals");
  expect((screen.getByRole("radio", { name: /Allow safe commands/ }) as HTMLInputElement).checked).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: /Ask every time/ })); });
  fireEvent.change(screen.getByLabelText("Allowed command prefixes"), { target: { value: "npm run build\npytest" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save allowed command prefixes" })); });
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

test("inbox entries can be marked as read, one at a time or all at once, and only unread ones count on the badge", async () => {
  const inbox = [
    { heading: "2026-11-16 08:00 · morning-brief", body: "Where things stand.", seen: false },
    { heading: "2026-11-15 09:00 · digest", body: "Two new pages.", seen: false },
    { heading: "2026-11-14 09:00 · digest", body: "Old news.", seen: true },
  ];
  const { refresh } = show("inbox", { ...camp(), inbox } as unknown as CampState);
  expect(screen.getByRole("button", { name: /Inbox/ }).textContent).toContain("2");
  expect(screen.getByText("2 unread")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "Mark as read" });
  expect(buttons).toHaveLength(2); // the read one has none
  await act(async () => { fireEvent.click(buttons[0]); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark all as read" })); });
  expect(posts).toEqual([
    { path: "/api/inbox/seen", body: { heading: "2026-11-16 08:00 · morning-brief" } },
    { path: "/api/inbox/seen", body: { all: true } },
  ]);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("today's cost can be taken out of the top bar's status menu, at once, and stays out in this browser", () => {
  localStorage.clear();
  const S = { ...camp(), spend: { today: 1.5 } } as unknown as CampState;
  render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} />);
  show("general", S);
  // The spend is in the menu under the status chip; a click elsewhere (on the setting) shuts it, so it's opened each time.
  const spend = () => { fireEvent.click(screen.getByRole("button", { name: /^Idle/ })); const there = screen.queryByText("$1.50 today"); fireEvent.click(screen.getByRole("button", { name: /^Idle/ })); return there; };
  expect(spend()).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: /Shown/ }));
  expect(spend()).toBeNull();
  expect(screen.getByRole("checkbox", { name: /Hidden/ })).toHaveProperty("checked", false);
  expect(localStorage.getItem("camp-show-cost")).toBe("0");

  fireEvent.click(screen.getByRole("checkbox", { name: /Hidden/ }));
  expect(spend()).toBeTruthy();
  localStorage.clear();
});

test("General has a Decorations row right under the colours: only for looks, kept in this browser, and nothing is sent to the camp", () => {
  localStorage.clear();
  show("general");
  const group = screen.getByRole("group", { name: "Decorations" });
  const row = group.closest(".set-row")!;
  expect(screen.getByRole("group", { name: "Colours" }).closest(".set-row")!.nextElementSibling).toBe(row);
  expect(row.textContent).toMatch(/Only for looks/);
  expect(row.textContent).toMatch(/Nothing the crew reads or writes changes/);
  expect(row.textContent).toMatch(/kept in this browser/);
  const pressed = () => Array.from(group.querySelectorAll("button")).map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`);
  expect(pressed()).toEqual(["Off:true", "Follow the calendar:false", "Winter:false", "Halloween:false", "New Year:false"]);
  expect(document.documentElement.dataset.season).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Winter" }));
  expect(pressed()).toEqual(["Off:false", "Follow the calendar:false", "Winter:true", "Halloween:false", "New Year:false"]);
  expect([document.documentElement.dataset.season, localStorage.getItem("camp-season")]).toEqual(["winter", "winter"]);
  expect(row.textContent).toMatch(/Snow, a string of lights/);
  // Following the calendar says what that means today.
  fireEvent.click(screen.getByRole("button", { name: "Follow the calendar" }));
  expect(localStorage.getItem("camp-season")).toBe("auto");
  expect(row.textContent).toMatch(/Today that's (Winter|Halloween|New Year)\.|Nothing is in season today\./);
  fireEvent.click(screen.getByRole("button", { name: "Off" }));
  expect([document.documentElement.dataset.season, localStorage.getItem("camp-season")]).toEqual([undefined, ""]);
  expect(posts).toEqual([]); // the camp is never told: it's this browser's own
  localStorage.clear();
});

test("General has a theme pack row above the colours: it says the crew is renamed for the crew too, and the camp keeps the choice", async () => {
  const { PACKS } = await import("../../../src/packs.ts");
  const { refresh } = show("general", { ...camp(), pack: "guild", packs: PACKS } as CampState);
  const group = screen.getByRole("group", { name: "Theme pack" });
  expect(group.compareDocumentPosition(screen.getByRole("group", { name: "Colours" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(group.closest(".set-row")?.textContent).toMatch(/and for the crew too/);
  expect((screen.getByRole("button", { name: /Guild/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  const starship = screen.getByRole("button", { name: /Starship/ });
  expect(starship.getAttribute("aria-pressed")).toBe("false");
  expect(starship.title).toMatch(/Commander, Navigator, Engineer, Comms Officer, Security Chief/);
  await act(async () => { fireEvent.click(starship); });
  expect(posts).toEqual([{ path: "/api/pack", body: { id: "starship" } }]);
  expect(refresh).toHaveBeenCalled();
  // The page wears it at once: the pack's attribute, and the colours it suggests (none were chosen).
  expect([document.documentElement.dataset.pack, document.documentElement.dataset.palette]).toEqual(["starship", "harbor"]);
  expect(screen.getByRole("button", { name: "Harbor" }).getAttribute("aria-pressed")).toBe("true");
  // The one that's on does nothing when clicked again.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Guild/ })); });
  expect(posts).toHaveLength(1);
  delete document.documentElement.dataset.pack; delete document.documentElement.dataset.palette; localStorage.clear();
});
