// Motion: the small pieces that let things ease in and out instead of popping.
//
// Most of it is CSS (see "Motion" in styles.css). What CSS can't do alone is play something out
// as it leaves, since React takes it off the page at once; and ease a box between two sizes that
// its contents decide. Those two live here. All of it stands down for anyone who has asked their
// system for less motion, and where the page can't tell (tests), nothing waits on an animation.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

export const LEAVE_MS = 160; // how long something takes to go; styles.css uses the same (--leave)

export function motionOK(): boolean {
  return typeof matchMedia === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Keeps what it holds on the page for a moment after it's gone, marked "leaving", so it can
// fade or slide away. Give it `condition && <Thing />`, as you'd write it without this.
export function Presence({ children, ms = LEAVE_MS }: { children: ReactNode; ms?: number }) {
  const shown = children !== null && children !== undefined && children !== false;
  const last = useRef<ReactNode>(null);
  if (shown) last.current = children;
  const [wasShown, setWasShown] = useState(shown);
  const [leaving, setLeaving] = useState(false);
  const cameFrom = useRef<HTMLElement | null>(null);
  let going = leaving;
  if (shown !== wasShown) { // it just appeared, or just went
    // Where the keyboard was when it appeared (the button that opened it, usually): it goes back there.
    if (shown && typeof document !== "undefined") cameFrom.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    going = !shown && motionOK();
    setWasShown(shown);
    setLeaving(going);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { last.current = null; setLeaving(false); }, ms);
    return () => clearTimeout(t);
  }, [leaving, ms]);
  // Once it's off the page, the keyboard returns to where it came from, unless you've already
  // put it somewhere else: closing a dialog shouldn't leave the next Tab starting from the top.
  const present = shown || going;
  useEffect(() => {
    if (!present) return;
    return () => {
      const back = cameFrom.current;
      cameFrom.current = null;
      const now = document.activeElement;
      if (back?.isConnected && (!now || now === document.body)) back.focus({ preventScroll: true });
    };
  }, [present]);
  if (!shown && !going) return null;
  // While it's on its way out it can't be clicked or focused.
  return <div className={going ? "presence leaving" : "presence"} inert={going || undefined}>{shown ? children : last.current}</div>;
}

const EASE = "cubic-bezier(.22, 1, .36, 1)";

// Make a change that moves things about, and have each thing that moved glide from where it was
// to where it is now. The page is laid out once, for the change itself; the gliding is done with
// transforms alone, which the browser can run without laying anything out again. (Easing a size
// instead would lay the page out on every frame, and a long conversation makes that stutter.)
//   moved: what might end up somewhere else.   within: clipped meanwhile, so nothing spills out.
//   fresh: what the change redraws in place, which fades up as the rest settles.
export function glide(change: () => void, moved: (HTMLElement | null)[], o: { within?: HTMLElement | null; fresh?: HTMLElement | null } = {}) {
  const els = moved.filter((el): el is HTMLElement => !!el && typeof el.animate === "function");
  if (!motionOK() || (!els.length && typeof o.fresh?.animate !== "function")) return change();
  const before = els.map((el) => el.getBoundingClientRect());
  flushSync(change);
  let any = false;
  els.forEach((el, i) => {
    const now = el.getBoundingClientRect();
    const dx = Math.round(before[i].left - now.left), dy = Math.round(before[i].top - now.top);
    if (!dx && !dy) return;
    any = true;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 240, easing: EASE });
  });
  o.fresh?.animate?.([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  const box = o.within;
  if (any && box) {
    const was = box.style.overflow;
    box.style.overflow = "hidden";
    setTimeout(() => { box.style.overflow = was; }, 260);
  }
}
