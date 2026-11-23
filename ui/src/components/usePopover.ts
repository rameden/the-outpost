// A menu or small panel that opens under a button: shut by a click anywhere else, or Escape.

import { useEffect, useRef, useState, type RefObject } from "react";

// For a panel whose open state lives elsewhere: while `open`, a click outside `box` (or on
// something matching `ignore`, like the button that opens it) or Escape calls `dismiss`.
export function useDismiss(open: boolean, dismiss: () => void, box: RefObject<HTMLElement | null>, ignore?: string) {
  const last = useRef(dismiss);
  last.current = dismiss;
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => {
      const t = ev.target as Element;
      if (!box.current?.contains(t) && !(ignore && t.closest?.(ignore))) last.current();
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") last.current(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open, box, ignore]);
}

// The usual case: it holds its own open state. Put `box` on the element around the button and the panel.
export function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useDismiss(open, () => setOpen(false), box);
  return { open, setOpen, box };
}
