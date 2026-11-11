// The camp's records: each crew member's memory, scheduled jobs, the wiki, proposed skills,
// connectors and linked folders, and the inbox.

import { useEffect, useState } from "react";
import { JiraConnection } from "../components/Jira.tsx";
import { api, errorText } from "../api.ts";
import { Empty, Icon } from "../components/bits.tsx";
import { cClass, cx, stripFrontmatter, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { CampState, Link } from "../types.ts";

type Panel = { S: CampState; refresh: () => void };

// ---------- Memory ----------
export function Memory({ S }: Panel) {
  return (
    <>
      <p className="panel-note">Each crew member keeps their own memory for their own role, plus their own session history. Files live in camp/agents/&lt;name&gt;/.</p>
      {S.memories.map((a) => {
        const lines = a.memory.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).reverse();
        return (
          <div key={a.id} className={cx("wiki-group", cClass(a.name))}>
            <h4 style={{ color: "var(--c)" }}>{a.emoji} {a.name}</h4>
            <p>{a.sessions} session{a.sessions === 1 ? "" : "s"} · camp/agents/{a.id}/memory.md</p>
            {!lines.length && <div className="meta">Nothing remembered yet.</div>}
            <ul className="ledger">
              {lines.map((l, i) => {
                const m = l.match(/^- (\d{4}-\d{2}-\d{2})\s+(.*)$/);
                return <li key={i}>{m ? <><time>{m[1]}</time>{m[2]}</> : l.slice(2)}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

// ---------- Jobs ----------
export function Jobs({ S, refresh }: Panel) {
  const act = (name: string, action: string) => api("/api/jobs", { name, action }).then(refresh, (e) => alert(errorText(e)));
  return (
    <>
      <p className="panel-note">
        {S.jobsRunBy === "watch"
          ? "A watcher (npm run watch, or the background one) is running the jobs right now, so mission control is standing by."
          : "Jobs run on schedule while mission control is open. To run them with nothing open, use npm run watch:install."}
        {" "}Quiet runs (nothing new) don't ping you.{S.pausedUntil && <> <b>Paused until your plan's limit resets.</b></>}
      </p>
      {!S.jobs.length ? <Empty title="No scheduled jobs">Ask the Quartermaster for something recurring, like “Every weekday at 08:00, summarize what's new in the wiki.”</Empty> : (
        <ul className="list">
          {S.jobs.map((j) => (
            <li className="card" key={j.name}>
              <div className="card-top"><span className="who">⏰ {j.name}</span><time>{j.schedule}</time></div>
              <div className="meta">{j.lastRun ? `Last ran ${when(j.lastRun)}` : "Hasn't run yet"}</div>
              <div className="clamp open">{j.task}</div>
              {j.lastReport && <details><summary>Last report</summary><Markdown text={j.lastReport} style={{ marginTop: 6, fontSize: 13.5 }} /></details>}
              <div className="card-actions">
                <label className="switch"><input type="checkbox" checked={j.enabled} onChange={(ev) => act(j.name, ev.target.checked ? "enable" : "disable")} /> {j.enabled ? "On" : "Off"}</label>
                <button className="btn small" type="button" onClick={() => act(j.name, "run")}>Run now</button>
                <button className="btn small danger" type="button" onClick={() => { if (confirm(`Delete the job "${j.name}"?`)) void act(j.name, "delete"); }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Skills ----------
export function Skills({ S, refresh }: Panel) {
  const act = (owner: string, name: string, action: "approve" | "reject") => api("/api/skills", { owner, name, action }).then(refresh, (e) => alert(errorText(e)));
  return (
    <>
      <p className="panel-note">Skills the Quartermaster proposed after expeditions. Nothing goes live until you approve it.</p>
      {!S.skills.length ? <Empty title="No proposals">After a good expedition, the Quartermaster may propose a skill that captures what worked.</Empty> : (
        <ul className="list">
          {S.skills.map((s) => (
            <li className="card" key={`${s.owner}/${s.name}`}>
              <div className="card-top"><span className="who"><Icon name="spark" /> {s.owner}/{s.name}</span><span className={cx("pill", s.current && "live")}>{s.current ? "Replaces current" : "New"}</span></div>
              <div className="clamp open"><b>Why</b> {s.reason || "No reason given."}</div>
              <pre className="raw">{stripFrontmatter(s.proposed)}</pre>
              {s.current && <details><summary>Current version</summary><pre className="raw">{stripFrontmatter(s.current)}</pre></details>}
              <div className="card-actions">
                <button className="btn small primary" type="button" onClick={() => act(s.owner, s.name, "approve")}>Approve</button>
                <button className="btn small danger" type="button" onClick={() => act(s.owner, s.name, "reject")}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Commands the camp runs by itself after a quest changes files in a linked folder.
function LinkChecks({ link, refresh }: { link: Link; refresh: () => void }) {
  const saved = (link.verify ?? []).join("\n");
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  async function save() {
    try { await api("/api/links/verify", { name: link.name, commands: text.split("\n") }); refresh(); } catch (e) { alert(errorText(e)); }
  }
  return (
    <details className="checks-edit" open={!!link.verify?.length}>
      <summary>Checks after changes{link.verify?.length ? ` (${link.verify.length})` : ""}</summary>
      <div className="meta">Commands the camp runs by itself after a quest changes files here, one per line (for example <code>npm run typecheck</code>). Results go into the quest's report.</div>
      <textarea spellCheck={false} aria-label={`Checks for ${link.name}`} value={text} onChange={(ev) => setText(ev.target.value)} />
      <div><button type="button" className="btn small" disabled={text === saved} onClick={save}>Save checks</button></div>
    </details>
  );
}

// ---------- Connectors (and linked folders) ----------
export function Connectors({ S, refresh, onAttachLink }: Panel & { onAttachLink: (link: Link) => void }) {
  async function unlink(l: Link) {
    if (!confirm(`Unlink ${l.path}? The folder itself isn't touched.`)) return;
    try { await api("/api/links/remove", { name: l.name }); refresh(); } catch (e) { alert(errorText(e)); }
  }
  const links = S.links ?? [];
  return (
    <>
      <JiraConnection S={S} refresh={refresh} />
      <div className="wiki-group">
        <h4>Linked folders</h4>
        <p>Folders on your disk the crew can read as links/&lt;name&gt;/, without uploading. Add one from the + menu.</p>
        {!links.length && <div className="meta">None yet.</div>}
        <ul className="list">
          {links.map((l) => (
            <li className="card" key={l.name}>
              <div className="card-top"><span className="who"><Icon name="folder" /> links/{l.name}</span><span className={cx("pill", l.access === "write" && "live")}>{l.access === "write" ? "Can edit" : "Read-only"}</span></div>
              <div className="meta" style={{ overflowWrap: "anywhere" }}>{l.path} · {l.files ?? "?"} files</div>
              <LinkChecks link={l} refresh={refresh} />
              <div className="card-actions">
                <button type="button" className="btn small" onClick={() => onAttachLink(l)}>Attach</button>
                <button type="button" className="btn small danger" onClick={() => unlink(l)}>Unlink</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="wiki-group" style={{ marginTop: 18 }}>
        <h4>MCP connectors</h4>
        <p>Servers from camp/mcp.json. Read-only unless a server allows writes, and then each write asks you first.</p>
      </div>
      {!S.connectors.length ? <Empty title="No connectors yet">Copy mcp.example.json to camp/mcp.json, fill in a server (GitHub, a notes folder…), and say which crew members may use it. It's picked up on the next run.</Empty> : (
        <ul className="list">
          {S.connectors.map((c) => {
            const ok = c.state === "connected";
            const agents = c.agents.map((a) => S.characters.find((x) => x.id === a)).filter((x) => !!x).map((x) => `${x.emoji} ${x.name}`).join(", ") || "nobody yet";
            return (
              <li className="card" key={c.name}>
                <div className="card-top"><span className="who"><Icon name="plug" /> {c.name}</span><span className={cx("pill", ok ? "done" : c.state === "error" && "bad")}>{ok ? "Connected" : c.state === "error" ? "Error" : "Not started"}</span></div>
                {c.description && <div className="meta">{c.description}</div>}
                <div className="meta">For: {agents} · {c.allowWrite ? "can make changes (asks first)" : "read-only"}</div>
                {c.error && <div className="clamp open" style={{ color: "var(--bad)" }}>{c.error}</div>}
                <div className="tool-chips">{c.tools.map((t) => <code key={t.name} className={t.write ? "write" : ""} title={t.write ? "Makes changes: asks you first" : "Read-only"}>{t.name}</code>)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---------- Inbox ----------
export function Inbox({ S }: Panel) {
  if (!S.inbox.length) return <Empty title="Inbox is empty">Reports from scheduled jobs land here, newest first. Runs that find nothing new stay quiet.</Empty>;
  return (
    <ul className="list">
      {S.inbox.map((m, i) => (
        <li className="card" key={`${m.heading}-${i}`}>
          <div className="card-top"><span className="who"><Icon name="inbox" /> {m.heading.split(" · ").pop()}</span><time>{m.heading.split(" · ")[0]}</time></div>
          <Markdown text={m.body} style={{ marginTop: 6, fontSize: 13.5 }} />
        </li>
      ))}
    </ul>
  );
}
