// Jira on the page: linking the account (the token goes to the camp once and isn't kept in the
// form), and picking a ticket to attach.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { JIRA_PRESETS, JiraConnection, JiraPicker } from "./Jira.tsx";

const calls: { url: string; body?: any }[] = [];
let answer: (url: string, body?: any) => { status?: number; json: unknown } = () => ({ json: {} });
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const a = answer(url, body);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const MINE = JIRA_PRESETS[0].jql;
const off = { jira: { connected: false, siteUrl: null, email: null, displayName: null, source: null, filter: MINE } } as unknown as CampState;
const WRITE_OFF = { on: false, startStatus: "", prStatus: "" };
const on = (source = "saved", filter = MINE, jiraWrite = WRITE_OFF) => ({ jira: { connected: true, siteUrl: "https://team.atlassian.net", email: "me@team.com", displayName: "Ryley A", source, filter }, settings: { jiraWrite } }) as unknown as CampState;
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

test("linking: the address, email and token are sent to be checked; a refusal is shown and the form stays", async () => {
  const refresh = vi.fn();
  render(<JiraConnection S={off} refresh={refresh} />);
  const link = screen.getByRole("button", { name: "Link Jira" }) as HTMLButtonElement;
  expect(link.disabled).toBe(true); // nothing filled in yet
  fill("Jira address", "team.atlassian.net"); fill("Atlassian account email", "me@team.com"); fill("API token", "tok-123");
  expect((screen.getByLabelText("API token") as HTMLInputElement).type).toBe("password");
  answer = () => ({ status: 400, json: { error: "Jira didn't accept that email and API token." } });
  fireEvent.click(link);
  expect((await screen.findByRole("alert")).textContent).toBe("Jira didn't accept that email and API token.");
  expect(refresh).not.toHaveBeenCalled();

  answer = () => ({ json: on().jira });
  fireEvent.click(screen.getByRole("button", { name: "Link Jira" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls.at(-1)).toEqual({ url: "/api/jira", body: { siteUrl: "team.atlassian.net", email: "me@team.com", apiToken: "tok-123" } });
  expect((screen.getByLabelText("API token") as HTMLInputElement).value).toBe(""); // not kept in the page once it's sent
});

test("linked: it says where and as whom, and can be unlinked; set in the environment, it says to remove it there", async () => {
  const refresh = vi.fn();
  const { rerender } = render(<JiraConnection S={on()} refresh={refresh} />);
  expect(screen.getByText("team.atlassian.net")).toBeTruthy();
  expect(screen.getByText("Ryley A · me@team.com")).toBeTruthy();
  expect(screen.queryByLabelText("API token")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls.at(-1)).toEqual({ url: "/api/jira", body: { disconnect: true } });
  rerender(<JiraConnection S={on("environment")} refresh={refresh} />);
  expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  expect(screen.getByText(/JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN/)).toBeTruthy();
});

test("which tickets are pulled in is set here, with the account: try a filter, then keep it", async () => {
  const refresh = vi.fn();
  const pull = (jql: string, saved: string, keys: string[]) => ({ json: { jql, saved, more: false, tickets: keys.map((key) => ({ key })) } });
  answer = (url, body) => {
    const jql = body?.jql ?? new URL(url, "http://camp").searchParams.get("jql") ?? MINE;
    if (jql.includes("BROKEN")) return { status: 400, json: { error: "Jira refused the request. Error in the JQL Query." } };
    return pull(jql, url === "/api/jira/filter" ? jql : MINE, jql.includes("MP") ? ["MP-544", "MP-601"] : []);
  };
  const { rerender } = render(<JiraConnection S={on()} refresh={refresh} />);
  const box = screen.getByLabelText("Filter (JQL)") as HTMLInputElement;
  expect(box.value).toBe(MINE);
  expect((screen.getByLabelText("A usual filter") as HTMLSelectElement).value).toBe(MINE);
  expect((screen.getByRole("button", { name: "Keep this filter" }) as HTMLButtonElement).disabled).toBe(true); // it's the one in use
  expect(screen.getByText(/This is the filter in use/)).toBeTruthy();
  expect(calls.length).toBe(0); // opening Settings asks Jira nothing

  fireEvent.change(box, { target: { value: "project = MP" } });
  expect(screen.getByText(/changed it and not kept it yet/)).toBeTruthy();
  expect((screen.getByLabelText("A usual filter") as HTMLSelectElement).value).toBe(""); // a filter of your own
  fireEvent.click(screen.getByRole("button", { name: "Try it" }));
  expect((await screen.findByRole("status")).textContent).toBe("Matches 2 tickets: MP-544, MP-601");
  expect(calls.at(-1)!.url).toBe(`/api/jira/tickets?jql=${encodeURIComponent("project = MP")}`);
  expect(refresh).not.toHaveBeenCalled(); // tried, not kept

  fireEvent.click(screen.getByRole("button", { name: "Keep this filter" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls.at(-1)).toEqual({ url: "/api/jira/filter", body: { jql: "project = MP" } });
  expect(screen.getByRole("status").textContent).toContain("Kept.");
  rerender(<JiraConnection S={on("saved", "project = MP")} refresh={refresh} />);
  expect(screen.getByText(/This is the filter in use/)).toBeTruthy();

  // One Jira rejects says why, and isn't kept; a usual filter is one pick away.
  fireEvent.change(box, { target: { value: "project = BROKEN" } });
  fireEvent.click(screen.getByRole("button", { name: "Try it" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Error in the JQL Query");
  fireEvent.change(screen.getByLabelText("A usual filter"), { target: { value: JIRA_PRESETS[1].jql } });
  expect(box.value).toBe(JIRA_PRESETS[1].jql);
  expect(screen.queryByRole("alert")).toBeNull();
});

const ISSUES = [{ key: "MP-544", summary: "Open button on file citations", status: "In Progress", type: "Story", updated: null, url: "https://team.atlassian.net/browse/MP-544" }];

test("picking a ticket: the ones your filter pulls in first, then a search as you type", async () => {
  vi.useFakeTimers();
  answer = (url) => ({ json: { issues: url.includes("q=nav") ? [{ ...ISSUES[0], key: "MP-601", summary: "Fix the nav" }] : ISSUES } });
  const onPick = vi.fn();
  render(<JiraPicker connected onPick={onPick} onConnect={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(calls[0].url).toBe("/api/jira/issues?q=");
  expect(screen.getByText("From your filter")).toBeTruthy();
  expect(screen.getByRole("option").textContent).toBe("MP-544Open button on file citationsStory · In Progress");
  fireEvent.change(screen.getByLabelText("Find a Jira ticket"), { target: { value: "nav" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(calls.at(-1)!.url).toBe("/api/jira/issues?q=nav");
  fireEvent.click(screen.getByRole("option"));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "MP-601" }));
});

test("what Jira says when a search fails is shown; not linked, the picker points at Settings", async () => {
  vi.useFakeTimers();
  answer = () => ({ status: 400, json: { error: "Jira refused the request. Error in the JQL Query." } });
  const { unmount } = render(<JiraPicker connected onPick={() => {}} onConnect={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(screen.getByRole("alert").textContent).toContain("Error in the JQL Query");
  unmount();
  const onConnect = vi.fn(), before = calls.length;
  render(<JiraPicker connected={false} onPick={() => {}} onConnect={onConnect} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(calls.length).toBe(before); // nothing is asked of Jira
  fireEvent.click(screen.getByRole("button", { name: "Link Jira in Settings" }));
  expect(onConnect).toHaveBeenCalled();
});
