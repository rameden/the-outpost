// A conversation's Status tab (beside Condensed and Detailed): what its runs cost and took, who did
// the work and on which models, the tools they used, and what fills its latest run's context.
// The figures come from the quest log and the saved transcripts (src/threadstats.ts).

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { kTok as kOnly, money, plural, shortModel, took, when } from "../format.ts";
import { w } from "../words.ts";
import type { ThreadStats, ContextPart } from "../types.ts";

const PART: Record<ContextPart["key"], { label: string; hint: string; color: string }> = {
  setup: { label: "Set-up", hint: "The system prompt, standing notes, memory, skills and tool definitions (estimated)", color: "var(--faint)" },
  request: { label: "Request", hint: "What you asked, with what came attached", color: "var(--accent)" },
  you: { label: "You, mid-run", hint: "What you said while it was working", color: "var(--accent-deep, var(--accent))" },
  replies: { label: "Its words", hint: "What it wrote and thought", color: "var(--good)" },
  calls: { label: "Tool calls", hint: "What it asked its tools to do", color: "var(--info)" },
  results: { label: "Tool results", hint: "What its tools sent back", color: "var(--bad)" },
};

const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : kOnly(n));
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

export function ThreadStatus({ thread, version }: { thread: string; version: string }) {
  const [stats, setStats] = useState<ThreadStats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<ThreadStats>(`/api/conversation/stats?id=${encodeURIComponent(thread)}`)
      .then((s) => { if (live) { setStats(s); setError(""); } })
      .catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [thread, version]);

  if (error) return <div className="feed thread-status"><p className="meta">Couldn't read this conversation's figures: {error}</p></div>;
  if (!stats) return <div className="feed thread-status"><p className="meta">Reading the figures…</p></div>;
  const { total, context } = stats;
  const inTok = total.usage.input + total.usage.cacheRead + total.usage.cacheWrite;
  const est = total.estimated ? " est." : "";
  const spend = stats.crew.reduce((s, c) => s + c.cost, 0);

  return (
    <div className="feed thread-status">
      <section className="ts-card">
        <div className="ts-tiles">
          <div><b>{money(total.cost)}{est}</b><span>Cost</span></div>
          <div><b>{took(total.seconds)}</b><span>Working time</span></div>
          <div><b>{total.runs}</b><span>{plural(total.runs, "run")} · {total.quests} {plural(total.quests, w("quest"), w("quests"))}</span></div>
          <div><b>{total.turns}</b><span>Model calls</span></div>
          <div><b>{kTok(inTok)}</b><span>In · {pct(total.usage.cacheRead, inTok)}% cached</span></div>
          <div><b>{kTok(total.usage.output)}</b><span>Out</span></div>
        </div>
        {total.estimated && <p className="meta">On your Claude subscription these are estimates at API prices, not charges.</p>}
      </section>

      {context && (
        <section className="ts-card">
          <h3>Context of the latest run</h3>
          <p className="meta">About {kTok(context.tokens)} tokens at its end, over {context.messages} {plural(context.messages, "message")}. An average call read {kTok(context.perCall)} in.</p>
          <div className="ts-bar" role="img" aria-label={context.parts.filter((p) => p.tokens).map((p) => `${PART[p.key].label} ${pct(p.tokens, context.tokens)}%`).join(", ")}>
            {context.parts.filter((p) => p.tokens).map((p) => (
              <span key={p.key} title={`${PART[p.key].label}: ${kTok(p.tokens)}`} style={{ flexGrow: p.tokens, background: PART[p.key].color }} />
            ))}
          </div>
          <ul className="ts-legend">
            {context.parts.filter((p) => p.tokens).map((p) => (
              <li key={p.key} title={PART[p.key].hint}><i style={{ background: PART[p.key].color }} />{PART[p.key].label}<b>{kTok(p.tokens)}</b><span>{pct(p.tokens, context.tokens)}%</span></li>
            ))}
          </ul>
          {context.heaviest.length > 0 && (
            <p className="meta">Biggest tool results: {context.heaviest.map((h) => `${h.name} ${kTok(h.tokens)}`).join(" · ")}</p>
          )}
          <p className="meta ts-note">The set-up isn't saved with the transcript, so its size is worked out from what each call was billed for: a rough figure.</p>
        </section>
      )}

      <section className="ts-card ts-split">
        <div>
          <h3>Who did the work</h3>
          <table className="ts-table"><tbody>
            {stats.crew.map((c) => (
              <tr key={c.name}><td>{c.name}</td><td>{c.runs} {plural(c.runs, "run")}</td><td>{kTok(c.tokens)}</td><td><b>{money(c.cost)}</b> <span className="meta">{pct(c.cost, spend)}%</span></td></tr>
            ))}
          </tbody></table>
        </div>
        <div>
          <h3>Models</h3>
          <table className="ts-table"><tbody>
            {stats.models.map((m) => (
              <tr key={m.name}><td>{shortModel(m.name)}</td><td>{m.runs} {plural(m.runs, "run")}</td><td>{kTok(m.tokens)}</td><td><b>{money(m.cost)}</b></td></tr>
            ))}
          </tbody></table>
        </div>
      </section>

      {stats.tools.length > 0 && (
        <section className="ts-card">
          <h3>Tools used</h3>
          <div className="tool-chips">{stats.tools.map((t) => <code key={t.name}>{t.name} × {t.calls}</code>)}</div>
        </section>
      )}

      <section className="ts-card">
        <h3>Runs</h3>
        <table className="ts-table ts-runs"><tbody>
          {stats.runs.map((r) => (
            <tr key={r.id}>
              <td><time>{when(r.time)}</time></td>
              <td className="ts-task" title={r.task}><span>{r.task}</span></td>
              <td>{r.by}{r.quests ? ` + ${r.quests}` : ""}</td>
              <td>{took(r.seconds)}</td>
              <td>{kTok(r.usage.input + r.usage.cacheRead + r.usage.cacheWrite)} in</td>
              <td><b>{money(r.cost)}</b></td>
            </tr>
          ))}
        </tbody></table>
      </section>
    </div>
  );
}
