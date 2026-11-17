// The terminal's rail: the slim tab it leaves while hidden. Kept apart from Terminal.tsx so the
// page's main script can show it without xterm, which loads only when the terminal is opened.
import { useEffect, useState } from "react";
import { api, storeGet } from "../api.ts";
import { Icon } from "./bits.tsx";
import type { TerminalInfo } from "../types.ts";

// While the pane is hidden: the last line your last terminal printed, checked every couple of
// seconds (and when you come back to the page). Null when there's no terminal to show.
const PEEK_EVERY = 2000;
function useLastLine(): { line: string; ended: boolean } | null {
  const [peek, setPeek] = useState<{ line: string; ended: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const { terminals } = await api<{ terminals: TerminalInfo[] }>("/api/term");
        const chosen = storeGet("camp-term-tab");
        const t = terminals.find((x) => x.id === chosen) ?? terminals.at(-1);
        if (live) setPeek(t ? { line: t.last, ended: t.exited !== null } : null);
      } catch { /* the camp is restarting: keep what's shown */ }
    };
    void check();
    const timer = setInterval(check, PEEK_EVERY);
    const back = () => { void check(); };
    document.addEventListener("visibilitychange", back);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", back); };
  }, []);
  return peek;
}

// The slim tab the terminal leaves behind while it's hidden; your shells keep running meanwhile.
// Along the bottom (or top) it also shows the last line your last terminal printed.
export function TerminalRail({ onShow }: { onShow: () => void }) {
  const peek = useLastLine();
  const line = peek?.line ? (peek.ended ? `${peek.line} (ended)` : peek.line) : "";
  return (
    <button type="button" className="zone-rail" aria-label="Show terminal" onClick={onShow}
      title={`${line ? `Last line: ${line}\n\n` : ""}Show the terminal (Ctrl+\`). Your shells kept running.`}>
      <Icon name="terminal" /><span>Terminal</span>
      {line && <code className="rail-peek">{line}</code>}
    </button>
  );
}
