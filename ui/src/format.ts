// Small formatting helpers shared across the page.

export function slug(name: string | undefined | null) { return String(name || "").toLowerCase().replace(/[^a-z]/g, ""); }
// Crew members you added, by name: the colour you picked for each (the page sets this when the
// crew loads or changes, so messages and cards anywhere on the page can look it up).
const addedColors = new Map<string, string>();
type PackName = { name: string; emoji: string; short?: string[]; was?: string[] };
// own: what you called someone you added, when the theme pack is calling them something else.
type CrewLine = { id: string; name: string; emoji: string; role: string; custom?: boolean; color?: string | null; aliases?: string[]; own?: { name: string; emoji: string } };
type PackLine = { id: string; crew: Record<string, PackName>; extras?: Record<string, PackName> };
let crewList: CrewLine[] = [];
// The camp's own five, by id. Their names change with the theme pack; their ids never do.
export const BUILT_IN = ["quartermaster", "scout", "scribe", "artificer", "warden"];
export const LEAD = "quartermaster";
// Every name one of the five has gone by, in any theme pack, to their id. History keeps the name
// someone had when it was written, so an old message still finds its colour after a switch.
const GUILD_NAMES = new Map<string, string>(BUILT_IN.map((id) => [id, id]));
let knownAs = new Map(GUILD_NAMES);
const GUILD_CALLED: Record<string, string> = { quartermaster: "Quartermaster", scout: "Scout", scribe: "Scribe", artificer: "Artificer", warden: "Warden" };
let called = new Map<string, Set<string>>();
// Someone you added that the packs have names for too (the Test Pilot, @wizard): each of those names, to their id.
let addedAs = new Map<string, string>();
// Whether someone you added still has the name they came with: what the Guild pack calls them, or
// called them before (src/packs.ts has the same check). Only then do the packs rename them.
export const cameAs = (guild: PackName | undefined, name: string): boolean => !!guild && (guild.name === name || !!guild.was?.includes(name));
const everCalled = (n: PackName | undefined): string[] => (n ? [n.name, ...(n.was ?? [])] : []);
// The crew as the page last loaded it, for parts of the page far from where it's passed down.
export const crewNow = () => crewList;
// retired: names a pack of your own gave before it was changed or deleted, by who had them. Nobody
// is called them now, but history written under them still finds its colour and who it was.
export function setCrewColors(crew: CrewLine[], packs: PackLine[] = [], retired: Record<string, string[]> = {}) {
  crewList = crew;
  addedColors.clear();
  knownAs = new Map(GUILD_NAMES);
  called = new Map();
  addedAs = new Map();
  for (const p of packs) for (const id of BUILT_IN) {
    const c = p.crew[id];
    if (!c) continue;
    for (const n of [c.name, ...(c.short ?? [])]) knownAs.set(slug(n), id);
    called.set(id, (called.get(id) ?? new Set()).add(c.name));
  }
  for (const c of crew) {
    if (c.custom) { if (c.color) addedColors.set(slug(c.name), c.color); }
    else if (BUILT_IN.includes(c.id)) for (const n of [c.name, ...(c.aliases ?? [])]) knownAs.set(slug(n), c.id);
  }
  // Someone you added always keeps their own name: it never points at one of the five.
  for (const c of crew) if (c.custom) { knownAs.delete(slug(c.name)); for (const names of called.values()) names.delete(c.name); }
  // The packs' names for someone you added (the Test Pilot), while they still have the name they
  // came with: history written under another pack, or under the name the Guild gave them before,
  // keeps their colour and finds them.
  const guild = packs[0]?.extras ?? {};
  const names = new Set(crew.map((c) => slug(c.name)));
  for (const c of crew) {
    if (!c.custom || !cameAs(guild[c.id], c.own?.name ?? c.name)) continue;
    for (const p of packs) for (const n of everCalled(p.extras?.[c.id])) {
      if ((n !== c.name && names.has(slug(n))) || knownAs.has(slug(n))) continue;
      addedAs.set(slug(n), c.id);
      called.set(c.id, (called.get(c.id) ?? new Set()).add(n));
      if (c.color) addedColors.set(slug(n), c.color);
    }
  }
  for (const [who, old] of Object.entries(retired)) {
    const added = crew.find((c) => c.custom && c.id === who);
    if (!BUILT_IN.includes(who) && !added) continue;
    for (const n of old) {
      const s = slug(n);
      if (!s || names.has(s) || knownAs.has(s) || addedAs.has(s)) continue;
      if (added) { addedAs.set(s, who); if (added.color) addedColors.set(s, added.color); }
      else knownAs.set(s, who);
      called.set(who, (called.get(who) ?? new Set()).add(n));
    }
  }
}
// Every name someone has had under any pack, as it was written (for matching history to who it was):
// one of the five, or someone you added that the packs rename.
export const calledEver = (id: string): string[] => [...new Set([...(GUILD_CALLED[id] ? [GUILD_CALLED[id]] : []), ...(called.get(id) ?? [])])];
// Which of the camp's own five a name (from any theme pack) or an id means, if any.
export function crewId(name: string | undefined | null): string | undefined { return knownAs.get(slug(name)); }
export const isLead = (name: string | undefined | null) => crewId(name) === LEAD;
// What the lead is called now ("Quartermaster", or the theme pack's name for them).
export const leadName = () => crewList.find((c) => c.id === LEAD)?.name ?? "Quartermaster";
// What someone is called now, from any name they've gone by (a name nobody has is left as it is).
export function nameNow(name: string) {
  const id = crewId(name) ?? addedAs.get(slug(name));
  return (id && crewList.find((c) => c.id === id)?.name) || name;
}
// The CSS class that gives a crew member their colour.
export function cClass(name: string | undefined | null) {
  const mine = addedColors.get(slug(name));
  if (mine) return `c-x-${mine}`;
  const id = crewId(name);
  return id ? `c-${id}` : "";
}
export function when(iso: string) { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
export function clock(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
export function dayLabel(iso: string) { return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
// How long something took, as you'd say it: 45s, 7m 06s, 1h 12m.
export function took(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
export function kTok(n: number) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
export const money = (n: number | undefined | null) => (!n ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
// An amount in a given currency (credit from your plan): "$12.40", "€8.00".
export const cash = (n: number, currency = "USD") => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n); } catch { return `${n.toFixed(2)} ${currency}`; }
};
export const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
export const spaced = (status: string) => status.replace(/_/g, " ");
// Auto ("auto", "auto:economy"…) reads as what it is: Auto, and the preference it was given.
const AUTO = /^auto(?::(economy|balanced|quality))?$/;
export const isAuto = (model: string | undefined | null) => !!model && AUTO.test(model);
export const autoName = (model: string) => { const p = model.match(AUTO)?.[1] ?? "balanced"; return `Auto · ${p[0].toUpperCase()}${p.slice(1)}`; };
export const shortModel = (model: string) => (isAuto(model) ? autoName(model) : model.replace(/^claude-/, ""));
export const isImagePath = (p: string | undefined | null) => /\.(png|jpe?g|gif|webp)$/i.test(p || "");
export const stripFrontmatter = (src: string) => String(src).replace(/^---\n[\s\S]*?\n---\n?/, "");
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// "12 min", "3 h": how long until a plan limit resets.
export function resetIn(ms: number) {
  const mins = Math.max(1, Math.round((ms - Date.now()) / 60000));
  return mins < 90 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
}
