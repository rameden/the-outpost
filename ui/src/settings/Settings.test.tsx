// The Settings page: moving between sections, the approval level, the allow-lists, and the
// limits that used to live on the Quests card.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { Settings, type SettingsSection } from "./Settings.tsx";
import { SETTINGS_SECTIONS } from "./sections.ts";
import { Header } from "../components/Header.tsx";
import { createFeedStore } from "../feed/store.ts";
import { hear } from "../bus.ts";
import { Opener, expectTabWraps } from "../components/modalkit.tsx";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, models: [], live: false }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const camp = (over: Partial<CampState["settings"]> = {}) => ({
  characters: [], skills: [], installedSkills: [], wiki: [], connectors: [], links: [], inbox: [],
  parallel: 3, budgetUsd: null, runtime: "api", login: null, sandbox: { on: false, available: true },
  settings: {
    approval: "safe", allow: ["npm run build"], exact: ["npm test -- --watch=false"], deny: ["git push*"], askAlways: [], reviewer: false, allowHosts: [], defaultAllow: ["ls", "git status"],
    questsAtOnce: 4, questsMax: 16, parallelMax: 8, selfEdit: false,
    phone: { topic: "", server: "", approve: null, on: false }, runtimeLocked: null, outpost: "Home", ...over,
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

test("god mode is a level of its own, there with or without a sandbox", async () => {
  const S = { ...camp(), sandbox: { on: false, available: false } } as CampState;
  show("approvals", S);
  const god = screen.getByRole("radio", { name: /God mode/ }) as HTMLInputElement;
  expect(god.disabled).toBe(false);
  await act(async () => { fireEvent.click(god); });
  expect(posts).toEqual([{ path: "/api/approvals", body: { level: "god" } }]);
});

test("from another machine: what would loosen approvals says it's changed on the camp's own machine; stricter still saves", async () => {
  const S = { ...camp({ deny: ["git push*"], allow: ["npm run build"], exact: [] }), here: false } as CampState;
  show("approvals", S);
  expect(screen.getByText(/You're on another machine/)).toBeTruthy();
  // The level goes down, not up.
  expect((screen.getByRole("radio", { name: /Ask every time/ }) as HTMLInputElement).disabled).toBe(false);
  for (const up of [/Sandbox the rest/, /God mode/]) expect((screen.getByRole("radio", { name: up }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getAllByText("Raised only on the camp's own machine.").length).toBe(2);
  // The reviewer and editing the camp's own code are off, and can't be turned on from here.
  const switches = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(switches.filter((b) => b.disabled).length).toBe(2);
  expect(screen.getAllByText("Turned on only on the camp's own machine.").length).toBe(2);
  // A new allowed prefix isn't saved from here, and says why; taking one out is.
  const allow = screen.getByLabelText("Allowed command prefixes");
  const saveAllow = screen.getByRole("button", { name: "Save allowed command prefixes" }) as HTMLButtonElement;
  fireEvent.change(allow, { target: { value: "npm run build\npytest" } });
  expect(saveAllow.disabled).toBe(true);
  expect(screen.getByText(/Lines are added only on the camp's own machine/)).toBeTruthy();
  fireEvent.change(allow, { target: { value: "" } });
  expect(saveAllow.disabled).toBe(false);
  await act(async () => { fireEvent.click(saveAllow); });
  // "Never run" the other way round: a line more is saved, a line gone isn't.
  const deny = screen.getByLabelText("Commands that never run");
  const saveDeny = screen.getByRole("button", { name: "Save commands that never run" }) as HTMLButtonElement;
  fireEvent.change(deny, { target: { value: "" } });
  expect(saveDeny.disabled).toBe(true);
  expect(screen.getByText(/Lines are changed or taken out only on the camp's own machine/)).toBeTruthy();
  fireEvent.change(deny, { target: { value: "git push*\nrm -rf *" } });
  await act(async () => { fireEvent.click(saveDeny); });
  expect(posts).toEqual([{ path: "/api/shell", body: { allow: [""] } }, { path: "/api/shell", body: { deny: ["git push*", "rm -rf *"] } }]);
});

test("on the camp's own machine nothing on Approvals is held back", () => {
  show("approvals", { ...camp(), here: true } as CampState);
  expect(screen.queryByText(/You're on another machine/)).toBeNull();
  expect((screen.getByRole("radio", { name: /God mode/ }) as HTMLInputElement).disabled).toBe(false);
  expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).some((b) => b.disabled)).toBe(false);
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

test("what moved to the Activity page, and the wiki's page, aren't sections here; Memory, Skills and Connectors still are", () => {
  show("limits");
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  for (const name of ["Memory", "Skills", "Connectors", "Limits & budget"]) expect(within(nav).getByRole("button", { name: new RegExp(name) })).toBeTruthy();
  for (const name of [/^Wiki/, /Scheduled jobs/, /^Inbox/, /^Stats/, /Usage/, /unasked/i]) expect(within(nav).queryByRole("button", { name })).toBeNull();
});

test("Automatic work is a section under Camp, and the nav carries no counts: what's waiting is counted in the Inbox", () => {
  const waiting = { ...camp(), skills: [{ owner: "scribe", name: "release-notes", description: "", body: "" }], memoryProposals: [{ id: "m1" }], inbox: [{ heading: "h", body: "b", seen: false }] } as unknown as CampState;
  const { setSection } = show("general", waiting);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  const group = [...nav.querySelectorAll(".set-group-title")].find((t) => t.textContent === "Camp")!.parentElement!;
  expect(within(group).getByRole("button", { name: "Automatic work" })).toBeTruthy();
  fireEvent.click(within(nav).getByRole("button", { name: "Automatic work" }));
  expect(setSection).toHaveBeenLastCalledWith("automatic");
  expect((within(nav).getByRole("button", { name: /Skills/ }).textContent ?? "").trim()).toBe("Skills");
  expect((within(nav).getByRole("button", { name: /Memory/ }).textContent ?? "").trim()).toBe("Memory");
  expect(nav.querySelector(".count")).toBeNull();
});

test("Automatic work holds the switches; its links to what was proposed lead to the Inbox, and the one to scheduled jobs to that tab", async () => {
  const home = { name: "Ryley", today: "2026-11-13", brief: null, days: [], board: { weeks: [] }, offers: [], held: [],
    retros: [{ project: "p1", name: "web", week: "2026-11-09", label: "Nov 9 to Nov 15, 2026", written: "", requests: 12, heard: 4, proposed: ["Sign every commit."], skill: "scribe/release-notes" }],
    drive: { brief: true, briefAt: "08:00", retro: false, debrief: false }, pulls: { count: 0 } };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(String(path).startsWith("/api/home") ? home : { ok: true }), { status: 200 });
  }));
  const S = { ...camp(), history: { projects: [], conversations: [] }, triggers: [] } as unknown as CampState;
  const onOpenActivity = vi.fn();
  render(<Settings S={S} section="automatic" setSection={() => {}} refresh={() => {}} onAttachLink={() => {}} onClose={() => {}} onOpenActivity={onOpenActivity} />);
  const brief = (await screen.findByText("Morning brief")).closest(".set-row") as HTMLElement;
  await act(async () => { fireEvent.click(within(brief).getByRole("checkbox")); });
  expect(posts).toContainEqual({ path: "/api/drive", body: { brief: false } });
  fireEvent.click(screen.getByRole("button", { name: "Look them over" }));
  expect(onOpenActivity).toHaveBeenLastCalledWith("inbox");
  fireEvent.click(screen.getByRole("button", { name: "Review the draft" }));
  expect(onOpenActivity).toHaveBeenLastCalledWith("inbox");
  fireEvent.click(screen.getByRole("button", { name: "Scheduled jobs" }));
  expect(onOpenActivity).toHaveBeenLastCalledWith("jobs");
});

test("Settings → Skills says how many proposals are waiting and sends you to the Inbox to answer them", () => {
  const skill = (name: string) => ({ owner: "scribe", name, description: "How to do it", body: "Steps." });
  const onOpenActivity = vi.fn();
  const at = (skills: unknown[], open: typeof onOpenActivity | undefined = onOpenActivity) => {
    cleanup();
    render(<Settings S={{ ...camp(), skills } as unknown as CampState} section="skills" setSection={() => {}} refresh={() => {}} onAttachLink={() => {}} onClose={() => {}} onOpenActivity={open} />);
    return screen.getByText(/proposed after/).closest("p") as HTMLElement;
  };
  let note = at([skill("release-notes"), skill("changelog")]);
  expect(note.textContent).toMatch(/Nothing goes live until you approve it\. 2 proposals are waiting\. Answer them in the Inbox$/);
  // The proposals themselves aren't listed here, so there's nothing to approve twice.
  expect(screen.queryByText("How to do it")).toBeNull();
  fireEvent.click(within(note).getByRole("button", { name: "Answer them in the Inbox" }));
  expect(onOpenActivity).toHaveBeenCalledWith("inbox");
  note = at([skill("release-notes")]);
  expect(note.textContent).toMatch(/1 proposal is waiting\. Answer it in the Inbox$/);
  note = at([]);
  expect(note.textContent).toMatch(/Nothing goes live until you approve it\. None is waiting\.$/);
  expect(within(note).queryByRole("button")).toBeNull();
});

test("Settings → Memory keeps the two switches and links to the Memory page for the lines", async () => {
  const asked: unknown[] = [];
  const off = hear((a) => asked.push(a));
  show("memory", { ...camp(), memory: [], memoryProposals: [{ id: "p1" }] } as unknown as CampState);
  expect(screen.getByRole("checkbox", { name: /Offer a shorter version/ })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /suggest what's worth keeping/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Memory page" }));
  expect(asked).toEqual([{ do: "command", name: "memory" }]);
  off();
});

test("General keeps to the camp's basics: looks, notifications and other devices each have a page of their own", () => {
  show("general");
  for (const gone of ["Theme pack", "Colours", "Decorations"]) expect(screen.queryByRole("group", { name: gone })).toBeNull();
  for (const gone of ["Browser notifications", "Uploads", "Other devices"]) expect(screen.queryByText(gone)).toBeNull();
  cleanup();
  show("devices");
  expect(screen.getByText("Other devices")).toBeTruthy();
  expect(screen.getByText("Uploads")).toBeTruthy();
  cleanup();
  show("notifications");
  expect(screen.getByText("Browser notifications")).toBeTruthy();
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

test("General renames the outpost: the name is first on the page, and Save sends it to the camp", async () => {
  show("general");
  const input = screen.getByRole("textbox", { name: "Outpost name" });
  expect(input.closest(".set-row")!.previousElementSibling).toBeNull();
  expect((input as HTMLInputElement).value).toBe("Home");
  const save = within(input.closest("form")!).getByRole("button", { name: "Save" });
  expect((save as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
  fireEvent.change(input, { target: { value: "Work" } });
  await act(async () => { fireEvent.click(save); });
  expect(posts).toContainEqual({ path: "/api/outpost/name", body: { name: "Work" } });
  expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toMatch(/Saved/);
});

test("General says what the outpost is for, right under its name, and Save sends it to the camp", async () => {
  show("general");
  const box = screen.getByRole("textbox", { name: "What this outpost is for" });
  expect(box.closest(".set-row")!.previousElementSibling?.contains(screen.getByRole("textbox", { name: "Outpost name" }))).toBe(true);
  const save = within(box.closest("form")!).getByRole("button", { name: "Save" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(box, { target: { value: "The payments team at Acme." } });
  await act(async () => { fireEvent.click(save); });
  expect(posts).toContainEqual({ path: "/api/outpost/description", body: { description: "The payments team at Acme." } });
});

test("Appearance has a Decorations row right under the colours: only for looks, kept in this browser, and nothing is sent to the camp", () => {
  localStorage.clear();
  show("appearance");
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

test("Appearance has a theme pack row above the colours: it says the crew is renamed for the crew too, and the camp keeps the choice", async () => {
  const { PACKS } = await import("../../../src/packs.ts");
  const { refresh } = show("appearance", { ...camp(), pack: "guild", packs: PACKS } as CampState);
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

test("choosing a theme pack shows even after you've chosen colours: the pack's colours go on in their place", async () => {
  const { PACKS } = await import("../../../src/packs.ts");
  show("appearance", { ...camp(), pack: "guild", packs: PACKS } as CampState);
  fireEvent.click(screen.getByRole("button", { name: "Moss" }));
  expect(document.documentElement.dataset.palette).toBe("moss");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Starship/ })); });
  expect([document.documentElement.dataset.pack, document.documentElement.dataset.palette]).toEqual(["starship", "harbor"]);
  expect(screen.getByRole("button", { name: "Harbor" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Moss" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("group", { name: "Theme pack" }).closest(".set-row")?.textContent).toMatch(/puts its colours on \(choose others below whenever you like\)/);
  delete document.documentElement.dataset.pack; delete document.documentElement.dataset.palette; localStorage.clear();
});

test("the theme pack row makes packs of your own: New pack… opens the dialog, yours have an edit button, and one that was left out says why", async () => {
  const { PACKS } = await import("../../../src/packs.ts");
  const pirates = {
    id: "pirates", name: "Pirates", about: "A ship and her hands.", custom: true, palette: "moss",
    crew: { quartermaster: { name: "Captain", emoji: "🦜" }, scout: { name: "Lookout", emoji: "🔭" }, scribe: { name: "Chronicler", emoji: "📜" }, artificer: { name: "Shipwright", emoji: "🪚" }, warden: { name: "Bosun", emoji: "⚓" }, wizard: { name: "Sea Witch", emoji: "🌊" } },
    words: { crew: "hands", quest: "errand", quests: "errands", camp: "ship", expedition: "voyage" }, place: "the good ship Mae",
  };
  const S = { ...camp(), pack: "guild", packs: [...PACKS, pirates], packsLeftOut: [{ id: "mutiny", why: "The Scout needs a name in this pack." }] } as unknown as CampState;
  const { refresh } = show("appearance", S);
  const group = screen.getByRole("group", { name: "Theme pack" });
  const row = group.closest(".set-row")!;
  expect(row.textContent).toMatch(/You can make a pack of your own: it's kept in camp\/packs\.json, and it leaves the orb's colours as they are\./);
  // Yours sits after the camp's six, with the same kind of button and a pencil beside it; theirs have none.
  expect([...group.querySelectorAll("button.look")].map((b) => b.textContent)).toEqual(["🧭Guild", "🚀Starship", "📰Newsroom", "🎬Studio", "🧪Lab", "🏴‍☠️Pirate", "🦜Pirates", "New pack…"]);
  expect(within(group).getAllByRole("button", { name: /^Edit the / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Edit the Pirates pack"]);
  expect(screen.getByRole("button", { name: "Pirates" }).title).toBe("A ship and her hands. Captain, Lookout, Shipwright, Chronicler, Bosun, Sea Witch.");
  expect(row.querySelector(".pack-left-out")?.textContent).toBe(`The pack "mutiny" in camp/packs.json was left out. The Scout needs a name in this pack.`);

  // It's put on like any other, and the page takes the colours it suggests.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pirates" })); });
  expect(posts).toEqual([{ path: "/api/pack", body: { id: "pirates" } }]);
  expect([document.documentElement.dataset.pack, document.documentElement.dataset.palette]).toEqual(["pirates", "moss"]);

  // New pack…: the dialog, empty; saved, it closes and the camp's state is read again.
  expect(screen.queryByRole("dialog", { name: "New theme pack" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New pack…" }));
  const fresh = screen.getByRole("dialog", { name: "New theme pack" });
  expect(fresh.closest(".set-control")).toBeNull(); // not inside the row, whose styles are for its own controls
  fireEvent.click(within(fresh).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "New theme pack" })).toBeNull();

  // The pencil: the dialog with that pack in it.
  refresh.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Edit the Pirates pack" }));
  const edit = screen.getByRole("dialog", { name: "Edit the Pirates pack" });
  expect((within(edit).getByLabelText("Name for the Scout") as HTMLInputElement).value).toBe("Lookout");
  fireEvent.change(within(edit).getByLabelText("Name for the Scout"), { target: { value: "Spotter" } });
  await act(async () => { fireEvent.click(within(edit).getByRole("button", { name: "Save" })); });
  expect(posts.at(-1)).toMatchObject({ path: "/api/packs", body: { action: "update", id: "pirates", pack: { name: "Pirates", crew: { scout: { name: "Spotter", emoji: "🔭" } } } } });
  expect(screen.queryByRole("dialog", { name: "Edit the Pirates pack" })).toBeNull();
  expect(refresh).toHaveBeenCalled();
  delete document.documentElement.dataset.pack; delete document.documentElement.dataset.palette; localStorage.clear();
});

test("the notification sound row shows once notifications are on: a switch kept in this browser, and buttons to hear each chime", () => {
  localStorage.clear();
  show("notifications");
  expect(screen.queryByText("Notification sound")).toBeNull(); // jsdom has no notifications: nothing to add a sound to

  cleanup();
  const started: number[] = [];
  vi.stubGlobal("Notification", class { static permission = "granted"; });
  const node = () => ({ connect: (d: unknown) => d });
  const param = () => ({ value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} });
  vi.stubGlobal("AudioContext", class {
    state = "running"; currentTime = 0; destination = {}; sampleRate = 8000;
    createOscillator() { const o = { ...node(), frequency: param(), start: () => started.push(o.frequency.value), stop: () => {} }; return o; }
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), frequency: param(), Q: param() }; }
    createWaveShaper() { return node(); }
    createStereoPanner() { return { ...node(), pan: param() }; }
    createConvolver() { return node(); }
    createBufferSource() { return { ...node(), start: () => {} }; }
    createBuffer(channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
    createDelay() { return { ...node(), delayTime: param() }; }
    createChannelMerger() { return node(); }
  });
  show("notifications");
  const row = screen.getByText("Notification sound").closest(".set-row") as HTMLElement;
  const box = within(row).getByRole("checkbox");
  expect(box).toHaveProperty("checked", true); // on by default

  fireEvent.click(box);
  expect(localStorage.getItem("camp-notify-sound")).toBe("off");
  expect(within(row).getByRole("checkbox")).toHaveProperty("checked", false);
  expect(started).toEqual([]); // switching off is silent

  fireEvent.click(within(row).getByRole("button", { name: "Failed" }));
  expect(started.length).toBeGreaterThan(0); // the preview plays even with the sound off
  localStorage.clear();
});

test("the nav is grouped as Camp, Look & sound, Safety, Access, Knowledge, in that order", () => {
  show("general");
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  const titles = [...nav.querySelectorAll(".set-group-title")].map((e) => e.textContent);
  expect(titles).toEqual(["Camp", "Look & sound", "Safety", "Access", "Knowledge"]);
});

test("on a narrow screen the nav is one select: every section is in it, and picking one goes there", () => {
  const { setSection } = show("general");
  const pick = screen.getByRole("combobox", { name: "Settings section" }) as HTMLSelectElement;
  expect(pick.value).toBe("general");
  expect([...pick.options].map((o) => o.value).sort()).toEqual([...SETTINGS_SECTIONS].sort());
  fireEvent.change(pick, { target: { value: "limits" } });
  expect(setSection).toHaveBeenCalledWith("limits");
});

test("Tab stays inside Settings, it opens on its close button, and focus goes back to what opened it when it closes", () => {
  render(<Opener>{(close) => <Settings S={camp()} section="general" setSection={() => {}} refresh={() => {}} onAttachLink={() => {}} onClose={close} />}</Opener>);
  const opener = screen.getByRole("button", { name: "Open it" });
  opener.focus();
  fireEvent.click(opener);
  const page = screen.getByRole("dialog");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close settings" }));
  expectTabWraps(page);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
