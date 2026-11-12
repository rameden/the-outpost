// Settings: one place for how the camp runs. A modal over mission control (the camp stays in
// view behind it; click outside or press Escape to close), with a section list on the left: the runtime and look, each crew member (who they are, their model),
// how much the crew may do without asking, limits, phone approvals, the camp's activity (usage,
// jobs, inbox), and its knowledge (memory, skills, connectors). (The wiki has a page of its own: components/Wiki.tsx.)

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { About } from "../components/AgentDrawer.tsx";
import { useModelList } from "../components/ModelPicker.tsx";
import { Quests } from "../panels/Quests.tsx";
import { Connectors, Inbox, Jobs, Skills } from "../panels/Records.tsx";
import { MemoryPage } from "./MemoryPage.tsx";
import { ModelsPage } from "./ModelsPage.tsx";
import { canNotify, notificationsOn, toggleNotifications } from "../notifications.ts";
import { cClass, cx, money } from "../format.ts";
import type { AgentDetail, CampState, Character, Link } from "../types.ts";
import { Icon, type IconName } from "../components/bits.tsx";
import { Confirm } from "../components/Confirm.tsx";
import { Presence } from "../motion.tsx";
import { SkillImport } from "./SkillImport.tsx";
import { SkillEditor } from "./SkillEditor.tsx";
import { TerminalActions } from "./TerminalActions.tsx";

export type SettingsSection = "general" | "crew" | "approvals" | "limits" | "phone" | "usage" | "jobs" | "inbox" | "memory" | "skills" | "connectors" | "terminal" | "models";
const GROUPS: { title: string; items: [SettingsSection, string, IconName][] }[] = [
  { title: "Camp", items: [
    ["general", "General", "gear"], ["crew", "Crew", "users"], ["approvals", "Approvals", "shield"], ["limits", "Limits & budget", "gauge"], ["models", "Models", "spark"], ["phone", "Phone", "phone"], ["terminal", "Terminal", "terminal"],
  ] },
  { title: "Activity", items: [["usage", "Usage & quests", "chart"], ["jobs", "Scheduled jobs", "clock"], ["inbox", "Inbox", "inbox"]] },
  { title: "Knowledge", items: [["memory", "Memory", "bookmark"], ["skills", "Skills", "spark"], ["connectors", "Connectors", "plug"]] },
];
const ALL = GROUPS.flatMap((g) => g.items);
export const isSettingsSection = (s: string | null): s is SettingsSection => ALL.some(([id]) => id === s);

const tryIt = async (work: () => Promise<unknown>, then: () => void) => {
  try { await work(); then(); } catch (e) { alert(errorText(e)); }
};

// A labelled setting: name and explanation on the left, the control on the right.
function Row({ label, help, children, wide }: { label: string; help?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("set-row", wide && "wide")}>
      <div className="set-label"><b>{label}</b>{help && <p>{help}</p>}</div>
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
type Theme = "system" | "light" | "dark";
function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") { delete root.dataset.theme; storeSet("camp-theme", ""); }
  else { root.dataset.theme = t; storeSet("camp-theme", t); }
}

function General({ S, refresh }: { S: CampState; refresh: () => void }) {
  const [theme, setTheme] = useState<Theme>(() => (storeGet("camp-theme") as Theme) || "system");
  const [, redraw] = useState(0);
  const locked = S.settings.runtimeLocked;
  const plan = S.login?.plan ? S.login.plan[0].toUpperCase() + S.login.plan.slice(1) : "";
  async function setRuntime(next: string) {
    if (next === S.runtime) return;
    const msg = next === "api"
      ? "Switch the crew to the API? Usage will be billed to your API key."
      : "Switch the crew to your Claude subscription (through Claude Code)? Usage will count against your plan's limits.";
    if (confirm(msg)) await tryIt(() => api("/api/runtime", { runtime: next }), refresh);
  }
  return (
    <>
      <Row label="What runs the crew" help={locked ? `CAMP_RUNTIME=${locked} is set for this server, so it can't be changed here.` : "Applies from the next run. Nothing running is interrupted."} wide>
        <Choices name="Runtime" value={S.runtime} onChange={setRuntime} options={[
          { id: "claude-code", label: `Claude subscription${plan ? ` (${plan})` : ""}`, help: S.login && !S.login.ok ? S.login.problem ?? "Not signed in" : "Through Claude Code. Counts against your plan's usage limits.", disabled: locked ? "Set by CAMP_RUNTIME" : undefined },
          { id: "api", label: "API key", help: "Billed per token to ANTHROPIC_API_KEY.", disabled: locked ? "Set by CAMP_RUNTIME" : undefined },
        ]} />
      </Row>
      <Row label="Theme" help="Remembered in this browser.">
        <select aria-label="Theme" value={theme} onChange={(ev) => { const t = ev.target.value as Theme; setTheme(t); applyTheme(t); }}>
          <option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </Row>
      <Row label="Name conversations automatically" help="After a new conversation's first answer, the smallest model writes it a short title. Each one uses a little of your plan (or a fraction of a cent on the API). Off, a conversation is named after its first request.">
        <label className="switch"><input type="checkbox" checked={S.settings.autoTitles}
          onChange={(ev) => tryIt(() => api("/api/auto-titles", { on: ev.target.checked }), refresh)} /> {S.settings.autoTitles ? "On" : "Off"}</label>
      </Row>
      <Row label="Browser notifications" help={!canNotify() ? "This browser can't show notifications." : Notification.permission === "denied" ? "Blocked for this page in your browser's settings." : "A ping when the camp needs a decision."}>
        {canNotify() && (
          <label className="switch"><input type="checkbox" checked={notificationsOn()} disabled={Notification.permission === "denied"}
            onChange={async () => { await toggleNotifications(); redraw((n) => n + 1); }} /> {notificationsOn() ? "On" : "Off"}</label>
        )}
      </Row>
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
    try { await api("/api/agents", { id: c.id, reset: true }); setModel(c.defaultModel); setEffort(c.defaultEffort); setTurns(String(c.defaultMaxTurns)); setNote("Back to the crew defaults."); refresh(); }
    catch (e) { setNote(errorText(e)); }
  }
  return (
    <form onSubmit={save}>
      <Row label="Model" help={m?.price ? `Per million tokens: ${m.price} (input / output).` : loadError || undefined}>
        <select aria-label="Model" value={list ? model : ""} disabled={!list} onChange={(ev) => setModel(ev.target.value)}>
          {!list && <option value="">Loading models…</option>}
          {list && !list.models.some((x) => x.id === c.model) && <option value={c.model}>{c.model}</option>}
          {list?.models.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === c.defaultModel ? " (default)" : ""}</option>)}
        </select>
      </Row>
      <Row label="Reasoning effort" help={list && !efforts.length ? "This model doesn't take an effort setting." : "Higher thinks longer and costs more."}>
        <select aria-label="Effort" value={chosenEffort} disabled={!efforts.length} onChange={(ev) => setEffort(ev.target.value)}>
          <option value="">Model's own default</option>
          {efforts.map((e) => <option key={e} value={e}>{e}{e === c.defaultEffort ? " (crew default)" : ""}</option>)}
        </select>
      </Row>
      <Row label="Max turns per run" help={`One reply and its tool calls is a turn. Crew default: ${c.defaultMaxTurns}.`}>
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
      <h4 className="set-sub">Agent info</h4>
      <p className="set-note">Names, roles and personalities are fixed in code (src/crew.ts) so they don't drift; memory and skills grow over time.</p>
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
      <div><button type="button" className="btn small" aria-label={`Save ${label.toLowerCase()}`} disabled={text === saved} onClick={() => onSave(text.split("\n"))}>Save</button></div>
    </div>
  );
}

function Approvals({ S, refresh }: { S: CampState; refresh: () => void }) {
  const st = S.settings;
  const noSandbox = S.sandbox.available ? undefined : "Needs macOS (sandbox-exec), or Linux with bubblewrap (bwrap) installed.";
  return (
    <>
      <Row label="Approval level" help="What the crew's shell commands may do without asking you. Plans, new scheduled jobs and connector writes always ask." wide>
        <Choices name="Approval level" value={st.approval} onChange={(level) => tryIt(() => api("/api/approvals", { level }), refresh)} options={[
          { id: "ask", label: "Ask every time", help: "Every command waits for your OK, even ls and git status. Your allow-lists below are ignored." },
          { id: "safe", label: "Allow safe commands (default)", help: "Simple read-only commands (ls, git status, git diff…) and your allow-lists run; everything else asks." },
          { id: "sandbox", label: "Sandbox the rest", help: "Everything else runs without asking, with no network and writes only inside the project. Installs and pushes still ask.", disabled: noSandbox },
        ]} />
      </Row>
      <Row label="Hosts the sandbox can reach" help={S.sandbox.kind === "bwrap"
        ? "On Linux the sandbox has no network at all for now, so this list isn't used: commands that need the network ask to run outside it."
        : <>Sandboxed commands can reach these hosts, and only these, through a proxy the camp runs, so installs and fetches stop asking. One per line; <code>*.github.com</code> covers its subdomains. Tools that ignore proxy settings still get no network.</>} wide>
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
      <Row label="Your allow-list" help={<>Command prefixes that run without asking, one per line. <code>npm run build</code> also allows <code>npm run build --watch</code>, and <code>*</code> matches anything (<code>npm run test:*</code>). Only simple commands match (no pipes, chaining or paths outside the camp). Test runners run project code the Artificer can edit, so add them only if that's fine with you.</>} wide>
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
      <Row label="Let agents edit the camp's own code" help="src/, tests/, evals/ and package.json are read-only to the crew unless this is on. Leave it off unless you're asking them to improve the camp itself.">
        <label className="switch"><input type="checkbox" checked={st.selfEdit}
          onChange={(ev) => { if (!ev.target.checked || confirm("Let the crew change the camp's own source code?")) void tryIt(() => api("/api/self-edit", { on: ev.target.checked }), refresh); }} /> {st.selfEdit ? "On" : "Off"}</label>
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
      <Row label="Budget per expedition" help={S.budgetUsd ? `Stops an expedition at ${money(S.budgetUsd)}, all agents together.` : `No limit.${sub ? " On your subscription, costs are estimates at API prices." : ""}`}>
        <form className="inline-form" onSubmit={saveBudget}>
          <span>$</span><input key={S.budgetUsd ?? "none"} name="budget" aria-label="Budget per expedition" type="number" min="0" step="0.25" placeholder="none" defaultValue={S.budgetUsd ?? ""} />
          <button className="btn small" type="submit">Save</button>
        </form>
      </Row>
      <Row label="Expeditions at once" help={`The rest wait their turn. More at once uses your ${sub ? "plan's limits" : "API budget"} faster.`}>
        <select aria-label="Expeditions at once" value={S.parallel} onChange={(ev) => tryIt(() => api("/api/parallel", { parallel: Number(ev.target.value) }), refresh)}>
          {range(S.settings.parallelMax).map((n) => <option key={n}>{n}</option>)}
        </select>
      </Row>
      <Row label="Quests at once" help="Crew members working at the same time across every expedition. One Quartermaster can send several in a turn.">
        <select aria-label="Quests at once" value={S.settings.questsAtOnce} onChange={(ev) => tryIt(() => api("/api/quests-at-once", { n: Number(ev.target.value) }), refresh)}>
          {range(S.settings.questsMax).map((n) => <option key={n}>{n}</option>)}
        </select>
      </Row>
      <Row label="When a check fails" help="After a quest changes files in a linked folder, the camp runs that folder's checks (set on its project page). If one fails, the same crew member is sent back with the failing output to fix what it broke, and the checks run again. Each time is another quest's worth of usage.">
        <select aria-label="When a check fails" value={S.settings.fixAttempts} onChange={(ev) => tryIt(() => api("/api/quest-checks", { fixAttempts: Number(ev.target.value) }), refresh)}>
          <option value={0}>Just report it</option>
          {range(S.settings.fixAttemptsMax).map((n) => <option key={n} value={n}>{n === 1 ? "Send it back once" : `Send it back up to ${n} times`}</option>)}
        </select>
      </Row>
      <Row label="Review changes before reporting" help="Before the Quartermaster sums up an expedition that changed files in a linked folder, it sends the Scout to read the actual diff and look for bugs, missing pieces and changes beyond the request; a real problem gets one fix. Another quest's worth of usage each time, so it's off unless you want it.">
        <label className="switch"><input type="checkbox" checked={S.settings.reviewChanges}
          onChange={(ev) => tryIt(() => api("/api/quest-checks", { review: ev.target.checked }), refresh)} /> {S.settings.reviewChanges ? "On" : "Off"}</label>
      </Row>
      <Row label="Watch open pull requests" help="Every few minutes while mission control is open, the camp looks (with the GitHub CLI, as you) at the pull requests of worktrees the crew worked in lately: failing checks, review comments, conflicts with the base. A conversation whose pull request needs you says so at its top, where one click brings the feedback into a reply for you to read and send. Nothing is answered, pushed or merged by itself.">
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
        Get a notification through <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> when the camp needs a decision, with Approve / Decline buttons.
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
    catch (e) { alert(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="skill-always" role="group" aria-label={`Who always follows ${skill.name}`}
      title="Ticked, this skill's instructions are in every one of that crew member's prompts. Unticked, they see its name and description and open it when a task seems to match. Each one that's always on makes every prompt a little longer.">
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
    try { await api("/api/skills/remove", asking); } catch (e) { alert(errorText(e)); }
    setAsking(null);
    refresh();
  };
  const owners = [...new Set(S.installedSkills.map((s) => s.owner))];
  const label = (o: string) => { const c = S.characters.find((x) => x.id === o); return c ? `${c.emoji} ${c.name}` : o === "shared" ? "Shared by everyone" : o; };
  return (
    <div className="wiki-group" style={{ marginTop: 22 }}>
      <h4>Installed</h4>
      <p>Approved skills in skills/&lt;owner&gt;/. Each crew member uses its own plus the shared ones, opening one when a task seems to match. Tick a crew member under a skill to have them follow it always.</p>
      {!owners.length && <div className="meta">None yet.</div>}
      <Presence>{editing && <SkillEditor key={`${editing.owner}/${editing.name}`} owner={editing.owner} name={editing.name} onClose={closeEditor} onSaved={refresh} />}</Presence>
      <Presence>{asking && (
        <Confirm title={`Remove ${asking.owner}/${asking.name}?`} action="Remove the skill" danger onConfirm={remove} onCancel={() => setAsking(null)}>
          <p>Its folder, skills/{asking.owner}/{asking.name}/, is deleted, along with any commands you let it run without asking. The crew stops seeing it from their next run.</p>
        </Confirm>
      )}</Presence>
      {owners.map((o) => (
        <div key={o} className="skill-owner">
          <div className="set-sub">{label(o)}</div>
          <ul className="list">
            {S.installedSkills.filter((s) => s.owner === o).map((s) => (
              <li key={s.path} className="card"><div className="card-top"><span className="who"><Icon name="spark" /> {s.name}</span>
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
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !document.querySelector('.popover, [role="alertdialog"]')) onClose(); }; // a menu or a question on top closes first
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const title = ALL.find(([id]) => id === section)?.[1] ?? "";
  const counts: Partial<Record<SettingsSection, number>> = { skills: S?.skills.length, inbox: S?.inboxCount ?? S?.inbox?.length, memory: S?.memoryProposals?.length };
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
                {!!counts[id] && <span className="count">{counts[id]}</span>}
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
            : section === "crew" ? <Crew S={S} refresh={refresh} />
            : section === "approvals" ? <Approvals S={S} refresh={refresh} />
            : section === "limits" ? <Limits S={S} refresh={refresh} />
            : section === "terminal" ? <TerminalActions S={S} refresh={refresh} />
            : section === "models" ? <ModelsPage S={S} refresh={refresh} />
            : section === "phone" ? <Phone key={S.settings.phone.topic} S={S} refresh={refresh} />
            : section === "usage" ? <Quests S={S} refresh={refresh} onOpenSettings={() => setSection("limits")} />
            : section === "jobs" ? <Jobs S={S} refresh={refresh} />
            : section === "inbox" ? <Inbox S={S} refresh={refresh} />
            : section === "memory" ? <MemoryPage S={S} refresh={refresh} />
            : section === "skills" ? <><Skills S={S} refresh={refresh} /><SkillImport S={S} refresh={refresh} /><InstalledSkills S={S} refresh={refresh} /></>
            : <Connectors S={S} refresh={refresh} onAttachLink={(l) => { onAttachLink(l); onClose(); }} />}
        </div>
      </div>
    </div>
    </div>
  );
}
