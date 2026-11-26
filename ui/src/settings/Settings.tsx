// Settings: one place for how the camp runs. A modal over mission control (the camp stays in
// view behind it; click outside or press Escape to close), with a section list on the left: the runtime and look, each crew member (who they are, their model),
// how much the crew may do without asking, limits, phone approvals, the camp's activity (usage,
// jobs, inbox), and its knowledge (memory, skills, connectors). (The wiki has a page of its own: components/Wiki.tsx.)

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { About } from "../components/AgentDrawer.tsx";
import { AUTO_CHOICES, useModelList } from "../components/ModelPicker.tsx";
import { Connectors, Skills } from "../panels/Records.tsx";
import { MemoryPage } from "./MemoryPage.tsx";
import { ModelsPage } from "./ModelsPage.tsx";
import { VoicePage } from "./VoicePage.tsx";
import { canNotify, notificationsOn, toggleNotifications } from "../notifications.ts";
import { chimeOn, playChime, setChime } from "../chime.ts";
import { showCost } from "../prefs.ts";
import { outpostName } from "../outpost.ts";
import { PALETTES, modeNow, paletteNow, seasonChoice, seasonNow, setMode, setPalette, setSeason, wearPack, type Mode, type PaletteId, type SeasonChoice } from "../themes.ts";
import { SEASONS, seasonById } from "../seasons.ts";
import { autoName, cClass, cx, isAuto, leadName, money, nameNow } from "../format.ts";
import { w, a as an } from "../words.ts";
import type { AgentDetail, CampState, Character, Link } from "../types.ts";
import { Icon, type IconName } from "../components/bits.tsx";
import { ask, Confirm } from "../components/Confirm.tsx";
import { PackDialog, type PackLine } from "../components/PackDialog.tsx";
import { Presence } from "../motion.tsx";
import { SkillImport } from "./SkillImport.tsx";
import { SkillEditor } from "./SkillEditor.tsx";
import { TerminalActions } from "./TerminalActions.tsx";

import type { SettingsSection } from "./sections.ts";
import { complain, StatusLine } from "../components/StatusLine.tsx";
import { switchRuntime } from "../runtime.ts";
export { isSettingsSection, type SettingsSection } from "./sections.ts";
type NavItem = [SettingsSection, string, IconName];
// The navigation, in groups. A label is a function where it names the outpost or a theme-pack noun.
const groups = (): { title: string; items: NavItem[] }[] => [
  { title: w("Camp"), items: [["general", "General", "gear"], ["models", "Models", "cpu"], ["crew", `${w("Crew")}`, "users"], ["connectors", "Connectors", "plug"]] },
  { title: "Look & sound", items: [["appearance", "Appearance", "theme"], ["notifications", "Notifications", "bell"], ["voice", "Voice", "speaker"]] },
  { title: "Safety", items: [["approvals", "Approvals", "shield"], ["limits", "Limits & budget", "gauge"]] },
  { title: "Access", items: [["devices", "Devices & uploads", "link"], ["phone", "Phone", "phone"], ["terminal", "Terminal", "terminal"]] },
  { title: "Knowledge", items: [["memory", "Memory", "bookmark"], ["skills", "Skills", "bolt"]] },
];

const PACK_CREW = ["quartermaster", "scout", "artificer", "scribe", "warden", "wizard"] as const; // in the order the crew is listed
const tryIt = async (work: () => Promise<unknown>, then: () => void) => {
  try { await work(); then(); } catch (e) { complain(errorText(e)); }
};

// A labelled setting: name and explanation on the left, the control on the right.
// A setting's explanation: two lines of it, and "More" for the rest when there is a rest, so a
// page of settings reads as a list of settings.
function Help({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [children, open]);
  return (
    <>
      <p ref={text} className={open ? undefined : "help-short"}>{children}</p>
      {(long || open) && <button type="button" className="linkish help-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Less" : "More"}</button>}
    </>
  );
}

function Row({ label, help, children, wide }: { label: string; help?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("set-row", wide && "wide")}>
      <div className="set-label"><b>{label}</b>{help && <Help>{help}</Help>}</div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}

// A group of choices, each with a line of explanation.
function Choices<T extends string>({ name, value, options, onChange }: {
  name: string; value: T; options: { id: T; label: string; help: string; disabled?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.id} className={cx("choice", value === o.id && "on", o.disabled && "off")} title={o.disabled}>
          <input type="radio" name={name} checked={value === o.id} disabled={!!o.disabled} onChange={() => onChange(o.id)} />
          <span><b>{o.label}</b><span>{o.disabled ?? o.help}</span></span>
        </label>
      ))}
    </div>
  );
}

// ---------- General ----------

// The files you've attached, and clearing out the ones nothing uses any more. Nothing is deleted
// unless you press the button (which says what will go) or pick a number of days here.
type UploadsUsage = { files: number; bytes: number; clearable: { batches: number; files: number; bytes: number } };
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
function Uploads({ S, refresh }: { S: CampState; refresh: () => void }) {
  const [u, setU] = useState<UploadsUsage | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const load = useCallback(() => { api<UploadsUsage>("/api/uploads/usage").then((r) => setU(r?.clearable ? r : null)).catch(() => setU(null)); }, []);
  useEffect(load, [load]);
  const keep = S.settings.uploadKeepDays;
  const clear = async () => {
    setBusy(true);
    try {
      const r = await api<{ cleared: { files: number; bytes: number } }>("/api/uploads/clear", {});
      setSaid(r.cleared.files ? `Deleted ${r.cleared.files} ${r.cleared.files === 1 ? "file" : "files"} (${mb(r.cleared.bytes)}).` : "There was nothing to delete.");
    } catch (e) { setSaid(errorText(e)); }
    setBusy(false); setAsking(false); load();
  };
  const n = u?.clearable.files ?? 0;
  return (
    <>
      <Row label="Uploads" wide help={<>Files you attach are kept in <code>camp/uploads</code>{u ? <>: {u.files} {u.files === 1 ? "file" : "files"}, {mb(u.bytes)}</> : null}. One is only ever deleted when it's at least a day old and nothing uses it any more: no conversation in your history, no project's pinned reference, no wiki page. Deleting is for good.</>}>
        <select aria-label="Delete unused uploads automatically" value={keep ?? ""} onChange={(ev) => tryIt(() => api("/api/uploads/keep", { days: ev.target.value ? Number(ev.target.value) : null }), refresh)}>
          <option value="">Keep them all</option>
          <option value="30">Delete unused ones after 30 days</option>
          <option value="90">Delete unused ones after 90 days</option>
          <option value="365">Delete unused ones after a year</option>
          {keep && ![30, 90, 365].includes(keep) && <option value={keep}>Delete unused ones after {keep} days</option>}
        </select>{" "}
        <button type="button" className="btn small" disabled={!n || busy} onClick={() => { setSaid(""); setAsking(true); }}>{n ? `Delete ${n} unused now…` : "Nothing unused to delete"}</button>
        {said && <span className="meta" role="status"> {said}</span>}
      </Row>
      {asking && u && (
        <Confirm title="Delete unused uploads?" action={`Delete ${n} ${n === 1 ? "file" : "files"}`} danger busy={busy} onConfirm={clear} onCancel={() => setAsking(false)}>
          <p>{n} {n === 1 ? "file" : "files"} ({mb(u.clearable.bytes)}) that no conversation in your history, pinned reference or wiki page uses any more, each at least a day old.</p>
          <p>They're deleted from <code>camp/uploads</code> for good: there's no bin to get them back from.</p>
        </Confirm>
      )}
    </>
  );
}

// Signing in another browser: a one-time link, made here by a browser that's already in. And,
// when the camp is in LAN mode, where your other machines reach it.
function OtherDevices({ S }: { S: CampState }) {
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const lan = S.settings.lan;
  const make = async () => {
    setNote("");
    try {
      const r = await api<{ link: string; minutes: number }>("/api/login/link", {});
      setLink(r.link);
      setNote(`Good once, for ${r.minutes} minutes.`);
    } catch (e) { setLink(""); setNote(errorText(e)); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setNote("Copied."); }
    catch { setNote(`Select the link and copy it (this browser only copies for you over HTTPS or on the ${w("camp")}'s own machine).`); }
  };
  return (
    <Row label="Other devices" wide help={lan
      ? <>Your other machines on this network reach the {w("camp")} at {lan.length ? lan.map((a, i) => <span key={a}>{i ? ", " : ""}<code>{a}</code></span>) : "this machine's network address (it has none just now)"}. It's plain HTTP, for a home network you trust. The terminal pane only opens on the {w("camp")}'s own machine.</>
      : <>Only this machine can reach the {w("camp")}. To use it from your other machines at home, start it with <code>CAMP_LAN=1</code> (see the README). A sign-in link is also how a second browser on this machine gets in.</>}>
      <button type="button" className="btn small" onClick={make}>Make a sign-in link</button>
      {link && <> <input className="signin-link" aria-label="Sign-in link" readOnly value={link} onFocus={(ev) => ev.currentTarget.select()} /> <button type="button" className="btn small" onClick={copy}>Copy</button></>}
      {note && <span className="meta" role="status"> {note}</span>}
    </Row>
  );
}

// This outpost's name: "Outpost <name>" in the header, the tab's title and notifications. Kept in
// camp/outpost.json; the folder it lives in stays where it is.
function OutpostName({ S, refresh }: { S: CampState; refresh: () => void }) {
  const now = S.settings.outpost ?? outpostName();
  const [name, setName] = useState(now);
  const [note, setNote] = useState("");
  useEffect(() => { setName(now); }, [now]);
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setNote("");
    try {
      const r = await api<{ name?: string }>("/api/outpost/name", { name });
      const saved = r.name ?? name.trim();
      setName(saved);
      setNote(saved === now ? "" : "Saved.");
      refresh();
    } catch (e) { setNote(errorText(e)); }
  };
  return (
    <Row label="Outpost name" help={<>Shown under "Outpost" in the header and in the tab's title, notifications and the theme packs' places, so you can tell your outposts apart (say, Work and Home). Letters, digits and spaces, up to 24 characters. Kept in <code>camp/outpost.json</code>.</>}>
      <form className="inline-form" onSubmit={save}>
        <input aria-label="Outpost name" value={name} maxLength={24} onChange={(ev) => { setName(ev.target.value); setNote(""); }} />
        <button className="btn small primary" type="submit" disabled={!name.trim() || name.trim() === now}>Save</button>
        {note && <span className="meta" role="status"> {note}</span>}
      </form>
    </Row>
  );
}

// Decorations (seasons.ts): off, whatever the calendar says, or one by name.
const monthDay = (mmdd: string) => { const [m, d] = mmdd.split("-").map(Number); return new Date(2024, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric" }); };
const decorChoices = (): { id: SeasonChoice; name: string; about: string }[] => [
  { id: "", name: "Off", about: "No decorations." },
  { id: "auto", name: "Follow the calendar", about: `${SEASONS.map((s) => `${s.name} from ${monthDay(s.from)} to ${monthDay(s.to)}`).join("; ")}. Nothing the rest of the year.` },
  ...SEASONS.map((s) => ({ id: s.id, name: s.name, about: s.about })), // about is read now: some of it names the pack's words
];

// General: the outpost's name, what runs the crew, and a couple of small switches. How the page
// looks, notifications, and other devices and uploads each have a page of their own.
function General({ S, refresh }: { S: CampState; refresh: () => void }) {
  const costShown = showCost.use();
  const locked = S.settings.runtimeLocked;
  const plan = S.login?.plan ? S.login.plan[0].toUpperCase() + S.login.plan.slice(1) : "";
  async function setRuntime(next: string) {
    if (next === S.runtime) return;
    await switchRuntime(next, refresh);
  }
  return (
    <>
      <OutpostName S={S} refresh={refresh} />
      <Row label={`What runs the ${w("crew")}`} help={locked ? `CAMP_RUNTIME=${locked} is set for this server, so it can't be changed here.` : "Applies from the next run. Nothing running is interrupted."} wide>
        <Choices name="Runtime" value={S.runtime} onChange={setRuntime} options={[
          { id: "claude-code", label: `Claude subscription${plan ? ` (${plan})` : ""}`, help: S.login && !S.login.ok ? S.login.problem ?? "Not signed in" : "Through Claude Code. Counts against your plan's usage limits.", disabled: locked ? "Set by CAMP_RUNTIME" : undefined },
          { id: "api", label: "API key", help: "Billed per token to your Anthropic API account.", disabled: locked ? "Set by CAMP_RUNTIME" : undefined },
        ]} />
      </Row>
      <Row label="Name conversations automatically" help="After a new conversation's first answer, the smallest model writes it a short title. Each one uses a little of your plan (or a fraction of a cent on the API). Off, a conversation is named after its first request.">
        <label className="switch"><input type="checkbox" checked={S.settings.autoTitles}
          onChange={(ev) => tryIt(() => api("/api/auto-titles", { on: ev.target.checked }), refresh)} /> {S.settings.autoTitles ? "On" : "Off"}</label>
      </Row>
      <Row label="Today's cost in the status menu" help={`${S.runtime === "claude-code" ? "The estimate at API prices (your plan isn't charged per run)" : "What the API has cost today"}. It's in the menu under the top bar's status chip (Idle, or what's running). Remembered in this browser. Usage & ${w("expeditions")}, in this menu, always shows it.`}>
        <label className="switch"><input type="checkbox" checked={costShown} onChange={(ev) => showCost.set(ev.target.checked)} /> {costShown ? "Shown" : "Hidden"}</label>
      </Row>
    </>
  );
}

// Appearance: light or dark, the theme pack, colours and decorations.
function Appearance({ S, refresh }: { S: CampState; refresh: () => void }) {
  const [theme, setTheme] = useState<Mode>(modeNow);
  const [palette, setPaletteShown] = useState<PaletteId>(paletteNow);
  const [season, setSeasonShown] = useState<SeasonChoice>(seasonChoice);
  const inSeason = seasonById(seasonNow())?.name;
  const decorNow = season === "auto" ? (inSeason ? `Today that's ${inSeason}.` : "Nothing is in season today.") : season ? seasonById(season)?.about ?? "" : "";
  // The camp keeps the pack (the crew is renamed in what they read and write too); the page wears
  // it at once, and takes the colours it suggests unless you've chosen your own.
  const packs = S.packs ?? [];
  const setPack = (id: string) => tryIt(async () => {
    await api("/api/pack", { id });
    wearPack(id, packs);
    setPaletteShown(paletteNow());
  }, refresh);
  // A pack of your own: the dialog that makes or changes one. The page wears what comes back (App
  // does, when the camp's state changes); the colours shown here follow it.
  const [packDialog, setPackDialog] = useState<{ pack: PackLine | null } | null>(null);
  const closePack = useCallback(() => setPackDialog(null), []);
  useEffect(() => { setPaletteShown(paletteNow()); }, [S.pack, S.packs]);
  return (
    <>
      <Row label="Theme" help="Light or dark. Remembered in this browser.">
        <select aria-label="Theme" value={theme} onChange={(ev) => { const t = ev.target.value as Mode; setTheme(t); setMode(t); }}>
          <option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </Row>
      <Row label="Theme pack" wide help={<>Renames the {w("camp")}'s own six, for you <b>and for the {w("crew")} too</b>: from the next run on they call themselves and each other by the pack's names in what they write. It also changes a few of the page's words and the orb's colours, and suggests colours below (your own choice of colours wins). Old names still work after @, and history keeps the names it was written with. You can make a pack of your own: it's kept in <code>camp/packs.json</code>, and it leaves the orb's colours as they are.</>}>
        <div className="looks" role="group" aria-label="Theme pack">
          {packs.map((p) => {
            const button = (
              <button key={p.id} type="button" className="look pack" aria-pressed={S.pack === p.id} title={`${p.about} ${PACK_CREW.map((id) => p.crew[id]?.name).filter(Boolean).join(", ")}.`}
                onClick={() => { if (p.id !== S.pack) void setPack(p.id); }}><span aria-hidden="true">{p.crew.quartermaster?.emoji}</span>{p.name}</button>
            );
            return p.custom ? (
              <span key={p.id} className="look-pair">{button}
                <button type="button" className="icon-btn look-edit" aria-label={`Edit the ${p.name} pack`} title={`Edit the ${p.name} pack`} onClick={() => setPackDialog({ pack: p })}>✎</button>
              </span>
            ) : button;
          })}
          <button type="button" className="look pack-new" onClick={() => setPackDialog({ pack: null })}>New pack…</button>
        </div>
        {(S.packsLeftOut ?? []).map((p) => (
          <p key={p.id} className="field-hint pack-left-out" role="note">The pack "{p.id}" in <code>camp/packs.json</code> was left out. {p.why}</p>
        ))}
      </Row>
      {packDialog && (
        <PackDialog pack={packDialog.pack} packs={packs} on={packDialog.pack?.id === S.pack}
          onClose={closePack} onSaved={() => { closePack(); refresh(); }} />
      )}
      <Row label="Colours" help={`${PALETTES.find((p) => p.id === palette)?.about ?? ""} Each has a light and a dark side, and the tour wears it too.`} wide>
        <div className="looks" role="group" aria-label="Colours">
          {PALETTES.map((p) => (
            <button key={p.id} type="button" className={`look p-${p.id}`} aria-pressed={palette === p.id}
              onClick={() => { setPaletteShown(p.id); setPalette(p.id); }}><i aria-hidden="true" />{p.name}</button>
          ))}
        </div>
      </Row>
      <Row label="Decorations" wide help={<>Only for looks: snow, bats or confetti, a string of lights and a tint on the orb, on top of any theme pack and colours. Nothing the {w("crew")} reads or writes changes, and the choice is kept in this browser. {decorNow} If your system asks for less motion, nothing moves.</>}>
        <div className="looks" role="group" aria-label="Decorations">
          {decorChoices().map((d) => (
            <button key={d.id || "off"} type="button" className="look decor" aria-pressed={season === d.id} title={d.about}
              onClick={() => { setSeasonShown(d.id); setSeason(d.id); }}>{d.name}</button>
          ))}
        </div>
      </Row>
    </>
  );
}

// Notifications: a ping in this browser when the camp needs you, and the chime that goes with it.
function Notifications() {
  const [, redraw] = useState(0);
  return (
    <>
      <Row label="Browser notifications" help={!canNotify() ? "This browser can't show notifications." : Notification.permission === "denied" ? "Blocked for this page in your browser's settings." : `A ping when the ${w("camp")} needs a decision.`}>
        {canNotify() && (
          <label className="switch"><input type="checkbox" checked={notificationsOn()} disabled={Notification.permission === "denied"}
            onChange={async () => { await toggleNotifications(); redraw((n) => n + 1); }} /> {notificationsOn() ? "On" : "Off"}</label>
        )}
      </Row>
      {notificationsOn() && (
        <Row label="Notification sound" help={`A soft chime with each notification: rising when a decision is needed, settling when ${an("expedition")} finishes, falling when one fails. Remembered in this browser.`}>
          <label className="switch"><input type="checkbox" checked={chimeOn()}
            onChange={(ev) => { setChime(ev.target.checked); if (ev.target.checked) playChime("ask"); redraw((n) => n + 1); }} /> {chimeOn() ? "On" : "Off"}</label>
          <button type="button" className="btn small" onClick={() => playChime("ask")}>Decision</button>
          <button type="button" className="btn small" onClick={() => playChime("done")}>Finished</button>
          <button type="button" className="btn small" onClick={() => playChime("fail")}>Failed</button>
        </Row>
      )}
    </>
  );
}

// ---------- Crew ----------
function ModelForm({ c, runtime, refresh }: { c: Character; runtime: string; refresh: () => void }) {
  const { list, error: loadError } = useModelList(runtime);
  const [model, setModel] = useState(c.model);
  const [effort, setEffort] = useState<string>(c.effort);
  const [turns, setTurns] = useState(String(c.maxTurns));
  const [note, setNote] = useState("");
  const m = list?.models.find((x) => x.id === model);
  const efforts: string[] = m?.efforts ?? [];
  const chosenEffort = efforts.includes(effort) ? effort : "";
  const dirty = model !== c.model || chosenEffort !== (c.effort === "default" ? "" : c.effort) || turns !== String(c.maxTurns);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const t = turns.trim();
    const maxTurns = t === "" || Number(t) === c.defaultMaxTurns ? null : Number(t);
    try { await api("/api/agents", { id: c.id, model, effort: chosenEffort || null, maxTurns }); setNote(`Saved. Applies from ${c.name}'s next run.`); refresh(); }
    catch (e) { setNote(errorText(e)); }
  }
  async function reset() {
    try { await api("/api/agents", { id: c.id, reset: true }); setModel(c.defaultModel); setEffort(c.defaultEffort); setTurns(String(c.defaultMaxTurns)); setNote(`Back to the ${w("crew")} defaults.`); refresh(); }
    catch (e) { setNote(errorText(e)); }
  }
  return (
    <form onSubmit={save}>
      <Row label="Model" help={isAuto(model) ? "Auto picks the model and effort for each task, and says which it used and why." : m?.price ? `Per million tokens: ${m.price} (input / output).` : loadError || undefined}>
        <select aria-label="Model" value={list ? model : ""} disabled={!list} onChange={(ev) => setModel(ev.target.value)}>
          {!list && <option value="">Loading models…</option>}
          {list && !isAuto(c.model) && !list.models.some((x) => x.id === c.model) && <option value={c.model}>{c.model}</option>}
          {list && AUTO_CHOICES.map((a) => <option key={a.id} value={a.id}>{autoName(a.id)}{a.id === "auto:balanced" ? " (recommended)" : ""}</option>)}
          {list?.models.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === c.defaultModel ? " (default)" : ""}</option>)}
        </select>
      </Row>
      <Row label="Reasoning effort" help={list && !efforts.length ? "This model doesn't take an effort setting." : "Higher thinks longer and costs more."}>
        <select aria-label="Effort" value={chosenEffort} disabled={!efforts.length} onChange={(ev) => setEffort(ev.target.value)}>
          <option value="">Model's own default</option>
          {efforts.map((e) => <option key={e} value={e}>{e}{e === c.defaultEffort ? ` (${w("crew")} default)` : ""}</option>)}
        </select>
      </Row>
      <Row label="Max turns per run" help={`One reply and its tool calls is a turn. ${w("Crew")} default: ${c.defaultMaxTurns}.`}>
        <input aria-label="Max turns" type="number" min={5} max={200} step={5} value={turns} placeholder={String(c.defaultMaxTurns)} onChange={(ev) => setTurns(ev.target.value)} />
      </Row>
      <div className="set-actions">
        <button className="btn small primary" type="submit" disabled={!list || !dirty}>Save</button>
        <button className="btn small" type="button" disabled={!c.overridden} onClick={reset}>Reset to defaults</button>
        <span className="meta">{note}</span>
      </div>
    </form>
  );
}

function Crew({ S, refresh }: { S: CampState; refresh: () => void }) {
  const [id, setId] = useState(() => storeGet("camp-settings-agent") ?? S.characters[0]?.id);
  const c = S.characters.find((x) => x.id === id) ?? S.characters[0];
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  useEffect(() => {
    let gone = false;
    setDetail(null);
    api<AgentDetail>(`/api/agent?id=${encodeURIComponent(c.id)}`).then((d) => { if (!gone) setDetail(d); }, () => {});
    return () => { gone = true; };
  }, [c.id, c.model, c.effort]);
  return (
    <>
      <div className="set-applies">
        <span>Applies to</span>
        <div className="seg">
          {S.characters.map((x) => (
            <button key={x.id} type="button" className={cx("seg-btn", cClass(x.name))} aria-pressed={x.id === c.id}
              onClick={() => { setId(x.id); storeSet("camp-settings-agent", x.id); }}>{x.emoji} {x.name}</button>
          ))}
        </div>
      </div>
      <div className={cx("set-agent", cClass(c.name))}>
        <div className="avatar" aria-hidden="true">{c.emoji}</div>
        <div><h3>{c.name}</h3><p>{c.role}</p></div>
      </div>
      <h4 className="set-sub">Model</h4>
      <ModelForm key={`${c.id}-${c.model}-${c.effort}-${c.maxTurns}`} c={c} runtime={S.runtime} refresh={refresh} />
      <h4 className="set-sub">{w("Member")} info</h4>
      <p className="set-note">{c.custom
        ? `You added this ${w("crew")} member. Change their name, role and how they work with the pencil on their card in the ${w("crew")} panel. Their memory and skills grow over time.`
        : `The built-in ${w("crew")}'s names, roles and personalities are set by the app, so they stay the same. Add your own ${w("crew")} member with + in the ${w("crew")} panel. Memory and skills grow over time.`}</p>
      {detail ? <About a={detail} /> : <div className="meta">Loading…</div>}
    </>
  );
}

// ---------- Approvals ----------
function ListEditor({ label, value, placeholder, onSave }: { label: string; value: string[]; placeholder: string; onSave: (lines: string[]) => void }) {
  const saved = value.join("\n");
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  return (
    <div className="list-edit">
      <textarea aria-label={label} spellCheck={false} placeholder={placeholder} value={text} onChange={(ev) => setText(ev.target.value)} />
      <div><button type="button" className="btn small primary" aria-label={`Save ${label.toLowerCase()}`} disabled={text === saved} onClick={() => onSave(text.split("\n"))}>Save</button></div>
    </div>
  );
}

function Approvals({ S, refresh }: { S: CampState; refresh: () => void }) {
  const st = S.settings;
  const noSandbox = S.sandbox.available ? undefined : "Needs macOS (sandbox-exec), or Linux with bubblewrap (bwrap) installed.";
  return (
    <>
      <Row label="Approval level" help={`What the ${w("crew")}'s shell commands may do without asking you. Plans, new scheduled jobs and connector writes always ask.`} wide>
        <Choices name="Approval level" value={st.approval} onChange={(level) => tryIt(() => api("/api/approvals", { level }), refresh)} options={[
          { id: "ask", label: "Ask every time", help: "Every command waits for your OK, even ls and git status. Your allow-lists below are ignored." },
          { id: "safe", label: "Allow safe commands (default)", help: "Simple read-only commands (ls, git status, git diff…) and your allow-lists run; everything else asks." },
          { id: "sandbox", label: "Sandbox the rest", help: `Everything else runs without asking, with no network and writes only inside the project and the ${w("crew")}’s own outputs. Installs and pushes still ask.`, disabled: noSandbox },
          { id: "god", label: "God mode", help: `Every command runs without asking, outside the sandbox: installs, pushes, the network, and changes to any file you can change. Nothing stands between the ${w("crew")} and your computer except your “Never run” and “Always ask” rules below. Scheduled jobs still run in the sandbox.` },
        ]} />
      </Row>
      <Row label="Hosts the sandbox can reach" help={S.sandbox.kind === "bwrap"
        ? "On Linux the sandbox has no network at all for now, so this list isn't used: commands that need the network ask to run outside it."
        : <>Sandboxed commands can reach these hosts, and only these, through a proxy the {w("camp")} runs, so installs and fetches stop asking. One per line; <code>*.github.com</code> covers its subdomains. Tools that ignore proxy settings still get no network.</>} wide>
        <ListEditor label="Hosts the sandbox can reach" value={st.allowHosts} placeholder={"registry.npmjs.org\npypi.org\nfiles.pythonhosted.org"} onSave={(allowHosts) => tryIt(() => api("/api/shell", { allowHosts }), refresh)} />
      </Row>
      <Row label="Never run" help={<>Commands that never run, whatever else allows them: not with your OK, not in the sandbox. One per line; <code>*</code> matches anything, so <code>git push*</code> covers every push. Each part of a chained command is checked, so <code>cd web &amp;&amp; git push</code> is caught too.</>} wide>
        <ListEditor label="Commands that never run" value={st.deny} placeholder={"git push*\nrm -rf *"} onSave={(deny) => tryIt(() => api("/api/shell", { deny }), refresh)} />
      </Row>
      <Row label="Always ask" help="Commands that always wait for your OK, even where the sandbox or your allow-list would run them. Same patterns as above." wide>
        <ListEditor label="Commands that always ask" value={st.askAlways} placeholder={"npm install*\ngit commit*"} onSave={(ask) => tryIt(() => api("/api/shell", { ask }), refresh)} />
      </Row>
      <Row label="Approval reviewer" help="Before a command waits for you, the smallest model looks at it. It can run a routine one (tests, builds, formatters, read-only commands) and says so in the feed, or leave it for you with its reason. It never declines for you, and it can't clear anything with sudo, deleting, pushing, installs or the network, or anything in a scheduled job. Each look is a small call.">
        <label className="switch"><input type="checkbox" checked={st.reviewer} onChange={(ev) => tryIt(() => api("/api/shell-reviewer", { on: ev.target.checked }), refresh)} /> {st.reviewer ? "On" : "Off"}</label>
      </Row>
      <Row label="Approvals in plain words" help="When a shell command or a connector call waits for you, the smallest model adds a short summary to its card: what it does, what it changes, what it contacts outside this machine, and anything worth a second look. It's a reading aid: it never approves anything, it can be wrong, and what runs is the command on the card. Each summary is one small call (free if your small jobs run on a free model, under Models); the same command isn't summarized twice.">
        <label className="switch"><input type="checkbox" checked={st.plainApprovals} onChange={(ev) => tryIt(() => api("/api/plain-approvals", { on: ev.target.checked }), refresh)} /> {st.plainApprovals ? "On" : "Off"}</label>
      </Row>
      <Row label="Your allow-list" help={<>Command prefixes that run without asking, one per line. <code>npm run build</code> also allows <code>npm run build --watch</code>, and <code>*</code> matches anything (<code>npm run test:*</code>). Only simple commands match (no pipes, chaining or paths outside the {w("camp")}). Test runners run project code the {nameNow("Artificer")} can edit, so add them only if that's fine with you.</>} wide>
        <ListEditor label="Allowed command prefixes" value={st.allow} placeholder={"npm run build\npytest"} onSave={(allow) => tryIt(() => api("/api/shell", { allow }), refresh)} />
      </Row>
      <Row label="Always allowed" help="Exact commands you chose “Always allow” for on an approval. Remove one to be asked again." wide>
        {!st.exact.length ? <div className="meta">None yet.</div> : (
          <ul className="exact-list">
            {st.exact.map((cmd) => (
              <li key={cmd}><code>{cmd}</code>
                <button type="button" className="btn small danger" onClick={() => tryIt(() => api("/api/shell", { exact: st.exact.filter((x) => x !== cmd) }), refresh)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Built-in safe commands" help="Always allowed at the default level." wide>
        <div className="tool-chips" style={{ margin: 0 }}>{st.defaultAllow.map((c) => <code key={c}>{c}</code>)}</div>
      </Row>
      <Row label={`Let the ${w("crew")} edit the ${w("camp")}'s own code`} help={`src/, tests/, evals/ and package.json are read-only to the ${w("crew")} unless this is on. Leave it off unless you're asking them to improve the ${w("camp")} itself.`}>
        <label className="switch"><input type="checkbox" checked={st.selfEdit}
          onChange={async (ev) => { const on = ev.target.checked; if (!on || await ask({ title: `Let the ${w("crew")} change the ${w("camp")}'s own source code?`, action: "Let them", danger: true })) void tryIt(() => api("/api/self-edit", { on }), refresh); }} /> {st.selfEdit ? "On" : "Off"}</label>
      </Row>
    </>
  );
}

// ---------- Limits & budget ----------
function Limits({ S, refresh }: { S: CampState; refresh: () => void }) {
  const sub = S.runtime === "claude-code";
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  function saveBudget(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = String(new FormData(ev.currentTarget).get("budget") ?? "").trim();
    void tryIt(() => api("/api/budget", { usd: v === "" || Number(v) === 0 ? null : Number(v) }), refresh);
  }
  return (
    <>
      <Row label={`Budget per ${w("expedition")}`} help={S.budgetUsd ? `Stops ${an("expedition")} at ${money(S.budgetUsd)}, the whole ${w("crew")} together.` : `No limit.${sub ? " On your subscription, costs are estimates at API prices." : ""}`}>
        <form className="inline-form" onSubmit={saveBudget}>
          <span>$</span><input key={S.budgetUsd ?? "none"} name="budget" aria-label={`Budget per ${w("expedition")}`} type="number" min="0" step="0.25" placeholder="none" defaultValue={S.budgetUsd ?? ""} />
          <button className="btn small primary" type="submit">Save</button>
        </form>
      </Row>
      <Row label={`${w("Expeditions")} at once`} help={`The rest wait their turn. More at once uses your ${sub ? "plan's limits" : "API budget"} faster.`}>
        <select aria-label={`${w("Expeditions")} at once`} value={S.parallel} onChange={(ev) => tryIt(() => api("/api/parallel", { parallel: Number(ev.target.value) }), refresh)}>
          {range(S.settings.parallelMax).map((n) => <option key={n}>{n}</option>)}
        </select>
      </Row>
      <Row label={`${w("Quests")} at once`} help={`${w("Crew")} members working at the same time across every ${w("expedition")}. One ${leadName()} can send several in a turn.`}>
        <select aria-label={`${w("Quests")} at once`} value={S.settings.questsAtOnce} onChange={(ev) => tryIt(() => api("/api/quests-at-once", { n: Number(ev.target.value) }), refresh)}>
          {range(S.settings.questsMax).map((n) => <option key={n}>{n}</option>)}
        </select>
      </Row>
      <Row label="When a check fails" help={`After ${an("quest")} changes files in a linked folder, the ${w("camp")} runs that folder's checks (set on its project page). If one fails, the same ${w("crew")} member is sent back with the failing output to fix what it broke, and the checks run again. Each time is another ${w("quest")}'s worth of usage.`}>
        <select aria-label="When a check fails" value={S.settings.fixAttempts} onChange={(ev) => tryIt(() => api("/api/quest-checks", { fixAttempts: Number(ev.target.value) }), refresh)}>
          <option value={0}>Just report it</option>
          {range(S.settings.fixAttemptsMax).map((n) => <option key={n} value={n}>{n === 1 ? "Send it back once" : `Send it back up to ${n} times`}</option>)}
        </select>
      </Row>
      <Row label="Review changes before reporting" help={`Before the ${leadName()} sums up ${an("expedition")} that changed files in a linked folder, it sends the ${nameNow("Warden")} to read the actual diff and look for bugs, missing pieces and changes beyond the request; a real problem gets one fix. Another ${w("quest")}'s worth of usage each time, so it's off unless you want it.`}>
        <label className="switch"><input type="checkbox" checked={S.settings.reviewChanges}
          onChange={(ev) => tryIt(() => api("/api/quest-checks", { review: ev.target.checked }), refresh)} /> {S.settings.reviewChanges ? "On" : "Off"}</label>
      </Row>
      <Row label="Watch open pull requests" help={`Every few minutes while ${w("hq")} is open, the ${w("camp")} looks (with the GitHub CLI, as you) at the pull requests of worktrees the ${w("crew")} worked in lately: failing checks, review comments, conflicts with the base. A conversation whose pull request needs you says so at its top, where one click brings the feedback into a reply for you to read and send. Nothing is answered, pushed or merged by itself.`}>
        <label className="switch"><input type="checkbox" checked={S.settings.prWatch}
          onChange={(ev) => tryIt(() => api("/api/pr-watch", { on: ev.target.checked }), refresh)} /> {S.settings.prWatch ? "On" : "Off"}</label>
      </Row>
    </>
  );
}

// ---------- Phone ----------
const PHONE_KINDS: [string, string][] = [["plan", "Plans"], ["job", "New jobs"], ["shell", "Shell commands"], ["tool", "Connector writes"]];
function Phone({ S, refresh }: { S: CampState; refresh: () => void }) {
  const p = S.settings.phone;
  const [topic, setTopic] = useState(p.topic);
  const [server, setServer] = useState(p.server);
  const [approve, setApprove] = useState<string[]>(p.approve ?? ["plan", "job", "question"]);
  const [note, setNote] = useState("");
  async function save(ev: FormEvent) {
    ev.preventDefault();
    try { const r = await api<{ on: boolean }>("/api/phone", { topic, server, approve }); setNote(r.on ? "Saved. Phone approvals are on." : "Saved. Phone approvals are off."); refresh(); }
    catch (e) { setNote(errorText(e)); }
  }
  function randomTopic() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    setTopic("camp-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
  }
  return (
    <form onSubmit={save}>
      <p className="set-note">
        Get a notification through <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> when the {w("camp")} needs a decision, with Approve / Decline buttons.
        The text of each approval goes to the ntfy server, and anyone who knows the topic can read it and press the buttons, so make the topic long and random.
      </p>
      <Row label="Status"><span className={cx("pill", p.on ? "done" : "")}>{p.on ? "On" : "Off"}</span></Row>
      <Row label="Topic" help="Subscribe to this topic in the ntfy app. Leave it empty to turn phone approvals off." wide>
        <div className="inline-form">
          <input aria-label="ntfy topic" className="grow" value={topic} spellCheck={false} placeholder="camp-…" onChange={(ev) => setTopic(ev.target.value)} />
          <button type="button" className="btn small" onClick={randomTopic}>Generate</button>
        </div>
      </Row>
      <Row label="Server" help="Your own ntfy server, or leave empty for https://ntfy.sh." wide>
        <input aria-label="ntfy server" className="grow" value={server} spellCheck={false} placeholder="https://ntfy.sh" onChange={(ev) => setServer(ev.target.value)} />
      </Row>
      <Row label="Approve from the phone" help="Anything not ticked is notify-only: you answer it at your desk. Questions always need typing, so they're answered here." wide>
        <div className="checks">
          {PHONE_KINDS.map(([k, label]) => (
            <label key={k} className="switch"><input type="checkbox" checked={approve.includes(k)}
              onChange={(ev) => setApprove((a) => ev.target.checked ? [...a, k] : a.filter((x) => x !== k))} /> {label}</label>
          ))}
        </div>
      </Row>
      <div className="set-actions"><button className="btn small primary" type="submit">Save</button><span className="meta">{note}</span></div>
    </form>
  );
}

// ---------- Installed skills (the approved ones on disk) ----------
// Who follows a skill always. Normally a skill is listed for the crew by name and description,
// and opened when a task seems to match. Ticked here, its instructions go into every one of that
// crew member's prompts, so they follow it without having to notice it applies.
export function AlwaysOn({ S, skill, refresh }: { S: CampState; skill: CampState["installedSkills"][number]; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const on = skill.alwaysFor ?? [];
  const who = S.characters.filter((c) => skill.owner === "shared" || c.id === skill.owner);
  if (!who.length) return null;
  const set = async (id: string, yes: boolean) => {
    setBusy(true);
    try { await api("/api/skills/always", { owner: skill.owner, name: skill.name, agents: yes ? [...on, id] : on.filter((x) => x !== id) }); refresh(); }
    catch (e) { complain(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="skill-always" role="group" aria-label={`Who always follows ${skill.name}`}
      title={`Ticked, this skill's instructions are in every one of that ${w("crew")} member's prompts. Unticked, they see its name and description and open it when a task seems to match. Each one that's always on makes every prompt a little longer.`}>
      <span className="meta">Always on for</span>
      {who.map((c) => (
        <label key={c.id} className={cx("skill-always-who", on.includes(c.id) && "on")}>
          <input type="checkbox" checked={on.includes(c.id)} disabled={busy} onChange={(ev) => set(c.id, ev.target.checked)} /> {c.emoji} {c.name}
        </label>
      ))}
    </div>
  );
}

function InstalledSkills({ S, refresh }: { S: CampState; refresh: () => void }) {
  const [asking, setAsking] = useState<{ owner: string; name: string } | null>(null);
  const [editing, setEditing] = useState<{ owner: string; name: string } | null>(null);
  const closeEditor = useCallback(() => setEditing(null), []);
  const remove = async () => {
    if (!asking) return;
    try { await api("/api/skills/remove", asking); } catch (e) { complain(errorText(e)); }
    setAsking(null);
    refresh();
  };
  const owners = [...new Set(S.installedSkills.map((s) => s.owner))];
  const label = (o: string) => { const c = S.characters.find((x) => x.id === o); return c ? `${c.emoji} ${c.name}` : o === "shared" ? "Shared by everyone" : o; };
  return (
    <div className="wiki-group" style={{ marginTop: 22 }}>
      <h4>Installed</h4>
      <p>Approved skills in skills/&lt;owner&gt;/. Each {w("crew")} member uses its own plus the shared ones, opening one when a task seems to match. Tick {an("crew")} member under a skill to have them follow it always.</p>
      {!owners.length && <div className="meta">None yet.</div>}
      <Presence>{editing && <SkillEditor key={`${editing.owner}/${editing.name}`} owner={editing.owner} name={editing.name} onClose={closeEditor} onSaved={refresh} />}</Presence>
      <Presence>{asking && (
        <Confirm title={`Remove ${asking.owner}/${asking.name}?`} action="Remove the skill" danger onConfirm={remove} onCancel={() => setAsking(null)}>
          <p>Its folder, skills/{asking.owner}/{asking.name}/, is deleted, along with any commands you let it run without asking. The {w("crew")} stops seeing it from their next run.</p>
        </Confirm>
      )}</Presence>
      {owners.map((o) => (
        <div key={o} className="skill-owner">
          <div className="set-sub">{label(o)}</div>
          <ul className="list">
            {S.installedSkills.filter((s) => s.owner === o).map((s) => (
              <li key={s.path} className="card"><div className="card-top"><span className="who"><Icon name="bolt" /> {s.name}</span>
                  <span className="skill-actions">
                    <button type="button" className="linkish" title="Change this skill's instructions, or the files beside them" onClick={() => setEditing({ owner: s.owner, name: s.name })}>Edit</button>
                    <button type="button" className="linkish" title="Take this skill off the disk" onClick={() => setAsking({ owner: s.owner, name: s.name })}>Remove</button>
                  </span></div>
                <div className="meta">{s.description || "No description."}</div><div className="meta"><code>{s.path}</code></div>
                {s.commands?.length > 0 && <div className="meta skill-commands">Runs without asking: {s.commands.map((c) => <code key={c}>{c}</code>)}</div>}
                <AlwaysOn S={S} skill={s} refresh={refresh} /></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------- The page ----------
export function Settings({ S, section, setSection, refresh, onAttachLink, onClose }: {
  S: CampState | null; section: SettingsSection; setSection: (s: SettingsSection) => void; refresh: () => void;
  onAttachLink: (link: Link) => void; onClose: () => void;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const pressedOutside = useRef(false);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !document.querySelector('.popover, [role="alertdialog"], .dialog[role="dialog"]')) onClose(); }; // a menu, a dialog or a question on top closes first
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const GROUPS = groups();
  const title = GROUPS.flatMap((g) => g.items).find(([id]) => id === section)?.[1] ?? "";
  const counts: Partial<Record<SettingsSection, number>> = { skills: S?.skills.length, memory: S?.memoryProposals?.length };
  return (
    // A press that starts and ends on the dimmed backdrop closes it; a drag that began inside
    // (selecting text in a field, say) doesn't.
    <div className="settings-backdrop" onMouseDown={(ev) => { pressedOutside.current = ev.target === ev.currentTarget; }}
      onClick={(ev) => { if (pressedOutside.current && ev.target === ev.currentTarget) onClose(); pressedOutside.current = false; }}>
    <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <nav className="set-nav" aria-label="Settings sections">
        <div className="set-nav-head">Settings</div>
        {GROUPS.map((g) => (
          <div key={g.title} className="set-group">
            <div className="set-group-title">{g.title}</div>
            {g.items.map(([id, label, icon]) => (
              <button key={id} type="button" className="set-nav-item" aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}>
                <Icon name={icon} />{label}
                {!!counts[id] && <span className="count needs">{counts[id]}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="set-main">
        <header className="set-head">
          <div className="crumbs">Settings <span>›</span> <b>{title}</b></div>
          <button ref={closeBtn} className="icon-btn" type="button" aria-label="Close settings" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="set-body">
          {!S ? <div className="meta">Loading…</div>
            : section === "general" ? <General S={S} refresh={refresh} />
            : section === "appearance" ? <Appearance S={S} refresh={refresh} />
            : section === "notifications" ? <Notifications />
            : section === "devices" ? <><OtherDevices S={S} /><Uploads S={S} refresh={refresh} /></>
            : section === "crew" ? <Crew S={S} refresh={refresh} />
            : section === "approvals" ? <Approvals S={S} refresh={refresh} />
            : section === "limits" ? <Limits S={S} refresh={refresh} />
            : section === "terminal" ? <TerminalActions S={S} refresh={refresh} />
            : section === "models" ? <ModelsPage S={S} refresh={refresh} />
            : section === "voice" ? <VoicePage S={S} refresh={refresh} />
            : section === "phone" ? <Phone key={S.settings.phone.topic} S={S} refresh={refresh} />
            : section === "memory" ? <MemoryPage S={S} refresh={refresh} />
            : section === "skills" ? <><Skills S={S} refresh={refresh} /><SkillImport S={S} refresh={refresh} /><InstalledSkills S={S} refresh={refresh} /></>
            : <Connectors S={S} refresh={refresh} onAttachLink={(l) => { onAttachLink(l); onClose(); }} />}
        </div>
        {/* What a button here couldn't do: the page's own line by the message box is behind this. */}
        <StatusLine />
      </div>
    </div>
    </div>
  );
}
