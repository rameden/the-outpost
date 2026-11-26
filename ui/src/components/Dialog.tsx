// The one modal dialog: a dimmed backdrop and a panel that owns what every dialog needs.
// Escape closes it (only the top one, when two are open), Tab and Shift-Tab stay inside it,
// focus goes in when it opens and back to whatever opened it when it closes, and clicking the
// backdrop closes it. The look stays with the caller's class names (".dialog" and friends).
//
// An overlay that draws its own box (Settings, Orbit, the maps, a question) gets the same
// behaviour from useModal, on its own element.

import { createElement, useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { cx } from "../format.ts";

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
const FIELDS = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

// Open overlays, bottom first: only the last one answers Escape and Tab.
const open: HTMLElement[] = [];

// What Tab can land on: not disabled, not hidden, and (where the browser can say) drawn at all,
// so a button that CSS hides in this layout isn't taken for the last one.
const shown = (el: HTMLElement) => typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true });
const focusables = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !(el as HTMLButtonElement).disabled && !el.closest("[hidden], [inert]") && shown(el));
const usable = (el: HTMLElement | null) => (el && !(el as HTMLButtonElement).disabled ? el : null);

export type ModalOptions = {
  onClose?: () => void;   // Escape closes it; leave it out when the overlay answers Escape itself
  focus?: "inside" | "box"; // on open: the [data-autofocus] control, else the first field, else the box (default); or the box itself
};

// Tab and Shift-Tab wrap inside `box`, focus goes in on open and back to the opener on close, and
// (with onClose) Escape closes it when it's the top one. Keys the overlay handles itself still reach it.
export function useModal(box: RefObject<HTMLElement | null>, { onClose, focus = "inside" }: ModalOptions = {}) {
  // Where the keyboard was before anything inside could take it (an autoFocus field does, before effects run).
  const [opener] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Under any overlay it holds (one drawn inside it mounts first); else on top.
    const under = open.findIndex((o) => el.contains(o));
    if (under >= 0) open.splice(under, 0, el); else open.push(el);
    if (!el.contains(document.activeElement)) {
      const to = focus === "box" ? el : usable(el.querySelector<HTMLElement>("[data-autofocus]")) ?? el.querySelector<HTMLElement>(FIELDS) ?? el;
      to.focus({ preventScroll: true });
    }

    const onKey = (ev: KeyboardEvent) => {
      if (open[open.length - 1] !== el || ev.defaultPrevented) return;
      // A menu, or a question that isn't one of these, answers first.
      if ([...document.querySelectorAll<HTMLElement>('[role="alertdialog"], .popover')].some((n) => !open.includes(n))) return;
      if (ev.key === "Escape") { if (close.current) { ev.preventDefault(); close.current(); } return; }
      if (ev.key !== "Tab") return;
      const list = focusables(el);
      if (!list.length) { ev.preventDefault(); el.focus(); return; }
      const first = list[0], last = list[list.length - 1], now = document.activeElement;
      if (!el.contains(now)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
      else if (ev.shiftKey && (now === first || now === el)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && now === last) { ev.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = open.indexOf(el);
      if (at >= 0) open.splice(at, 1);
      const now = document.activeElement;
      if (opener && opener.isConnected && !el.contains(opener) && (!now || now === document.body || el.contains(now))) opener.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

type Props = Omit<HTMLAttributes<HTMLElement>, "onSubmit"> & {
  onClose: () => void;
  as?: "div" | "form" | "aside";
  onSubmit?: (ev: React.FormEvent) => void;
  label?: string;                  // the dialog's name, when there's no heading to point at
  labelledBy?: string;             // the id of its heading
  backdropClass?: string;
  onBackdrop?: () => void;         // a click on the backdrop; closes by default
  children: ReactNode;
};

export function Dialog({ onClose, as = "div", label, labelledBy, backdropClass, onBackdrop, className, children, ...rest }: Props) {
  const box = useRef<HTMLElement>(null);
  useModal(box, { onClose });
  return (
    <>
      <div className={cx("drawer-backdrop", backdropClass)} onClick={onBackdrop ?? onClose} />
      {createElement(as, {
        ...rest, ref: box, className, role: "dialog", "aria-modal": true, tabIndex: -1,
        "aria-label": label, "aria-labelledby": labelledBy,
      }, children)}
    </>
  );
}
