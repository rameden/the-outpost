// The star chart: every outpost on this machine, drawn as Orbit draws a camp and standing on the
// same night sky (the memory map's page, .constellation, with Orbit's star sheets and bodies). The
// sun at the middle is just the sun; every outpost is a planet on a contour line of its own, each
// treated the same, and each going slowly round the sun with its line (the stylesheet turns them:
// .hub-turn, and .hub-level to keep a planet and its name upright as it goes). Pick one to read about it in the panel, then launch it: the chart's server
// (scripts/launch.ts) starts that outpost and this page goes to it, signed in. One that's running
// glows; one that's stopped is dim.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { Icon } from "../components/bits.tsx";
import { contour } from "../components/MaeSystem.tsx";
import { cx, plural } from "../format.ts";
import { PLANET_R, STARS, SUN_R } from "../orbit/scene.ts";
import { chart, lapOf, lineAt, toneOf } from "./chart.ts";

export type HubOutpost = {
  id: string; name: string; port: number; dir: string;
  here: boolean;      // this checkout's own outpost
  running: boolean; starting: boolean;
  ours: boolean;      // started from the chart, so the chart can stop it
  crew: number | null; lastActive: number | null; since: number | null;
};

const token = () => document.querySelector('meta[name="hub-token"]')?.getAttribute("content") ?? "";

async function ask<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-hub-token": token(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `The chart's server answered ${r.status}.`);
  return j as T;
}

// "just now", "5 minutes ago", "3 days ago", then the date.
export function ago(then: number, now = Date.now()): string {
  const mins = Math.round((now - then) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${plural(days, "day")} ago`;
  return new Date(then).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

const day = (t: number) => new Date(t).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
const tone = (line: number) => ({ "--c": `var(--c-${toneOf(line)})` }) as CSSProperties;
const lap = (line: number) => ({ "--lap": `${lapOf(line)}s` }) as CSSProperties;
const PANEL = 400, NARROW = 760; // the panel's room beside the chart, and the width under which it sits below instead (as the stylesheet has it)
const DOUBLE_MS = 500, DOUBLE_PX = 10; // how soon and how near a second click counts as a double-click
const windowSize = () => ({ w: window.innerWidth || 1024, h: window.innerHeight || 768 });

// Orbit's sun, with its corona and dials. It is scenery: the outposts go round it.
function Sun() {
  const id = "hub-sun-glow";
  return (
    <g className="orb-sun" aria-hidden="true">
      <radialGradient id={id}><stop offset="0" className="orb-g0" /><stop offset=".3" className="orb-g1" /><stop offset="1" className="orb-g2" /></radialGradient>
      <circle className="orb-corona" r={SUN_R * 4.8} fill={`url(#${id})`} opacity=".72" />
      <g className="orb-sun-dial"><circle r={SUN_R + 9} /></g>
      <g className="orb-sun-dial inner"><circle r={SUN_R + 4.5} /></g>
      <circle className="orb-sun-core" r={SUN_R} />
    </g>
  );
}

// An outpost as Orbit draws a planet: its halo, its disc and its initial.
function Planet({ id, name }: { id: string; name: string }) {
  return <>
    <radialGradient id={id}><stop offset="0" className="orb-g0" /><stop offset=".45" className="orb-g1" /><stop offset="1" className="orb-g2" /></radialGradient>
    <circle className="orb-halo" r={PLANET_R * 3.6} fill={`url(#${id})`} />
    <circle className="orb-disc" r={PLANET_R} />
    <text className="orb-emoji hub-initial" y="3.7" textAnchor="middle">{name.trim().slice(0, 1).toUpperCase()}</text>
  </>;
}

export function Hub({ go = (url: string) => location.assign(url) }: { go?: (url: string) => void }) {
  const [outposts, setOutposts] = useState<HubOutpost[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<"launch" | "stop" | "new" | null>(null);
  const [error, setError] = useState("");
  const [lost, setLost] = useState(false); // the chart's server isn't answering
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const nameField = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setOutposts((await ask<{ outposts: HubOutpost[] }>("/api/outposts")).outposts); setLost(false); }
    catch { setLost(true); }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 2500);
    // Coming back from an outpost (the Back button) shows this page as it was left: mid-launch.
    const back = () => { setBusy(null); void load(); };
    window.addEventListener("pageshow", back);
    return () => { clearInterval(timer); window.removeEventListener("pageshow", back); };
  }, [load]);

  useEffect(() => { if (naming) nameField.current?.focus(); }, [naming]);

  const ids = (outposts ?? []).map((o) => o.id).join("\n");
  const map = useMemo(() => chart(ids ? ids.split("\n") : []), [ids]);
  const sel = outposts?.find((o) => o.id === picked) ?? null;
  const up = outposts?.filter((o) => o.running).length ?? 0;

  const pick = (id: string) => { setPicked(id); setError(""); setNaming(false); };
  const shut = () => { setPicked(null); setNaming(false); setError(""); };

  // A double-click on an outpost launches it. The first click opens the panel, which moves the chart
  // over, so the second click lands where the planet was, not on it, and the browser never calls that
  // a double-click. So it's counted here by time and place: a second click soon after, close to the
  // first, unless it's on another outpost.
  const lastClick = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const onPlanetClick = (ev: MouseEvent, o: HubOutpost) => {
    lastClick.current = { id: o.id, t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
    pick(o.id);
  };
  const onAnyClick = (ev: MouseEvent) => {
    const prev = lastClick.current;
    if (!prev) return;
    const on = (ev.target as Element | null)?.closest?.("[data-outpost]")?.getAttribute("data-outpost");
    const double = ev.timeStamp - prev.t < DOUBLE_MS && Math.hypot(ev.clientX - prev.x, ev.clientY - prev.y) < DOUBLE_PX && (!on || on === prev.id);
    if (!double) return;
    lastClick.current = null;
    ev.stopPropagation(); // it's the launch, not another pick
    const o = outposts?.find((x) => x.id === prev.id);
    if (o && busy === null) void launch(o);
  };

  // Esc steps back: out of the panel that's open.
  const open = naming || !!sel;
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") shut(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The chart fills what the panel leaves of the page: beside it on a wide page, above it on a narrow one.
  const [size, setSize] = useState(windowSize);
  useEffect(() => {
    const fit = () => setSize(windowSize());
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const narrow = size.w <= NARROW;
  const room = { w: size.w - (open && !narrow ? PANEL : 0), h: (open && narrow ? size.h * 0.44 : size.h - 70) - 64 };
  const k = Math.min(2.4, Math.max(0.5, Math.min(room.w, room.h) / (2 * map.half)));
  const mid = { x: room.w / 2, y: 64 + room.h / 2 };

  async function launch(o: HubOutpost) {
    setBusy("launch"); setError("");
    try { go((await ask<{ url: string }>("/api/launch", { id: o.id })).url); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); void load(); }
  }
  async function stop(o: HubOutpost) {
    setBusy("stop"); setError("");
    try { setOutposts((await ask<{ outposts: HubOutpost[] }>("/api/stop", { id: o.id })).outposts); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }
  async function make(ev: FormEvent) {
    ev.preventDefault();
    if (!newName.trim()) return;
    setBusy("new"); setError("");
    try {
      const made = await ask<{ id: string; outposts: HubOutpost[] }>("/api/new", { name: newName });
      setOutposts(made.outposts); setPicked(made.id); setNaming(false); setNewName("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  return (
    <main className={cx("constellation", "hub", open && "has-panel")} aria-label="Star chart of your outposts" onClickCapture={onAnyClick}>
      {STARS.map((_, j) => <div key={j} className={`orb-stars s${j + 1}`} aria-hidden="true" />)}
      <svg className="hub-sky">
        <g transform={`translate(${mid.x.toFixed(1)} ${mid.y.toFixed(1)}) scale(${k.toFixed(4)})`} style={{ "--k": k.toFixed(4) } as CSSProperties}>
          {outposts && <g aria-hidden="true">
            {Array.from({ length: map.lines }, (_, i) => <g key={i} className="hub-turn" style={lap(i)}><path className="con-line" transform={`rotate(${map.bodies.find((b) => b.line === i)?.deg ?? i * 97})`} d={contour(lineAt(i), i)} /></g>)}
            <path className="con-line hub-far" d={contour(lineAt(map.lines - 1) + 30, map.lines)} />
          </g>}
          <Sun />
          {outposts?.map((o, i) => {
            const b = map.bodies[i];
            if (!b) return null;
            const reach = PLANET_R + 6;
            return (
              <g key={o.id} className="hub-turn" style={lap(b.line)}>
              <g className={cx("con-star", "hub-body", "orb-planet", o.running ? "st-active" : "off", o.starting && "starting", o.id === picked && "sel")}
                style={tone(b.line)} transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`} role="button" tabIndex={0} aria-pressed={o.id === picked}
                aria-label={`Outpost ${o.name}, ${o.running ? "running" : o.starting ? "starting" : "stopped"}`}
                data-outpost={o.id} onClick={(ev) => onPlanetClick(ev, o)}
                onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(o.id); } }}>
                <g className="hub-level">
                  <circle className="con-hit" r={Math.max(reach, 22 / k)} />
                  <Planet id={`hub-glow-${i}`} name={o.name} />
                  <circle className="con-ring" r={reach} />
                  <text className="hub-name" y={reach} textAnchor="middle">{o.name}</text>
                  <text className="hub-says" y={reach} textAnchor="middle">{o.running ? "running" : o.starting ? "starting…" : "stopped"}</text>
                </g>
              </g>
              </g>
            );
          })}
        </g>
      </svg>

      <header className="con-top">
        <div className="con-title">
          <h1>Outposts</h1>
          {outposts && <p>{outposts.length} {plural(outposts.length, "outpost")} · {up} running</p>}
        </div>
        <div className="con-tools">
          <button type="button" className="con-tool worded" aria-pressed={naming} onClick={() => { setNaming(!naming); setPicked(null); setError(""); }}>New outpost</button>
        </div>
      </header>

      {lost ? (
        <div className="con-empty" role="alert">
          <b>The chart's server isn't answering</b>
          <p>Start it again with <code>npm start</code>.</p>
        </div>
      ) : !outposts ? <p className="con-empty" role="status">Reading the chart…</p> : null}

      {outposts && (
        <footer className="con-foot">
          <ul className="con-key" aria-label="How to read the chart">
            <li><svg viewBox="-13 -8 26 16" aria-hidden="true"><g className="orb-planet st-active" style={tone(4)}><circle className="hub-key-halo" r="8" /><circle className="orb-disc" r="4.5" /></g></svg>running</li>
            <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><g className="orb-planet" style={tone(4)}><circle className="orb-disc" r="4.5" /></g></svg>stopped</li>
          </ul>
          <p>Each planet is an outpost: a workspace of its own, with its own team and records.</p>
          <p className="con-hint" aria-hidden="true">Click an outpost to read about it · double-click to launch it · Esc to step back</p>
        </footer>
      )}

      {naming ? (
        <aside className="con-panel" aria-label="A new outpost">
          <header>
            <h3>A new outpost</h3>
            <button type="button" className="con-tool" title="Close (Esc)" aria-label="Close" onClick={shut}><Icon name="x" /></button>
          </header>
          <div className="con-panel-body">
            <form id="hub-new" className="hub-new" onSubmit={(ev) => void make(ev)}>
              <label htmlFor="hub-new-name">Name the new outpost</label>
              <input id="hub-new-name" ref={nameField} value={newName} maxLength={24} placeholder="Work" autoComplete="off" onChange={(ev) => setNewName(ev.target.value)} />
            </form>
            <p className="con-quiet">It starts empty, with a team, memory, settings and keys of its own, and takes the next line out on the chart.</p>
            {error && <p className="con-error" role="alert">{error}</p>}
          </div>
          <footer>
            <button type="submit" form="hub-new" className="btn primary" disabled={busy !== null || !newName.trim()}>{busy === "new" ? "Making…" : "Make"}</button>
            <button type="button" className="btn" onClick={shut}>Cancel</button>
          </footer>
        </aside>
      ) : sel ? (
        <aside className="con-panel" aria-label="The outpost you picked" style={tone(map.bodies.find((b) => b.id === sel.id)?.line ?? 0)}>
          <header>
            <span className="con-dot" aria-hidden="true" />
            <h3>Outpost {sel.name}</h3>
            <button type="button" className="con-tool" title="Close (Esc)" aria-label="Close this outpost" onClick={shut}><Icon name="x" /></button>
          </header>
          <div className="con-panel-body" aria-live="polite">
            <p className="con-text">{sel.crew === null && !sel.lastActive
              ? "A new outpost: it starts empty, with its own team, memory and settings."
              : "Its team, memory, settings and keys are its own. No other outpost can read them."}</p>
            <dl className="con-facts">
              <dt>Status</dt><dd>{sel.running ? "Running" : sel.starting ? "Starting…" : "Stopped"}</dd>
              {sel.crew !== null && <><dt>Team</dt><dd>{sel.crew} {plural(sel.crew, "member")}</dd></>}
              <dt>Last active</dt><dd>{sel.lastActive ? ago(sel.lastActive) : "Not yet"}</dd>
              {sel.since && <><dt>Made</dt><dd>{day(sel.since)}</dd></>}
              <dt>Address</dt><dd className="hub-mono">localhost:{sel.port}</dd>
              <dt>Folder</dt><dd className="hub-mono">{sel.dir}</dd>
            </dl>
            {sel.running && !sel.ours && <p className="con-quiet">Started outside the chart, so it's stopped where it was started.</p>}
            {error && <p className="con-error" role="alert">{error}</p>}
          </div>
          <footer>
            <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void launch(sel)}>
              {busy === "launch" ? (sel.running ? "Entering…" : "Launching…") : sel.running ? "Enter" : "Launch"}
            </button>
            {sel.ours && sel.running && <button type="button" className="btn" disabled={busy !== null} onClick={() => void stop(sel)}>{busy === "stop" ? "Stopping…" : "Stop"}</button>}
          </footer>
        </aside>
      ) : null}
    </main>
  );
}
