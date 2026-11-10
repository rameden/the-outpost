// Small formatting helpers shared across the page.

export function slug(name: string | undefined | null) { return String(name || "").toLowerCase().replace(/[^a-z]/g, ""); }
// Crew members you added, by name: the colour you picked for each (the page sets this when the
// crew loads or changes, so messages and cards anywhere on the page can look it up).
const addedColors = new Map<string, string>();
export function setCrewColors(crew: { name: string; custom?: boolean; color?: string | null }[]) {
  addedColors.clear();
  for (const c of crew) if (c.custom && c.color) addedColors.set(slug(c.name), c.color);
}
// The CSS class that gives a crew member their colour.
export function cClass(name: string | undefined | null) {
  const s = slug(name);
  if (["quartermaster", "scout", "scribe", "artificer"].includes(s)) return `c-${s}`;
  const mine = addedColors.get(s);
  return mine ? `c-x-${mine}` : "";
}
export function when(iso: string) { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
export function clock(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
export function dayLabel(iso: string) { return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
export function kTok(n: number) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
export const money = (n: number | undefined | null) => (!n ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
export const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
export const spaced = (status: string) => status.replace(/_/g, " ");
export const shortModel = (model: string) => model.replace(/^claude-/, "");
export const isImagePath = (p: string | undefined | null) => /\.(png|jpe?g|gif|webp)$/i.test(p || "");
export const stripFrontmatter = (src: string) => String(src).replace(/^---\n[\s\S]*?\n---\n?/, "");
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// "12 min", "3 h": how long until a plan limit resets.
export function resetIn(ms: number) {
  const mins = Math.max(1, Math.round((ms - Date.now()) / 60000));
  return mins < 90 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
}
