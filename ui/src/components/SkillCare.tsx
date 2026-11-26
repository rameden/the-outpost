// How the crew's skills are looked after, in the two places skills are shown (Settings → Skills,
// and Skills in Records): how much each is used, where the curator has it (active, stale or in
// the archive), pinning, restoring, and the switches for the learning review and the curator.
// The rules themselves are the server's (src/curator.ts, src/learning.ts); this only shows them.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { kTok, money, plural, shortModel, when } from "../format.ts";
import type { CampState } from "../types.ts";
import { w } from "../words.ts";
import { Icon } from "./bits.tsx";
import { complain } from "./StatusLine.tsx";

type Skill = CampState["installedSkills"][number];
type Learning = CampState["settings"]["learning"];

const DAY = 86_400_000;
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
// "Used 4 times, last 3 days ago." A use is the crew opening the skill, or a run with it always on.
export const usedLine = (s: { uses: number; last: string | null }) =>
  s.uses ? `Used ${s.uses} ${plural(s.uses, "time")}, last ${ago(s.last)}` : "Not used yet";

const post = (path: string, body: object, refresh: () => void) => api(path, body).then(refresh, (e) => complain(errorText(e)));

// On an installed skill's card: its use, and (for one the crew wrote) its state and a pin.
export function SkillStanding({ skill, refresh }: { skill: Skill; refresh: () => void }) {
  const byCrew = !!skill.createdBy;
  return (
    <div className="meta skill-standing">
      <span>{usedLine(skill)}</span>
      {byCrew && <span>Written by {skill.createdBy}</span>}
      {byCrew && skill.state === "stale" && <span className="pill bad" title="Nobody has used it in a while. If that goes on, it moves to the archive (nothing is deleted).">Stale</span>}
      {byCrew && skill.pinned && <span className="pill live" title="Pinned: it's never marked stale or archived.">Pinned</span>}
      {byCrew && (
        <button type="button" className="linkish" aria-pressed={skill.pinned}
          title={skill.pinned ? "Let the curator look at this skill again" : "Keep this skill where it is: never stale, never archived"}
          onClick={() => post("/api/skills/pin", { owner: skill.owner, name: skill.name, pinned: !skill.pinned }, refresh)}>{skill.pinned ? "Unpin" : "Pin"}</button>
      )}
    </div>
  );
}

// Skills the curator set aside. They're whole in skills/_archive; Restore puts one back.
export function ArchivedSkills({ S, refresh }: { S: CampState; refresh: () => void }) {
  const list = S.archivedSkills ?? [];
  if (!list.length) return null;
  return (
    <div className="wiki-group" style={{ marginTop: 22 }}>
      <h4>Archived</h4>
      <p>Skills the {w("crew")} wrote that nobody used for a long while. They're kept whole in skills/_archive/, out of every prompt, until you restore them.</p>
      <ul className="list">
        {list.map((s) => (
          <li key={s.path} className="card">
            <div className="card-top"><span className="who"><Icon name="bolt" /> {s.owner}/{s.name}</span>
              <span className="skill-actions">
                <button type="button" className="linkish" title="Put this skill back where it was" onClick={() => post("/api/skills/restore", { owner: s.owner, name: s.name }, refresh)}>Restore</button>
              </span></div>
            <div className="meta">{s.description || "No description."}</div>
            <div className="meta skill-standing">{s.archived && <span>Archived {ago(s.archived)}</span>}<span>{usedLine(s)}</span>{s.createdBy && <span>Written by {s.createdBy}</span>}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A whole number you type, saved when you leave the field or press Enter.
function Count({ label, value, min, max, disabled, onSave }: { label: string; value: number; min: number; max: number; disabled?: boolean; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const save = () => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || n === value) return setText(String(value));
    onSave(Math.min(max, Math.max(min, n)));
  };
  return <input className="learn-count" type="number" aria-label={label} min={min} max={max} step={1} value={text} disabled={disabled}
    onChange={(ev) => setText(ev.target.value)} onBlur={save} onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }} />;
}

// Settings → Skills: the learning review and the curator. Both only ever propose or set aside.
export function LearningSettings({ S, refresh }: { S: CampState; refresh: () => void }) {
  const l: Learning = S.settings.learning ?? { review: false, every: 10, curator: true, staleDays: 14, archiveDays: 30, everyDays: 7 };
  const [looking, setLooking] = useState(false);
  const [looked, setLooked] = useState<string | null>(null);
  const set = (change: Partial<Learning>) => post("/api/learning", change, refresh);
  const look = async () => {
    setLooking(true);
    try {
      const { pass } = await api("/api/skills/curate", {}) as { pass: NonNullable<CampState["curator"]> };
      setLooked(pass.archived.length || pass.stale.length
        ? `Looked at ${pass.checked}: ${pass.archived.length} archived, ${pass.stale.length} marked stale.`
        : `Looked at ${pass.checked} ${plural(pass.checked, "skill")}: nothing to move.`);
      refresh();
    } catch (e) { complain(errorText(e)); }
    setLooking(false);
  };
  const last = S.curator;
  return (
    <div className="wiki-group" style={{ marginTop: 22 }}>
      <h4>Learning</h4>
      <p>How the {w("crew")} gets better at your work between runs. Nothing here changes a memory or a skill by itself: it proposes, and you approve.</p>
      <div className="mem-care learn-care">
        <label className="switch"><input type="checkbox" checked={l.review} onChange={(ev) => set({ review: ev.target.checked })} /> Review long runs for what's worth keeping</label>
        <span className="field-hint">
          Every <Count label="Tool calls between reviews" value={l.every} min={2} max={200} disabled={!l.review} onSave={(every) => set({ every })} /> tool calls, a copy of the run is asked whether anything in it is worth remembering or turning into a skill.
          It can only propose: memory lines wait on the Memory page and skills in the Inbox. The copy reads the run's own prompt from the cache, so a review costs a small part of a turn; what they add up to is in Usage.
        </span>
        <label className="switch"><input type="checkbox" checked={l.curator} onChange={(ev) => set({ curator: ev.target.checked })} /> Set aside skills the {w("crew")} wrote and nobody uses</label>
        <span className="field-hint">
          Unused for <Count label="Days until a skill is stale" value={l.staleDays} min={1} max={365} disabled={!l.curator} onSave={(staleDays) => set({ staleDays })} /> days, a skill is marked stale;
          after <Count label="Days until a skill is archived" value={l.archiveDays} min={2} max={730} disabled={!l.curator} onSave={(archiveDays) => set({ archiveDays })} /> it moves to the archive.
          Nothing is deleted, pinned skills stay put, and skills you wrote or installed are never touched.
          It looks every <Count label="Days between looks" value={l.everyDays} min={1} max={90} disabled={!l.curator} onSave={(everyDays) => set({ everyDays })} /> days, when nothing is running, and copies the skills to camp/skill-backups/ first.
        </span>
        <div className="learn-last">
          <span className="meta" role="status">{looked ?? (last ? `Last look ${ago(last.at)}: ${last.checked} ${plural(last.checked, "skill")} checked, ${last.archived.length} archived.` : "It hasn't looked yet.")}</span>
          <button type="button" className="btn small" disabled={looking} onClick={look}>{looking ? "Looking…" : "Look now"}</button>
        </div>
      </div>
    </div>
  );
}

// Skills in Records: the ones the crew wrote, with where each stands, under the proposals.
export function CrewSkills({ S, refresh }: { S: CampState; refresh: () => void }) {
  const theirs = (S.installedSkills ?? []).filter((s) => s.createdBy);
  if (!theirs.length && !(S.archivedSkills ?? []).length) return null;
  return (
    <>
      {theirs.length > 0 && (
        <div className="wiki-group" style={{ marginTop: 22 }}>
          <h4>Written by the {w("crew")}</h4>
          <p>Skills you approved. One that goes unused is marked stale and later archived, unless you pin it.</p>
          <ul className="list">
            {theirs.map((s) => (
              <li key={s.path} className="card">
                <div className="card-top"><span className="who"><Icon name="bolt" /> {s.owner}/{s.name}</span></div>
                <div className="meta">{s.description || "No description."}</div>
                <SkillStanding skill={s} refresh={refresh} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <ArchivedSkills S={S} refresh={refresh} />
    </>
  );
}

// Usage: what the learning reviews cost, apart from the runs they looked at.
export function ReviewSpend({ S }: { S: CampState }) {
  const r = S.spend.reviews;
  const list = S.reviews ?? [];
  if (!r?.count) return null;
  return (
    <details className="review-spend">
      <summary>Learning reviews: <b>{money(r.today)}</b> today, <b>{money(r.week)}</b> in the last 7 days, <b>{money(r.total)}</b> in all ({r.count} {plural(r.count, "review")}). Counted in the totals above.</summary>
      <ul className="list">
        {list.map((e, i) => {
          const total = e.usage.input + e.usage.cacheRead + e.usage.cacheWrite;
          const cached = total ? Math.round((100 * e.usage.cacheRead) / total) : 0;
          const put = e.memory + e.skills;
          return (
            <li key={`${e.time}-${i}`} className="card">
              <div className="card-top"><span className="who">{S.characters.find((c) => c.id === e.agent)?.emoji ?? "🔎"} Review of {S.characters.find((c) => c.id === e.agent)?.name ?? e.agent}'s run</span>
                <span className={e.error ? "pill bad" : "pill"}>{e.error ? "failed" : put ? `${put} proposed` : "nothing to save"}</span><time>{when(e.time)}</time></div>
              <div className="meta"><b>{money(e.costUsd)}{e.runtime === "claude-code" ? " est." : ""}</b> · {e.turns} {plural(e.turns, "turn")} · {kTok(total)} in ({cached}% cached) · {kTok(e.usage.output)} out · {shortModel(e.model)}</div>
              {e.error && <div className="meta">{e.error}</div>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
