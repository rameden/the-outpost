// A unified diff laid out side by side: what was on the left, what is on the right, line against
// line. A run of removed lines is paired with the run of added lines that replaced it.

export type Cell = { n: number; text: string } | null;
export type DiffRow = { kind: "same" | "changed" | "hunk"; left: Cell; right: Cell; label?: string };

export function sideBySide(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let a = 0, b = 0, started = false;
  let gone: Cell[] = [], came: Cell[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(gone.length, came.length); i++) rows.push({ kind: "changed", left: gone[i] ?? null, right: came[i] ?? null });
    gone = []; came = [];
  };
  for (const line of diff.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      flush();
      if (started) rows.push({ kind: "hunk", left: null, right: null, label: hunk[3].trim() });
      a = Number(hunk[1]); b = Number(hunk[2]); started = true;
      continue;
    }
    if (!started || line.startsWith("\\")) continue; // the file header, or "\ No newline at end of file"
    if (line.startsWith("-")) gone.push({ n: a++, text: line.slice(1) });
    else if (line.startsWith("+")) came.push({ n: b++, text: line.slice(1) });
    else { flush(); rows.push({ kind: "same", left: { n: a++, text: line.slice(1) }, right: { n: b++, text: line.slice(1) } }); }
  }
  flush();
  // A diff's last line is followed by a newline, which reads here as one empty unchanged line: drop it.
  const last = rows[rows.length - 1];
  if (last?.kind === "same" && last.left?.text === "" && diff.endsWith("\n")) rows.pop();
  return rows;
}
