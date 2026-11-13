// One crew member's page, as a drawer: chat with them, their runs and each run's steps, their
// memory (editable), the files they've made, and what they are (tools, skills, stats).

import { Fragment, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText, outputUrl } from "../api.ts";
import { liveKey, type CrewStatus } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, clock, cx, dayLabel, isImagePath, kTok, money, plural, shortModel, spaced, stripFrontmatter, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { AgentDetail, CampEvent, CampState, SendResult, Transcript, TranscriptPart } from "../types.ts";
import type { OpenPicker } from "./Crew.tsx";
import { Clamp, Empty, Icon } from "./bits.tsx";

export type AgentTab = "chat" | "runs" | "memory" | "outputs" | "about";
const TABS: [AgentTab, string][] = [["chat", "Chat"], ["runs", "Runs"], ["memory", "Memory"], ["outputs", "Outputs"], ["about", "About"]];
const SOURCE_LABEL: Record<string, string> = { user: "You", direct: "You", discord: "You (Discord)", brief: "🧭 Quartermaster's brief", job: "⏰ Scheduled job" };

// ---------- A run's steps: what they were asked, what they said, each tool call and its result ----------
const short = (v: unknown, n = 600) => { const t = typeof v === "string" ? v : JSON.stringify(v, null, 2) ?? ""; return t.length > n ? t.slice(0, n) + "…" : t; };

function transcriptSteps(s: Transcript) {
  const steps: { label: string; text: string; tool?: boolean }[] = [];
  for (const m of s.messages ?? []) {
    const parts: TranscriptPart[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content ?? [];
    for (const p of parts) {
      if (p.type === "text" && p.text?.trim()) steps.push({ label: m.role === "user" ? "Asked" : "Said", text: short(p.text.replace(/^\(Sent directly by the user[^)]*\)\s*/, ""), 1500) });
      else if (p.type === "tool_use" || p.type === "server_tool_use") steps.push({ label: `Used ${p.name}`, text: short(p.input), tool: true });
      else if (p.type === "tool_result") steps.push({ label: "Got back", text: short(Array.isArray(p.content) ? p.content.map((c) => c.text ?? `[${c.type}]`).join("\n") : p.content ?? "") });
      else if (p.type === "image" || p.type === "document") steps.push({ label: "Attached", text: `[${p.type}]` });
    }
  }
  return steps;
}

// A "show the steps" button and, once opened, the steps themselves (loaded on first open).
function useTranscript(agentId: string, file: string | undefined, closedLabel: string) {
  const [state, setState] = useState<"closed" | "loading" | "open" | "failed">("closed");
  const [steps, setSteps] = useState<ReturnType<typeof transcriptSteps>>([]);
  async function toggle() {
    if (state === "open") return setState("closed");
    if (!file) return;
    setState("loading");
    try {
      setSteps(transcriptSteps(await api<Transcript>(`/api/agent/session?id=${encodeURIComponent(agentId)}&file=${encodeURIComponent(file)}`)));
      setState("open");
    } catch { setState("failed"); }
  }
  const label = state === "open" ? "Hide steps" : state === "loading" ? "Loading…" : state === "failed" ? "Couldn't load" : closedLabel;
  const view = state !== "open" ? null : (
    <div className="transcript">
      {steps.map((s, i) => <div key={i} className={s.tool ? "tx-step tool" : "tx-step"}><div className="tx-label">{s.label}</div><pre>{s.text}</pre></div>)}
      {!steps.length && <div className="meta">No steps recorded.</div>}
    </div>
  );
  return { label, toggle, view };
}

// ---------- Chat ----------
// Work happening right now, shown under the saved conversation until the run ends and is saved.
type LiveItem =
  | { kind: "you"; id: number; text: string }
  | { kind: "note"; id: number; text: string }
  | { kind: "brief"; id: number }
  | { kind: "agent"; id: number; text: string; streaming: boolean }
  | { kind: "tool"; id: number; tool: string; input: string };
type Live = { items: LiveItem[]; open: Record<string, number>; next: number };
type LiveAction = { type: "clear" } | { type: "you"; text: string; note?: string } | { type: "event"; event: CampEvent; briefed: boolean };
const noLive: Live = { items: [], open: {}, next: 1 };

function liveReducer(s: Live, a: LiveAction): Live {
  if (a.type === "clear") return noLive;
  if (a.type === "you") {
    const items: LiveItem[] = [...s.items, { kind: "you", id: s.next, text: a.text }];
    if (a.note) items.push({ kind: "note", id: s.next + 1, text: a.note });
    return { ...s, items, next: s.next + 2 };
  }
  const e = a.event;
  let { items, open, next } = s;
  if (e.type === "dispatch" && a.briefed) items = [...items, { kind: "brief", id: next++ }];
  if (e.type === "text_delta") {
    const key = liveKey(e);
    if (open[key]) items = items.map((it) => (it.id === open[key] && it.kind === "agent" ? { ...it, text: it.text + e.delta } : it));
    else { open = { ...open, [key]: next }; items = [...items, { kind: "agent", id: next++, text: e.delta, streaming: true }]; }
  }
  if (e.type === "text") {
    const key = liveKey(e);
    if (open[key]) items = items.map((it) => (it.id === open[key] && it.kind === "agent" ? { ...it, text: e.text, streaming: false } : it));
    else items = [...items, { kind: "agent", id: next++, text: e.text, streaming: false }];
    const { [key]: _done, ...rest } = open;
    open = rest;
  }
  if (e.type === "tool") {
    const { [liveKey(e)]: _done, ...rest } = open;
    open = rest;
    items = [...items, { kind: "tool", id: next++, tool: e.tool, input: e.input }];
  }
  return { items, open, next };
}

function SessionBubbles({ a, s }: { a: AgentDetail; s: AgentDetail["sessions"][number] }) {
  const steps = useTranscript(a.id, s.file, "How they did it");
  const fromYou = ["user", "direct", "discord"].includes(s.source);
  return (
    <>
      <div className={cx("bubble", fromYou ? "you" : "brief")}>{fromYou ? s.task : `${SOURCE_LABEL[s.source] ?? s.source}: ${s.task}`}</div>
      <div className="bubble agent">
        <Markdown text={s.result || "(no reply)"} />
        <div className="bubble-meta">
          <span>{clock(s.time)}</span>
          {s.status !== "done" && <span className="pill bad">{spaced(s.status)}</span>}
          <button type="button" className="linkish" onClick={steps.toggle}>{steps.label}</button>
        </div>
        {steps.view}
      </div>
    </>
  );
}

function Chat({ a, live }: { a: AgentDetail; live: LiveItem[] }) {
  let lastDay = "";
  return (
    <div className="thread">
      {!a.sessions.length && !live.length && <div className="empty"><b>No conversations yet</b>Say hello: ask the {a.name} who they are, or give them something from their line of work.</div>}
      {a.sessions.map((s) => {
        const day = dayLabel(s.time);
        const header = day !== lastDay ? <div className="thread-day">{day}</div> : null;
        lastDay = day;
        return <Fragment key={s.file}>{header}<SessionBubbles a={a} s={s} /></Fragment>;
      })}
      {live.map((it) =>
        it.kind === "you" ? <div key={it.id} className="bubble you">{it.text}</div>
        : it.kind === "note" ? <div key={it.id} className="thread-day">{it.text}</div>
        : it.kind === "brief" ? <div key={it.id} className="bubble brief">🧭 The Quartermaster sent them on a quest…</div>
        : it.kind === "tool" ? <div key={it.id} className="tool"><b>{it.tool}</b><code>{it.input}</code></div>
        : <div key={it.id} className="bubble agent">{it.streaming ? <div className="md streaming">{it.text}</div> : <Markdown text={it.text} />}</div>)}
    </div>
  );
}

// ---------- Runs ----------
function Run({ a, q }: { a: AgentDetail; q: AgentDetail["runs"][number] }) {
  const steps = useTranscript(a.id, q.session, "Show steps");
  const u = q.usage;
  const ok = q.status === "done";
  return (
    <li className="card">
      <div className="card-top">
        <span className={cx("pill", ok ? "done" : "bad")}>{spaced(q.status)}</span>
        <span className="meta" style={{ margin: 0 }}>{q.kind === "job" ? `⏰ ${q.job ?? "job"}` : q.kind === "expedition" ? "Expedition" : "Quest"}</span>
        <time>{when(q.time)}</time>
      </div>
      <div className="meta">
        <b>{money(q.cost)}{q.runtime === "claude-code" ? " est." : ""}</b> · {q.seconds}s · {q.turns} {plural(q.turns, "turn")} · {kTok(u.input + u.cacheRead + u.cacheWrite)} in · {kTok(u.output)} out · {shortModel(q.model)} · {q.effort ?? "default"}
      </div>
      <Clamp><b>Asked</b> {q.task}</Clamp>
      <Clamp><b>Result</b> {q.result}</Clamp>
      {q.session
        ? <div className="card-actions"><button type="button" className="btn small" onClick={steps.toggle}>{steps.label}</button></div>
        : <div className="meta">Steps weren't recorded for this older run.</div>}
      {steps.view}
    </li>
  );
}

// ---------- Memory ----------
function Memory({ a }: { a: AgentDetail }) {
  const [text, setText] = useState(a.memory);
  const [saved, setSaved] = useState("");
  async function save() {
    try { await api("/api/agent/memory", { id: a.id, text }); setSaved("Saved."); }
    catch (e) { setSaved(errorText(e)); }
  }
  return (
    <>
      <p className="panel-note">What the {a.name} remembers between sessions, loaded into every run. They add to it with their remember tool; edit here to correct or remove things. Their name, role, and personality aren't stored here and can't change.</p>
      <textarea className="memory-edit" aria-label={`${a.name}'s memory`} value={text} onChange={(ev) => { setText(ev.target.value); setSaved(""); }} />
      <div className="card-actions"><button type="button" className="btn small primary" onClick={save}>Save memory</button><span className="meta">{saved}</span></div>
    </>
  );
}

// ---------- Outputs ----------
function OutputView({ a, path, onBack }: { a: AgentDetail; path: string; onBack: () => void }) {
  const image = isImagePath(path);
  const [file, setFile] = useState<{ text?: string; binary?: boolean; size?: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (image) return;
    let gone = false;
    api<{ text?: string; binary?: boolean; size?: number }>(`/api/agent/output?id=${encodeURIComponent(a.id)}&path=${encodeURIComponent(path)}`).then(
      (r) => { if (!gone) setFile(r); },
      (e) => { if (!gone) setError(errorText(e)); },
    );
    return () => { gone = true; };
  }, [a.id, path, image]);
  return (
    <>
      <div className="viewer-head"><button className="btn small" type="button" onClick={onBack}>← Files</button><code>{path}</code></div>
      <div className="output-view">
        {image ? <img src={outputUrl(a.id, path)} alt={path} />
          : error ? error
          : !file ? "Loading…"
          : file.binary ? <div className="meta">Binary file ({Math.round((file.size ?? 0) / 1024)} KB), open it from {path}.</div>
          : /\.md$/i.test(path) ? <Markdown text={stripFrontmatter(file.text ?? "")} />
          : <pre className="raw" style={{ maxHeight: "none" }}>{file.text}</pre>}
      </div>
    </>
  );
}

function Outputs({ a }: { a: AgentDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <OutputView a={a} path={open} onBack={() => setOpen(null)} />;
  if (!a.outputs.length) return <Empty title="No files yet">Files the {a.name} makes for you land in camp/agents/{a.id}/outputs/.</Empty>;
  const prefix = `camp/agents/${a.id}/outputs/`;
  return (
    <div>
      {a.outputs.map((f) => (
        <button key={f.path} type="button" className="page-link" onClick={() => setOpen(f.path)}>
          <strong>{f.path.replace(prefix, "")}</strong><span>{Math.max(1, Math.round(f.size / 1024))} KB · {when(f.modified)}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- About ----------
export function About({ a }: { a: AgentDetail }) {
  const s = a.stats;
  const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="about-row"><span>{label}</span>{children}</div>;
  return (
    <>
      <div className="stat-grid">
        <div className="stat"><b>{s.runs}</b><span>Runs</span></div>
        <div className="stat"><b>{s.successRate != null ? `${s.successRate}%` : "–"}</b><span>Finished</span></div>
        <div className="stat"><b>{money(s.cost)}</b><span>Spent</span></div>
        <div className="stat"><b>{s.avgSeconds != null ? `${s.avgSeconds}s` : "–"}</b><span>Average run</span></div>
      </div>
      <Row label="Personality"><span>{a.personality}</span></Row>
      <Row label="Handles"><span>{a.handles}</span></Row>
      <Row label="Not theirs"><span>{a.notFor}</span></Row>
      <Row label="Model"><span>{a.model} · {a.effort}{a.overridden && <> <span className="meta">(default: {a.defaultModel} · {a.defaultEffort})</span></>}</span></Row>
      <Row label="Also called"><span>{a.aliases.map((x) => `@${x}`).join(", ") || "–"}</span></Row>
      <Row label="Last active"><span>{s.lastActive ? when(s.lastActive) : "Not yet"}</span></Row>
      <Row label="Tools"><span className="tool-chips" style={{ margin: 0 }}>{a.tools.map((t, i) => <code key={i} className={t.startsWith("mcp__") ? "write" : ""}>{t}</code>)}</span></Row>
      <Row label="Skills"><span>{a.skills.length ? a.skills.map((k) => <div key={`${k.owner}/${k.name}`}><b>{k.owner === "shared" ? "shared/" : ""}{k.name}</b>{k.always && <span className="pill live" title="Its instructions are in every one of this crew member's prompts (set under Settings → Skills)">Always on</span>} <span className="meta">{k.description}</span></div>) : "None yet"}</span></Row>
      <Row label="Workspace"><span><code>camp/agents/{a.id}/</code></span></Row>
    </>
  );
}

// ---------- The drawer ----------
// project: the project you're in when you open the page; a new chat from here is filed under it.
export function AgentDrawer({ agentId, tab, setTab, S, store, pickerOpen, onOpenPicker, onClose, project }: {
  agentId: string; tab: AgentTab; setTab: (t: AgentTab) => void; S: CampState | null; store: FeedStore; project?: string;
  pickerOpen: boolean; onOpenPicker: OpenPicker; onClose: () => void;
}) {
  const [a, setA] = useState<AgentDetail | null>(null);
  const [error, setError] = useState("");
  const [live, dispatchLive] = useReducer(liveReducer, noLive);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const character = S?.characters.find((c) => c.id === agentId);
  const crew = useFeed(store, (s) => s.crew);

  // Load the page, and reload it (a moment later) when a run of theirs ends or their records change.
  const clearLive = useRef(false);
  const load = useCallback(async () => {
    try {
      const data = await api<AgentDetail>(`/api/agent?id=${encodeURIComponent(agentId)}`);
      setA(data);
      setError("");
      if (clearLive.current) { clearLive.current = false; dispatchLive({ type: "clear" }); } // the finished run is in the saved conversation now
    } catch (e) { setError(errorText(e)); }
  }, [agentId]);
  useEffect(() => { setA(null); dispatchLive({ type: "clear" }); void load(); }, [load]);

  const now = useRef({ a, tab });
  now.current = { a, tab };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = (finished: boolean) => { if (finished) clearLive.current = true; clearTimeout(timer); timer = setTimeout(load, 500); };
    const off = store.onEvent((e) => {
      const { a, tab } = now.current;
      if (!a) return;
      const mine = "who" in e && e.who === a.name;
      if (e.type === "expedition_end" || (e.type === "return" && mine)) return reload(true);
      if (e.type === "changed" && (e.what === "memory" || e.what === "settings" || e.what === "log")) {
        if (tab !== "memory") reload(e.what === "log"); // don't reload under an edit in progress
        return;
      }
      if (mine && tab === "chat") dispatchLive({ type: "event", event: e, briefed: store.lastSource() !== "direct" });
    });
    return () => { off(); clearTimeout(timer); };
  }, [store, load]);

  // Esc closes the page (unless the model picker is open on top of it: Esc closes that first).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !pickerOpen) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, onClose]);

  const loaded = !!a;
  useEffect(() => { if (loaded) (tab === "chat" ? input.current : closeBtn.current)?.focus(); }, [loaded, agentId]);

  // Chat opens at the latest message, and follows new ones unless you've scrolled up.
  const sessions = a?.sessions;
  useLayoutEffect(() => { if (tab === "chat" && body.current) body.current.scrollTop = body.current.scrollHeight; }, [sessions, tab]);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && tab === "chat" && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [live, tab]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    if (draft) el.style.height = Math.min(180, el.scrollHeight) + "px";
  }, [draft]);

  const isQm = agentId === "quartermaster";
  // One send at a time: a second Enter while the first is still on its way would start two runs.
  const sendingNow = useRef(false);
  const [sending, setSending] = useState(false);
  async function send(ev: FormEvent) {
    ev.preventDefault();
    const text = draft.trim();
    if (!text || !a || sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    try {
      const r = await api<SendResult>("/api/send", { text: isQm ? text : `@${a.id} ${text}`, chat: !isQm, project });
      setDraft((now) => (now.startsWith(draft) ? now.slice(draft.length) : now)); // keep anything typed while it was sending
      setHint("");
      dispatchLive({ type: "you", text, note: r.position > 0 ? `Queued (#${r.position}): starts when one of the running expeditions finishes` : undefined });
      setTimeout(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, 0);
    } catch (e) { setHint(errorText(e)); }
    finally { sendingNow.current = false; setSending(false); }
  }

  const name = a?.name ?? character?.name ?? "";
  const st: CrewStatus = crew[name] ?? { status: "idle", line: "" };
  const status = st.status === "active" ? (st.line || "Working…") : st.status === "waiting" ? "Waiting for your OK" : "At camp";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={cx("drawer", cClass(name))} role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
        <header className="drawer-head">
          <div className="avatar" aria-hidden="true">{a?.emoji ?? character?.emoji}</div>
          <div style={{ minWidth: 0 }}>
            <h2 id="drawerTitle">{name}</h2>
            <div className="dh-role">{a?.role ?? character?.role}</div>
            {a && (
              <div className="dh-meta">
                <span><span className={cx("dot", st.status === "active" && "live")} />{status}</span>
                <button type="button" className={cx("kit-btn", a.overridden && "custom")} title="Change model"
                  onClick={(ev) => { ev.stopPropagation(); if (character) onOpenPicker(character, ev.currentTarget); }}>
                  <span>{shortModel(a.model)} · {a.effort}</span>▾
                </button>
                <span>Lv {Math.floor(a.xp / 50) + 1} · {a.xp} XP</span>
                <span>{a.stats.runs} {plural(a.stats.runs, "run")}{a.stats.successRate != null ? ` · ${a.stats.successRate}% done` : ""} · {money(a.stats.cost)}</span>
              </div>
            )}
          </div>
          <button className="icon-btn" type="button" aria-label="Close" ref={closeBtn} onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="tabs" role="tablist">
          {a && TABS.map(([id, label]) => (
            <button key={id} type="button" className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}{id === "runs" && a.stats.runs > 0 && <span className="count">{a.stats.runs}</span>}
            </button>
          ))}
        </div>
        <div className="drawer-body" ref={body}>
          {!a ? (error ? <Empty title="Couldn't load">{error}</Empty> : <div className="empty">Loading…</div>)
            : tab === "chat" ? <Chat a={a} live={live.items} />
            : tab === "runs" ? (a.runs.length
              ? <ul className="list">{a.runs.map((q, i) => <Run key={`${q.time}-${i}`} a={a} q={q} />)}</ul>
              : <Empty title="No runs yet">Every time the {a.name} works, the run shows up here with its cost, time, and steps.</Empty>)
            : tab === "memory" ? <Memory key={a.id} a={a} />
            : tab === "outputs" ? <Outputs a={a} />
            : <About a={a} />}
        </div>
        {tab === "chat" && (
          <div className="drawer-composer">
            <form onSubmit={send}>
              <textarea ref={input} rows={1} aria-label="Message" placeholder={isQm ? "Ask the Quartermaster…" : `Message the ${name}…`} value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); ev.currentTarget.form?.requestSubmit(); } }} />
              <button className="btn primary" type="submit" disabled={sending} aria-busy={sending || undefined}>Send</button>
            </form>
            <div className="drawer-hint">
              {hint || (isQm
                ? "Starts an expedition. You'll approve the plan in the main feed. Enter to send."
                : `Goes straight to the ${name}, skipping the Quartermaster. It continues your last chat with them if that was in the past 6 hours. Enter to send.`)}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
