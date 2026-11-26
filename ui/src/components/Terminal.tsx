// The terminal pane along the bottom of the page: your own shell on this machine.
//
// Each tab is a session the camp server keeps (so hiding the pane, or reloading the page, doesn't
// end it); this component shows one of them through xterm.js. Output arrives over a stream from
// the camp, and what you type is sent back. New tabs start in the folder of the project you're
// in. Hide the pane with its ⌄ button or Ctrl+` and bring it back the same way. Its size is its
// zone's: drag the line beside it.

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, errorText, storeGet, storeSet, termStreamUrl } from "../api.ts";
import { cx, youActed } from "../format.ts";
import { DrawerHead, Icon } from "./bits.tsx";
import type { TerminalInfo, TermAction } from "../types.ts";

// The page allows no inline styles, except <style> elements carrying this launch's nonce (the
// camp server puts it in a <meta> tag). xterm.js writes its colours and cell sizes into style
// elements it creates itself, so from the first terminal on, style elements made by the page's
// own script get the nonce. (Under `npm run ui`, where Vite serves the page, there's no such policy, and no nonce.)
let stylesAllowed = false;
function allowTerminalStyles() {
  if (stylesAllowed) return;
  stylesAllowed = true;
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="camp-style-nonce"]')?.content ?? "";
  if (!nonce || nonce === "__CAMP_NONCE__") return;
  const create = document.createElement.bind(document);
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const el = create(tag, options);
    if (String(tag).toLowerCase() === "style") (el as HTMLStyleElement).nonce = nonce;
    return el;
  }) as typeof document.createElement;
}
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Colours taken from the page's own theme, so the terminal follows light and dark.
function themeNow(): ITheme {
  return {
    background: cssVar("--bg"), foreground: cssVar("--text"), cursor: cssVar("--accent"), cursorAccent: cssVar("--bg"),
    selectionBackground: cssVar("--border-strong"),
  };
}

// One session on screen.
function TerminalView({ id, onExit }: { id: string; onExit: (code: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const exited = useRef(onExit);
  exited.current = onExit;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const term = new Xterm({
      fontFamily: cssVar("--mono") || "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.2,
      cursorBlink: true, scrollback: 5000, theme: themeNow(), allowProposedApi: false, macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    allowTerminalStyles();
    term.open(el);

    // Keystrokes go to the camp in order, a few at a time.
    let pending = "";
    let sending = false;
    const flush = async () => {
      if (sending || !pending) return;
      sending = true;
      const data = pending;
      pending = "";
      try { await api("/api/term/input", { id, data }); } catch { /* the session is gone: its exit line says so */ }
      sending = false;
      void flush();
    };
    const typed = term.onData((d) => { pending += d; void flush(); });

    let last = "";
    const resize = () => {
      if (!el.clientWidth || !el.clientHeight) return; // hidden
      try { fit.fit(); } catch { return; }
      const size = `${term.cols}x${term.rows}`;
      if (size === last) return;
      last = size;
      void api("/api/term/resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    // The pane changes size many times a second while it slides open or a line is dragged:
    // fit (and tell the shell) once it has settled.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const watching = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { clearTimeout(settle); settle = setTimeout(resize, 70); });
    watching?.observe(el);
    resize();

    const stream = new EventSource(termStreamUrl(id));
    // The camp sends everything the session has printed so far each time the stream connects.
    // The first time that fills the screen; after a dropped connection it would write it all a
    // second time under what's there, so the screen is cleared for it first.
    let connected = false;
    stream.addEventListener("open", () => { if (connected) term.reset(); connected = true; });
    stream.addEventListener("data", (m) => term.write(JSON.parse((m as MessageEvent).data) as string));
    stream.addEventListener("exit", (m) => {
      const { code } = JSON.parse((m as MessageEvent).data) as { code: number };
      term.write(`\r\n\x1b[2m[The shell ended${code ? ` with code ${code}` : ""}. Close this tab, or open a new one.]\x1b[0m\r\n`);
      stream.close();
      exited.current(code);
    });

    // Follow the page between light and dark.
    const themed = new MutationObserver(() => { term.options.theme = themeNow(); });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    const onScheme = () => { term.options.theme = themeNow(); };
    scheme?.addEventListener("change", onScheme);

    if (youActed()) term.focus(); // (not when it's only come back open with the page)
    return () => {
      clearTimeout(settle); stream.close(); typed.dispose(); watching?.disconnect(); themed.disconnect(); scheme?.removeEventListener("change", onScheme);
      term.dispose();
    };
  }, [id]);

  return <div className="term-view" ref={box} />;
}

// The rail the terminal leaves while hidden is in TerminalRail.tsx: it shows without loading xterm.
export { TerminalRail } from "./TerminalRail.tsx";

// What a quick action types: its commands as one line, each running only if the one before it
// succeeded, and Enter unless the action leaves that to you.
export const actionLine = (a: TermAction) => a.commands.join(" && ");
export const actionInput = (a: TermAction) => actionLine(a) + (a.ask ? "" : "\r");
// What its chip says when you rest on it.
export function actionTitle(a: TermAction, live: boolean) {
  const where = a.where === "current" ? "in this terminal" : `in a new terminal${a.folder ? `, in ${a.folder}${a.sub ? `/${a.sub}` : ""}` : ""}`;
  return live ? `${a.label} has its own tab open: click to go to it. Click again while you're there to run it again in that tab.\n\n${actionLine(a)}`
    : `${a.ask ? "Types" : "Runs"} ${where}${a.ask ? ", and waits for you to press Enter" : ""}:\n\n${a.commands.join("\n")}`;
}

// A quick action was about to type into a terminal you locked: it didn't. What now is yours to
// say: somewhere else (a new terminal, the safe way on), here after all, or nowhere.
function LockedWarning({ title, children, onNew, onHere, onCancel }: { title: string; children: ReactNode; onNew: () => void; onHere: () => void; onCancel: () => void }) {
  const safe = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safe.current?.focus();
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onCancel(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <>
      {/* A mouse shortcut for Cancel: Esc and the Cancel button do the same from the keyboard. */}
      <div className="drawer-backdrop" aria-hidden="true" onClick={onCancel} />
      <div className="dialog confirm term-locked" role="alertdialog" aria-modal="true" aria-labelledby="term-locked-title" aria-describedby="term-locked-body">
        <h2 id="term-locked-title">{title}</h2>
        <div className="confirm-body" id="term-locked-body">{children}</div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" onClick={onHere}>Unlock and run here</button>
          <button type="button" ref={safe} className="btn primary" onClick={onNew}>Run in a new terminal</button>
        </div>
      </div>
    </>
  );
}

const NO_ACTIONS: TermAction[] = [];

// ready: the page knows which project you're in (so the first terminal starts in the right folder).
// actions: your quick actions (Settings → Terminal), shown as chips in the header. onSetUp: open that page.
export const TerminalPanel = memo(function TerminalPanel({ project, onHide, ready = true, actions = NO_ACTIONS, onSetUp }: {
  project?: string; onHide: () => void; ready?: boolean; actions?: TermAction[]; onSetUp?: () => void;
}) {
  const [tabs, setTabs] = useState<TerminalInfo[] | null>(null); // null: still asking the camp what's open
  const [active, setActive] = useState<string | null>(() => storeGet("camp-term-tab"));
  const [error, setError] = useState("");
  const choose = useCallback((id: string | null) => { setActive(id); if (id) storeSet("camp-term-tab", id); }, []);

  const open = useCallback(async () => {
    setError("");
    try {
      const t = await api<TerminalInfo>("/api/term/open", { project, cols: 100, rows: 24 });
      setTabs((list) => [...(list ?? []), t]);
      choose(t.id);
    } catch (e) { setError(errorText(e)); }
  }, [project, choose]);

  // Pick up the sessions the camp already has; start one if there are none.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !ready) return;
    started.current = true;
    api<{ terminals: TerminalInfo[] }>("/api/term").then((r) => {
      setTabs(r.terminals);
      if (!r.terminals.length) void open();
      else setActive((a) => (a && r.terminals.some((t) => t.id === a) ? a : r.terminals[r.terminals.length - 1].id));
    }, (e) => { setTabs([]); setError(errorText(e)); });
  }, [open, ready]);

  async function close(id: string) {
    try { await api("/api/term/close", { id }); } catch { /* already gone */ }
    setTabs((list) => {
      const next = (list ?? []).filter((t) => t.id !== id);
      if (active === id) choose(next.at(-1)?.id ?? null);
      return next;
    });
  }

  const shown = tabs?.find((t) => t.id === active) ?? tabs?.at(-1);
  const pane = useRef<HTMLElement>(null);
  const toKeys = () => setTimeout(() => pane.current?.querySelector<HTMLElement>(".term-view textarea")?.focus(), 0);
  // The tab a "new terminal" action opened, while its shell is still alive: its chip leads back
  // there, so a dev server isn't started twice by a second click. Clicked while you're already
  // looking at that tab, it runs again there (you can see what's going on in it).
  const liveTab = (a: TermAction) => (a.where === "new" ? tabs?.find((t) => t.action === a.label && t.exited === null) : undefined);
  // A quick action that was stopped by a lock, waiting for your answer.
  const [stopped, setStopped] = useState<{ action: TermAction; tab: TerminalInfo } | null>(null);
  const noAnswer = useCallback(() => setStopped(null), []);

  // Lock a terminal so quick actions leave it alone, or unlock it. The camp keeps it with the session.
  async function lock(id: string, on: boolean) {
    setTabs((list) => (list ?? []).map((t) => (t.id === id ? { ...t, locked: on || undefined } : t)));
    try { await api("/api/term/lock", { id, on }); } catch (e) { setError(errorText(e)); }
  }

  // how: "new" sends an "in this terminal" action to a fresh terminal instead; "here" goes ahead in a locked one.
  async function run(a: TermAction, how?: "new" | "here") {
    setError("");
    const going = liveTab(a);
    if (going && going.id !== shown?.id) { choose(going.id); return void toKeys(); }
    const here = how !== "new" && (a.where === "current" || !!going) && shown && shown.exited === null ? shown : undefined;
    // A locked terminal takes only the action that opened it. Anything else stops and asks.
    if (here?.locked && here.action !== a.label && how !== "here") return setStopped({ action: a, tab: here });
    try {
      // In this terminal, if there's one whose shell is alive; otherwise it gets a fresh one.
      if (here) await api("/api/term/input", { id: here.id, data: actionInput(a) });
      else {
        // A terminal a chip opens for itself (a dev server, say) starts locked: the other chips don't type into it.
        const made = a.where === "new" ? { folder: a.folder, sub: a.sub, title: a.label, action: a.label, locked: true } : {};
        const t = await api<TerminalInfo>("/api/term/open", { project, cols: 100, rows: 24, ...made, type: actionInput(a) });
        setTabs((list) => [...(list ?? []), t]);
        choose(t.id);
      }
      toKeys();
    } catch (e) { setError(errorText(e)); }
  }

  return (
    <section className="term" aria-label="Terminal" ref={pane}>
      <DrawerHead className="term-head" icon="terminal" label="Terminal" onHide={onHide}
        hideLabel="Hide the terminal" hideTitle="Hide the terminal (Ctrl+`). Your shells keep running.">
        <div className="term-tabs" role="tablist">
          {(tabs ?? []).map((t, i) => (
            <span key={t.id} className={cx("term-tab", shown?.id === t.id && "selected")}>
              <button type="button" role="tab" aria-selected={shown?.id === t.id} title={t.cwd} onClick={() => choose(t.id)}>{i + 1}: {t.title}{t.exited !== null ? " (ended)" : ""}</button>
              <button type="button" className={cx("term-lock", t.locked && "on")} aria-pressed={!!t.locked} aria-label={`${t.locked ? "Unlock" : "Lock"} terminal ${i + 1}`}
                title={t.locked ? "Locked: quick actions won't type into this terminal (you still can). Click to unlock." : "Lock this terminal, so quick actions can't type into it"}
                onClick={() => lock(t.id, !t.locked)}><Icon name={t.locked ? "lock" : "unlock"} /></button>
              <button type="button" className="att-x" aria-label={`Close terminal ${i + 1}`} title="Close this terminal (ends its shell)" onClick={() => close(t.id)}>×</button>
            </span>
          ))}
        </div>
        {(actions.length > 0 || onSetUp) && (
          <div className="term-actions" role="group" aria-label="Quick actions">
            {actions.map((a) => {
              const live = !!liveTab(a);
              return (
                <button key={a.label} type="button" className={cx("term-chip", live && "live")} title={actionTitle(a, live)} onClick={() => run(a)}>
                  {a.where === "new" && <Icon name={live ? "terminal" : "plus"} />}<span>{a.label}</span>
                </button>
              );
            })}
            {onSetUp && (
              <button type="button" className={actions.length ? "hist-icon" : "term-chip quiet"} aria-label="Set up quick actions"
                title="Quick actions: your own commands as chips here, to run in this terminal or a new one. Set them up in Settings." onClick={onSetUp}>
                <Icon name="gear" />{!actions.length && <span>Quick actions</span>}
              </button>
            )}
          </div>
        )}
        <button type="button" className="hist-icon" aria-label="New terminal" title="New terminal" onClick={open}>+</button>
      </DrawerHead>
      {error && <div className="form-error term-error" role="alert">{error}</div>}
      {stopped && (
        <LockedWarning title={`Terminal ${(tabs ?? []).findIndex((t) => t.id === stopped.tab.id) + 1} (${stopped.tab.title}) is locked`} onCancel={noAnswer}
          onNew={() => { const a = stopped.action; setStopped(null); void run(a, "new"); }}
          onHere={() => { const { action, tab } = stopped; setStopped(null); void lock(tab.id, false).then(() => run(action, "here")); }}>
          <p><b>{stopped.action.label}</b> wasn't run. You locked this terminal so quick actions don't type into it.</p>
          <pre className="term-would"><code>{actionLine(stopped.action)}</code></pre>
        </LockedWarning>
      )}
      {shown
        ? <TerminalView key={shown.id} id={shown.id} onExit={(code) => setTabs((list) => (list ?? []).map((t) => (t.id === shown.id ? { ...t, exited: code } : t)))} />
        : tabs && !error && <div className="term-empty">No terminal open. <button type="button" className="linkish" onClick={open}>Open one</button></div>}
    </section>
  );
});
