import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Hub, TOUR, ago, tourOf, type HubOutpost } from "./Hub.tsx";

const outpost = (over: Partial<HubOutpost>): HubOutpost => ({
  id: "_here", name: "Mae", port: 4747, dir: "/code/mae", here: true, running: false, starting: false, ours: false, crew: 6, lastActive: Date.now() - 3 * 3_600_000, since: null, ...over,
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
    const calls = serve([outpost({}), outpost({ id: "work", name: "Work", port: 4748, dir: "/home/me/Outposts/work", here: false, crew: 8 })], {
      "/api/launch": () => ({ json: { url: "http://127.0.0.1:4748/#k=abc" } }),
    });
    const go = vi.fn();
    render(<Hub go={go} />);
    fireEvent.click(await screen.findByRole("button", { name: "Outpost Work, stopped" }));
    expect(screen.getByRole("heading", { name: "Outpost Work" })).toBeTruthy();
    expect(screen.getByText("8 members")).toBeTruthy();
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

  it("can say what a new outpost is for, and shows it on the outpost's card", async () => {
    const about = "The payments team at Acme.";
    const work = outpost({ id: "work", name: "Work", port: 4748, here: false, crew: null, lastActive: null, description: about });
    const calls = serve([outpost({})], { "/api/new": () => ({ json: { id: "work", outposts: [outpost({}), work] } }) });
    render(<Hub />);
    fireEvent.click(await screen.findByRole("button", { name: "New outpost" }));
    fireEvent.change(screen.getByLabelText("Name the new outpost"), { target: { value: "Work" } });
    fireEvent.change(screen.getByLabelText(/What it's for/), { target: { value: about } });
    fireEvent.click(screen.getByRole("button", { name: "Make" }));
    expect(await screen.findByRole("heading", { name: "Outpost Work" })).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/new")?.body).toEqual({ name: "Work", description: about });
    expect(screen.getByText(about)).toBeTruthy();
  });

  it("says how long ago in plain words", () => {
    const now = Date.UTC(2026, 10, 23, 12);
    expect(ago(now - 30_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(ago(now - 3_600_000, now)).toBe("1 hour ago");
    expect(ago(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});

describe("the star chart's first words: what The Outpost is, and what to do next", () => {
  const about = () => within(screen.getByRole("region", { name: "About The Outpost" }));
  // The line under the sentence, once the chart has been read ("Reading the chart…" is a status too).
  const nextStep = async () => within(await waitFor(() => {
    const line = within(screen.getByRole("region", { name: "About The Outpost" })).getByRole("status");
    return line;
  }));

  it("says what The Outpost is in a sentence, with the Tour a click away", async () => {
    serve([outpost({})]);
    render(<Hub />);
    await screen.findByRole("button", { name: "Outpost Mae, stopped" });
    expect(about().getByText(/^The Outpost is a team of AI agents that works on your own machine: you ask, a lead plans the work and hands it to the team, and anything that matters waits for your OK\./)).toBeTruthy();
    const tour = about().getByRole("link", { name: "Take the Tour" });
    expect(tour.getAttribute("href")).toBe("https://outpostmae.app/about"); // nothing is running to serve it, so the public one
    expect(tour.getAttribute("target")).toBe("_blank");
  });

  it("the Tour is the running outpost's own page when one is running, and the public one otherwise", async () => {
    const stopped = outpost({}), running = outpost({ id: "work", name: "Work", port: 4748, here: false, running: true });
    expect(TOUR).toBe("https://outpostmae.app/about");
    expect(tourOf(null)).toBe(TOUR);
    expect(tourOf([])).toBe(TOUR);
    expect(tourOf([stopped])).toBe(TOUR);
    expect(tourOf([stopped, running], "mae.local")).toBe("http://mae.local:4748/splash");
    serve([stopped, running]);
    render(<Hub />);
    await screen.findByRole("button", { name: "Outpost Work, running" });
    expect(about().getByRole("link", { name: "Take the Tour" }).getAttribute("href")).toBe(`http://${location.hostname}:4748/splash`);
  });

  it("with no outposts yet, it says so and Make an outpost opens the naming panel", async () => {
    serve([]);
    render(<Hub />);
    const next = await nextStep();
    expect(next.getByText("There are no outposts yet.")).toBeTruthy();
    expect(next.getByText("Make your first one: it starts empty, with a team, memory and settings of its own.")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "A new outpost" })).toBeNull();
    fireEvent.click(next.getByRole("button", { name: "Make an outpost" }));
    expect(screen.getByRole("complementary", { name: "A new outpost" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Name the new outpost"));
    // While you're naming one, the line steps aside; the sentence about The Outpost stays.
    expect(screen.queryByText("There are no outposts yet.")).toBeNull();
    expect(about().getByRole("link", { name: "Take the Tour" })).toBeTruthy();
  });

  it("with none running, it offers to launch the one you were in last", async () => {
    const calls = serve([outpost({ lastActive: Date.now() - 5 * 3_600_000 }), outpost({ id: "work", name: "Work", port: 4748, here: false, lastActive: Date.now() - 3_600_000 })], {
      "/api/launch": () => ({ json: { url: "http://127.0.0.1:4748/#k=abc" } }),
    });
    const go = vi.fn();
    render(<Hub go={go} />);
    const next = await nextStep();
    expect(next.getByText("No outpost is running.")).toBeTruthy();
    expect(next.getByText("Launch one to go in: it starts, and this page takes you to it, signed in. Or pick another on the chart.")).toBeTruthy();
    expect(next.queryByRole("button", { name: /^Enter/ })).toBeNull();
    fireEvent.click(next.getByRole("button", { name: "Launch Work" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://127.0.0.1:4748/#k=abc"));
    expect(calls.find((c) => c.path === "/api/launch")?.body).toEqual({ id: "work" });
  });

  it("with only one outpost and it stopped, there's no other to pick; while one is starting it says that and offers nothing", async () => {
    serve([outpost({})]);
    const { unmount } = render(<Hub />);
    const next = await nextStep();
    expect(next.getByText("Launch one to go in: it starts, and this page takes you to it, signed in.")).toBeTruthy();
    expect(next.getByRole("button", { name: "Launch Mae" })).toBeTruthy();
    unmount();
    serve([outpost({ starting: true })]);
    render(<Hub />);
    const wait = await nextStep();
    expect(wait.getByText("An outpost is starting…")).toBeTruthy();
    expect(wait.queryByRole("button")).toBeNull();
  });

  it("with some running, it says how many and offers to enter the running one you were in last", async () => {
    const calls = serve([
      outpost({ lastActive: Date.now() - 60_000 }), // the latest of all, but stopped
      outpost({ id: "work", name: "Work", port: 4748, here: false, running: true, lastActive: Date.now() - 2 * 3_600_000 }),
      outpost({ id: "play", name: "Play", port: 4749, here: false, running: true, lastActive: Date.now() - 3_600_000 }),
    ], { "/api/launch": () => ({ json: { url: "http://127.0.0.1:4749/#k=abc" } }) });
    const go = vi.fn();
    render(<Hub go={go} />);
    const next = await nextStep();
    expect(next.getByText("2 of 3 are running.")).toBeTruthy();
    expect(next.getByText("Go into one that's running, or pick another on the chart to launch it.")).toBeTruthy();
    expect(next.queryByRole("button", { name: /^Launch/ })).toBeNull();
    fireEvent.click(next.getByRole("button", { name: "Enter Play" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://127.0.0.1:4749/#k=abc"));
    expect(calls.find((c) => c.path === "/api/launch")?.body).toEqual({ id: "play" });
  });

  it("one of one running reads in the singular", async () => {
    serve([outpost({ running: true })]);
    render(<Hub />);
    const next = await nextStep();
    expect(next.getByText("1 of 1 is running.")).toBeTruthy();
    expect(next.getByRole("button", { name: "Enter Mae" })).toBeTruthy();
  });
});
