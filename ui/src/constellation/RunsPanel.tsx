// The runs that used memory, down the map's left side, newest first. Pick one and the map shows
// only the lines it used; pick more and theirs join them. The rest of the map steps back (it isn't
// taken away) until you show it all again.
import { Icon } from "../components/bits.tsx";
import { cx, plural, when } from "../format.ts";
import type { GraphNode, GraphRun } from "../types.ts";

// A run is known by its conversation. One with none was a scheduled job, or its conversation has gone since.
export const runName = (r: GraphRun) => r.thread?.title || (r.thread ? "An untitled conversation" : "A run with no conversation");

export function RunsPanel({ runs, picked, byId, classOf, onToggle, onClear, onClose }: {
  runs: GraphRun[]; picked: ReadonlySet<string>;
  byId: ReadonlyMap<string, GraphNode>;
  classOf: (where: string) => string;   // the class that colours a place
  onToggle: (id: string) => void;       // pick a run, or let it go
  onClear: () => void;                  // back to the whole map
  onClose: () => void;
}) {
  return (
    <aside className="con-runs" aria-label="Runs that used memory">
      <header>
        <h3>Runs</h3>
        {picked.size > 0 && <button type="button" className="linkish" title="Back to the whole map (Esc)" onClick={onClear}>Show all</button>}
        <button type="button" className="con-tool" title="Hide the runs (R)" aria-label="Hide the runs" onClick={onClose}><Icon name="x" /></button>
      </header>
      {runs.length === 0 ? (
        <p className="con-runs-says">No run has used a line that's on the map yet. When one does it's listed here, and picking it shows only the lines it used.</p>
      ) : <>
        <p className="con-runs-says">{picked.size
          ? `Only the lines of ${picked.size === 1 ? "this run" : `these ${picked.size} runs`} are lit. Pick another to add its lines.`
          : "Pick a run to see only the lines it used. Pick more to add theirs."}</p>
        <ul className="con-runs-list">
          {runs.map((r) => {
            // One dot for each place its lines live in, in the place's own colour.
            const places = [...new Set(r.lines.flatMap((id) => { const n = byId.get(id); return n ? [n.where] : []; }))];
            return (
              <li key={r.id}>
                <button type="button" className="con-run" aria-pressed={picked.has(r.id)} onClick={() => onToggle(r.id)}>
                  <b>{runName(r)}</b>
                  <span>
                    <time dateTime={r.time}>{when(r.time)}</time> · {r.lines.length} {plural(r.lines.length, "line")}
                    <i className="con-dots" aria-hidden="true">{places.slice(0, 6).map((w) => <i key={w} className={cx("con-dot", classOf(w))} />)}</i>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </>}
    </aside>
  );
}
