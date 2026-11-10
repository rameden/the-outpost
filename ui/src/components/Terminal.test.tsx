// The terminal pane's own behaviour: it picks up the camp's sessions (or starts one, in your
// project's folder), switches and closes tabs, and hides without ending anything.
// xterm.js itself needs a real browser to draw, so a stand-in takes its place here.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const made: { opened: boolean; written: string[]; onData?: (d: string) => void }[] = [];
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80; rows = 24; options: Record<string, unknown> = {};
    me = { opened: false, written: [] as string[], onData: undefined as ((d: string) => void) | undefined };
    constructor() { made.push(this.me); }
    loadAddon() {} focus() {} dispose() {}
    open() { this.me.opened = true; }
    write(d: string) { this.me.written.push(d); }
    onData(fn: (d: string) => void) { this.me.onData = fn; return { dispose() {} }; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const { TerminalPanel, TerminalRail } = await import("./Terminal.tsx");

let sessions: { id: string; title: string; cwd: string; exited: number | null }[] = [];
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
      const t = { id: `t${sessions.length + 1}`, title: body.project ? "mi-web-app" : "satchel", cwd: "/x", exited: null };
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
  fireEvent.click(screen.getByRole("button", { name: "Hide the terminal" }));
  expect(onHide).toHaveBeenCalled();
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
