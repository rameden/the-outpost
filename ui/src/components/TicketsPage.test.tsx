// The Tickets page: Mae's own tickets and Jira's as one set of cards, Mae's carrying Mae's mark,
// narrowed to one kind or the other with the Outpost / Jira chips. (Jira's side in full: JiraPage.test.tsx.)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { closeDrafting, closeTicket, loadTickets, newTicket, roughTicket, showTicket, ticketsNow } from "../tickets.ts";
import { MaeTicketDialog, TicketsPage } from "./TicketsPage.tsx";

const mae = (key: string, title: string, status: string, more: object = {}) =>
  ({ key, title, status, criteria: [], labels: [], description: "", created: "2026-11-10T09:00:00.000Z", updated: "2026-11-10T09:00:00.000Z", ...more });
const MAE = [mae("MAE-2", "Tidy the settings page", "todo", { priority: "high", project: "p1", criteria: ["Every page has a heading"] }), mae("MAE-1", "Write the tour", "doing")];
const jira = (key: string, summary: string, group: string, status: string) =>
  ({ key, summary, group, status, type: "Story", priority: "High", assignee: "Ryley", labels: [], project: "MP", updated: "2026-11-09T10:00:00.000Z", url: `https://team.atlassian.net/browse/${key}`, epic: null });
const JIRA = [jira("MP-544", "Open button on file citations", "doing", "In Progress"), jira("MP-601", "Fix the nav", "todo", "To Do")];

const calls: string[] = [];
beforeEach(async () => {
  calls.length = 0;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url === "/api/tickets") return new Response(JSON.stringify({ tickets: MAE }));
    return new Response(JSON.stringify({ jql: "", saved: "", tickets: JIRA, more: false }));
  }));
  await loadTickets();
});
afterEach(() => { cleanup(); closeTicket(); closeDrafting(); vi.unstubAllGlobals(); });

const S = (connected: boolean) => ({ jira: connected ? { connected: true, siteUrl: "https://team.atlassian.net", filter: "assignee = currentUser()" } : undefined,
  history: { projects: [{ id: "general", name: "General" }, { id: "p1", name: "Web app" }], conversations: [] } }) as unknown as CampState;
const show = (connected = true) => render(<TicketsPage S={S(connected)} onAttach={() => {}} refresh={() => {}} onStart={() => {}} />);
const cards = () => [...document.querySelectorAll(".jira-card")].map((c) => `${c.querySelector(".mae-mark") ? "◉ " : ""}${c.querySelector(".jira-key")!.textContent}`);

test("Mae's tickets and Jira's are one set of cards, what's being worked on first, Mae's marked as hers", async () => {
  show();
  await waitFor(() => expect(cards()).toEqual(["◉ MAE-1", "MP-544", "◉ MAE-2", "MP-601"]));
  const card = screen.getByRole("button", { name: "MAE-2: Tidy the settings page" });
  expect(card.querySelector(".mae-mark")!.getAttribute("aria-label")).toBe("Outpost ticket");
  expect(card.textContent).toContain("To do");
  expect(card.textContent).toMatch(/Web app · 1 criterion · changed /);
  expect(screen.getByText("4 tickets")).toBeTruthy();
});

test("the Outpost / Jira chips narrow the page to one kind, and the choice is kept", async () => {
  show();
  await waitFor(() => expect(cards().length).toBe(4));
  fireEvent.click(screen.getByRole("button", { name: /^Outpost/ }));
  expect(cards()).toEqual(["◉ MAE-1", "◉ MAE-2"]);
  expect(screen.getByText("2 of 4")).toBeTruthy();
  expect(document.querySelector(".jira-using")).toBeNull(); // Jira's filter has nothing to do with these
  expect(localStorage.getItem("camp-tickets-source")).toBe("mae");
  fireEvent.click(screen.getByRole("button", { name: /^Jira/ }));
  expect(cards()).toEqual(["MP-544", "MP-601"]);
  expect(screen.queryByLabelText("Project")).toBeNull(); // Jira's tickets are in no camp project
  fireEvent.click(screen.getByRole("button", { name: /^Jira/ })); // again: both
  expect(cards().length).toBe(4);
  // A project is Mae's to have: choosing one leaves Jira's out.
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
  expect(cards()).toEqual(["◉ MAE-2"]);
});

test("without Jira it's Mae's tickets alone: no chips to choose between, no Jira to ask", async () => {
  show(false);
  await waitFor(() => expect(cards()).toEqual(["◉ MAE-1", "◉ MAE-2"]));
  expect(calls.some((u) => u.startsWith("/api/jira"))).toBe(false);
  expect(screen.queryByRole("group", { name: "Whose tickets" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "MAE-1: Write the tour" }));
  expect(ticketsNow().showing).toEqual({ key: "MAE-1" }); // it opens over the page, wherever you are
});

// New ticket, started from a note or a plan.
const NOTE = { id: "n1", title: "Dark mode", text: "People keep asking for it.\n- [ ] Follows the system\n- [ ] Can be forced on in Settings", created: "2026-11-10T09:00:00.000Z", updated: "2026-11-12T09:00:00.000Z" };
const PLAN = { id: "a3", body: "1. Move the nav into its own file\n2. Add a test", time: "2026-11-11T09:00:00.000Z", conversation: "c1", conversationTitle: "Fix the nav", project: "p1" };
function startFrom(draft: Promise<object>) {
  const sent: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ url, body });
    if (url === "/api/notes") return new Response(JSON.stringify({ notes: [NOTE] }));
    if (url === "/api/tickets/plans") return new Response(JSON.stringify({ plans: [PLAN] }));
    if (url === "/api/tickets/draft") return new Response(JSON.stringify({ ok: true, drafts: [await draft] }));
    if (url === "/api/tickets" && body?.action === "create") return new Response(JSON.stringify({ tickets: MAE, ticket: { ...MAE[0], key: "MAE-3" } }));
    return new Response(JSON.stringify({ tickets: MAE }));
  }));
  render(<MaeTicketDialog S={S(false)} onOpenConversation={() => {}} />);
  newTicket();
  return sent;
}
const value = (label: string) => (screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement).value;

test("a note fills the new ticket at once, and Mae's write-up then changes only what you haven't", async () => {
  let done!: (d: object) => void;
  const sent = startFrom(new Promise((r) => { done = r; }));
  const pick = await screen.findByLabelText(/^Start from/);
  await waitFor(() => expect(pick.querySelectorAll("option").length).toBe(3)); // nothing, the note, the plan
  fireEvent.change(pick, { target: { value: "note:n1" } });
  expect(value("Title")).toBe("Dark mode");
  expect(value("Acceptance criteria")).toBe("Follows the system\nCan be forced on in Settings");
  expect(screen.getByRole("status").textContent).toMatch(/writing the rest/);
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Dark theme" } }); // yours now
  done({ title: "Add dark mode", criteria: ["Follows the system setting", "Can be forced on"], description: "Asked for often.", priority: "medium", labels: ["ui"] });
  await waitFor(() => expect(value("Acceptance criteria")).toBe("Follows the system setting\nCan be forced on"));
  expect(value("Title")).toBe("Dark theme");
  expect(value("Priority")).toBe("medium");
  expect(value("Labels")).toBe("ui");
  expect(value("Description")).toBe("Asked for often.");
  expect(sent.find((c) => c.url === "/api/tickets/draft")!.body).toMatchObject({ kind: "note", title: "Dark mode", one: true });
  fireEvent.click(screen.getByRole("button", { name: "File the ticket" }));
  await waitFor(() => expect(sent.some((c) => c.body?.action === "create")).toBe(true));
  expect(sent.find((c) => c.body?.action === "create")!.body).toMatchObject({ title: "Dark theme", priority: "medium", from: { kind: "note", id: "n1", title: "Dark mode" } });
});

test("a plan fills it from its conversation, in its project, and can be split into several instead", async () => {
  const failing = Promise.reject(new Error("no model here"));
  failing.catch(() => {}); // (it's the page that hears of it)
  startFrom(failing);
  const pick = await screen.findByLabelText(/^Start from/);
  await waitFor(() => expect(pick.querySelectorAll("option").length).toBe(3));
  fireEvent.change(pick, { target: { value: "plan:a3" } });
  expect(value("Title")).toBe("Fix the nav");
  expect(value("Project")).toBe("p1");
  expect(value("Acceptance criteria")).toBe("Move the nav into its own file\nAdd a test");
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/text only/)); // the model failed: what's there stays
  expect(value("Title")).toBe("Fix the nav");
  fireEvent.click(screen.getByRole("button", { name: "Make several tickets of it instead" }));
  expect(ticketsNow().showing).toBeNull();
  expect(ticketsNow().drafting).toMatchObject({ kind: "plan", project: "p1", from: { kind: "plan", id: "c1", title: "Fix the nav" } });
});

test("a done ticket the crew worked on shows how they did, and can be debriefed on the spot", async () => {
  const done = mae("MAE-4", "Add an Open button", "done", { done: "2026-11-12T09:00:00.000Z" });
  const debrief = { key: "MAE-4", written: "2026-11-12T09:02:00.000Z", conversations: 1, runs: 3, asks: 2, quests: 2, cost: 1,
    well: ["The button landed in the first quest."], better: ["The test was left out until the review."], proposed: [{ where: "agent:quartermaster", name: "Quartermaster's memory", text: "Brief a test as its own step." }] };
  const posted: string[] = [];
  let written: object | null = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/debrief" && init?.body) { posted.push(String(init.body)); written = debrief; return new Response(JSON.stringify({ debrief })); }
    if (url.startsWith("/api/debrief?key=MAE-4")) return new Response(JSON.stringify({ debrief: written }));
    return new Response(JSON.stringify({ tickets: [done, ...MAE] }));
  }));
  await loadTickets();
  const worked = { ...S(false), history: { ...S(false).history, conversations: [{ id: "c1", title: "Open button", ticket: "MAE-4", updated: "2026-11-12T08:00:00.000Z" }] } } as unknown as CampState;
  render(<MaeTicketDialog S={worked} onOpenConversation={() => {}} />);
  showTicket("MAE-4");
  expect(await screen.findByText(/Not debriefed yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Debrief now" }));
  expect(await screen.findByText("The test was left out until the review.")).toBeTruthy();
  expect(posted).toEqual(['{"key":"MAE-4"}']);
  expect(screen.getByText(/3 expeditions \(2 typed by you\) and 2 quests, costing \$1\.00/)).toBeTruthy();
  expect(screen.getByText("Brief a test as its own step.", { exact: false }).textContent).toBe("Quartermaster's memory: Brief a test as its own step.");
  expect(screen.getByRole("button", { name: "Debrief again" })).toBeTruthy();
});

test("the quick fill: a title, the checklist or list as the criteria, and the rest as the description", () => {
  expect(roughTicket("# Dark mode\n\nWanted.\n- [x] One\n- Two", "Dark mode")).toEqual({ title: "Dark mode", criteria: ["One"], description: "Wanted.\n- [x] One\n- Two" });
  expect(roughTicket("Tidy up\n1. **First**\n2. Second\n   - nested")).toEqual({ title: "Tidy up", criteria: ["First", "Second"], description: "1. **First**\n2. Second\n   - nested" });
  // A plan's own heading says more than its conversation's name.
  expect(roughTicket("Plan: Banner toggle\n\n1. Add it", "lets write up a plan").title).toBe("Banner toggle");
  expect(roughTicket("## Banner toggle\n- Add it", "lets write up a plan")).toEqual({ title: "Banner toggle", criteria: ["Add it"], description: "- Add it" });
});

test("keyboard: Enter opens a card, the arrows walk the cards, Shift and an arrow move a Mae ticket along", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/tickets") return new Response(JSON.stringify({ tickets: MAE, ticket: { ...MAE[0], status: "doing" } }));
    return new Response(JSON.stringify({ jql: "", saved: "", tickets: JIRA, more: false }));
  }));
  show();
  await waitFor(() => expect(cards().length).toBe(4));
  const first = screen.getByRole("button", { name: "MAE-1: Write the tour" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement!.getAttribute("aria-label")).toBe("MP-544: Open button on file citations");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(first);
  // Shift+Right moves the Mae ticket on a state (To do → In progress), and says so aloud.
  const todo = screen.getByRole("button", { name: "MAE-2: Tidy the settings page" });
  fireEvent.keyDown(todo, { key: "ArrowRight", shiftKey: true });
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("MAE-2 moved to In progress"));
  expect(calls).toContain("POST /api/tickets");
  // A Jira card isn't moved from here.
  const before = calls.length;
  fireEvent.keyDown(screen.getByRole("button", { name: "MP-601: Fix the nav" }), { key: "ArrowRight", shiftKey: true });
  expect(calls.length).toBe(before);
});

test("the Jira filter is changed on this page, folded away until asked for", async () => {
  show();
  await waitFor(() => expect(cards().length).toBe(4));
  expect(screen.queryByLabelText("Filter (JQL)")).toBeNull();
  const open = screen.getByRole("button", { name: "Change the filter" });
  expect(open.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(open);
  expect((screen.getByLabelText("Filter (JQL)") as HTMLInputElement).value).toBe("assignee = currentUser()");
  expect(screen.getByRole("button", { name: "Hide the filter" }).getAttribute("aria-expanded")).toBe("true");
});
