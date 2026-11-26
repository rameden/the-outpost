// Changing an earlier message and sending it again: the conversation is forked just before it, the
// changed message goes in the copy, and the files are put back only if you say so.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hear, type Ask } from "../bus.ts";
import { Resend, resendPlan, useEditAsk, type ResendFrom } from "./EditAsk.tsx";
import type { ExpNode } from "./reducer.ts";

const calls: { path: string; body: any }[] = [];
let heard: Ask[] = [];
let unhear = () => {};
beforeEach(() => {
  calls.length = 0; heard = [];
  unhear = hear((a) => heard.push(a));
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path: url, body });
    const r = url === "/api/fork" ? { ok: true, thread: "t-copy", expedition: "r1-fab", restored: [], skipped: [] }
      : { ok: true, id: "new", position: 0, attached: 0, thread: body.replyTo ? "t-copy" : "t-fresh" };
    return Promise.resolve(new Response(JSON.stringify(r)));
  }));
});
afterEach(() => { unhear(); cleanup(); vi.unstubAllGlobals(); });

const run = (expId: string, more: Partial<ExpNode> = {}): ExpNode => ({ kind: "exp", id: `n-${expId}`, expId, task: `Asked in ${expId}`, source: "user", followUp: false,
  attachments: [], time: "", nodes: [], end: { status: "done", seconds: 1, changed: 0, workspaces: {} as any }, ...more });

function Harness({ exp }: { exp: ExpNode }) {
  const { button, editor } = useEditAsk(exp);
  return <div>{editor}{button}</div>;
}
const draw = (exp: ExpNode, from: ResendFrom | null = { runs: ["r1", "r2", "r3"], project: "p1", busy: false }) =>
  render(<Resend.Provider value={from}><Harness exp={exp} /></Resend.Provider>);

test("resendPlan: the run before, and how many come after", () => {
  expect(resendPlan(["r1", "r2", "r3"], "r2")).toEqual({ before: "r1", later: 1 });
  expect(resendPlan(["r1", "r2", "r3"], "r1")).toEqual({ before: null, later: 2 });
});

test("Edit is there for a finished message of yours in a conversation, and nowhere else", () => {
  draw(run("r2"));
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  cleanup();
  draw(run("r2"), null); // All runs: not a conversation
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  cleanup();
  draw(run("r2", { source: "job", job: "nightly" }));
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  cleanup();
  draw(run("r2"), { runs: ["r1", "r2", "r3"], busy: true }); // a run in the conversation is still going
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});

test("a changed message is sent in a copy of the conversation up to the one before, files left as they are", async () => {
  draw(run("r2", { attachments: [{ kind: "file", name: "a.txt", path: "camp/uploads/a.txt" }, { kind: "note", name: "pasted" }] }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getByRole("textbox", { name: "Your message, changed" }) as HTMLTextAreaElement;
  expect(box.value).toBe("Asked in r2");
  expect(screen.getByText(/This conversation stays as it is/)).toBeTruthy();
  expect((screen.getByRole("radio", { name: /Leave them as they are now/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("radio", { name: /this run and the 1 after it changed/ })).toBeTruthy();
  fireEvent.change(box, { target: { value: "Asked better" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
  await waitFor(() => expect(calls).toEqual([
    { path: "/api/fork", body: { id: "r1", rewind: false } },
    { path: "/api/send", body: { text: "Asked better", attachments: [{ kind: "file", name: "a.txt", path: "camp/uploads/a.txt" }], replyTo: "r1-fab" } },
  ]));
  expect(heard).toContainEqual({ do: "open-conversation", id: "t-copy" });
});

test("putting the files back asks first, then forks with them put back", async () => {
  draw(run("r2"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("radio", { name: /this run and the 1 after it changed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(calls).toEqual([]); // not yet
  expect(screen.getByRole("alertdialog").textContent).toContain("this run and the 1 run after it");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Put back and send" })); });
  await waitFor(() => expect(calls[0]).toEqual({ path: "/api/fork", body: { id: "r1", rewind: true } }));
});

test("the first message has nothing before it: it starts a new conversation in the same project", async () => {
  draw(run("r1"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByText(/This is the first message, so it starts a new conversation/)).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
  await waitFor(() => expect(calls).toEqual([{ path: "/api/send", body: { text: "Asked in r1", attachments: [], project: "p1" } }]));
  expect(heard).toContainEqual({ do: "open-conversation", id: "t-fresh" });
});

test("Esc or Cancel leaves it as it was", () => {
  draw(run("r2"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(calls).toEqual([]);
});
