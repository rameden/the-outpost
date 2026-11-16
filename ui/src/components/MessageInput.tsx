// The message box: plain text you type, drawn with its markdown styled as you go (compose.ts).
//
// It stands in for a <textarea>, and answers to the same few things (value, selectionStart,
// setSelectionRange, focus), but it's an editable <div>, because a textarea can't style part of
// its text. To keep that honest, the box never edits itself: every keystroke, deletion, paste
// and drop is turned into an edit of the text, the text goes up to whoever owns it, and the box
// is drawn again from the text with the cursor put back. The one exception is an input method
// composing a character (Japanese, accents on a phone…): that's left alone until it's done.
//
// Shortcuts: ⌘/Ctrl+B bold, +I italic, +E code, +Shift+X strike, +K link, +Z / Shift+Z undo
// and redo. Shift+Enter is a new line, and carries a list or quote on; Tab indents in a code block.
// Backspace at the very start of a block's code unwraps the block.
// (Enter itself belongs to whoever owns the box: see enterInCode.)

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type Ref } from "react";
import { backspace, belowBlock, codeLine, forwardDelete, highlight, insideFence, link, newline, tidyPaste, wrap, type Edit } from "../compose.ts";

export type MessageInputHandle = {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly el: HTMLElement | null;
  setSelectionRange: (start: number, end: number) => void;
  focus: () => void;
  insert: (text: string) => void;  // at the cursor, replacing what's selected
  inCode: () => boolean;           // the cursor is inside a code block
  // Enter, when the cursor is inside a code block: a new line of code (and the block's closing
  // line, if it has none yet). Says whether it was: false means Enter is still yours to handle.
  enterInCode: () => boolean;
};

type Range2 = [number, number];
type Snap = { text: string; sel: Range2 };

// Where a spot in the box is, counted in characters from the start of the message.
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}
function readSelection(root: HTMLElement): Range2 | null {
  const s = getSelection();
  if (!s || !s.rangeCount || !s.anchorNode || !s.focusNode || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
  const a = offsetOf(root, s.anchorNode, s.anchorOffset), b = offsetOf(root, s.focusNode, s.focusOffset);
  return [Math.min(a, b), Math.max(a, b)];
}
// Markers that have taken effect are in the box's text but out of sight (compose.ts): the ticks
// round code, the stars round bold, and so on.
const marker = (node: Node) => node.parentElement?.closest<HTMLElement>(".mi-hide") ?? null;
const beside = (el: HTMLElement, after: boolean): [Node, number] => [el.parentNode!, [...el.parentNode!.childNodes].indexOf(el) + (after ? 1 : 0)];

// And back: the spot in the box for a character count. The cursor is never put at the edge of
// a marker that's out of sight, where it couldn't be seen either: it goes just outside it.
function pointAt(root: HTMLElement, at: number): [Node, number] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = at, last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length, hid = marker(node);
    if (left === 0 && hid) return beside(hid, false);
    if (left < len || (left === len && !hid && !node.data.endsWith("\n"))) return [node, left];
    left -= len; // just past a line's break means the start of the next line; just past a marker, what follows it
    last = node;
  }
  const lastLine = root.lastElementChild;
  if (lastLine && !lastLine.textContent) return [lastLine, 0]; // an empty last line
  if (!last) return [root, 0];
  const hid = marker(last);
  return hid ? beside(hid, true) : [last, last.data.length];
}
// Show a block's ``` line while the cursor is on it (and only then), so what you type there can be seen.
function mark(root: HTMLElement) {
  const s = getSelection(), n = s?.focusNode;
  const line = n && root.contains(n) ? (n.nodeType === 1 ? n as Element : n.parentElement)?.closest(".mi-line") ?? null : null;
  root.querySelectorAll(".mi-fence").forEach((l) => l.classList.toggle("on", l === line));
}
function select(root: HTMLElement, [a, b]: Range2) {
  const s = getSelection();
  if (!s) return;
  const [n1, o1] = pointAt(root, a), [n2, o2] = a === b ? [n1, o1] : pointAt(root, b);
  s.setBaseAndExtent(n1, o1, n2, o2);
  mark(root);
}

// The box's text as it stands, for the times the browser wrote into it itself. Each block is a
// line; a line's own break (or the <br> holding an empty one open) isn't part of its text.
function readText(root: HTMLElement): string {
  const lines: string[] = [];
  for (const child of root.childNodes) {
    let t = "";
    const walk = (n: Node) => { if (n.nodeType === 3) t += (n as Text).data; else if (n.nodeName === "BR") t += "\n"; else n.childNodes.forEach(walk); };
    walk(child);
    lines.push(t.replace(/\r/g, "").replace(/\n$/, ""));
  }
  return lines.join("\n");
}

// "plaintext-only" where the browser has it (nothing pasted or dragged in can bring formatting).
const editable = (() => {
  if (typeof document === "undefined") return "true" as const;
  const probe = document.createElement("div");
  try { probe.contentEditable = "plaintext-only"; } catch { return "true" as const; }
  return probe.contentEditable === "plaintext-only" ? "plaintext-only" as const : "true" as const;
})();
const onMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export function MessageInput({ value, onChange, onKeyDown, onPaste, onClick, placeholder, label, ref }: {
  value: string; onChange: (text: string) => void; ref?: Ref<MessageInputHandle>;
  onKeyDown?: (ev: KeyboardEvent<HTMLElement>) => void; onPaste?: (ev: ClipboardEvent<HTMLElement>) => void; onClick?: () => void;
  placeholder?: string; label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drawn = useRef<string | null>(null);      // the text the box shows
  const next = useRef<Snap | null>(null);         // an edit on its way: the text sent up, and where the cursor goes
  const composing = useRef(false);
  const now = useRef({ value, onChange });
  now.current = { value, onChange };
  const past = useRef<{ list: Snap[]; at: number; stamp: number }>({ list: [{ text: value, sel: [value.length, value.length] }], at: 0, stamp: 0 });

  const text = () => next.current?.text ?? now.current.value;
  const selection = (): Range2 => next.current?.sel ?? (root.current && readSelection(root.current)) ?? [text().length, text().length];

  // Make an edit: remember it (for undo), send the text up, and put the cursor where it belongs
  // once the box has been drawn again. typing: a run of single characters undoes as one.
  function apply(e: Edit, typing = false) {
    const h = past.current, stamp = Date.now();
    const sel: Range2 = [e.start, e.end];
    if (e.text !== h.list[h.at].text) {
      if (typing && h.at === h.list.length - 1 && h.at > 0 && stamp - h.stamp < 700) h.list[h.at] = { text: e.text, sel };
      else { h.list.splice(h.at + 1, Infinity, { text: e.text, sel }); h.at = h.list.length - 1; if (h.list.length > 200) { h.list.shift(); h.at--; } }
      h.stamp = typing ? stamp : 0;
    }
    move(e.text, sel);
  }
  // The box is drawn for the new text right away, not when React next gets round to it: the
  // browser can send several edits in one go (dictation, a replacement), and each has to find
  // the box as the one before left it.
  function move(to: string, sel: Range2) {
    const el = root.current;
    if (el) {
      if (drawn.current !== to) { el.innerHTML = highlight(to); el.toggleAttribute("data-empty", !to); drawn.current = to; }
      select(el, sel);
    }
    if (to === now.current.value) { next.current = null; return; }
    next.current = { text: to, sel };
    now.current.onChange(to);
  }
  function step(by: -1 | 1) {
    const h = past.current, to = h.list[h.at + by];
    if (!to) return;
    h.at += by;
    h.stamp = 0;
    move(to.text, to.sel);
  }
  const insert = (data: string, typing = false) => {
    const [a, b] = selection(), t = text();
    apply({ text: t.slice(0, a) + data + t.slice(b), start: a + data.length, end: a + data.length }, typing);
  };

  // Text that didn't come from an edit here (the first draw, sent and cleared, an example picked):
  // draw the box for it. Like a textarea, the cursor stays where it was if you're in the box, and
  // otherwise waits at the end.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || composing.current) return;
    if (next.current?.text === value) next.current = null; // our own edit has arrived
    if (drawn.current === value) return;
    const focused = document.activeElement === el;
    const keep = focused ? readSelection(el) : null;
    const had = !!readSelection(el);
    el.innerHTML = highlight(value);
    el.toggleAttribute("data-empty", !value);
    drawn.current = value;
    next.current = null;
    const h = past.current; // it's a step you can undo, too
    if (h.list[h.at].text !== value) { h.list.splice(h.at + 1, Infinity, { text: value, sel: [value.length, value.length] }); h.at = h.list.length - 1; h.stamp = 0; }
    if (keep) select(el, [Math.min(keep[0], value.length), Math.min(keep[1], value.length)]);
    else if (had) select(el, [value.length, value.length]);
  });

  // What the browser is about to do to the box, done to the text instead.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const before = (ev: InputEvent) => {
      const t = ev.inputType;
      if (composing.current || ev.isComposing || t.includes("Composition")) return;
      ev.preventDefault();
      if (t === "historyUndo") return step(-1);
      if (t === "historyRedo") return step(1);
      const was = text(), cursor = selection();
      // One character either way, with nothing selected, is worked out from the text: the
      // browser's own idea of "the character before" skips markers that are out of sight.
      if (cursor[0] === cursor[1] && (t === "deleteContentBackward" || t === "deleteContentForward")) {
        const e = t === "deleteContentBackward" ? backspace(was, cursor[0]) : forwardDelete(was, cursor[0]);
        return e ? apply(e) : undefined;
      }
      const target = ev.getTargetRanges?.()[0];
      const [a, b] = target ? [offsetOf(el, target.startContainer, target.startOffset), offsetOf(el, target.endContainer, target.endOffset)] : cursor;
      if (t === "insertLineBreak" || t === "insertParagraph") return apply(newline(was, a, b));
      let data = "";
      if (t.startsWith("insert")) data = (ev.data ?? ev.dataTransfer?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
      else if (!t.startsWith("delete")) return; // formatting and the like: nothing a plain message takes
      if (t === "insertFromPaste" || t === "insertFromDrop") data = tidyPaste(data); // a chat's ```text``` blocks, made whole
      if (a === b && !data) return;
      apply({ text: was.slice(0, a) + data + was.slice(b), start: a + data.length, end: a + data.length }, t === "insertText" && data.length === 1 && data !== " ");
    };
    // Whatever got into the box some other way (a finished composition, mostly): read it back.
    const sync = () => {
      if (composing.current) return;
      const got = readText(el);
      if (got === text() && drawn.current === got) return;
      const at = readSelection(el) ?? [got.length, got.length];
      drawn.current = null; // the box is no longer as it was drawn
      if (got === now.current.value) { el.innerHTML = highlight(got); drawn.current = got; select(el, at); return; }
      apply({ text: got, start: at[0], end: at[1] });
    };
    const start = () => { composing.current = true; };
    const end = () => { composing.current = false; sync(); };
    const moved = () => { if (!composing.current) mark(el); }; // the cursor went somewhere: show or put away the ``` lines
    document.addEventListener("selectionchange", moved);
    el.addEventListener("beforeinput", before);
    el.addEventListener("input", sync);
    el.addEventListener("compositionstart", start);
    el.addEventListener("compositionend", end);
    return () => {
      document.removeEventListener("selectionchange", moved);
      el.removeEventListener("beforeinput", before);
      el.removeEventListener("input", sync);
      el.removeEventListener("compositionstart", start);
      el.removeEventListener("compositionend", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function keyDown(ev: KeyboardEvent<HTMLElement>) {
    const mod = onMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
    if (mod && !ev.altKey) {
      const k = ev.key.toLowerCase(), [a, b] = selection(), t = text();
      const edit = k === "z" ? () => step(ev.shiftKey ? 1 : -1) : k === "y" && !onMac ? () => step(1)
        : k === "b" && !ev.shiftKey ? () => apply(wrap(t, a, b, "**")) : k === "i" && !ev.shiftKey ? () => apply(wrap(t, a, b, "*"))
        : k === "e" && !ev.shiftKey ? () => apply(wrap(t, a, b, "`")) : k === "x" && ev.shiftKey ? () => apply(wrap(t, a, b, "~~"))
        : k === "k" && !ev.shiftKey ? () => apply(link(t, a, b)) : null;
      if (edit) { ev.preventDefault(); return edit(); }
    }
    onKeyDown?.(ev);
    if (ev.defaultPrevented) return;
    if (ev.shiftKey || mod || ev.altKey) return;
    const [a, b] = selection();
    if (ev.key === "Tab" && insideFence(text(), a)) { ev.preventDefault(); insert("  "); }
    // Down from the last line of a block that ends the message: make the line below it and go there.
    const below = ev.key === "ArrowDown" && a === b ? belowBlock(text(), a) : null;
    if (below) { ev.preventDefault(); apply(below); }
  }

  useImperativeHandle(ref, () => ({
    get value() { return text(); },
    get selectionStart() { return selection()[0]; },
    get selectionEnd() { return selection()[1]; },
    get el() { return root.current; },
    setSelectionRange: (a, b) => { if (next.current) next.current.sel = [a, b]; if (root.current) select(root.current, [a, b]); },
    focus: () => {
      const el = root.current;
      if (!el) return;
      const had = readSelection(el);
      el.focus();
      if (!had) select(el, [text().length, text().length]); // never been in the box: start at the end, not the top
    },
    insert: (data) => insert(data),
    inCode: () => insideFence(text(), selection()[0]),
    enterInCode: () => {
      const [a, b] = selection(), t = text();
      if (!insideFence(t, a)) return false;
      apply(codeLine(t, a, b));
      return true;
    },
  }));

  return (
    <div ref={root} className="mi" role="textbox" aria-multiline="true" aria-label={label} aria-placeholder={placeholder} data-placeholder={placeholder}
      contentEditable={editable} suppressContentEditableWarning spellCheck tabIndex={0}
      onKeyDown={keyDown} onPaste={onPaste} onClick={onClick} />
  );
}
