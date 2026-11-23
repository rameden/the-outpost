// What an expedition's file tools changed: the list, a diff, and Undo.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { plural } from "../format.ts";
import type { CheckpointDiff, UndoResult } from "../types.ts";
import { ask } from "../components/Confirm.tsx";
import { complain } from "../components/StatusLine.tsx";

import { w } from "../words.ts";
const WORDS = { created: "created", modified: "changed", deleted: "deleted" };

function DiffLine({ line }: { line: string }) {
  const cls = line.startsWith("+++") || line.startsWith("---") ? "file" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
  return cls ? <span className={cls}>{line}</span> : <>{line + "\n"}</>;
}

export function Changes({ expId }: { expId: string }) {
  const [diff, setDiff] = useState<CheckpointDiff | null>(null);
  const [message, setMessage] = useState<string | null>("Loading…");
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    let gone = false;
    api<CheckpointDiff>(`/api/checkpoint?id=${encodeURIComponent(expId)}`).then(
      (d) => {
        if (gone) return;
        if (!d.files.length) return setMessage(d.undone ? "These changes were undone." : "Nothing is changed any more (the files match how they were before).");
        setDiff(d);
        setMessage(null);
      },
      (e) => { if (!gone) setMessage(errorText(e)); },
    );
    return () => { gone = true; };
  }, [expId]);

  async function undo() {
    if (!diff) return;
    const n = diff.files.length;
    if (!await ask({ title: `Put ${n} ${plural(n, "file")} back the way ${n === 1 ? "it was" : "they were"} before this ${w("expedition")}?`, action: "Put back", danger: true })) return;
    setUndoing(true);
    try {
      const r = await api<UndoResult>("/api/checkpoint/undo", { id: expId });
      setDiff(null);
      setMessage(`↩ Put back ${r.restored.length} ${plural(r.restored.length, "file")}.${r.skipped.length ? ` Couldn't restore: ${r.skipped.join(", ")}.` : ""}`);
    } catch (e) { setUndoing(false); complain(errorText(e)); }
  }

  if (message !== null || !diff) return <div className="exp-changes"><div className="meta">{message}</div></div>;
  return (
    <div className="exp-changes">
      <ul>{diff.files.map((f) => <li key={f.path}><span className="chg">{WORDS[f.change]}</span><code>{f.path}</code></li>)}</ul>
      <pre className="diff">{diff.diff.split("\n").map((l, i) => <DiffLine key={i} line={l} />)}</pre>
      <div className="card-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn small danger" disabled={undoing} onClick={undo}>Undo these changes</button>
        <span className="meta">Covers write_file and edit_file. Changes made by shell commands aren't tracked.</span>
      </div>
    </div>
  );
}
