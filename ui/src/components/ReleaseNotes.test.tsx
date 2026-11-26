// The Release notes page: each write-up's front end and back end, big features first, with links to the pull requests.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { parseView } from "../feed/conversation.ts";
import { ReleaseNotes } from "./ReleaseNotes.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const DATA = {
  checked: "2026-11-25T12:00:00Z", repo: "o/r",
  releases: [{
    id: "a", from: "2026-11-23T12:00:00Z", to: "2026-11-25T10:00:00Z", written: "2026-11-25T12:00:00Z", byModel: true,
    prs: [{ number: 7, title: "x", url: "https://github.com/o/r/pull/7", author: "me" }, { number: 8, title: "y", url: "https://github.com/o/r/pull/8", author: "me" }],
    frontend: [{ title: "A new page", detail: "You can see it.", major: true, prs: [7] }],
    backend: [{ title: "Quicker start", detail: "", major: false, prs: [8] }],
  }],
};

test("a write-up shows front end then back end, new features marked, each linked to its pull requests", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(DATA)));
  vi.stubGlobal("fetch", fetch);
  render(<ReleaseNotes />);
  const r = within(await screen.findByRole("region", { name: /Release notes for/ }));
  expect(r.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Front end", "Back end"]);
  expect(r.getByText("New")).toBeTruthy();
  expect(r.getByRole("link", { name: "#7" }).getAttribute("href")).toBe("https://github.com/o/r/pull/7");
  expect(screen.getByText(/2 pull requests/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/releases/refresh", expect.objectContaining({ method: "POST" })));
});

test("nothing written yet says so; the page is remembered across reloads", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ checked: "", repo: "", releases: [] }))));
  render(<ReleaseNotes />);
  expect(await screen.findByText(/No release notes yet/)).toBeTruthy();
  expect(parseView(JSON.stringify({ kind: "releases" }))).toEqual({ kind: "releases" });
});
