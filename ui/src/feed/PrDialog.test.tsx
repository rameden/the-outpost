// The pull request dialog while the feed behind it keeps redrawing: the draft is asked for once,
// and what you've changed in it stays yours.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PrDialog } from "./PrDialog.tsx";

const calls: { url: string; body?: any }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/repo/pr/draft") return new Response(JSON.stringify({ title: "Add the Open button", body: "Drafted from the record.", branch: "mp-544", existing: null }));
    return new Response(JSON.stringify({ url: "https://github.com/acme/web/pull/7" }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const W = { link: "web", path: "/work/web-mp-544", base: "main" };
const drafts = () => calls.filter((c) => c.url === "/api/repo/pr/draft").length;

test("the page behind redrawing (a new onClose each time) doesn't ask for the draft again or undo your edits", async () => {
  const onDone = vi.fn();
  // Each draw hands the dialog a brand new onClose, as its parent in the feed does.
  const dialog = (onClose = () => {}) => <PrDialog w={{ ...W }} expId="run1" onClose={onClose} onDone={onDone} />;
  const { rerender } = render(dialog());
  const title = await screen.findByLabelText("Title") as HTMLInputElement;
  const body = screen.getByLabelText("Description") as HTMLTextAreaElement;
  expect(title.value).toBe("Add the Open button");
  expect(drafts()).toBe(1);

  fireEvent.change(title, { target: { value: "Open button on file citations" } });
  fireEvent.change(body, { target: { value: "My own words." } });
  for (let i = 0; i < 5; i++) rerender(dialog());
  await new Promise((r) => setTimeout(r, 20)); // (time for a second draft to land, had one been asked for)
  expect(drafts()).toBe(1);
  expect(title.value).toBe("Open button on file citations");
  expect(body.value).toBe("My own words.");

  // Escape still closes it, with whichever onClose it was last given.
  const onClose = vi.fn();
  rerender(dialog(onClose));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Push and open it" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ url: "https://github.com/acme/web/pull/7" }));
  expect(calls.at(-1)).toEqual({ url: "/api/repo/pr", body: { link: "web", path: "/work/web-mp-544", title: "Open button on file citations", body: "My own words.", expedition: "run1" } });
});

test("a click outside closes it only while the draft is as it came: once you've changed it, Cancel and Escape do", async () => {
  const onClose = vi.fn();
  render(<PrDialog w={W} onClose={onClose} onDone={() => {}} />);
  const title = await screen.findByLabelText("Title") as HTMLInputElement;
  const backdrop = document.querySelector(".drawer-backdrop")!;
  fireEvent.change(title, { target: { value: "Something else" } });
  fireEvent.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.change(title, { target: { value: "Add the Open button" } }); // back to how it came
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(2);
});
