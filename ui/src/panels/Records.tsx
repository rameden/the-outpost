// The camp's records: each crew member's memory, scheduled jobs, the wiki, proposed skills,
// connectors and linked folders, and the inbox.

import { useContext, useEffect, useState } from "react";
import { JiraConnection } from "../components/Jira.tsx";
import { CalendarConnection } from "../components/Calendar.tsx";
import { api, errorText } from "../api.ts";
import { Empty, Icon } from "../components/bits.tsx";
import { ReadAloud, VoiceOn } from "../components/ReadAloud.tsx";
import { cClass, cx, leadName, nameNow, stripFrontmatter, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { CampState, Link } from "../types.ts";
import { ask } from "../components/Confirm.tsx";
import { complain } from "../components/StatusLine.tsx";

import { w, a as an, cap } from "../words.ts";
type Panel = { S: CampState; refresh: () => void };

// ---------- Jobs ----------
export function Jobs({ S, refresh }: Panel) {
  const act = (name: string, action: string) => api("/api/jobs", { name, action }).then(refresh, (e) => complain(errorText(e)));
  return (
    <>
      <p className="panel-note">
        {S.jobsRunBy === "watch"
          ? `The background watcher is running the jobs right now, so ${w("hq")} is standing by.`
          : `Jobs run on schedule while ${w("hq")} is open. To run them with nothing open, use npm run watch:install.`}
        {" "}Quiet runs (nothing new) don't ping you.{S.pausedUntil && <> <b>Paused until your plan's limit resets.</b></>}
      </p>
      {!S.jobs.length ? <Empty title="No scheduled jobs">Ask the {leadName()} for something recurring, like “Every weekday at 08:00, summarize what's new in the wiki.”</Empty> : (
        <ul className="list">
          {S.jobs.map((j) => (
            <li className="card" key={j.name}>
              <div className="card-top"><span className="who">⏰ {j.name}</span><time>{j.schedule}</time></div>
              <div className="meta">{j.lastRun ? `Last ran ${when(j.lastRun)}` : "Hasn't run yet"}</div>
              <div className="clamp open">{j.task}</div>
              {j.lastReport && <details><summary>Last report</summary><Markdown text={j.lastReport} style={{ marginTop: 6, fontSize: 13.5 }} /><div className="card-actions"><ReadAloud text={j.lastReport} markdown what={`Job report · ${j.name}`} /></div></details>}
              <div className="card-actions">
                <label className="switch"><input type="checkbox" checked={j.enabled} onChange={(ev) => act(j.name, ev.target.checked ? "enable" : "disable")} /> {j.enabled ? "On" : "Off"}</label>
                <button className="btn small" type="button" onClick={() => act(j.name, "run")}>Run now</button>
                <button className="btn small danger" type="button" onClick={async () => { if (await ask({ title: `Delete the job "${j.name}"?`, action: "Delete", danger: true })) void act(j.name, "delete"); }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Triggers S={S} refresh={refresh} />
    </>
  );
}

// ---------- Triggers: work that starts when an issue or ticket arrives ----------
function Triggers({ S, refresh }: Panel) {
  const act = (name: string, action: string) => api("/api/triggers", { name, action }).then(refresh, (e) => complain(errorText(e)));
  const [adding, setAdding] = useState(false);
  const list = S.triggers ?? [];
  return (
    <div className="wiki-group">
      <h4>Triggers</h4>
      <p className="panel-note">Start a conversation when a GitHub issue gets a label, a Jira ticket matches a filter, or one of your own pull requests gets new feedback. Each one is ordinary work: its plan waits for your OK. {cap(w("hq"))} checks every five minutes while it's open; what's already there when you add a trigger isn't started.</p>
      {list.length > 0 && (
        <ul className="list">
          {list.map((t) => (
            <li className="card" key={t.name}>
              <div className="card-top"><span className="who"><Icon name="flag" /> {t.name}</span>
                <span className="pill">{t.kind === "jira" ? `Jira${t.jql ? `: ${t.jql}` : ": your filter"}` : t.kind === "github-pr" ? `links/${t.link} · your pull requests${t.describe ? " · descriptions kept current" : ""}` : `links/${t.link} · label “${t.label}”`}</span></div>
              <div className="meta">{t.lastPoll ? `Checked ${when(t.lastPoll)}` : "Not checked yet"} · {t.seen} seen{t.worktree ? " · new worktree each time" : ""}{t.project ? ` · project ${t.project}` : ""}</div>
              {t.lastError && <div className="meta bad">Last check failed: {t.lastError}</div>}
              <div className="clamp open">{t.task}</div>
              <div className="card-actions">
                <label className="switch"><input type="checkbox" checked={t.enabled} onChange={(ev) => act(t.name, ev.target.checked ? "enable" : "disable")} /> {t.enabled ? "On" : "Off"}</label>
                <button className="btn small" type="button" onClick={() => act(t.name, "check")}>Check now</button>
                <button className="btn small danger" type="button" onClick={async () => { if (await ask({ title: `Delete the trigger "${t.name}"?`, action: "Delete", danger: true })) void act(t.name, "delete"); }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? <TriggerForm S={S} done={() => { setAdding(false); refresh(); }} /> : <button type="button" className="btn small" onClick={() => setAdding(true)}>Add a trigger…</button>}
    </div>
  );
}

function TriggerForm({ S, done }: { S: CampState; done: () => void }) {
  const repos = S.links;
  const [kind, setKind] = useState<"github-issue" | "github-pr" | "jira">(repos.length ? "github-issue" : "jira");
  const [describe, setDescribe] = useState(true);
  const [name, setName] = useState("");
  const [link, setLink] = useState(repos[0]?.name ?? "");
  const [label, setLabel] = useState("mae");
  const [jql, setJql] = useState("");
  const ISSUE_TASK = "Fix what this describes. Plan first; keep the change small and add a test.";
  const PR_TASK = "Address this feedback on my pull request. Plan first: say what you'd change for each comment, and which comments you'd answer without changing anything. Run the project's checks after the changes. Don't commit, push, or reply on GitHub unless the plan says so and I approve it.";
  const [task, setTask] = useState(ISSUE_TASK);
  // Changing what's watched swaps the suggested wording, unless you've written your own.
  const pick = (k: typeof kind) => { setKind(k); setTask((was) => (was === ISSUE_TASK || was === PR_TASK ? (k === "github-pr" ? PR_TASK : ISSUE_TASK) : was)); };
  const [project, setProject] = useState("");
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!repos.length && !S.jira?.connected) {
    return (
      <div className="card trigger-form">
        <div className="meta">A trigger needs something to watch: link a GitHub repository (add its folder to a project) or your Jira account (Connectors) first.</div>
        <div className="card-actions"><button type="button" className="btn small" onClick={done}>Close</button></div>
      </div>
    );
  }
  const writable = kind === "github-pr" ? false : kind === "github-issue" ? S.links.find((l) => l.name === link)?.access === "write" : true; // a pull request is worked on where its branch is
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      await api("/api/triggers", { action: "add", trigger: { name, kind, link, label, jql, task, project, worktree: worktree && writable, describe: kind === "github-pr" && describe } });
      done();
    } catch (e) { complain(errorText(e)); }
    setBusy(false);
  }
  const projects = (S.history?.projects ?? []).filter((p) => p.id !== "general");
  return (
    <form className="card trigger-form" onSubmit={save}>
      <label>Name <input id="trigger-name" value={name} placeholder="fix-labelled-issues" onChange={(ev) => setName(ev.target.value)} /></label>
      <label>Watch <select id="trigger-kind" value={kind} onChange={(ev) => pick(ev.target.value as typeof kind)}>
        <option value="github-issue" disabled={!repos.length}>GitHub issues with a label</option>
        <option value="github-pr" disabled={!repos.length}>Your pull requests: new review comments and failing checks</option>
        <option value="jira" disabled={!S.jira?.connected}>Jira tickets matching a filter{S.jira?.connected ? "" : " (link Jira first)"}</option>
      </select></label>
      {kind !== "jira" ? <>
        <label>Repository <select id="trigger-link" value={link} onChange={(ev) => setLink(ev.target.value)}>
          {repos.map((l) => <option key={l.name} value={l.name}>links/{l.name}</option>)}
        </select></label>
        {kind === "github-issue"
          ? <label>Label <input id="trigger-label" value={label} onChange={(ev) => setLabel(ev.target.value)} /></label>
          : <label className="switch"><input id="trigger-describe" type="checkbox" checked={describe} onChange={(ev) => setDescribe(ev.target.checked)} /> After new commits are pushed, have the {nameNow("Scribe")} draft an updated description for you to approve</label>}
      </> : <label>JQL filter <input id="trigger-jql" value={jql} placeholder={`Empty: the ${w("camp")}'s own filter`} onChange={(ev) => setJql(ev.target.value)} /></label>}
      <label>{kind === "github-pr" ? "What to do with new feedback" : "What to do with each one"} <textarea id="trigger-task" value={task} onChange={(ev) => setTask(ev.target.value)} /></label>
      <label>Project <select id="trigger-project" value={project} onChange={(ev) => setProject(ev.target.value)}>
        <option value="">General</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      {writable && <label className="switch"><input id="trigger-worktree" type="checkbox" checked={worktree} onChange={(ev) => setWorktree(ev.target.checked)} /> Work in a new worktree each time</label>}
      <div className="card-actions"><button type="submit" className="btn small primary" disabled={busy}>Add trigger</button><button type="button" className="btn small" onClick={done}>Cancel</button></div>
    </form>
  );
}

// ---------- Skills ----------
export function Skills({ S, refresh }: Panel) {
  const act = (owner: string, name: string, action: "approve" | "reject") => api("/api/skills", { owner, name, action }).then(refresh, (e) => complain(errorText(e)));
  return (
    <>
      <p className="panel-note">Skills the {leadName()} proposed after {w("expeditions")}. Nothing goes live until you approve it.</p>
      {!S.skills.length ? <Empty title="No proposals">After a good {w("expedition")}, the {leadName()} may propose a skill that captures what worked.</Empty> : (
        <ul className="list">
          {S.skills.map((s) => (
            <li className="card" key={`${s.owner}/${s.name}`}>
              <div className="card-top"><span className="who"><Icon name="bolt" /> {s.owner}/{s.name}</span><span className={cx("pill", s.current && "live")}>{s.current ? "Replaces current" : "New"}</span></div>
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

// Commands the camp runs by itself in a linked folder: checks after a quest changes files there,
// or setup in each new worktree it creates for it.
const COMMANDS = {
  verify: { title: "Checks after changes", noun: "checks", example: "npm run typecheck",
    get hint() { return `Commands the ${w("camp")} runs by itself after ${an("quest")} changes files here, one per line. Results go into the ${w("quest")}'s report.`; } },
  setup: { title: "Setup for new worktrees", noun: "setup", example: "npm ci",
    get hint() { return `Commands the ${w("camp")} runs once in each new worktree it makes for this repository, before the ${w("crew")} starts there, one per line. They run without the sandbox, since installs need the network.`; } },
} as const;
export function LinkCommands({ link, kind, refresh, open }: { link: Link; kind: keyof typeof COMMANDS; refresh: () => void; open?: boolean }) {
  const list = link[kind] ?? [];
  const saved = list.join("\n");
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const c = COMMANDS[kind];
  async function save() {
    try { await api(`/api/links/${kind}`, { name: link.name, commands: text.split("\n") }); refresh(); } catch (e) { complain(errorText(e)); }
  }
  return (
    <details className="checks-edit" open={open ?? !!list.length}>
      <summary>{c.title}{list.length ? ` (${list.length})` : ""}</summary>
      <div className="meta">{c.hint} For example <code>{c.example}</code>.</div>
      <textarea spellCheck={false} aria-label={`${c.title} for ${link.name}`} value={text} onChange={(ev) => setText(ev.target.value)} />
      <div><button type="button" className="btn small primary" disabled={text.trim() === saved} onClick={save}>Save {c.noun}</button></div>
    </details>
  );
}

// ---------- Connectors (and linked folders) ----------
export function Connectors({ S, refresh, onAttachLink }: Panel & { onAttachLink: (link: Link) => void }) {
  async function unlink(l: Link) {
    if (!await ask({ title: `Unlink ${l.path}?`, body: "The folder itself isn't touched.", action: "Unlink", danger: true })) return;
    try { await api("/api/links/remove", { name: l.name }); refresh(); } catch (e) { complain(errorText(e)); }
  }
  const links = S.links ?? [];
  return (
    <>
      <JiraConnection S={S} refresh={refresh} />
      <CalendarConnection S={S} refresh={refresh} />
      <div className="wiki-group">
        <h4>Linked folders</h4>
        <p>Folders on your disk the {w("crew")} can read as links/&lt;name&gt;/, without uploading. Add one by adding its folder to a project.</p>
        {!links.length && <div className="meta">None yet.</div>}
        <ul className="list">
          {links.map((l) => (
            <li className="card" key={l.name}>
              <div className="card-top"><span className="who"><Icon name="folder" /> links/{l.name}</span><span className={cx("pill", l.access === "write" && "live")}>{l.access === "write" ? "Can edit" : "Read-only"}</span></div>
              <div className="meta" style={{ overflowWrap: "anywhere" }}>{l.path} · {l.files ?? "?"} files</div>
              <LinkCommands link={l} kind="verify" refresh={refresh} />
              <LinkCommands link={l} kind="setup" refresh={refresh} />
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
      {!S.connectors.length ? <Empty title="No connectors yet">Copy mcp.example.json (in the app's folder) to camp/mcp.json inside this outpost's folder, fill in a server (GitHub, a notes folder…) and list which {w("crew")} members may use it. A new server shows up here on the next refresh and is used on the {w("crew")}'s next run. If you change one that's already connected, restart the {w("camp")}.</Empty> : (
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
// Unread entries count on the badge in Settings' menu. Marking one as read keeps it here, quieter.
export function Inbox({ S, refresh }: Panel) {
  const voice = useContext(VoiceOn);
  if (!S.inbox.length) return <Empty title="Inbox is empty">Reports from scheduled jobs land here, newest first. Runs that find nothing new stay quiet.</Empty>;
  const unread = S.inbox.filter((m) => !m.seen).length;
  const markRead = (which: { heading: string } | { all: true }) => api("/api/inbox/seen", which).then(refresh, (e) => complain(errorText(e)));
  return (
    <>
      <div className="panel-note inbox-note">
        <span>{unread ? `${unread} unread` : "All read."}</span>
        {unread > 1 && <button className="btn small" type="button" onClick={() => markRead({ all: true })}>Mark all as read</button>}
      </div>
      <ul className="list">
        {S.inbox.map((m, i) => (
          <li className={cx("card", m.seen && "inbox-read")} key={`${m.heading}-${i}`}>
            <div className="card-top">
              <span className="who"><Icon name="inbox" /> {m.heading.split(" · ").pop()}{!m.seen && <span className="pill live">New</span>}</span>
              <time>{m.heading.split(" · ")[0]}</time>
            </div>
            <Markdown text={m.body} style={{ marginTop: 6, fontSize: 13.5 }} />
            {(!m.seen || voice) && (
              <div className="card-actions">
                {!m.seen && <button className="btn small" type="button" onClick={() => markRead({ heading: m.heading })}>Mark as read</button>}
                <ReadAloud text={m.body} markdown what={`Inbox · ${m.heading.split(" · ").pop()}`} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
