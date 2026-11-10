// A small, safe Markdown renderer. It builds React elements (never raw HTML), so whatever an
// agent, a web page, or a file puts in its text can only ever show up as text, a few kinds of
// formatting, and http(s) links.

import { Fragment, memo, useMemo, type CSSProperties, type ReactNode } from "react";

type Part = string | { node: ReactNode };
type Stage = { re: RegExp; render: (m: RegExpExecArray, next: (text: string) => ReactNode[]) => Part[] };

const link = (href: string, children: ReactNode): Part => ({ node: <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> });

// In order: code spans first (nothing inside them is formatted), then bold, italics, links.
const STAGES: Stage[] = [
  { re: /`([^`]+)`/g, render: (m) => [{ node: <code>{m[1]}</code> }] },
  { re: /\*\*([^*]+)\*\*/g, render: (m, next) => [{ node: <strong>{next(m[1])}</strong> }] },
  { re: /(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, render: (m, next) => [m[1], { node: <em>{next(m[2])}</em> }] },
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, render: (m) => [link(m[2], m[1])] },
  { re: /(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, render: (m) => [m[1], link(m[2], m[2])] },
];

function inline(text: string, from = 0): ReactNode[] {
  let parts: Part[] = [text];
  for (let i = from; i < STAGES.length; i++) {
    const { re, render } = STAGES[i];
    const out: Part[] = [];
    for (const part of parts) {
      if (typeof part !== "string") { out.push(part); continue; }
      let last = 0;
      for (const m of part.matchAll(re)) {
        if (m.index > last) out.push(part.slice(last, m.index));
        out.push(...render(m, (inner) => inline(inner, i + 1)));
        last = m.index + m[0].length;
      }
      if (last < part.length) out.push(part.slice(last));
    }
    parts = out;
  }
  return parts.filter((p) => p !== "").map((p, i) => (typeof p === "string" ? p : <Fragment key={i}>{p.node}</Fragment>));
}

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const QUOTE = /^>\s?/;
const FENCE = /^```/;

export function renderMarkdown(src: string): ReactNode[] {
  const lines = String(src ?? "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = out.length;
    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
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
      const ordered = NUMBERED.test(line);
      const marker = ordered ? NUMBERED : BULLET;
      const items: ReactNode[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""))}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
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
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|>)/.test(lines[i])) {
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
