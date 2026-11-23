// The shared dialog: Escape closes the top one, Tab stays inside, focus goes in and comes back.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { Dialog } from "./Dialog.tsx";

afterEach(cleanup);

function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Dialog label="Test dialog" className="dialog" onClose={() => { onClose(); setOpen(false); }}>
          <input aria-label="First" />
          <button disabled>Nope</button>
          <button>Last</button>
        </Dialog>
      )}
    </>
  );
}

test("it is a labelled modal dialog, with focus on its first field", () => {
  render(<Page />);
  fireEvent.click(screen.getByText("Open"));
  const d = screen.getByRole("dialog", { name: "Test dialog" });
  expect(d.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(screen.getByLabelText("First"));
});

test("Tab and Shift-Tab wrap inside the dialog", () => {
  render(<Page />);
  fireEvent.click(screen.getByText("Open"));
  const first = screen.getByLabelText("First"), last = screen.getByText("Last");
  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false); // prevented: focus moved by us
  expect(document.activeElement).toBe(first);
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(last);
  // focus that strayed behind the dialog comes back in
  (screen.getByText("Open") as HTMLElement).focus();
  fireEvent.keyDown(document.body, { key: "Tab" });
  expect(document.activeElement).toBe(first);
});

test("Escape closes it and focus goes back to the opener", () => {
  const closed = vi.fn();
  render(<Page onClose={closed} />);
  const opener = screen.getByText("Open");
  opener.focus();
  fireEvent.click(opener);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("with two open, Escape closes only the top one", () => {
  const a = vi.fn(), b = vi.fn();
  render(<><Dialog label="A" onClose={a}><button>a</button></Dialog><Dialog label="B" onClose={b}><button>b</button></Dialog></>);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(b).toHaveBeenCalledTimes(1);
  expect(a).not.toHaveBeenCalled();
});
