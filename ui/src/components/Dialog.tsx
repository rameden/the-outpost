// The one modal dialog: a dimmed backdrop and a panel that owns what every dialog needs.
// Escape closes it (only the top one, when two are open), Tab and Shift-Tab stay inside it,
// focus goes in when it opens and back to whatever opened it when it closes, and clicking the
// backdrop closes it. The look stays with the caller's class names (".dialog" and friends).

import { createElement, useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../format.ts";

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
const FIRST = '[data-autofocus], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

// Open dialogs, oldest first: only the last one answers Escape and Tab.
const open: HTMLElement[] = [];

const focusables = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !(el as HTMLButtonElement).disabled && !el.closest("[hidden]"));

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
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open.push(el);
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FIRST) ?? el).focus();

    const onKey = (ev: KeyboardEvent) => {
      if (open[open.length - 1] !== el || ev.defaultPrevented || document.querySelector('[role="alertdialog"], .popover')) return; // a question or menu on top answers first
      if (ev.key === "Escape") { ev.preventDefault(); close.current(); return; }
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
      if (opener && opener.isConnected && (!document.activeElement || document.activeElement === document.body || el.contains(document.activeElement))) opener.focus();
    };
  }, []);

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
