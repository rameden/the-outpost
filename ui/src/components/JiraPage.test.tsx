// The Jira page: the tickets the filter pulls in as cards, trying and keeping a filter,
// narrowing what's on the page, and one ticket opened in full.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { JIRA_PRESETS } from "./Jira.tsx";
import { JiraPage, JiraTicket, startBrief, ticketBranch } from "./JiraPage.tsx";

const MINE = JIRA_PRESETS[0].jql;
const card = (key: string, summary: string, group: string, status: string, more: object = {}) =>
  ({ key, summary, group, status, type: "Story", priority: "High", assignee: "Ryley", labels: ["web"], project: "MP", updated: "2026-11-09T10:00:00.000Z", url: `https://team.atlassian.net/browse/${key}`, epic: null, ...more });
const CANVAS = { key: "MP-500", summary: "Reports canvas", type: "Epic" };
const TICKETS = [card("MP-544", "Open button on file citations", "doing", "In Progress", { epic: CANVAS }), card("MP-601", "Fix the nav on small screens", "todo", "To Do", { type: "Bug", assignee: null, labels: [] }),
  card("MP-590", "Tidy the report header", "done", "Done", { epic: CANVAS })];
const EPIC = { ...card("MP-500", "Reports canvas", "doing", "In Progress", { type: "Epic" }), reporter: "Sam", description: "Everything for the canvas.", comments: [], earlierComments: 0, children: [TICKETS[0], TICKETS[2]], moreChildren: false, criteria: [] };
const DETAIL = { ...TICKETS[0], children: [], moreChildren: false, criteria: ["An Open button on web reports", "It opens the cited file"], reporter: "Sam", description: "## Acceptance criteria\n\n- An **Open** button on web reports", earlierComments: 3,
  comments: [{ author: "Sam", created: "2026-11-08T09:00:00.000Z", text: "Looks good <script>alert(1)</script>" }] };

const calls: { url: string; body?: any }[] = [];
let saved = MINE;
beforeEach(() => {
  calls.length = 0; saved = MINE;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const u = new URL(url, "http://camp");
    if (u.pathname === "/api/jira/ticket") return new Response(JSON.stringify(u.searchParams.get("key") === "MP-500" ? EPIC : DETAIL));
    const jql = body?.jql ?? u.searchParams.get("jql") ?? saved;
    if (jql.includes("BROKEN")) return new Response(JSON.stringify({ error: "Jira refused the request. Error in the JQL Query." }), { status: 400 });
    if (u.pathname === "/api/jira/filter") saved = jql;
    return new Response(JSON.stringify({ jql, saved, tickets: jql.includes("nav") ? [TICKETS[1]] : TICKETS, more: false }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const state = (filter = MINE) => ({ jira: { connected: true, siteUrl: "https://team.atlassian.net", displayName: "Ryley A", email: "me@team.com", source: "saved", filter },
  history: { projects: [{ id: "general", name: "General" }, { id: "p1", name: "Web app", links: ["web"] }, { id: "p2", name: "Docs", links: ["docs"] }], conversations: [] },
  links: [{ name: "web", path: "/code/web", access: "write" }, { name: "docs", path: "/code/docs", access: "read" }] }) as unknown as CampState;
const S = state();
const show = () => { const onAttach = vi.fn(), onFilter = vi.fn(), onStart = vi.fn(); const r = render(<JiraPage S={S} onAttach={onAttach} onFilter={onFilter} onStart={onStart} />); return { onAttach, onFilter, onStart, ...r }; };
const cards = () => [...document.querySelectorAll(".jira-card")].map((c) => c.querySelector(".jira-key")!.textContent);

test("the tickets the filter pulls in are cards, each with what you need at a glance", async () => {
  show();
  await waitFor(() => expect(cards()).toEqual(["MP-544", "MP-601", "MP-590"]));
  expect(calls[0].url).toBe("/api/jira/tickets");
  const first = screen.getByRole("button", { name: "MP-544: Open button on file citations" });
  expect(first.textContent).toContain("Story");
  expect(first.textContent).toContain("In Progress");
  expect(first.textContent).toMatch(/High · Ryley · changed /);
  expect(first.querySelector(".jira-label")?.textContent).toBe("web");
  expect(first.querySelector(".pill")?.className).toBe("pill live");
  expect(screen.getByRole("button", { name: /^MP-601/ }).textContent).toContain("Unassigned");
  expect(screen.getByText("3 tickets")).toBeTruthy();
  expect(screen.getByText(/team\.atlassian\.net · Ryley A · read-only/)).toBeTruthy();
});

test("what's on the page can be narrowed by words, status and type, without asking Jira again", async () => {
  show();
  await waitFor(() => expect(cards().length).toBe(3));
  const asked = calls.length;
  fireEvent.change(screen.getByLabelText("Narrow by words"), { target: { value: "nav" } });
  expect(cards()).toEqual(["MP-601"]);
  expect(screen.getByText("1 of 3")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Narrow by words"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
  expect(cards()).toEqual(["MP-590"]);
  fireEvent.click(screen.getByRole("button", { name: /^Done/ })); // again: off
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "Bug" } });
  expect(cards()).toEqual(["MP-601"]);
  fireEvent.click(screen.getByRole("button", { name: /^In progress/ }));
  expect(cards()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Show them all" }));
  expect(cards().length).toBe(3);
  expect(calls.length).toBe(asked);
});

test("which tickets are pulled in is the camp's one filter: the page says which, links to Settings, and follows a change", async () => {
  const { onFilter, rerender } = show();
  await waitFor(() => expect(cards().length).toBe(3));
  expect(document.querySelector(".jira-using")!.textContent).toContain("Showing Assigned to me, not done");
  expect(screen.queryByLabelText("Filter (JQL)")).toBeNull(); // no filter of its own here
  fireEvent.click(screen.getByRole("button", { name: "Change the filter in Settings" }));
  expect(onFilter).toHaveBeenCalled();

  // Changed in Settings: the page asks Jira again, and shows a filter of your own as it's written.
  saved = 'summary ~ "nav"';
  const asked = calls.length;
  rerender(<JiraPage S={state(saved)} onAttach={() => {}} onFilter={onFilter} onStart={() => {}} />);
  await waitFor(() => expect(cards()).toEqual(["MP-601"]));
  expect(calls.length).toBe(asked + 1);
  expect(document.querySelector(".jira-using code")!.textContent).toBe('summary ~ "nav"');
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(calls.length).toBe(asked + 2));
  expect(calls.at(-1)!.url).toBe("/api/jira/tickets");
});

test("a card opens the whole ticket: its facts, description and comments, to attach or open in Jira", async () => {
  const { onAttach } = show();
  fireEvent.click(await screen.findByRole("button", { name: "MP-544: Open button on file citations" }));
  const dialog = await screen.findByRole("dialog", { name: "MP-544: Open button on file citations" });
  await waitFor(() => expect(within(dialog).getByText("Reporter")).toBeTruthy());
  expect(calls.at(-1)!.url).toBe("/api/jira/ticket?key=MP-544");
  expect([...dialog.querySelectorAll(".jira-facts dd")].map((d) => d.textContent).slice(0, 6)).toEqual(["In Progress", "Story", "High", "Ryley", "Sam", "MP"]);
  expect(within(dialog).getByRole("heading", { name: "Acceptance criteria" })).toBeTruthy(); // the description, formatted
  expect(dialog.querySelector("strong")?.textContent).toBe("Open");
  expect(within(dialog).getByText("Comments (4)")).toBeTruthy();
  expect(within(dialog).getByText(/The latest 1; 3 earlier ones are in Jira/)).toBeTruthy();
  expect(dialog.querySelector("script")).toBeNull(); // what a ticket says is only ever text
  expect(dialog.textContent).toContain("Looks good <script>alert(1)</script>");
  expect((within(dialog).getByRole("link", { name: /Open in Jira/ }) as HTMLAnchorElement).href).toBe("https://team.atlassian.net/browse/MP-544");
  fireEvent.click(within(dialog).getByRole("button", { name: "Attach to message" }));
  expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ key: "MP-544", summary: "Open button on file citations" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("epics: a card says which epic it's in, and the cards can be grouped under their epics or narrowed to one", async () => {
  show();
  await waitFor(() => expect(cards().length).toBe(3));
  expect(screen.getByRole("button", { name: /^MP-544/ }).querySelector(".jira-epic")!.textContent).toBe("MP-500 · Reports canvas");
  expect(screen.getByRole("button", { name: /^MP-601/ }).querySelector(".jira-epic")).toBeNull();

  expect(screen.getByLabelText("Epic").previousElementSibling).toBe(screen.getByLabelText("Type")); // side by side, in one group
  fireEvent.change(screen.getByLabelText("Epic"), { target: { value: "MP-500" } });
  expect(cards()).toEqual(["MP-544", "MP-590"]);
  fireEvent.change(screen.getByLabelText("Epic"), { target: { value: "none" } });
  expect(cards()).toEqual(["MP-601"]);
  fireEvent.change(screen.getByLabelText("Epic"), { target: { value: "" } });

  fireEvent.click(screen.getByRole("button", { name: "Group by epic" }));
  const sections = () => [...document.querySelectorAll(".jira-section")].map((sec) => `${sec.getAttribute("aria-label")} → ${[...sec.querySelectorAll(".jira-card .jira-key")].map((k) => k.textContent).join(",")}`);
  expect(sections()).toEqual(["MP-500: Reports canvas → MP-544,MP-590", "In no epic → MP-601"]);
  expect(document.querySelector(".jira-card .jira-epic")).toBeNull(); // it's the heading now: the cards don't repeat it
  expect(localStorage.getItem("camp-jira-by-epic")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
  expect(sections()).toEqual(["MP-500: Reports canvas → MP-590"]); // a group with nothing left in it goes
});

test("an epic opens like any ticket, listing what's in it; a ticket leads to its epic and back", async () => {
  localStorage.setItem("camp-jira-by-epic", "1");
  show();
  await waitFor(() => expect(cards().length).toBe(3));
  fireEvent.click(screen.getByTitle("Open this epic"));
  const epic = await screen.findByRole("dialog", { name: "MP-500: Reports canvas" });
  await waitFor(() => expect(within(epic).getByText("In this epic (2)")).toBeTruthy());
  expect([...epic.querySelectorAll(".jira-children li")].map((li) => li.textContent)).toEqual(["MP-544Open button on file citationsIn Progress", "MP-590Tidy the report headerDone"]);
  fireEvent.click(within(epic).getByTitle("Open MP-544"));
  const story = await screen.findByRole("dialog", { name: "MP-544: Open button on file citations" });
  await waitFor(() => expect(within(story).getByTitle("Open MP-500")).toBeTruthy());
  expect(within(story).getByTitle("Open MP-500").textContent).toContain("Epic MP-500 Reports canvas");
  expect(within(story).queryByText(/In this epic|Under this ticket/)).toBeNull(); // nothing sits under it
  fireEvent.click(within(story).getByTitle("Open MP-500"));
  expect(await screen.findByRole("dialog", { name: "MP-500: Reports canvas" })).toBeTruthy();
});

test("Start work hands the ticket to the kickoff stepper; the page's own button opens it from the first step", async () => {
  const onKickoff = vi.fn(), onStart = vi.fn();
  render(<JiraPage S={S} onAttach={() => {}} onFilter={() => {}} onStart={onStart} onKickoff={onKickoff} />);
  await waitFor(() => expect(cards().length).toBe(3));
  fireEvent.click(screen.getByRole("button", { name: "Start a ticket…" }));
  expect(onKickoff).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /MP-544: Open button/ }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Acceptance criteria (2)");
  fireEvent.click(within(dialog).getByRole("button", { name: "Start work…" }));
  expect(onStart).toHaveBeenCalledWith({ key: "MP-544", summary: "Open button on file citations" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the brief lists the ticket's acceptance criteria as a checklist, or asks what done means when it has none", () => {
  const brief = startBrief({ key: "MP-544", summary: "Open button", criteria: ["An Open button", "It opens the file"] });
  expect(brief).toContain("Work on MP-544: Open button");
  expect(brief).toContain("- [ ] An Open button\n- [ ] It opens the file");
  expect(startBrief({ key: "MP-1", summary: "x", criteria: [] })).toContain("lists no acceptance criteria");
  // What you add for the crew goes in under your own name, after the criteria.
  expect(startBrief({ key: "MP-1", summary: "x", criteria: ["One"] }, "  Leave the old nav alone.\n")).toContain("- [ ] One\n\nAlso, from me:\nLeave the old nav alone.\n\nWhen you're done");
  expect(ticketBranch("MP-9", "Fix: the nav / on small screens!!")).toBe("MP-9-fix-the-nav-on-small-screens");
});

test("an open ticket asks Jira once, however often the page behind it is redrawn (a new onClose each time)", async () => {
  const ticket = (onClose = () => {}) => <JiraTicket id="MP-544" summary="Open button on file citations" onClose={onClose} onOpen={() => {}} />;
  const { rerender } = render(ticket());
  const dialog = await screen.findByRole("dialog", { name: "MP-544: Open button on file citations" });
  await waitFor(() => expect(within(dialog).getByText("Reporter")).toBeTruthy());
  const asked = () => calls.filter((c) => c.url.startsWith("/api/jira/ticket")).length;
  expect(asked()).toBe(1);
  for (let i = 0; i < 5; i++) rerender(ticket());
  expect(asked()).toBe(1);
  const onClose = vi.fn();
  rerender(ticket(onClose));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
