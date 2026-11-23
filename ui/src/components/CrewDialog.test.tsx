// Adding to the crew from the crew bar: the + card at the end opens the dialog, the dialog sends
// what you filled in, and a crew member you added can be edited or removed.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { cClass, setCrewColors } from "../format.ts";
import type { CampState, Character } from "../types.ts";
import { ConfirmHost } from "./Confirm.tsx";
import { Crew } from "./Crew.tsx";
import { CrewDialog } from "./CrewDialog.tsx";

const base = { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 20, defaultMaxTurns: 20, defaultModel: "claude-sonnet-5-5", defaultEffort: "medium", overridden: false, personality: "" };
const SCOUT = { ...base, id: "scout", name: "Scout", emoji: "🏹", role: "Research.", custom: false, color: null } as unknown as Character;
const PILOT = { ...base, id: "testpilot", name: "Test Pilot", emoji: "🧪", role: "Testing.", custom: true, color: "rose", handles: "tests", notFor: "prose",
  persona: "Reproduce first.", abilities: { write: "project", shell: true }, aliases: [] } as unknown as Character;
const S = { characters: [SCOUT, PILOT], xp: {} } as unknown as CampState;

const posts: { path: string; body: any }[] = [];
let reply: { status: number; body: object } = { status: 200, body: { ok: true } };
beforeEach(() => {
  posts.length = 0;
  reply = { status: 200, body: { ok: true } };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("the crew bar has a + in its corner that opens the dialog; added crew members can be edited", () => {
  const onAdd = vi.fn(), onEdit = vi.fn(), onOpenAgent = vi.fn();
  render(<Crew S={S} store={createFeedStore()} pickerFor={null} onOpenAgent={onOpenAgent} onOpenPicker={() => {}} onAdd={onAdd} onEdit={onEdit} />);
  const bar = screen.getByRole("region", { name: "The crew" });
  // The crew's half of the roster: the crew, then the + in the corner, and the arrow that folds the half away.
  expect([...bar.parentElement!.children]).toEqual([bar, screen.getByRole("button", { name: "Add a crew member" }), screen.getByRole("button", { name: "Hide the crew" })]);
  // Under the whole roster area (the crew and who's running), the "Crew" rail: it opens the bar up, or folds it down.
  const rail = screen.getByRole("button", { name: "Show more about the crew" });
  expect(rail.textContent).toBe("Crew");
  expect(rail.className).toContain("zone-rail"); // the same rail History, Files and the terminal have
  expect(rail.getAttribute("aria-expanded")).toBe("false");
  expect(rail.previousElementSibling?.className).toBe("crew-area");
  expect(rail.parentElement!.lastElementChild).toBe(rail);
  expect(bar.querySelector("button.member-add, .crew-toggle")).toBeNull(); // nothing but the crew inside the bar itself
  fireEvent.click(screen.getByRole("button", { name: "Add a crew member" }));
  expect(onAdd).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit Test Pilot" }));
  expect(onEdit).toHaveBeenCalledWith(PILOT);
  expect(onOpenAgent).not.toHaveBeenCalled(); // the pencil doesn't also open their page
  expect(screen.queryByRole("button", { name: "Edit Scout" })).toBeNull();
  setCrewColors(S.characters);
  expect([cClass("Scout"), cClass("Test Pilot"), cClass("Stranger")]).toEqual(["c-scout", "c-x-rose", ""]);
});

test("a new crew member: the handle follows the name, and what you fill in is sent", async () => {
  const onSaved = vi.fn();
  render(<CrewDialog member={null} onClose={() => {}} onSaved={onSaved} />);
  const d = screen.getByRole("dialog", { name: "New crew member" });
  fireEvent.click(within(d).getByRole("button", { name: "Add to the crew" }));
  expect(within(d).getByRole("alert").textContent).toBe("Give the crew member a name.");
  fireEvent.change(within(d).getByLabelText(/^Name/), { target: { value: "Map Maker" } });
  expect((within(d).getByLabelText(/^Handle/) as HTMLInputElement).value).toBe("mapmaker");
  expect(within(d).getByText("You'll message them with @mapmaker.")).toBeTruthy();
  fireEvent.change(within(d).getByLabelText("Icon (an emoji)"), { target: { value: "🗺️" } });
  fireEvent.click(within(d).getByRole("button", { name: "green" }));
  fireEvent.change(within(d).getByLabelText(/^What they're for/), { target: { value: "Diagrams: draws maps of codebases." } });
  fireEvent.change(within(d).getByLabelText(/^How they work/), { target: { value: "Start from the entry points." } });
  // Reading the web and being able to change things: allowed, with a warning.
  expect(within(d).queryByRole("note")).toBeNull();
  fireEvent.click(within(d).getByLabelText(/Search the web/));
  fireEvent.change(within(d).getByLabelText("Write files"), { target: { value: "project" } });
  expect(within(d).getByRole("note").textContent).toMatch(/reads the web and can also change things/);
  fireEvent.change(within(d).getByLabelText("Write files"), { target: { value: "outputs" } });
  expect(within(d).queryByRole("note")).toBeNull();
  fireEvent.click(within(d).getByRole("button", { name: "Add to the crew" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(posts).toEqual([{ path: "/api/crew", body: { action: "add", member: {
    id: "mapmaker", name: "Map Maker", emoji: "🗺️", color: "green", role: "Diagrams: draws maps of codebases.", personality: "", handles: "", notFor: "",
    persona: "Start from the entry points.", abilities: { web: true, write: "outputs", shell: false, wiki: true },
  } } }]);
});

test("the camp's objection is shown; editing keeps the handle; removing asks first", async () => {
  reply = { status: 400, body: { error: 'There\'s already a crew member called "Scout" or answering to @scout. Pick another name or handle.' } };
  const onSaved = vi.fn();
  const { unmount } = render(<CrewDialog member={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Scout" } });
  fireEvent.change(screen.getByLabelText(/^What they're for/), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to the crew" }));
  await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already a crew member/));
  expect(onSaved).not.toHaveBeenCalled();
  unmount();

  reply = { status: 200, body: { ok: true } };
  posts.length = 0;
  render(<CrewDialog member={PILOT} onClose={() => {}} onSaved={onSaved} />);
  const d = screen.getByRole("dialog", { name: "Edit Test Pilot" });
  expect((within(d).getByLabelText(/^Handle/) as HTMLInputElement).disabled).toBe(true);
  expect((within(d).getByLabelText(/Run shell commands/) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(within(d).getByLabelText(/^What they're for/), { target: { value: "Testing, with flight checks." } });
  fireEvent.click(within(d).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(posts[0].body).toMatchObject({ action: "update", id: "testpilot", member: { name: "Test Pilot", role: "Testing, with flight checks.", abilities: { write: "project", shell: true } } });
  cleanup();

  render(<><CrewDialog member={PILOT} onClose={() => {}} onSaved={onSaved} /><ConfirmHost /></>);
  fireEvent.click(screen.getByRole("button", { name: "Remove from the crew" }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
  expect(posts.at(-1)!.body).toEqual({ action: "remove", id: "testpilot" });
});
