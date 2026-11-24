// A theme pack of your own: the dialog that makes one (from nothing, or starting from another
// pack), changes one, and deletes one. The camp does the checking; what it says is shown as it is.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PACKS } from "../../../src/packs.ts";
import { ConfirmHost } from "./Confirm.tsx";
import { PackDialog, type PackLine } from "./PackDialog.tsx";

const packs = PACKS as unknown as PackLine[];
const PIRATES = {
  id: "pirates", name: "Pirates", about: "A ship and her hands.", custom: true,
  crew: {
    quartermaster: { name: "Captain", emoji: "🦜" }, scout: { name: "Lookout", emoji: "🔭", short: ["spy"] }, scribe: { name: "Chronicler", emoji: "📜" },
    artificer: { name: "Shipwright", emoji: "🪚" }, warden: { name: "Bosun", emoji: "⚓"}, wizard: { name: "Sea Witch", emoji: "🌊" },
  },
  words: { crew: "hands", quest: "errand", quests: "errands", camp: "ship", expedition: "voyage" },
  place: "the good ship Mae", palette: "harbor",
} as unknown as PackLine;

const posts: { path: string; body: any }[] = [];
let reply: { status: number; body: object } = { status: 200, body: { ok: true, id: "pirates" } };
beforeEach(() => {
  posts.length = 0;
  reply = { status: 200, body: { ok: true, id: "pirates" } };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const field = (d: HTMLElement, label: string | RegExp) => within(d).getByLabelText(label) as HTMLInputElement;
const type = (d: HTMLElement, label: string | RegExp, value: string) => fireEvent.change(field(d, label), { target: { value } });

test("a new pack: a name for it and for each of the six, its words and colours, and what you fill in is sent", async () => {
  const onSaved = vi.fn();
  render(<PackDialog pack={null} packs={packs} onClose={() => {}} onSaved={onSaved} />);
  const d = screen.getByRole("dialog", { name: "New theme pack" });
  // Each of the six is labelled with their Guild name, in the order the crew is listed, with the
  // Guild's icon to start from and no name yet; the Test Pilot has a row like the others.
  const names = within(within(d).getByRole("group", { name: "What it calls the crew" }));
  expect(names.getAllByLabelText(/^Name for the /).map((i) => [i.getAttribute("aria-label"), (i as HTMLInputElement).value]))
    .toEqual([["Name for the Quartermaster", ""], ["Name for the Scout", ""], ["Name for the Artificer", ""], ["Name for the Scribe", ""], ["Name for the Warden", ""], ["Name for the Test Pilot", ""]]);
  expect(field(d, "Icon for the Scout").value).toBe("🏹");
  expect(WORDS.map((k) => field(d, `Word for ${k}`).value)).toEqual(["crew", "quest", "quests", "camp", "expedition"]);
  expect(within(d).getByRole("button", { name: "Camp" }).getAttribute("aria-pressed")).toBe("true");

  // Nothing is sent until the pack and all six have a name.
  fireEvent.click(within(d).getByRole("button", { name: "Add pack" }));
  expect(within(d).getByRole("alert").textContent).toBe("Give the pack a name.");
  type(d, "Pack name", "Pirates");
  type(d, "Name for the Quartermaster", "Captain");
  fireEvent.click(within(d).getByRole("button", { name: "Add pack" }));
  expect(within(d).getByRole("alert").textContent).toBe("The Scout needs a name in this pack.");
  expect(posts).toEqual([]);

  type(d, "About it", "A ship and her hands.");
  type(d, "Name for the Scout", "Lookout"); type(d, "Icon for the Scout", "🔭");
  type(d, "Name for the Scribe", "Chronicler"); type(d, "Name for the Artificer", "Shipwright"); type(d, "Name for the Warden", "Bosun");
  fireEvent.click(within(d).getByRole("button", { name: "Add pack" }));
  expect(within(d).getByRole("alert").textContent).toBe("The Test Pilot needs a name in this pack.");
  type(d, "Name for the Test Pilot", "Sea Witch");
  // More than one quest follows the word for one, until you say otherwise.
  type(d, "Word for quest", "story");
  expect(field(d, "Word for quests").value).toBe("stories");
  type(d, "Word for quests", "tales");
  type(d, "Word for quest", "errand");
  expect(field(d, "Word for quests").value).toBe("tales");
  type(d, "Word for camp", "ship");
  // Where the crew works: the line they'll read is shown as it will be.
  expect(d.textContent).toContain(`"You are the Lookout of the Mae ship."`);
  type(d, "Where the crew works", "the good ship Mae");
  expect(d.textContent).toContain(`"You are the Lookout of the good ship Mae."`);
  fireEvent.click(within(d).getByRole("button", { name: "Moss" }));
  expect([within(d).getByRole("button", { name: "Moss" }).getAttribute("aria-pressed"), within(d).getByRole("button", { name: "Camp" }).getAttribute("aria-pressed")]).toEqual(["true", "false"]);
  expect(d.textContent).toMatch(/a pack of your own doesn't recolour it/);

  fireEvent.click(within(d).getByRole("button", { name: "Add pack" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith("pirates"));
  expect(posts).toEqual([{ path: "/api/packs", body: { action: "add", pack: {
    name: "Pirates", about: "A ship and her hands.", place: "the good ship Mae", palette: "moss",
    words: { crew: "crew", quest: "errand", quests: "tales", camp: "ship", expedition: "expedition" },
    crew: { quartermaster: { name: "Captain", emoji: "🧭" }, scout: { name: "Lookout", emoji: "🔭" }, artificer: { name: "Shipwright", emoji: "🔨" }, scribe: { name: "Chronicler", emoji: "🪶" }, warden: { name: "Bosun", emoji: "🛡️" }, wizard: { name: "Sea Witch", emoji: "🛸" } },
  } } }]);
});
const WORDS = ["crew", "quest", "quests", "camp", "expedition"];

test("Start from another pack fills in its names, words, place and colours, the Test Pilot's too", async () => {
  render(<PackDialog pack={null} packs={packs} onClose={() => {}} onSaved={() => {}} />);
  const d = screen.getByRole("dialog", { name: "New theme pack" });
  type(d, "Pack name", "My Ship");
  expect(field(d, "Name for the Test Pilot").value).toBe("");
  const from = field(d, "Start from") as unknown as HTMLSelectElement;
  expect([...from.options].map((o) => o.textContent).slice(1)).toEqual(["Guild", "Starship", "Newsroom", "Studio", "Lab", "Pirate"]);
  fireEvent.change(from, { target: { value: "starship" } });
  expect(["Quartermaster", "Scout", "Artificer", "Scribe", "Warden", "Test Pilot"].map((who) => [field(d, `Name for the ${who}`).value, field(d, `Icon for the ${who}`).value]))
    .toEqual([["Commander", "🚀"], ["Navigator", "🔭"], ["Engineer", "🔧"], ["Comms Officer", "📡"], ["Security Chief", "🛡️"], ["Test Pilot", "🛸"]]);
  const starship = PACKS.find((p) => p.id === "starship")!;
  expect(WORDS.map((k) => field(d, `Word for ${k}`).value)).toEqual(WORDS.map((k) => (starship.words as Record<string, string>)[k]));
  expect(field(d, "Where the crew works").value).toBe(starship.place);
  expect(within(d).getByRole("button", { name: "Harbor" }).getAttribute("aria-pressed")).toBe("true");
  expect([field(d, "Pack name").value, field(d, "About it").value]).toEqual(["My Ship", ""]); // the pack's own name and line are yours

  // A name left as it was keeps the short handle it had (@nav); one you change loses its own (@comms).
  type(d, "Name for the Scribe", "Herald");
  fireEvent.click(within(d).getByRole("button", { name: "Add pack" }));
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].body.pack.crew).toEqual({ ...starship.crew, scribe: { name: "Herald", emoji: "📡" } });
  expect(posts[0].body.pack.extras).toBeUndefined();
  expect(posts[0].body.pack).toMatchObject({ name: "My Ship", words: Object.fromEntries(WORDS.map((k) => [k, (starship.words as Record<string, string>)[k]])), place: starship.place, palette: "harbor" });

  // Back to nothing: names of your own again, with the Guild's icons and words.
  fireEvent.change(from, { target: { value: "" } });
  expect([field(d, "Name for the Scout").value, field(d, "Icon for the Scout").value, field(d, "Word for quest").value, field(d, "Where the crew works").value]).toEqual(["", "🏹", "quest", ""]);
});

test("a pack of yours can be changed: it opens as it is, and what the camp says about a name is shown as it is", async () => {
  const onSaved = vi.fn(), onClose = vi.fn();
  render(<PackDialog pack={PIRATES} packs={[...packs, PIRATES]} onClose={onClose} onSaved={onSaved} />);
  const d = screen.getByRole("dialog", { name: "Edit the Pirates pack" });
  expect(within(d).queryByLabelText("Start from")).toBeNull();
  expect([field(d, "Pack name").value, field(d, "About it").value, field(d, "Name for the Scout").value, field(d, "Icon for the Scout").value, field(d, "Name for the Test Pilot").value, field(d, "Word for quests").value, field(d, "Where the crew works").value])
    .toEqual(["Pirates", "A ship and her hands.", "Lookout", "🔭", "Sea Witch", "errands", "the good ship Mae"]);
  expect(within(d).getByRole("button", { name: "Harbor" }).getAttribute("aria-pressed")).toBe("true");

  reply = { status: 400, body: { error: `The Scribe can't be called "Navigator": the Starship pack calls the Scout Navigator.` } };
  type(d, "Name for the Scribe", "Navigator");
  fireEvent.click(within(d).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(within(d).getByRole("alert").textContent).toBe(`The Scribe can't be called "Navigator": the Starship pack calls the Scout Navigator.`));
  expect(onSaved).not.toHaveBeenCalled();
  expect((within(d).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false); // still open, to put right

  reply = { status: 200, body: { ok: true, id: "pirates" } };
  type(d, "Name for the Scribe", "Purser");
  type(d, "Word for quest", "job"); // the plural was the usual one, so it follows
  fireEvent.click(within(d).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith("pirates"));
  const sent = posts.at(-1)!.body;
  expect([sent.action, sent.id, sent.pack.name]).toEqual(["update", "pirates", "Pirates"]);
  expect(sent.pack.crew.scout).toEqual({ name: "Lookout", emoji: "🔭", short: ["spy"] });
  expect(sent.pack.crew.scribe).toEqual({ name: "Purser", emoji: "📜" });
  expect(sent.pack.words).toMatchObject({ quest: "job", quests: "jobs" });
  expect(sent.pack.crew.wizard).toEqual({ name: "Sea Witch", emoji: "🌊" });
  expect(sent.pack.extras).toBeUndefined();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("deleting a pack asks first, and says the camp goes back to the Guild when it's the one that's on", async () => {
  const onSaved = vi.fn();
  render(<><PackDialog pack={PIRATES} packs={[...packs, PIRATES]} on onClose={() => {}} onSaved={onSaved} /><ConfirmHost /></>);
  fireEvent.click(screen.getByRole("button", { name: "Delete this pack" }));
  const question = await screen.findByRole("alertdialog");
  expect(question.textContent).toMatch(/Delete the Pirates pack\?The camp is wearing it now, so it goes back to the Guild pack\. The names it gave still work after @/);
  fireEvent.click(within(question).getByRole("button", { name: "Delete" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(posts).toEqual([{ path: "/api/packs", body: { action: "remove", id: "pirates" } }]);
  cleanup();

  // Not the one that's on: nothing about the Guild. And "no" sends nothing.
  posts.length = 0;
  render(<><PackDialog pack={PIRATES} packs={[...packs, PIRATES]} onClose={() => {}} onSaved={onSaved} /><ConfirmHost /></>);
  fireEvent.click(screen.getByRole("button", { name: "Delete this pack" }));
  const second = await screen.findByRole("alertdialog");
  expect(second.textContent).not.toMatch(/goes back to the Guild/);
  fireEvent.click(within(second).getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(posts).toEqual([]);
  // The packs the camp comes with have no such button: a new pack has nothing to delete either.
  cleanup();
  render(<PackDialog pack={null} packs={packs} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.queryByRole("button", { name: "Delete this pack" })).toBeNull();
});

test("the phrases that go with the words are optional: blank ones show what would be made, and only those you type are sent", async () => {
  render(<PackDialog pack={null} packs={packs} onClose={() => {}} onSaved={() => {}} />);
  const d = screen.getByRole("dialog", { name: "New theme pack" });
  expect(d.textContent).toContain("More phrases");
  expect(field(d, "Phrase for close").value).toBe("");
  expect(field(d, "Phrase for close").placeholder).toBe("close the camp");
  type(d, "Word for camp", "ship"); type(d, "Word for crew", "hands"); type(d, "Word for quest", "errand");
  expect([field(d, "Phrase for ready").placeholder, field(d, "Phrase for member").placeholder, field(d, "Phrase for log").placeholder]).toEqual(["The ship is set", "hands member", "errand log"]);
  type(d, "Phrase for close", "drop anchor");
  type(d, "Pack name", "Pirates");
  for (const who of ["Quartermaster", "Scout", "Artificer", "Scribe", "Warden", "Test Pilot"]) type(d, `Name for the ${who}`, `${who} of the sea`);
  fireEvent.click(within(d).getByRole("button", { name: "Add pack" }));
  await vi.waitFor(() => expect(posts.length).toBe(1));
  expect(posts[0].body.pack.words).toEqual({ crew: "hands", quest: "errand", quests: "errands", camp: "ship", expedition: "expedition", close: "drop anchor" });
});

test("starting from a pack copies the phrases it gave itself, and leaves those it just made from its words", () => {
  render(<PackDialog pack={null} packs={packs} onClose={() => {}} onSaved={() => {}} />);
  const d = screen.getByRole("dialog", { name: "New theme pack" });
  fireEvent.change(field(d, "Start from") as unknown as HTMLSelectElement, { target: { value: "starship" } });
  expect([field(d, "Phrase for member").value, field(d, "Phrase for hq").value, field(d, "Phrase for depart").value]).toEqual(["officer", "the bridge", "launches"]);
});

test("renaming the place drops the phrases copied for the old one, and the new words make them", () => {
  render(<PackDialog pack={null} packs={packs} onClose={() => {}} onSaved={() => {}} />);
  const d = screen.getByRole("dialog", { name: "New theme pack" });
  fireEvent.change(field(d, "Start from") as unknown as HTMLSelectElement, { target: { value: "starship" } });
  fireEvent.change(field(d, "Phrase for hq"), { target: { value: "the deck" } });
  fireEvent.change(field(d, "Word for camp"), { target: { value: "base" } });
  expect([field(d, "Phrase for back").value, field(d, "Phrase for back").placeholder, field(d, "Phrase for hq").value]).toEqual(["", "returns to the base", "the deck"]);
});
