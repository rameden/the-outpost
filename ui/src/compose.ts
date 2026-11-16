// Writing a message: how what you type is styled as you type it, and the edits behind the
// formatting shortcuts. The text itself is never changed by the styling: every character you
// typed is still in the box, markers included, so what's sent is exactly what you wrote.
//
// Styled: `code`, fenced code blocks (``` on a line of its own), **bold**, *italic* and _italic_,
// ~~struck~~, # headings, > quotes, list markers, [links](url), bare links, and @mentions.
// Once a pair of markers takes effect it goes out of sight: `code` shows as code without its
// ticks, **bold** as bold without its stars, and a code block without its ``` lines (those show
// only while the cursor is on them). The markers of headings, quotes and links stay, dimmed.
// Everything here is plain text in, plain text (or HTML for the box) out.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dim = (s: string) => (s ? `<span class="mi-dim">${esc(s)}</span>` : "");
const hide = (s: string) => `<span class="mi-hide">${esc(s)}</span>`; // in the text, out of sight

// A code block opens on a line of three or more backticks (or tildes), with at most a language
// after them, and closes on a line of them alone. A line like ```npm test``` is not a block:
// it opens and closes on the one line, so it's inline code, as markdown has it.
const OPENS = /^\s*(`{3,}[^`]*|~{3,}.*)$/;
const CLOSES = /^\s*(`{3,}|~{3,})\s*$/;
// Each line's part in a code block: its opening line, its closing line, a line inside, or none.
type InBlock = "open" | "close" | "in" | null;
function blocks(lines: string[]): { parts: InBlock[]; open: boolean } {
  let open = false;
  const parts = lines.map((line): InBlock => {
    if (!open) { if (!OPENS.test(line)) return null; open = true; return "open"; }
    if (!CLOSES.test(line)) return "in";
    open = false;
    return "close";
  });
  return { parts, open };
}
// What can follow an opening ``` and be its language: one short word (ts, c++, shell-session).
const LANG = /^[\w+#.-]{1,24}$/;

// Text pasted in from a chat (Slack, Teams…) often writes a block with its ``` run on to the text:
// ```first line … last line```. Read as markdown, the first line would be taken for the block's
// language (and lost), and the block would never close. Put each ``` on a line of its own.
// A line that opens and closes on itself (```npm test```) is inline code, and stays as it is.
export function tidyPaste(text: string): string {
  if (!/`{3}|~{3}/.test(text)) return text;
  const out: string[] = [];
  let fence = "";
  for (const line of text.split("\n")) {
    if (!fence) {
      const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
      const rest = m?.[3] ?? "";
      if (!m || (m[2][0] === "`" && rest.includes("`"))) { out.push(line); continue; }
      fence = m[2];
      if (!rest.trim() || LANG.test(rest.trim())) { out.push(line); continue; }
      out.push(m[1] + fence);
      const end = rest.trimEnd();
      if (end.endsWith(fence) && end.length > fence.length) { out.push(m[1] + end.slice(0, -fence.length), m[1] + fence); fence = ""; }
      else out.push(m[1] + rest);
      continue;
    }
    const end = line.trimEnd();
    if (CLOSES.test(line)) { out.push(line); fence = ""; }
    else if (end.endsWith(fence) && end.trim().length > fence.length && !end.endsWith(fence + fence[0])) {
      out.push(end.slice(0, -fence.length), line.match(/^\s*/)![0] + fence);
      fence = "";
    } else out.push(line);
  }
  return out.join("\n");
}
const LIST = /^(\s*)([-*+]|\d{1,4}[.)])(\s+)/;
// One pass over a line, left to right; the first thing that matches at a spot wins.
const INLINE = new RegExp([
  "(`+)(?!`)([^\\n]+?)(?<!`)\\1(?!`)",                        // 1,2  `code`, or ``code with a ` in it``
  "\\*\\*(?=\\S)([^\\n]*?\\S)\\*\\*",                          // 3    **bold**
  "(?<![\\w*])\\*(?=[^\\s*])([^*\\n]*?[^\\s*])\\*(?![\\w*])",  // 4    *italic*
  "(?<!\\w)_(?=\\S)([^_\\n]*?\\S)_(?!\\w)",                    // 5    _italic_
  "~~(?=\\S)([^\\n]*?\\S)~~",                                  // 6    ~~struck~~
  "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)",                        // 7,8  [text](url)
  "(https?:\\/\\/[^\\s<>)]+)",                                 // 9    a bare link
  "(?<=^|\\s)(@\\w[\\w./-]*)",                                 // 10   @mention
].join("|"), "g");

function inline(s: string): string {
  let out = "", at = 0;
  for (const m of s.matchAll(INLINE)) {
    out += esc(s.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1]) out += `${hide(m[1])}<code class="mi-code">${esc(m[2])}</code>${hide(m[1])}`;
    else if (m[3] !== undefined) out += `${hide("**")}<b>${esc(m[3])}</b>${hide("**")}`;
    else if (m[4] !== undefined) out += `${hide("*")}<i>${esc(m[4])}</i>${hide("*")}`;
    else if (m[5] !== undefined) out += `${hide("_")}<i>${esc(m[5])}</i>${hide("_")}`;
    else if (m[6] !== undefined) out += `${hide("~~")}<s>${esc(m[6])}</s>${hide("~~")}`;
    else if (m[7] !== undefined) out += `${dim("[")}<span class="mi-link">${esc(m[7])}</span>${dim(`](${m[8]})`)}`;
    else if (m[9] !== undefined) out += `<span class="mi-link">${esc(m[9])}</span>`;
    else out += `<span class="mi-at">${esc(m[10])}</span>`;
  }
  return out + esc(s.slice(at));
}

// The message as HTML for the box: one block per line, each ending in its own line break, so
// the box's text is the message, character for character.
export function highlight(text: string): string {
  const lines = text.split("\n");
  const { parts, open: fenced } = blocks(lines);
  const drawn = lines.map((line, i): { cls: string; body: string; lang?: string } => {
    const part = parts[i];
    if (part === "in") {
      // The block's first line of code carries the language named on the opening line.
      // (Only a word that could be one: anything longer isn't a language, and wouldn't fit as a label.)
      const named = parts[i - 1] === "open" ? lines[i - 1].replace(/^\s*(`+|~+)\s*/, "").trim() : "";
      const lang = LANG.test(named) ? named : "";
      return { cls: "mi-pre", body: esc(line), ...(lang ? { lang } : {}) };
    }
    if (part) {
      // The ``` lines are kept out of sight (mi-fence) when there's code between them to show.
      // An opening line with more than a language after its ``` stays in sight, so none of it is hidden.
      const named = part === "open" ? line.replace(/^\s*(`+|~+)\s*/, "").trim() : "";
      const holds = part === "open" ? parts[i + 1] === "in" && (!named || LANG.test(named)) : parts[i - 1] === "in";
      return { cls: `mi-pre${holds ? " mi-fence" : ""}${part === "open" ? " mi-pre-top" : " mi-pre-end"}`, body: dim(line) };
    }
    const h = line.match(/^(#{1,6}\s+)(.*)$/);
    if (h) return { cls: "mi-h", body: dim(h[1]) + inline(h[2]) };
    const q = line.match(/^(>\s?)(.*)$/);
    if (q) return { cls: "mi-quote", body: dim(q[1]) + inline(q[2]) };
    const l = line.match(LIST);
    if (l) return { cls: "", body: `${esc(l[1])}<span class="mi-mark">${esc(l[2])}</span>${esc(l[3])}${inline(line.slice(l[0].length))}` };
    return { cls: "", body: inline(line) };
  });
  // A block that isn't closed yet runs to the end of the message.
  if (fenced) drawn[drawn.length - 1].cls += " mi-pre-end";
  return drawn.map((d, i) => {
    const last = i === drawn.length - 1;
    const lang = d.lang ? ` data-lang="${esc(d.lang).replace(/"/g, "&quot;")}"` : "";
    return `<span class="mi-line${d.cls ? ` ${d.cls}` : ""}"${lang}>${d.body}${last ? (lines[i] ? "" : "<br>") : "\n"}</span>`;
  }).join("");
}

// Whether a place in the message is inside a code block that's been opened and not yet closed.
export function insideFence(text: string, at: number): boolean {
  return blocks(text.slice(0, at).split("\n")).open;
}

// Enter inside a code block: a new line of code. On the opening line of a block that has no
// closing line yet, the closing line is added too, with the cursor on the empty line between:
// the block is whole from the start. If the block would end the message, an empty line is left
// below it as well, so there's somewhere to go on writing.
export function codeLine(text: string, start: number, end: number): Edit {
  const lineEnd = text.indexOf("\n", end);
  const atOpening = blocks(text.slice(0, start).split("\n")).parts.at(-1) === "open" && start === end && (lineEnd < 0 ? end === text.length : end === lineEnd);
  if (atOpening && blocks(text.split("\n")).open) {
    const fence = text.slice(text.lastIndexOf("\n", start - 1) + 1, start).match(/^\s*(`{3,}|~{3,})/)![0];
    return { text: `${text.slice(0, start)}\n\n${fence}${end === text.length ? "\n" : ""}${text.slice(end)}`, start: start + 1, end: start + 1 };
  }
  return { text: `${text.slice(0, start)}\n${text.slice(end)}`, start: start + 1, end: start + 1 };
}

// Where a place in the message falls: its line, where that line starts, and each line's part in a code block.
function place(text: string, at: number) {
  const lines = text.split("\n");
  let row = 0, from = 0;
  while (row < lines.length - 1 && from + lines[row].length < at) from += lines[row++].length + 1;
  return { lines, parts: blocks(lines).parts, row, from };
}
const joined = (lines: string[]) => lines.join("\n");

// Backspace with nothing selected. Mostly one character. But the ``` lines of a block are out
// of sight, so the two places where it would eat into one do something you can see instead:
//  - at the start of a block's first line of code, the block is unwrapped (its ``` lines go, the
//    code stays as text);
//  - at the start of the line just below a block, an empty line is removed, and anything else
//    is left alone, since it would be joined on to the closing ```.
// Returns nothing when there's nothing to do.
export function backspace(text: string, at: number): Edit | null {
  if (at <= 0) return null;
  const { lines, parts, row, from } = place(text, at);
  if (at === from && row > 0) {
    if (parts[row - 1] === "open" && parts[row] === "in") {
      const end = parts.indexOf("close", row);
      const kept = lines.filter((_, i) => i !== row - 1 && i !== end);
      const to = from - lines[row - 1].length - 1;
      return { text: joined(kept), start: to, end: to };
    }
    if (parts[row - 1] === "close" && lines[row] !== "") return null;
  }
  const n = charBefore(text, at);
  return { text: text.slice(0, at - n) + text.slice(at), start: at - n, end: at - n };
}
// The same going forward: Delete at the end of a line never pulls a ``` line up into it.
export function forwardDelete(text: string, at: number): Edit | null {
  if (at >= text.length) return null;
  const { lines, parts, row, from } = place(text, at);
  if (at === from + lines[row].length && (parts[row + 1] === "open" || parts[row + 1] === "close") && lines[row] !== "") return null;
  const n = charAfter(text, at);
  return { text: text.slice(0, at) + text.slice(at + n), start: at, end: at };
}

// The down arrow on a block's last line of code, when the block ends the message: there's no
// line below to go to, so one is made. Returns nothing anywhere else.
export function belowBlock(text: string, at: number): Edit | null {
  const { lines, parts, row } = place(text, at);
  if (parts[row] !== "in" || parts[row + 1] !== "close" || row + 1 !== lines.length - 1) return null;
  return { text: `${text}\n`, start: text.length + 1, end: text.length + 1 };
}

// An edit: the new text, and where the selection ends up.
export type Edit = { text: string; start: number; end: number };

// Wrap the selection in a marker (**bold**, `code`…), or take the marker off if it's there
// already. With nothing selected, the markers go in and the cursor sits between them.
export function wrap(text: string, start: number, end: number, open: string, close = open): Edit {
  const sel = text.slice(start, end);
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return { text: text.slice(0, start - open.length) + sel + text.slice(end + close.length), start: start - open.length, end: end - open.length };
  }
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  return { text: text.slice(0, start) + open + sel + close + text.slice(end), start: start + open.length, end: end + open.length };
}

// Turn the selection into a link, with the address selected and ready to type over.
export function link(text: string, start: number, end: number): Edit {
  const label = text.slice(start, end) || "text";
  const at = start + label.length + 3;
  return { text: `${text.slice(0, start)}[${label}](url)${text.slice(end)}`, start: at, end: at + 3 };
}

// A new line. In a list or a quote the next line carries on with it (numbers count up); on an
// item that's still empty, the marker comes off instead, which is how you leave the list.
export function newline(text: string, start: number, end: number): Edit {
  const plain = { text: `${text.slice(0, start)}\n${text.slice(end)}`, start: start + 1, end: start + 1 };
  if (insideFence(text, start)) return plain;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const line = text.slice(from, start);
  const m = line.match(LIST) ?? line.match(/^()(>)(\s?)/);
  if (!m) return plain;
  if (line.length === m[0].length && start === end) { // an empty item: end the list
    return { text: text.slice(0, from) + text.slice(start), start: from, end: from };
  }
  const n = m[2].match(/^(\d+)([.)])$/);
  const next = `\n${m[1]}${n ? `${Number(n[1]) + 1}${n[2]}` : m[2]}${m[3] || " "}`;
  return { text: text.slice(0, start) + next + text.slice(end), start: start + next.length, end: start + next.length };
}

// How long the character just before (or after) a place is: 2 for an emoji's pair, else 1.
export function charBefore(text: string, at: number): number {
  const c = text.charCodeAt(at - 1), p = text.charCodeAt(at - 2);
  return at >= 2 && c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff ? 2 : 1;
}
export function charAfter(text: string, at: number): number {
  const c = text.charCodeAt(at), n = text.charCodeAt(at + 1);
  return c >= 0xd800 && c <= 0xdbff && n >= 0xdc00 && n <= 0xdfff ? 2 : 1;
}
