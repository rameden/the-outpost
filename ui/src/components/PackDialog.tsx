// The pack dialog: make a theme pack of your own, or change one you made.
//
// A pack is a set of names: what it calls each of the camp's own six, five of the page's words and eight phrases that go with them,
// the line the crew reads about where they work, and the colours
// it suggests. The camp keeps yours in camp/packs.json, beside the ones it comes with, and checks
// that no name in it is already someone else's; what it says when one is, is shown here as it is.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { cx } from "../format.ts";
import { PALETTES } from "../themes.ts";
import { many, phrasesFor, w } from "../words.ts";
export { phrasesFor };
import type { CampState } from "../types.ts";
import { ask } from "./Confirm.tsx";
import { Dialog } from "./Dialog.tsx";

export type PackLine = NonNullable<CampState["packs"]>[number];
type Named = { name: string; emoji: string };
type WordKey = "crew" | "quest" | "quests" | "camp" | "expedition";
type PhraseKey = "member" | "log" | "ready" | "close" | "closing" | "back" | "depart" | "hq";

const CREW = ["quartermaster", "scout", "artificer", "scribe", "warden", "wizard"] as const; // in the order the crew is listed
const WORDS: WordKey[] = ["crew", "quest", "quests", "camp", "expedition"];
const GUILD_WORDS: Record<WordKey, string> = { crew: "crew", quest: "quest", quests: "quests", camp: "camp", expedition: "expedition" };
// The phrases that go with the words, each optional: what a pack that leaves it out gets. This mirrors
// phrasesFor in src/packs.ts, which makes the same ones when the pack is saved.
export const PHRASES: [PhraseKey, string][] = [
  ["member", "One member"], ["log", "Past work"], ["ready", "It's up"], ["close", "Shut down"],
  ["closing", "Shutting down"], ["back", "Comes back"], ["depart", "Heads out"], ["hq", "Watch from"],
];
// Just the five words (a pack's words also carry its phrases, which have a place of their own).
const wordsOf = (from: Partial<Record<WordKey, string>> | undefined): Record<WordKey, string> => Object.fromEntries(WORDS.map((k) => [k, from?.[k] ?? GUILD_WORDS[k]])) as Record<WordKey, string>;
const NO_PHRASES: Record<PhraseKey, string> = { member: "", log: "", ready: "", close: "", closing: "", back: "", depart: "", hq: "" };
// The phrases a pack gave itself: those that aren't just what its words would make.
const givenBy = (words: Record<string, string> | undefined): Record<PhraseKey, string> => {
  if (!words) return NO_PHRASES;
  const made = phrasesFor({ crew: words.crew ?? "", quest: words.quest ?? "", camp: words.camp ?? "" });
  return Object.fromEntries(PHRASES.map(([k]) => [k, words[k] && words[k] !== made[k] ? words[k] : ""])) as Record<PhraseKey, string>;
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function PackDialog({ pack, packs, on = false, onClose, onSaved }: {
  pack: PackLine | null;             // null: a new pack
  packs: PackLine[];                 // every pack the camp has; the first is the Guild's
  on?: boolean;                      // this pack is the one the camp is wearing
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const guild = packs[0];
  const said = (p: PackLine | null | undefined, who: string) => (p?.crew as Record<string, Named & { short?: string[] }> | undefined)?.[who];
  const guildName = (who: string) => said(guild, who)?.name ?? cap(who);
  const everyone = CREW;
  // A new pack starts with the Guild's icons and words, and every name still to give.
  const namesFrom = (p: PackLine | null | undefined, blank = false): Record<string, Named> =>
    Object.fromEntries(everyone.map((who) => [who, { name: blank ? "" : said(p, who)?.name ?? "", emoji: said(p, who)?.emoji ?? said(guild, who)?.emoji ?? "" }]));

  const [from, setFrom] = useState("");
  const [base, setBase] = useState<PackLine | null>(pack);   // the pack the names here came from: a name left as it was keeps its short handle
  const [name, setName] = useState(pack?.name ?? "");
  const [about, setAbout] = useState(pack?.about ?? "");
  const [names, setNames] = useState(() => namesFrom(pack ?? guild, !pack));
  const [words, setWords] = useState<Record<WordKey, string>>(() => wordsOf(pack?.words ?? guild?.words));
  const [phrases, setPhrases] = useState<Record<PhraseKey, string>>(() => givenBy(pack?.words as Record<string, string> | undefined));
  const [typedMany, setTypedMany] = useState(!!pack && pack.words.quests !== many(pack.words.quest));
  const [place, setPlace] = useState(pack?.place ?? "");
  const [palette, setPalette] = useState<string>(pack?.palette ?? "camp");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  // "Start from": another pack's names, words, place and colours, to change from there. The pack's
  // own name and its line about itself stay as you've typed them.
  function startFrom(id: string) {
    setFrom(id);
    const p = packs.find((x) => x.id === id) ?? null;
    setBase(p);
    setNames(namesFrom(p ?? guild, !p));
    setWords(wordsOf(p?.words ?? guild?.words));
    setTypedMany(!!p && p.words.quests !== many(p.words.quest));
    setPhrases(givenBy(p?.words as Record<string, string> | undefined));
    setPlace(p?.place ?? "");
    setPalette(p?.palette ?? "camp");
  }
  const setNamed = (who: string, part: Partial<Named>) => setNames((all) => ({ ...all, [who]: { ...all[who], ...part } }));
  function setWord(key: WordKey, value: string) {
    setWords((all) => ({ ...all, [key]: value, ...(key === "quest" && !typedMany ? { quests: value.trim() ? many(value.trim()) : "" } : {}) }));
    if (key === "quests") setTypedMany(true);
    // A phrase still as the pack you started from had it was made for that pack's place ("returns to the
    // ship"): once the place, the crew or the quest is renamed, it goes back to what the new words make.
    if (key === "camp" || key === "crew" || key === "quest") {
      const was = base?.words as Record<string, string> | undefined;
      if (was) setPhrases((all) => Object.fromEntries(PHRASES.map(([k]) => [k, all[k] && all[k] === was[k] ? "" : all[k]])) as Record<PhraseKey, string>);
    }
  }

  async function send(body: object) {
    setSaving(true);
    setError("");
    try { const r = await api("/api/packs", body) as { id?: string }; onSaved(r?.id ?? pack?.id ?? ""); }
    catch (e) { setError(errorText(e)); setSaving(false); }
  }
  function save(ev: FormEvent) {
    ev.preventDefault();
    if (!name.trim()) { setError("Give the pack a name."); nameInput.current?.focus(); return; }
    const unnamed = everyone.find((who) => !names[who]?.name.trim());
    if (unnamed) { setError(`The ${guildName(unnamed)} needs a name in this pack.`); return; }
    const line = (who: string) => {
      const was = said(base, who);
      const n = names[who];
      return { name: n.name, emoji: n.emoji, ...(was?.short && was.name === n.name.trim() ? { short: was.short } : {}) };
    };
    const details = {
      name, about, place, palette,
      words: { ...words, ...Object.fromEntries(PHRASES.map(([k]) => [k, phrases[k].trim()]).filter(([, v]) => v)) }, // (a phrase left blank is made from the words)
      crew: Object.fromEntries(CREW.map((who) => [who, line(who)])),
    };
    void send(pack ? { action: "update", id: pack.id, pack: details } : { action: "add", pack: details });
  }
  async function remove() {
    if (!pack) return;
    const body = `${on ? `The ${w("camp")} is wearing it now, so it goes back to the Guild pack. ` : ""}The names it gave still work after @, and history keeps them.`;
    if (await ask({ title: `Delete the ${pack.name} pack?`, body, action: "Delete", danger: true })) void send({ action: "remove", id: pack.id });
  }

  return (
    <Dialog as="form" className="dialog" labelledBy="pack-dialog-title" onClose={onClose} onSubmit={save}>
        <h2 id="pack-dialog-title">{pack ? `Edit the ${pack.name} pack` : "New theme pack"}</h2>
        {!pack && (
          <label className="field">Start from
            <select value={from} onChange={(ev) => startFrom(ev.target.value)}>
              <option value="">The Guild's icons and words, and names of your own</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">Pack name
          <input ref={nameInput} value={name} maxLength={24} placeholder="e.g. Pirate Ship, Kitchen, Orchestra" onChange={(ev) => setName(ev.target.value)} />
        </label>
        <label className="field">About it
          <input value={about} maxLength={80} placeholder="One line, shown when you point at the pack in Settings." onChange={(ev) => setAbout(ev.target.value)} />
        </label>

        <div className="field" role="group" aria-label={`What it calls the ${w("crew")}`}>What it calls the crew
          <span className="field-hint">An icon and a name for each. A name can't be one another {w("crew")} member has, in this pack or any other: every pack's names keep working after @.</span>
          <div className="pack-names">
            {everyone.map((who) => (
              <div key={who} className="pack-name">
                <span>{guildName(who)}</span>
                <input className="pack-emoji" value={names[who]?.emoji ?? ""} maxLength={8} aria-label={`Icon for the ${guildName(who)}`} onChange={(ev) => setNamed(who, { emoji: ev.target.value })} />
                <input value={names[who]?.name ?? ""} maxLength={24} aria-label={`Name for the ${guildName(who)}`} placeholder={guildName(who)} onChange={(ev) => setNamed(who, { name: ev.target.value })} />
              </div>
            ))}
          </div>
        </div>

        <div className="field" role="group" aria-label="Its words">Its words
          <span className="field-hint">What the page says where the Guild says these. Lowercase; the page capitalises them where it needs to.</span>
          <div className="pack-names pack-words">
            {WORDS.map((key) => (
              <div key={key} className="pack-name">
                <span>{cap(key)}</span>
                <input value={words[key]} maxLength={24} aria-label={`Word for ${key}`} placeholder={GUILD_WORDS[key]} onChange={(ev) => setWord(key, ev.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <details className="field pack-more">
          <summary>More phrases</summary>
          <span className="field-hint">Where a word alone won't read ("break camp" isn't "break ship"). Leave any blank and it's made from the words above, as shown.</span>
          <div className="pack-names pack-words">
            {PHRASES.map(([key, what]) => (
              <div key={key} className="pack-name">
                <span>{what}</span>
                <input value={phrases[key]} maxLength={40} aria-label={`Phrase for ${key}`} placeholder={phrasesFor(words)[key]} onChange={(ev) => setPhrases((all) => ({ ...all, [key]: ev.target.value }))} />
              </div>
            ))}
          </div>
        </details>

        <label className="field">Where the {w("crew")} works
          <input value={place} maxLength={60} placeholder={`the Mae ${words.camp.trim() || "camp"}`} onChange={(ev) => setPlace(ev.target.value)} />
        </label>
        <div className="field-hint dialog-under">The {w("crew")} reads this: "You are the {names.scout?.name.trim() || "Scout"} of {place.trim() || `the Mae ${words.camp.trim() || "camp"}`}."</div>

        <div className="field" role="group" aria-label="Colours it suggests">Colours it suggests
          <div className="looks">
            {PALETTES.map((p) => (
              <button key={p.id} type="button" className={cx("look", `p-${p.id}`)} aria-pressed={palette === p.id} title={p.about} onClick={() => setPalette(p.id)}><i aria-hidden="true" />{p.name}</button>
            ))}
          </div>
          <span className="field-hint">Your own choice under Colours still wins. The orb keeps those colours too: a pack of your own doesn't recolour it.</span>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          {pack && <button type="button" className="btn danger dialog-remove" disabled={saving} onClick={remove}>Delete this pack</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : pack ? "Save" : "Add pack"}</button>
        </div>
    </Dialog>
  );
}
