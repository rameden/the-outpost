// What sits at the foot of a conversation (work that's waiting, a line of status, the message
// box), floating over the thread instead of standing below it.
//
// It used to be a strip of its own under the thread, which cut the thread off at a hard edge: a
// long card stopped dead just above the message box, its side borders running into it. Now the
// thread runs to the bottom of the pane and scrolls underneath, and the box floats on top.
//
// For that the thread has to know how tall this is, so its last lines can still be scrolled
// clear of the box: the height is kept in --dock-h on the pane (the thread's bottom padding reads
// it, in styles.css), and kept current as the box grows (a long message, attachments).

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function Dock({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current, pane = el?.parentElement;
    if (!el || !pane) return;
    const measure = () => {
      // If you're reading the newest lines, you still are after the box changes height.
      const feed = pane.querySelector<HTMLElement>(".feed");
      const atEnd = !!feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
      pane.style.setProperty("--dock-h", `${el.offsetHeight}px`);
      if (feed && atEnd) feed.scrollTop = feed.scrollHeight;
    };
    measure();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    watch?.observe(el);
    return () => { watch?.disconnect(); pane.style.removeProperty("--dock-h"); };
  }, []);
  return <div className="dock" ref={box}>{children}</div>;
}
