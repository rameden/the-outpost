// The terminal pane along the bottom of the page: your own shell on this machine.
//
// Each tab is a session the camp server keeps (so hiding the pane, or reloading the page, doesn't
// end it); this component shows one of them through xterm.js. Output arrives over a stream from
// the camp, and what you type is sent back. New tabs start in the folder of the project you're
// in. Hide the pane with its ⌄ button or Ctrl+` and bring it back the same way. Its size is its
// zone's: drag the line beside it.

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, errorText, storeGet, storeSet, termStreamUrl } from "../api.ts";
import { cx } from "../format.ts";
import { Icon } from "./bits.tsx";
import type { TerminalInfo } from "../types.ts";

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

    term.focus();
    return () => {
      clearTimeout(settle); stream.close(); typed.dispose(); watching?.disconnect(); themed.disconnect(); scheme?.removeEventListener("change", onScheme);
      term.dispose();
    };
  }, [id]);

  return <div className="term-view" ref={box} />;
}

// The slim tab the terminal leaves behind while it's hidden; your shells keep running meanwhile.
export function TerminalRail({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" className="zone-rail" aria-label="Show terminal" title="Show the terminal (Ctrl+`). Your shells kept running." onClick={onShow}>
      <Icon name="terminal" /><span>Terminal</span>
    </button>
  );
}

// ready: the page knows which project you're in (so the first terminal starts in the right folder).
export function TerminalPanel({ project, onHide, ready = true }: { project?: string; onHide: () => void; ready?: boolean }) {
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
  return (
    <section className="term" aria-label="Terminal">
      <header className="term-head">
        <span className="term-label">Terminal</span>
        <div className="term-tabs" role="tablist">
          {(tabs ?? []).map((t, i) => (
            <span key={t.id} className={cx("term-tab", shown?.id === t.id && "selected")}>
              <button type="button" role="tab" aria-selected={shown?.id === t.id} title={t.cwd} onClick={() => choose(t.id)}>{i + 1}: {t.title}{t.exited !== null ? " (ended)" : ""}</button>
              <button type="button" className="att-x" aria-label={`Close terminal ${i + 1}`} title="Close this terminal (ends its shell)" onClick={() => close(t.id)}>×</button>
            </span>
          ))}
        </div>
        <button type="button" className="hist-icon" aria-label="New terminal" title="New terminal" onClick={open}>+</button>
        <button type="button" className="hist-icon" aria-label="Hide the terminal" title="Hide (Ctrl+`). Your shells keep running." onClick={onHide}>⌄</button>
      </header>
      {error && <div className="form-error term-error" role="alert">{error}</div>}
      {shown
        ? <TerminalView key={shown.id} id={shown.id} onExit={(code) => setTabs((list) => (list ?? []).map((t) => (t.id === shown.id ? { ...t, exited: code } : t)))} />
        : tabs && !error && <div className="term-empty">No terminal open. <button type="button" className="linkish" onClick={open}>Open one</button></div>}
    </section>
  );
}
