// Acting from the full-screen view: steer, stop, send, and answer a decision, each a post to the camp.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AskNode } from "../feed/reducer.ts";
import { Decisions, Dispatch, Steer, Stop } from "./Act.tsx";

const posts: { path: string; body: unknown }[] = [];
let reply: () => Response;
const ok = (body: object = { ok: true }) => () => new Response(JSON.stringify(body), { status: 200 });
const fails = (error: string, status = 500) => () => new Response(JSON.stringify({ error }), { status });
beforeEach(() => {
  posts.length = 0;
  reply = ok();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return reply();
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const type = (label: string | RegExp, text: string) => fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: text } });

test("Steer says it to the expedition, and clears what was typed", async () => {
  render(<Steer expId="A" />);
  type("Say something to this expedition", "  use the new API  ");
  fireEvent.click(screen.getByRole("button", { name: "Say" }));
  expect((await screen.findByRole("status")).textContent).toContain("Said.");
  expect(posts).toEqual([{ path: "/api/steer", body: { id: "A", text: "use the new API" } }]);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
});

test("Steer shows why it couldn't, and keeps what you typed", async () => {
  reply = fails("No such expedition");
  render(<Steer expId="A" />);
  type("Say something to this expedition", "hello");
  fireEvent.click(screen.getByRole("button", { name: "Say" }));
  expect((await screen.findByRole("alert")).textContent).toContain("No such expedition");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("hello");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello again" } });
  expect(screen.queryByRole("alert")).toBeNull(); // typing again clears the note
});

test("nothing is sent for empty or blank text", () => {
  render(<Steer expId="A" />);
  const say = screen.getByRole("button", { name: "Say" }) as HTMLButtonElement;
  expect(say.disabled).toBe(true);
  type("Say something to this expedition", "   ");
  expect(say.disabled).toBe(true);
  fireEvent.submit(say.closest("form")!);
  expect(posts).toEqual([]);
});

const stopIt = () => fireEvent.click(screen.getByRole("button", { name: "Stop this expedition" }));

test("Stop asks once first, and sends nothing until you say yes", async () => {
  render(<Stop expId="A" />);
  stopIt();
  expect(screen.getByRole("group", { name: "Stop this expedition?" })).toBeTruthy();
  expect(posts).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Yes, stop it" }));
  await waitFor(() => expect(posts).toEqual([{ path: "/api/stop", body: { id: "A" } }]));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("Keep it going goes back to the button and sends nothing", () => {
  render(<Stop expId="A" />);
  stopIt();
  fireEvent.click(screen.getByRole("button", { name: "Keep it going" }));
  expect(screen.queryByRole("group")).toBeNull();
  expect(screen.getByRole("button", { name: "Stop this expedition" })).toBeTruthy();
  expect(posts).toEqual([]);
});

test("Stop shows why it couldn't, and can be tried again", async () => {
  reply = fails("Already over", 404);
  render(<Stop expId="A" />);
  stopIt();
  fireEvent.click(screen.getByRole("button", { name: "Yes, stop it" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Already over");
  expect((screen.getByRole("button", { name: "Stop this expedition" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Dispatch to the Quartermaster sends the text as an expedition and says it was sent", async () => {
  const onSent = vi.fn();
  render(<Dispatch id="quartermaster" name="Quartermaster" lead onSent={onSent} />);
  reply = ok({ ok: true, id: "x", position: 0, attached: 0, thread: "t" });
  type("Send the Quartermaster on an expedition", "Audit the login");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("status")).textContent).toContain("Sent. The plan shows here");
  expect(posts).toEqual([{ path: "/api/send", body: { text: "Audit the login", chat: false } }]);
  expect(onSent).toHaveBeenCalledTimes(1);
});

test("Dispatch to one of the crew addresses them by id and sends it as a chat", async () => {
  const onSent = vi.fn();
  reply = ok({ ok: true, id: "x", position: 0, attached: 0, thread: "t" });
  render(<Dispatch id="scout" name="Scout" lead={false} onSent={onSent} />);
  type("Ask Scout for something", "find the bug");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("status")).textContent).toContain("Sent to Scout.");
  expect(posts).toEqual([{ path: "/api/send", body: { text: "@scout find the bug", chat: true } }]);
  expect(onSent).toHaveBeenCalledTimes(1);
});

test("a request that's queued says how many are ahead of it, and isn't counted as sent", async () => {
  const onSent = vi.fn();
  reply = ok({ ok: true, id: "x", position: 2, attached: 0, thread: "t" });
  render(<Dispatch id="quartermaster" name="Quartermaster" lead onSent={onSent} />);
  type(/expedition/, "Later");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("status")).textContent).toContain("Queued, with 2 ahead of it.");
  expect(onSent).not.toHaveBeenCalled();
});

test("a request that fails shows the error and sends nothing on", async () => {
  const onSent = vi.fn();
  reply = fails("Busy");
  render(<Dispatch id="scout" name="Scout" lead={false} onSent={onSent} />);
  type("Ask Scout for something", "x");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Busy");
  expect(onSent).not.toHaveBeenCalled();
});

test("an empty request isn't sent", () => {
  render(<Dispatch id="scout" name="Scout" lead={false} onSent={vi.fn()} />);
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(posts).toEqual([]);
});

const ask = (id: string, over: Partial<AskNode> = {}): AskNode => ({ kind: "ask", id: `a${id}`, askId: id, askKind: "shell", title: `Run ${id}`, body: "ls", who: "Scout", outcome: null, ...over });

test("Decisions shows nothing when nothing's waiting, and a card for each decision that is", () => {
  const { container, rerender } = render(<Decisions asks={[]} />);
  expect(container.firstChild).toBeNull();
  rerender(<Decisions asks={[ask("k1")]} />);
  expect(screen.getByRole("heading", { name: "Needs your decision" })).toBeTruthy();
  rerender(<Decisions asks={[ask("k1"), ask("k2", { title: "Run k2" })]} />);
  expect(screen.getByRole("heading", { name: "2 decisions need you" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Run command" })).toHaveLength(2);
});

test("answering a decision posts the answer for that one", async () => {
  render(<Decisions asks={[ask("k1"), ask("k2")]} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Decline" })[1]);
  await waitFor(() => expect(posts).toEqual([{ path: "/api/answer", body: { id: "k2", answer: "n" } }]));
});
