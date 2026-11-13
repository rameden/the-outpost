// The terminal pane's own behaviour: it picks up the camp's sessions (or starts one, in your
// project's folder), switches and closes tabs, and hides without ending anything.
// xterm.js itself needs a real browser to draw, so a stand-in takes its place here.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const made: { opened: boolean; written: string[]; resets: number; onData?: (d: string) => void }[] = [];
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80; rows = 24; options: Record<string, unknown> = {};
    me = { opened: false, written: [] as string[], resets: 0, onData: undefined as ((d: string) => void) | undefined };
    constructor() { made.push(this.me); }
    loadAddon() {} focus() {} dispose() {}
    open() { this.me.opened = true; }
    write(d: string) { this.me.written.push(d); }
    reset() { this.me.resets++; this.me.written.length = 0; }
    onData(fn: (d: string) => void) { this.me.onData = fn; return { dispose() {} }; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const { TerminalPanel, TerminalRail, actionInput, actionTitle } = await import("./Terminal.tsx");

let sessions: { id: string; title: string; cwd: string; exited: number | null; last?: string; action?: string; locked?: boolean }[] = [];
const posts: { path: string; body: any }[] = [];
const streams: { url: string; listeners: Record<string, (m: { data: string }) => void>; closed: boolean }[] = [];
beforeEach(() => {
  sessions = []; posts.length = 0; streams.length = 0; made.length = 0;
  localStorage.clear();
  vi.stubGlobal("EventSource", class {
    me: (typeof streams)[number];
    constructor(url: string) { this.me = { url, listeners: {}, closed: false }; streams.push(this.me); }
    addEventListener(name: string, fn: (m: { data: string }) => void) { this.me.listeners[name] = fn; }
    close() { this.me.closed = true; }
  });
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === "POST") posts.push({ path, body });
    if (path === "/api/term") return new Response(JSON.stringify({ terminals: sessions }));
    if (path === "/api/term/open") {
      const t = { id: `t${sessions.length + 1}`, title: body.title ?? (body.project ? "mi-web-app" : "satchel"), cwd: "/x", exited: null, ...(body.action ? { action: body.action } : {}), ...(body.locked ? { locked: true } : {}) };
      sessions.push(t);
      return new Response(JSON.stringify(t));
    }
    return new Response(JSON.stringify({ ok: true }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tabs = () => screen.getAllByRole("tab").map((t) => `${t.textContent}${t.getAttribute("aria-selected") === "true" ? " *" : ""}`);

test("with nothing open it starts a session in your project's folder, and what you type goes to it", async () => {
  render(<TerminalPanel project="p1" onHide={() => {}} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: mi-web-app *"]));
  expect(posts[0]).toEqual({ path: "/api/term/open", body: { project: "p1", cols: 100, rows: 24 } });
  await vi.waitFor(() => expect(streams[0]?.url).toContain("/api/term/stream?id=t1"));
  streams[0].listeners.data({ data: JSON.stringify("hello\r\n") });
  expect(made[0].written).toEqual(["hello\r\n"]);
  made[0].onData!("ls\r");
  await vi.waitFor(() => expect(posts.find((p) => p.path === "/api/term/input")?.body).toEqual({ id: "t1", data: "ls\r" }));
});

test("it picks up sessions the camp already has, opens more, and closing a tab ends that shell", async () => {
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }, { id: "b", title: "mi-web-app", cwd: "/b", exited: null }];
  render(<TerminalPanel onHide={() => {}} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: mi-web-app *"]));
  expect(posts).toEqual([]); // nothing new was started
  fireEvent.click(screen.getByRole("tab", { name: /1: satchel/ }));
  expect(tabs()).toEqual(["1: satchel *", "2: mi-web-app"]);
  fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: mi-web-app", "3: satchel *"]));
  fireEvent.click(screen.getByRole("button", { name: "Close terminal 3" }));
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: mi-web-app *"]));
  expect(posts.at(-1)).toEqual({ path: "/api/term/close", body: { id: "t3" } });
});

test("hiding the pane closes nothing; a shell that ends says so", async () => {
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }];
  const onHide = vi.fn();
  render(<TerminalPanel onHide={onHide} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel *"]));
  fireEvent.click(screen.getByRole("tab", { name: /1: satchel/ }));
  expect(onHide).not.toHaveBeenCalled(); // a tab is a tab, not the header
  fireEvent.click(document.querySelector(".term-tabs")!); // the empty header beside the tabs
  expect(onHide).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Hide the terminal" }));
  expect(onHide).toHaveBeenCalledTimes(2);
  expect(posts.filter((p) => p.path === "/api/term/close")).toEqual([]);
  await vi.waitFor(() => expect(streams[0]?.listeners.exit).toBeTruthy());
  streams[0].listeners.exit({ data: JSON.stringify({ code: 0 }) });
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel (ended) *"]));
  expect(made[0].written.at(-1)).toMatch(/The shell ended/);
});

test("while it's hidden, its tab brings it back", () => {
  const onShow = vi.fn();
  render(<TerminalRail onShow={onShow} />);
  fireEvent.click(screen.getByRole("button", { name: "Show terminal" }));
  expect(onShow).toHaveBeenCalled();
});

test("the hidden tab shows the last line of the terminal you last had open, and keeps it current", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null, last: "nothing to commit, working tree clean" },
      { id: "b", title: "web", cwd: "/b", exited: null, last: "VITE ready in 180 ms" }];
    localStorage.setItem("camp-term-tab", "a");
    const { container } = render(<TerminalRail onShow={() => {}} />);
    await vi.waitFor(() => expect(container.querySelector(".rail-peek")?.textContent).toBe("nothing to commit, working tree clean"));
    expect(screen.getByRole("button", { name: "Show terminal" }).title).toMatch(/^Last line: nothing to commit/);

    sessions[0] = { ...sessions[0], last: "3 files changed", exited: 0 };
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(container.querySelector(".rail-peek")?.textContent).toBe("3 files changed (ended)"));

    sessions = sessions.slice(1); // that one was closed: the newest one left stands in
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(container.querySelector(".rail-peek")?.textContent).toBe("VITE ready in 180 ms"));

    sessions = [];
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(container.querySelector(".rail-peek")).toBeNull());
    expect(screen.getByRole("button", { name: "Show terminal" }).textContent).toBe("Terminal");
  } finally { vi.useRealTimers(); }
});

const PUSH = { label: "Push", commands: ["git push origin HEAD"], where: "current" as const };
const DEV = { label: "Dev", commands: ["pnpm install", "pnpm dev:production"], where: "new" as const, folder: "mi-web-app", sub: "apps/root" };
const CHECK = { label: "Check", commands: ["pnpm lint", "pnpm test"], where: "current" as const, ask: true };

test("a quick action is typed as one chain, with Enter unless it's left to you", () => {
  expect(actionInput(PUSH)).toBe("git push origin HEAD\r");
  expect(actionInput(DEV)).toBe("pnpm install && pnpm dev:production\r");
  expect(actionInput(CHECK)).toBe("pnpm lint && pnpm test"); // typed, and waits
  expect(actionTitle(PUSH, false)).toBe("Runs in this terminal:\n\ngit push origin HEAD");
  expect(actionTitle(DEV, false)).toBe("Runs in a new terminal, in mi-web-app/apps/root:\n\npnpm install\npnpm dev:production");
  expect(actionTitle(CHECK, false)).toMatch(/^Types in this terminal, and waits for you to press Enter:/);
  expect(actionTitle(DEV, true)).toMatch(/^Dev has its own tab open: click to go to it\. Click again while you're there to run it again in that tab\./);
});

test("quick action chips: one runs in the terminal you're looking at, one opens its own (and leads back to it while it's going)", async () => {
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }];
  const onSetUp = vi.fn();
  render(<TerminalPanel project="p1" onHide={() => {}} actions={[PUSH, DEV, CHECK]} onSetUp={onSetUp} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel *"]));
  const chips = () => within(screen.getByRole("group", { name: "Quick actions" })).getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"));
  expect(chips()).toEqual(["Push", "Dev", "Check", "Set up quick actions"]);

  // In this terminal: typed into the tab that's showing, and run.
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/input", body: { id: "a", data: "git push origin HEAD\r" } }));
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/input", body: { id: "a", data: "pnpm lint && pnpm test" } }));
  expect(tabs()).toEqual(["1: satchel *"]);

  // A new terminal: its own tab, named for the chip, in its folder, with the chain typed in.
  fireEvent.click(screen.getByRole("button", { name: "Dev" }));
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: Dev *"]));
  expect(posts.at(-1)).toEqual({ path: "/api/term/open", body: { project: "p1", cols: 100, rows: 24, folder: "mi-web-app", sub: "apps/root", title: "Dev", action: "Dev", locked: true, type: "pnpm install && pnpm dev:production\r" } });
  // Clicked again while it's going: back to its tab, not a second dev server.
  fireEvent.click(screen.getByRole("tab", { name: /1: satchel/ }));
  const before = posts.length;
  expect(screen.getByRole("button", { name: "Dev" }).className).toContain("live");
  fireEvent.click(screen.getByRole("button", { name: "Dev" }));
  expect(tabs()).toEqual(["1: satchel", "2: Dev *"]);
  expect(posts.length).toBe(before);
  // And again, now that you're looking at its tab: it runs again right there.
  fireEvent.click(screen.getByRole("button", { name: "Dev" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/input", body: { id: "t2", data: "pnpm install && pnpm dev:production\r" } }));
  expect(tabs()).toEqual(["1: satchel", "2: Dev *"]);
  // Once that shell has ended, the chip starts a fresh one.
  streams.at(-1)!.listeners.exit({ data: JSON.stringify({ code: 0 }) });
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Dev" }).className).not.toContain("live"));
  fireEvent.click(screen.getByRole("button", { name: "Dev" }));
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: Dev (ended)", "3: Dev *"]));
  // "In this terminal" with a shell that has ended gets a fresh terminal instead of typing into nothing.
  fireEvent.click(screen.getByRole("tab", { name: /2: Dev/ }));
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/open", body: { project: "p1", cols: 100, rows: 24, type: "git push origin HEAD\r" } }));

  fireEvent.click(screen.getByRole("button", { name: "Set up quick actions" }));
  expect(onSetUp).toHaveBeenCalledTimes(1);
});

test("with no quick actions there's a way to set them up, and clicking a chip doesn't hide the pane", async () => {
  const onHide = vi.fn();
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }];
  const { rerender } = render(<TerminalPanel onHide={onHide} onSetUp={() => {}} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel *"]));
  expect(screen.getByRole("button", { name: "Set up quick actions" }).textContent).toBe("Quick actions");
  rerender(<TerminalPanel onHide={onHide} actions={[PUSH]} onSetUp={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  expect(onHide).not.toHaveBeenCalled();
});

test("a locked terminal: a quick action doesn't type into it, and a warning asks where it should go instead", async () => {
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }];
  render(<TerminalPanel project="p1" onHide={() => {}} actions={[PUSH, DEV]} onSetUp={() => {}} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel *"]));
  // Lock it from its tab; the camp keeps that with the session.
  const lockBtn = screen.getByRole("button", { name: "Lock terminal 1" });
  expect(lockBtn.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(lockBtn);
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/lock", body: { id: "a", on: true } }));
  expect(screen.getByRole("button", { name: "Unlock terminal 1" }).getAttribute("aria-pressed")).toBe("true");

  // Push would have typed into it: it doesn't, and says so.
  const before = posts.length;
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  const warning = screen.getByRole("alertdialog", { name: "Terminal 1 (satchel) is locked" });
  expect(warning.textContent).toContain("Push wasn't run. You locked this terminal so quick actions don't type into it.");
  expect(within(warning).getByText("git push origin HEAD")).toBeTruthy();
  expect(posts.length).toBe(before);
  // Cancel: nothing happens, and it stays locked.
  fireEvent.click(within(warning).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(posts.length).toBe(before);

  // Somewhere else: a fresh terminal gets it, and the locked one is untouched.
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Run in a new terminal" }));
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: mi-web-app *"]));
  expect(posts.at(-1)).toEqual({ path: "/api/term/open", body: { project: "p1", cols: 100, rows: 24, type: "git push origin HEAD\r" } });
  expect(posts.some((p) => p.path === "/api/term/input")).toBe(false);

  // Here after all: it's unlocked first, then run.
  fireEvent.click(screen.getByRole("tab", { name: /1: satchel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Unlock and run here" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/input", body: { id: "a", data: "git push origin HEAD\r" } }));
  expect(posts.at(-2)).toEqual({ path: "/api/term/lock", body: { id: "a", on: false } });
  expect(screen.getByRole("button", { name: "Lock terminal 1" })).toBeTruthy();
});

test("a terminal a chip opened for itself starts locked: other chips are stopped there, its own chip isn't", async () => {
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }];
  render(<TerminalPanel onHide={() => {}} actions={[PUSH, DEV]} onSetUp={() => {}} />);
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel *"]));
  fireEvent.click(screen.getByRole("button", { name: "Dev" }));
  await vi.waitFor(() => expect(tabs()).toEqual(["1: satchel", "2: Dev *"]));
  expect(screen.getByRole("button", { name: "Unlock terminal 2" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Lock terminal 1" })).toBeTruthy(); // a terminal of your own isn't
  // Push, while you're looking at the dev server's tab: stopped.
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  expect(screen.getByRole("alertdialog", { name: "Terminal 2 (Dev) is locked" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  // Dev's own chip still runs there.
  fireEvent.click(screen.getByRole("button", { name: "Dev" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/term/input", body: { id: "t2", data: "pnpm install && pnpm dev:production\r" } }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("when the stream reconnects, the screen is cleared before the camp sends the session's output again", async () => {
  sessions = [{ id: "a", title: "satchel", cwd: "/a", exited: null }];
  render(<TerminalPanel onHide={() => {}} />);
  await vi.waitFor(() => expect(streams[0]?.url).toContain("/api/term/stream?id=a"));
  const stream = streams[0].listeners;
  // The first connection: what the session has printed so far fills the screen.
  stream.open({ data: "" });
  stream.data({ data: JSON.stringify("$ npm test\r\n") });
  expect(made[0].resets).toBe(0);
  expect(made[0].written).toEqual(["$ npm test\r\n"]);
  // The connection drops and comes back: the camp sends all of it again, plus what's new.
  stream.open({ data: "" });
  expect(made[0].resets).toBe(1);
  stream.data({ data: JSON.stringify("$ npm test\r\nok\r\n") });
  expect(made[0].written).toEqual(["$ npm test\r\nok\r\n"]); // once, not under a copy of itself
});
