// For tests of an overlay that uses useModal: a button that opens it (so there's somewhere for focus
// to come back to), and a check that Tab and Shift-Tab wrap inside it.
import { fireEvent } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { expect } from "vitest";

export function Opener({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Open it</button>{open && children(() => setOpen(false))}</>;
}

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

// Tab from the last control goes to the first, Shift-Tab from the first to the last, and focus that
// strayed behind the overlay comes back in. (The list is read again after each move: focusing
// something can open more of the overlay, like a star's panel on the memory map.)
const controls = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !(el as HTMLButtonElement).disabled);
export function expectTabWraps(box: HTMLElement) {
  expect(controls(box).length).toBeGreaterThan(1);
  const last = controls(box).at(-1)!;
  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false); // prevented: focus was moved for it
  const first = controls(box)[0];
  expect(document.activeElement).toBe(first);
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(controls(box).at(-1));
  (document.body as HTMLElement).focus();
  fireEvent.keyDown(document.body, { key: "Tab" });
  expect(box.contains(document.activeElement)).toBe(true);
}
