// The layout's rules: zones are added beside others, removed, given parts, and resized, and a
// saved layout is only used if it's one the page can show.
import { expect, test } from "vitest";
import { addZone, assign, canAssign, canRemove, defaultLayout, drag, focusPlan, loadLayout, MAX_ZONES, parseLayout, placed, removeZone, saveLayout, setSize, withNotes, zoneOf, zonesOf, type Item, type Layout } from "./layout.ts";

// A layout as a line of text: row(history:272 chat:* files:300 notes:320)
const show = (n: Item): string => {
  const size = "px" in n.size ? `:${n.size.px}` : "grow" in n.size ? (n.size.grow === 1 ? "" : `*${n.size.grow}`) : ":auto";
  return n.kind === "zone" ? `${n.part ?? "empty"}${size}` : `${n.dir}(${n.items.map(show).join(" ")})${size}`;
};

test("the default: roster on top, history, chat, files and notes side by side, the terminal below", () => {
  expect(show(defaultLayout())).toBe("col(roster:auto row(history:272 chat files:300 notes:320) terminal:280)");
  expect(show(defaultLayout({ files: 420, terminal: 200 }))).toContain("files:420 notes:320) terminal:200");
});

test("a zone added in the split's own direction goes in beside it", () => {
  const l = defaultLayout();
  const right = addZone(l, zoneOf(l, "chat")!.id, "right");
  expect(show(right.layout)).toBe("col(roster:auto row(history:272 chat empty files:300 notes:320) terminal:280)");
  expect(zonesOf(right.layout).find((z) => z.id === right.id)?.part).toBeNull();
  expect(show(addZone(l, zoneOf(l, "chat")!.id, "left").layout)).toContain("row(history:272 empty chat files:300 notes:320)");
  expect(show(l)).toBe(show(defaultLayout())); // the layout passed in isn't changed
});

test("a zone added across the split's direction shares the first one's place", () => {
  const l = defaultLayout();
  expect(show(addZone(l, zoneOf(l, "history")!.id, "below").layout)).toContain("row(col(history empty):272 chat files:300 notes:320)");
  expect(show(addZone(l, zoneOf(l, "chat")!.id, "above").layout)).toContain("row(history:272 col(empty chat) files:300 notes:320)");
  expect(show(addZone(l, zoneOf(l, "terminal")!.id, "right").layout)).toMatch(/row\(terminal empty\):280\)$/);
});

test("there's a limit to how many zones a layout holds", () => {
  let l = defaultLayout();
  for (let i = 0; i < 10; i++) l = addZone(l, zoneOf(l, "chat")!.id, "right").layout;
  expect(zonesOf(l).length).toBe(MAX_ZONES);
  expect(addZone(l, zoneOf(l, "chat")!.id, "right").id).toBeUndefined();
});

test("removing a zone closes the gap, and a split left with one item goes with it", () => {
  const l = defaultLayout();
  expect(show(removeZone(l, zoneOf(l, "files")!.id))).toBe("col(roster:auto row(history:272 chat notes:320) terminal:280)");
  const two = removeZone(removeZone(removeZone(l, zoneOf(l, "files")!.id), zoneOf(l, "notes")!.id), zoneOf(l, "history")!.id);
  expect(show(two)).toBe("col(roster:auto chat terminal:280)");
  const one = removeZone(removeZone(two, zoneOf(l, "roster")!.id), zoneOf(l, "terminal")!.id);
  expect(show(one)).toBe("col(chat)");
  const added = addZone(l, zoneOf(l, "history")!.id, "below");
  expect(show(removeZone(added.layout, added.id!))).toBe(show(l)); // back to how it was, size and all
});

test("chat's zone can't be removed, nor the last zone", () => {
  const l = defaultLayout();
  expect(canRemove(l, zoneOf(l, "chat")!.id)).toBe(false);
  expect(removeZone(l, zoneOf(l, "chat")!.id)).toBe(l);
  expect(canRemove(l, zoneOf(l, "files")!.id)).toBe(true);
  expect(canRemove(l, "nope")).toBe(false);
});

test("a part that's already on the page trades places; chat is never left without a zone", () => {
  const l = defaultLayout();
  const chat = zoneOf(l, "chat")!.id, files = zoneOf(l, "files")!.id;
  expect(show(assign(l, files, "history"))).toContain("row(files:272 chat history:300 notes:320)");
  expect(show(assign(l, chat, "files"))).toContain("row(history:272 files chat:300 notes:320)");
  expect(show(assign(l, files, null))).toContain("row(history:272 chat empty:300 notes:320)");
  expect(placed(assign(l, files, null), "files")).toBe(false);
  expect(canAssign(l, chat, null)).toBe(false);
  expect(assign(l, chat, null)).toBe(l);
  const noFiles = assign(l, files, null);
  expect(canAssign(noFiles, chat, "files")).toBe(false); // files is nowhere, so chat would be too
  expect(show(assign(noFiles, files, "files"))).toBe(show(l));
});

test("dragging the line: fixed zones take pixels, and two that share space trade shares", () => {
  const l = defaultLayout();
  const [history, chat, files] = ["history", "chat", "files"].map((p) => zoneOf(l, p as "chat")!.id);
  expect(show(drag(l, history, chat, 272, 800, 48))).toContain("row(history:320 chat files:300 notes:320)");
  expect(show(drag(l, chat, files, 800, 300, 60))).toContain("row(history:272 chat files:240 notes:320)");
  expect(show(drag(l, history, chat, 272, 800, -500))).toContain("history:80 "); // no smaller than this
  expect(show(drag(l, chat, files, 800, 300, 900))).toContain("files:80 ");
  const roster = zoneOf(l, "roster")!.id;
  expect(show(drag(l, roster, "s2", 76, 500, 24))).toBe("col(roster:100 row(history:272 chat files:300 notes:320) terminal:280)");

  const two = addZone(l, chat, "right");
  expect(show(drag(two.layout, chat, two.id!, 400, 400, 200))).toContain("chat*1.5 empty*0.5");
  expect(drag(l, history, "z5", 272, 280, 10)).toBe(l); // not neighbours in one split
});

test("a zone's size can be set outright", () => {
  const l = defaultLayout();
  expect(show(setSize(l, zoneOf(l, "roster")!.id, { px: 120 }))).toContain("roster:120");
  expect(show(setSize(l, zoneOf(l, "history")!.id, { grow: 1 }))).toContain("row(history chat");
});

test("a saved layout is used only if the page can show it", () => {
  const l: Layout = addZone(defaultLayout(), "z3", "below").layout;
  expect(parseLayout(JSON.stringify(l))).toEqual(l);
  const bad = (change: (x: any) => void) => { const x = structuredClone(l) as any; change(x); return parseLayout(JSON.stringify(x)); };
  expect(parseLayout(null)).toBeNull();
  expect(parseLayout("{not json")).toBeNull();
  expect(parseLayout(JSON.stringify(l.items[0]))).toBeNull();                 // a lone zone isn't a layout
  expect(bad((x) => { x.items[0].part = "chat"; })).toBeNull();               // chat twice
  expect(bad((x) => { x.items[0].part = "weather"; })).toBeNull();            // no such part
  expect(bad((x) => { x.items[1].items[1].items[1].part = null; x.items[1].items[1].items[0].part = null; })).toBeNull(); // no chat
  expect(bad((x) => { x.items[0].size = { px: -4 }; })).toBeNull();
  expect(bad((x) => { x.items[0].id = "z5"; })).toBeNull();                   // two items, one id
  expect(bad((x) => { x.items[1].dir = "diagonal"; })).toBeNull();
  expect(bad((x) => { x.items[1].items = []; })).toBeNull();
});

test("focus mode closes the panels that are open, and used again brings those back", () => {
  expect(focusPlan(["history", "terminal"], null)).toEqual({ close: ["history", "terminal"], reopen: [] });
  expect(focusPlan(["files"], "history,terminal")).toEqual({ close: ["files"], reopen: [] }); // what's open now is what counts
  expect(focusPlan([], "history,terminal")).toEqual({ close: [], reopen: ["history", "terminal"] });
  expect(focusPlan([], null)).toEqual({ close: [], reopen: ["history"] });                 // nothing remembered: history, at least
  expect(focusPlan([], "roster,,nonsense")).toEqual({ close: [], reopen: ["history"] });  // only panels come back
});

test("a layout kept from before Notes is given a zone for them, right of Files (or of Chat)", () => {
  const old = removeZone(defaultLayout(), zoneOf(defaultLayout(), "notes")!.id);
  expect(show(withNotes(old))).toBe(show(defaultLayout()));
  expect(withNotes(defaultLayout())).toEqual(defaultLayout()); // already there: left alone
  const bare = removeZone(old, zoneOf(old, "files")!.id);
  expect(show(withNotes(bare))).toContain("row(history:272 chat notes:320)");
  // Asked for once: a layout kept since by a page that has Notes is yours as it is.
  localStorage.setItem("camp-layout", JSON.stringify(old));
  expect(placed(loadLayout(), "notes")).toBe(true);
  saveLayout(old);
  expect(placed(loadLayout(), "notes")).toBe(false);
  localStorage.clear();
});
