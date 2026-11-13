// A small, safe Markdown renderer. It builds React elements (never raw HTML), so whatever an
// agent, a web page, or a file puts in its text can only ever show up as text, a few kinds of
// formatting, and http(s) links.

import { Fragment, memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { say } from "./bus.ts";
import { Findings, parseFindings } from "./feed/Findings.tsx";

type Part = string | { node: ReactNode };
type Stage = { re: RegExp; render: (m: RegExpExecArray, next: (text: string) => ReactNode[]) => Part[] };

const link = (href: string, children: ReactNode): Part => ({ node: <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> });

// A code span that's a file path (src/app.ts, links/site/README.md, lib/a.ts:42) opens that
// file in the viewer when clicked: the page looks for it in the folders attached where you are.
const PATH = /^(?:\.{0,2}\/)?(?:[\w.@()[\]~+-]+\/)+[\w.@()[\]~+-]*\.[A-Za-z][A-Za-z0-9]{0,9}(?::(\d+)(?::\d+)?)?$/;
export function pathIn(code: string): { path: string; line?: number } | null {
  const m = code.match(PATH);
  if (!m || code.length > 300 || /^https?:/.test(code)) return null;
  return { path: code.replace(/:\d+(?::\d+)?$/, ""), ...(m[1] ? { line: Number(m[1]) } : {}) };
}
function codeSpan(code: string): ReactNode {
  const file = pathIn(code);
  if (!file) return <code>{code}</code>;
  const open = () => say({ do: "open-file", ...file });
  return (
    <code className="path-link" role="link" tabIndex={0} title="Open this file" onClick={open}
      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } }}>{code}</code>
  );
}

// Code spans are lifted out first, so nothing inside them is formatted, and put back at the end:
// that way bold or a link can wrap a code span (**`name`**) instead of stopping at its edge.
// Then, in order: bold, italics, links.
const HELD = /(\d+)/g;
const STAGES: Stage[] = [
  { re: /\*\*([^*]+)\*\*/g, render: (m, next) => [{ node: <strong>{next(m[1])}</strong> }] },
  { re: /(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, render: (m, next) => [m[1], { node: <em>{next(m[2])}</em> }] },
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, render: (m, next) => [link(m[2], next(m[1]))] },
  { re: /(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, render: (m) => [m[1], link(m[2], m[2])] },
];

function inline(text: string): ReactNode[] {
  const codes: string[] = [];
  const held = text.replace(/[]/g, "").replace(/`([^`]+)`/g, (_, code: string) => `${codes.push(code) - 1}`);
  const raw = (s: string) => s.replace(HELD, (_, n) => "`" + codes[Number(n)] + "`"); // a link's address is never formatted
  const run = (piece: string, from: number): ReactNode[] => {
    let parts: Part[] = [piece];
    for (let i = from; i < STAGES.length; i++) {
      const { re, render } = STAGES[i];
      const isLink = i >= 2;
      const out: Part[] = [];
      for (const part of parts) {
        if (typeof part !== "string") { out.push(part); continue; }
        let last = 0;
        for (const m of part.matchAll(re)) {
          if (m.index > last) out.push(part.slice(last, m.index));
          if (isLink) m[2] = raw(m[2]);
          out.push(...render(m, (inner) => run(inner, i + 1)));
          last = m.index + m[0].length;
        }
        if (last < part.length) out.push(part.slice(last));
      }
      parts = out;
    }
    // Put the code spans back where they were lifted from.
    const done: Part[] = [];
    for (const part of parts) {
      if (typeof part !== "string") { done.push(part); continue; }
      let last = 0;
      for (const m of part.matchAll(HELD)) {
        if (m.index > last) done.push(part.slice(last, m.index));
        done.push({ node: codeSpan(codes[Number(m[1])]) });
        last = m.index + m[0].length;
      }
      if (last < part.length) done.push(part.slice(last));
    }
    return done.filter((p) => p !== "").map((p, i) => (typeof p === "string" ? p : <Fragment key={i}>{p.node}</Fragment>));
  };
  return run(held, 0);
}

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*(\d+)[.)]\s+/;
const QUOTE = /^>\s?/;
const FENCE = /^\s*```/; // set in or not: under a list item it usually is
const ROW = /^\s*\|.*\|\s*$/;
const DIVIDER = /^\s*\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|\s*$/; // |---|:-:|--:|
const STARTS_BLOCK = /^(#{1,4}\s|\s*```|\s*[-*]\s+|\s*\d+[.)]\s+|>)/;
const indentOf = (line: string) => line.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;
const blank = (line: string) => !line.trim();

// A list, from its first line: its items, and under each whatever is set in beneath it (a list
// inside the list, a code block, more paragraphs). A blank line between two items doesn't end the
// list, and a numbered list starts at the number it was written with, so a list that's
// interrupted (by bullets at the margin, say) carries on counting instead of starting at 1 again.
function listAt(lines: string[], from: number, key: number): { node: ReactNode; next: number } {
  let i = from;
  const ordered = NUMBERED.test(lines[i]);
  const marker = ordered ? NUMBERED : BULLET;
  const at = indentOf(lines[i]);
  const start = ordered ? Number(lines[i].match(NUMBERED)![1]) : 1;
  const mine = (line: string | undefined) => line !== undefined && marker.test(line) && indentOf(line) === at;
  const items: ReactNode[] = [];
  while (mine(lines[i])) {
    let text = lines[i++].replace(marker, "");
    const under: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) {
        let j = i;
        while (j < lines.length && blank(lines[j])) j++;
        if (j >= lines.length || indentOf(lines[j]) <= at) break; // what follows isn't under this item
        while (i < j) { under.push(""); i++; }
        continue;
      }
      if (indentOf(line) <= at) break;
      under.push(line); i++;
      if (FENCE.test(line)) { // a code block under the item: all of it, however its own lines are set in
        while (i < lines.length && !FENCE.test(lines[i])) under.push(lines[i++]);
        if (i < lines.length) under.push(lines[i++]);
      }
    }
    const depth = Math.min(...under.filter((l) => !blank(l) && indentOf(l) > at).map(indentOf));
    const body = Number.isFinite(depth) ? under.map((l) => l.replace(new RegExp(`^[ \\t]{0,${depth}}`), "")) : under;
    // Lines that carry on the item's own sentence join it; the rest are blocks of their own.
    let k = 0;
    while (k < body.length && !blank(body[k]) && !STARTS_BLOCK.test(body[k]) && !ROW.test(body[k])) text += ` ${body[k++].trim()}`;
    const rest = body.slice(k);
    const below = rest.some((l) => !blank(l)) ? blocks(rest) : null;
    // A checklist item ("- [ ] …", "- [x] …"): its box, ticked or not. It's a record, so it can't be clicked.
    const box = text.match(/^\[([ xX])\]\s+(.*)$/);
    items.push(box
      ? <li key={items.length} className="md-task"><input type="checkbox" checked={box[1] !== " "} readOnly disabled aria-label={box[1] !== " " ? "Done" : "Not done"} /> {inline(box[2])}{below}</li>
      : <li key={items.length}>{inline(text)}{below}</li>);
    let j = i;
    while (j < lines.length && blank(lines[j])) j++;
    if (j > i && mine(lines[j])) i = j;
  }
  return { node: ordered ? <ol key={key} start={start !== 1 ? start : undefined}>{items}</ol> : <ul key={key}>{items}</ul>, next: i };
}

export function renderMarkdown(src: string): ReactNode[] {
  return blocks(String(src ?? "").split("\n"));
}

function blocks(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = out.length;
    if (FENCE.test(line)) {
      const code: string[] = [];
      const lang = line.replace(FENCE, "").trim().toLowerCase();
      const setIn = new RegExp(`^[ \\t]{0,${indentOf(line)}}`);
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++].replace(setIn, ""));
      i++;
      // A review's findings come as a block of their own, shown as a list you can act on.
      const found = lang === "findings" ? parseFindings(code.join("\n")) : null;
      out.push(found ? <Findings key={key} list={found} /> : <pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = `h${h[1].length}` as "h1" | "h2" | "h3" | "h4";
      out.push(<Tag key={key}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push(<hr key={key} />); i++; continue; }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const list = listAt(lines, i, key);
      out.push(list.node);
      i = list.next;
      continue;
    }
    // A table: a row of cells, a row of dashes under it, then the rest.
    if (ROW.test(line) && i + 1 < lines.length && DIVIDER.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : undefined));
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && ROW.test(lines[i])) body.push(cells(lines[i++]));
      out.push(
        <div key={key} className="md-table"><table>
          <thead><tr>{head.map((c, n) => <th key={n} style={aligns[n] ? { textAlign: aligns[n] } : undefined}>{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, m) => <tr key={m}>{head.map((_, n) => <td key={n} style={aligns[n] ? { textAlign: aligns[n] } : undefined}>{inline(r[n] ?? "")}</td>)}</tr>)}</tbody>
        </table></div>);
      continue;
    }
    if (QUOTE.test(line)) {
      const q: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) q.push(lines[i++].replace(QUOTE, ""));
      out.push(<blockquote key={key}>{inline(q.join(" "))}</blockquote>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: ReactNode[] = [];
    while (i < lines.length && lines[i].trim() && !STARTS_BLOCK.test(lines[i]) && !(ROW.test(lines[i]) && i + 1 < lines.length && DIVIDER.test(lines[i + 1]))) {
      if (para.length) para.push(<br key={`br${i}`} />);
      para.push(<Fragment key={i}>{inline(lines[i])}</Fragment>);
      i++;
    }
    if (!para.length) para.push(lines[i++]); // never stall on a line nothing above claimed
    out.push(<p key={key}>{para}</p>);
  }
  return out;
}

export const Markdown = memo(function Markdown({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  const body = useMemo(() => renderMarkdown(text), [text]);
  return <div className={className ? `md ${className}` : "md"} style={style}>{body}</div>;
});
