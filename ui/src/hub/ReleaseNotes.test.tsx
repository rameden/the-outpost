// The star chart's Release notes drawer: each write-up's front end and back end, big features first, with links
// to the pull requests; and a rail that closes it and brings it back, remembered.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { parseView } from "../feed/conversation.ts";
import { ReleaseDrawer, keepNotesOpen, notesOpenAtFirst } from "./ReleaseNotes.tsx";

afterEach(() => { cleanup(); localStorage.clear(); });

const DATA = {
  checked: "2026-11-25T12:00:00Z", repo: "o/r",
  releases: [{
    id: "a", from: "2026-11-23T12:00:00Z", to: "2026-11-25T10:00:00Z", written: "2026-11-25T12:00:00Z", byModel: true,
    prs: [{ number: 7, title: "x", url: "https://github.com/o/r/pull/7", author: "me" }, { number: 8, title: "y", url: "https://github.com/o/r/pull/8", author: "me" }],
    frontend: [{ title: "A new page", detail: "You can see it.", major: true, prs: [7] }],
    backend: [{ title: "Quicker start", detail: "", major: false, prs: [8] }],
  }],
};
const asker = (data: unknown) => vi.fn(async () => data) as unknown as (<T>(path: string, body?: object) => Promise<T>) & ReturnType<typeof vi.fn>;

test("a write-up shows front end then back end, new features marked, each linked to its pull requests", async () => {
  const ask = asker(DATA);
  render(<ReleaseDrawer open ask={ask} onToggle={() => {}} />);
  const r = within(await screen.findByRole("region", { name: /Release notes for/ }));
  expect(r.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Front end1", "Back end1"]);
  expect(r.getByText("New")).toBeTruthy();
  expect(r.getByRole("link", { name: "#7" }).getAttribute("href")).toBe("https://github.com/o/r/pull/7");
  expect(screen.getByText(/2 pull requests/)).toBeTruthy();
  expect(ask).toHaveBeenCalledWith("/api/releases");
  const check = screen.getByRole("button", { name: "Check now" }); // the refresh button on the rail, after its name
  expect(check.closest(".zone-rail")?.querySelector(".rail-main + .rail-tools")?.contains(check)).toBe(true);
  expect(screen.queryByRole("heading", { name: "Release notes" })).toBeNull(); // no second header in the panel
  fireEvent.click(check);
  await waitFor(() => expect(ask).toHaveBeenCalledWith("/api/releases/refresh", {}));
});

test("each side's header folds its notes away and brings them back", async () => {
  render(<ReleaseDrawer open ask={asker(DATA)} onToggle={() => {}} />);
  const front = await screen.findByRole("button", { name: /Front end/ });
  expect(front.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(front);
  expect(front.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("A new page")).toBeNull();
  expect(screen.getByText("Quicker start")).toBeTruthy(); // the back end stays open
  fireEvent.click(front);
  expect(screen.getByText("A new page")).toBeTruthy();
});

test("while Check now runs, the button turns and is held, and the panel says it's looking", async () => {
  let finish!: (v: unknown) => void;
  const ask = vi.fn((path: string) => path === "/api/releases/refresh" ? new Promise((r) => { finish = r; }) : Promise.resolve(DATA)) as unknown as Parameters<typeof ReleaseDrawer>[0]["ask"];
  render(<ReleaseDrawer open ask={ask} onToggle={() => {}} />);
  const check = await screen.findByRole("button", { name: "Check now" });
  fireEvent.click(check);
  expect(check.getAttribute("aria-busy")).toBe("true");
  expect((check as HTMLButtonElement).disabled).toBe(true);
  expect(check.className).toContain("checking");
  expect(screen.getByRole("status").textContent).toMatch(/Looking for pull requests/);
  finish(DATA);
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect((check as HTMLButtonElement).disabled).toBe(false);
});

test("nothing written yet says so; the old workspace page lands on Today", async () => {
  render(<ReleaseDrawer open ask={asker({ checked: "", repo: "", releases: [] })} onToggle={() => {}} />);
  expect(await screen.findByText(/No release notes yet/)).toBeTruthy();
  expect(parseView(JSON.stringify({ kind: "releases" }))).toEqual({ kind: "home" });
});

test("the drawer folds to a rail and opens again, and the page remembers which", async () => {
  expect(notesOpenAtFirst()).toBe(true); // open the first time
  const onToggle = vi.fn();
  const { rerender } = render(<ReleaseDrawer open ask={asker(DATA)} onToggle={onToggle} />);
  expect(await screen.findByRole("region", { name: "Release notes" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide the release notes" }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  rerender(<ReleaseDrawer open={false} ask={asker(DATA)} onToggle={onToggle} />);
  expect(screen.queryByRole("region", { name: "Release notes" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show the release notes" }));
  expect(onToggle).toHaveBeenCalledTimes(2);
  keepNotesOpen(false);
  expect(notesOpenAtFirst()).toBe(false);
  keepNotesOpen(true);
  expect(notesOpenAtFirst()).toBe(true);
});
