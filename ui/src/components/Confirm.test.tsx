// The question before something that can't be taken back: where the keyboard goes, and what Escape does.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ask, Confirm, ConfirmHost } from "./Confirm.tsx";
import { Dialog } from "./Dialog.tsx";
import { Opener, expectTabWraps } from "./modalkit.tsx";

afterEach(cleanup);

test("it opens on the button that goes ahead, Tab stays inside, and Escape is Cancel with focus back on what asked", () => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<Opener>{(close) => <Confirm title="Forget this?" action="Forget it" onConfirm={onConfirm} onCancel={() => { onCancel(); close(); }}>It can't be undone.</Confirm>}</Opener>);
  const opener = screen.getByRole("button", { name: "Open it" });
  opener.focus();
  fireEvent.click(opener);
  const box = screen.getByRole("alertdialog", { name: "Forget this?" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Forget it" }));
  expectTabWraps(box);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("asked from inside a dialog, Escape answers the question and leaves the dialog open", async () => {
  const closed = vi.fn();
  render(<><Opener>{() => <Dialog label="Edit" onClose={closed}><button type="button" onClick={() => void ask({ title: "Sure?", action: "Yes" })}>Delete</button><button type="button">Done</button></Dialog>}</Opener><ConfirmHost /></>);
  fireEvent.click(screen.getByRole("button", { name: "Open it" }));
  const del = screen.getByRole("button", { name: "Delete" });
  del.focus();
  fireEvent.click(del);
  const question = await screen.findByRole("alertdialog", { name: "Sure?" });
  expectTabWraps(question); // the question's own buttons, not the dialog's
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(closed).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(del);
});
