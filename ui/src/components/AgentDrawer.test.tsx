// An agent's page, its chat box: one message at a time, like the main message box.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { AgentDrawer } from "./AgentDrawer.tsx";

const sends: any[] = [];
let landing: ((r: Response) => void)[] = []; // each /api/send waits here until the test lets it land
const SCOUT = { id: "scout", name: "Scout", emoji: "🔭", role: "Finds things out", model: "claude-sonnet-5", effort: "medium", xp: 10, overridden: false,
  stats: { runs: 0, successRate: null, cost: 0 }, sessions: [], runs: [] };
beforeEach(() => {
  sends.length = 0; landing = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/send") {
      sends.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((answer) => landing.push(answer));
    }
    return Promise.resolve(new Response(JSON.stringify(SCOUT)));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("a second Enter while a message is still on its way doesn't send it twice", async () => {
  render(<AgentDrawer agentId="scout" tab="chat" setTab={() => {}} S={null} store={createFeedStore()} pickerOpen={false} onOpenPicker={() => {}} onClose={() => {}} />);
  const box = await screen.findByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await screen.findByText("No conversations yet");
  const button = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  fireEvent.change(box, { target: { value: "What's new?" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(sends.length).toBe(1));
  expect(button.disabled).toBe(true);
  fireEvent.keyDown(box, { key: "Enter" });
  fireEvent.submit(box.form!);
  expect(sends).toEqual([{ text: "@scout What's new?", chat: true }]);
  await act(async () => { landing[0](new Response(JSON.stringify({ ok: true, id: "r1", position: 0, attached: 0, thread: "t1" }))); });
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(box.value).toBe("");
  expect(screen.getByText("What's new?").className).toBe("bubble you"); // said once
  // The next one goes as usual.
  fireEvent.change(box, { target: { value: "And then?" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(sends.length).toBe(2));
});

test("the memory tab links to that member's memory on the Memory page, and closes the drawer", async () => {
  const asked: unknown[] = [];
  const hear = (ev: Event) => asked.push((ev as CustomEvent).detail);
  window.addEventListener("camp:ask", hear);
  const onClose = vi.fn();
  render(<AgentDrawer agentId="scout" tab="memory" setTab={() => {}} S={null} store={createFeedStore()} pickerOpen={false} onOpenPicker={() => {}} onClose={onClose} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open in Memory" }));
  expect(asked).toEqual([{ do: "command", name: "memory", arg: "scout" }]);
  expect(onClose).toHaveBeenCalled();
  window.removeEventListener("camp:ask", hear);
});
