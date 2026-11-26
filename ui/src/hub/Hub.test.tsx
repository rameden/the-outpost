import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Hub, ago, type HubOutpost } from "./Hub.tsx";

const outpost = (over: Partial<HubOutpost>): HubOutpost => ({
  id: "_here", name: "Mae", port: 4747, dir: "/code/mae", here: true, running: false, starting: false, ours: false, crew: 5, lastActive: Date.now() - 3 * 3_600_000, since: null, ...over,
});

function serve(outposts: HubOutpost[], more: Record<string, (body: any) => { status?: number; json: object }> = {}) {
  const calls: { path: string; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const answer = path === "/api/outposts" ? { json: { outposts } } : more[path]?.(body) ?? { status: 404, json: { error: "Not found" } };
    return { ok: (answer.status ?? 200) < 400, status: answer.status ?? 200, json: async () => answer.json } as Response;
  }));
  return calls;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the star chart page", () => {
  it("shows a star for each outpost, and says which are running", async () => {
    serve([outpost({}), outpost({ id: "work", name: "Work", port: 4748, here: false, running: true })]);
    render(<Hub />);
    expect(await screen.findByRole("button", { name: "Outpost Mae, stopped" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Outpost Work, running" })).toBeTruthy();
    expect(screen.getByText("2 outposts · 1 running")).toBeTruthy();
  });

  it("tells about the outpost you pick, then launches it and goes there", async () => {
    const calls = serve([outpost({}), outpost({ id: "work", name: "Work", port: 4748, dir: "/home/me/Outposts/work", here: false, crew: 3 })], {
      "/api/launch": () => ({ json: { url: "http://127.0.0.1:4748/#k=abc" } }),
    });
    const go = vi.fn();
    render(<Hub go={go} />);
    fireEvent.click(await screen.findByRole("button", { name: "Outpost Work, stopped" }));
    expect(screen.getByRole("heading", { name: "Outpost Work" })).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
    expect(screen.getByText("3 hours ago")).toBeTruthy();
    expect(screen.getByText("localhost:4748")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://127.0.0.1:4748/#k=abc"));
    expect(calls.find((c) => c.path === "/api/launch")?.body).toEqual({ id: "work" });
  });

  it("launches an outpost on a double-click, though the chart moves under the second click", async () => {
    const calls = serve([outpost({}), outpost({ id: "work", name: "Work", port: 4748, here: false })], {
      "/api/launch": () => ({ json: { url: "http://127.0.0.1:4748/#k=abc" } }),
    });
    const go = vi.fn();
    render(<Hub go={go} />);
    fireEvent.click(await screen.findByRole("button", { name: "Outpost Work, stopped" }), { clientX: 300, clientY: 200 });
    // The panel opened and the chart moved over: the second click lands on the sky where Work was.
    fireEvent.click(screen.getByRole("main"), { clientX: 302, clientY: 201 });
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://127.0.0.1:4748/#k=abc"));
    expect(calls.find((c) => c.path === "/api/launch")?.body).toEqual({ id: "work" });
  });

  it("doesn't launch when two clicks are far apart", async () => {
    const calls = serve([outpost({})]);
    render(<Hub />);
    fireEvent.click(await screen.findByRole("button", { name: "Outpost Mae, stopped" }), { clientX: 300, clientY: 200 });
    fireEvent.click(screen.getByRole("main"), { clientX: 500, clientY: 400 });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.find((c) => c.path === "/api/launch")).toBeUndefined();
  });

  it("offers Enter for one that's running, and Stop only when the chart started it", async () => {
    serve([outpost({ running: true }), outpost({ id: "work", name: "Work", here: false, running: true, ours: true })]);
    render(<Hub />);
    fireEvent.click(await screen.findByRole("button", { name: "Outpost Mae, running" }));
    expect(screen.getByRole("button", { name: "Enter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Outpost Work, running" }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("says why when an outpost doesn't start", async () => {
    serve([outpost({})], { "/api/launch": () => ({ status: 500, json: { error: "Outpost Mae didn't start." } }) });
    const go = vi.fn();
    render(<Hub go={go} />);
    fireEvent.click(await screen.findByRole("button", { name: "Outpost Mae, stopped" }));
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Outpost Mae didn't start.");
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy();
  });

  it("charts a new outpost and picks it", async () => {
    const work = outpost({ id: "work", name: "Work", port: 4748, here: false, crew: null, lastActive: null });
    const calls = serve([outpost({})], { "/api/new": () => ({ json: { id: "work", outposts: [outpost({}), work] } }) });
    render(<Hub />);
    fireEvent.click(await screen.findByRole("button", { name: "New outpost" }));
    fireEvent.change(screen.getByLabelText("Name the new outpost"), { target: { value: "Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Make" }));
    expect(await screen.findByRole("heading", { name: "Outpost Work" })).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/new")?.body).toEqual({ name: "Work" });
    expect(screen.getByText(/A new outpost: it starts empty/)).toBeTruthy();
  });

  it("says how long ago in plain words", () => {
    const now = Date.UTC(2026, 10, 23, 12);
    expect(ago(now - 30_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(ago(now - 3_600_000, now)).toBe("1 hour ago");
    expect(ago(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});
