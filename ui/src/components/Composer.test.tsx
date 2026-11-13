// Sending from the message box: one send at a time, a Reply that doesn't follow you into another
// conversation, and what the page says back ("Queued…") shown by the box, not only in All activity.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import type { CampState } from "../types.ts";
import { Composer, type ComposerHandle, type SendContext } from "./Composer.tsx";
import { forgetModelLists } from "./ModelPicker.tsx";
import { StatusLine } from "./StatusLine.tsx";

const sends: any[] = [];
let landing: ((r: Response) => void)[] = []; // each /api/send waits here until the test lets it land
let position = 0;
beforeEach(() => {
  sends.length = 0; landing = []; position = 0;
  localStorage.clear();
  forgetModelLists();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/send") {
      sends.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((answer) => landing.push(answer));
    }
    return Promise.resolve(new Response(JSON.stringify(url === "/api/repos" ? { repos: [] } : { live: true, models: [], files: [] })));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const S = { characters: [], links: [], running: [], queued: [], parallel: 3, pausedUntil: null, runtime: "api", providers: [], snippets: [],
  history: { projects: [{ id: "general", name: "General" }], conversations: [] } } as unknown as CampState;
const land = (n: number) => act(async () => { landing[n](new Response(JSON.stringify({ ok: true, id: `run${n}`, position, attached: 0, thread: `t${n}` }))); });

function setup(context: SendContext = { placeholder: "Ask…" }, draftKey = "new:") {
  const ref = createRef<ComposerHandle>();
  const store = createFeedStore();
  const onSent = vi.fn();
  const props = { S, store, refresh: () => {}, patch: () => {}, onSent };
  const view = render(<><StatusLine /><Composer ref={ref} {...props} context={context} draftKey={draftKey} /></>);
  const go = (context: SendContext, draftKey: string) => view.rerender(<><StatusLine /><Composer ref={ref} {...props} context={context} draftKey={draftKey} /></>);
  const write = (text: string) => act(() => ref.current!.setText(text));
  const submit = () => fireEvent.submit(view.container.querySelector("form.composer-box")!);
  const button = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  return { ref, store, onSent, go, write, submit, button };
}

test("a second Enter while a message is still on its way doesn't send it twice", async () => {
  const { write, submit, button, onSent } = setup();
  write("Ship it");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(button().disabled).toBe(true);
  submit();
  submit();
  expect(sends.length).toBe(1);
  await land(0);
  await waitFor(() => expect(button().disabled).toBe(false));
  expect(onSent).toHaveBeenCalledTimes(1);
  // Once it has landed, the next one goes as usual.
  write("And the next");
  submit();
  await waitFor(() => expect(sends.length).toBe(2));
  expect(sends.map((s) => s.text)).toEqual(["Ship it", "And the next"]);
  await land(1);
});

test("a send that fails says why and lets you send again", async () => {
  const { write, submit, button } = setup();
  write("Ship it");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  await act(async () => { landing[0](new Response(JSON.stringify({ error: "The camp is paused" }), { status: 409 })); });
  expect(await screen.findByText("The camp is paused")).toBeTruthy();
  expect(button().disabled).toBe(false);
  submit();
  await waitFor(() => expect(sends.length).toBe(2));
  await land(1);
});

test("Reply names a run where you pressed it: opening another conversation lets go of it", async () => {
  const { ref, go, write, submit } = setup({ replyTo: "run-a2", placeholder: "Reply…" }, "c:a");
  act(() => ref.current!.setReply("run-a1", "The first request"));
  expect(screen.getByText("Following up on")).toBeTruthy();
  expect(screen.getByText("The first request")).toBeTruthy();
  go({ replyTo: "run-b1", placeholder: "Reply…" }, "c:b");
  expect(screen.queryByText("Following up on")).toBeNull();
  write("About B");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0].replyTo).toBe("run-b1"); // conversation B's own latest run, not the one picked in A
  await land(0);
});

test("a Reply pressed here still goes to the run it names", async () => {
  const { ref, write, submit } = setup({ replyTo: "run-a2", placeholder: "Reply…" }, "c:a");
  act(() => ref.current!.setReply("run-a1", "The first request"));
  write("More on that");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0].replyTo).toBe("run-a1");
  await land(0);
  await waitFor(() => expect(screen.queryByText("Following up on")).toBeNull());
});

test("a queued message says so by the message box, and in the feed for All activity", async () => {
  position = 2;
  const { store, write, submit } = setup();
  write("One more");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  await land(0);
  const said = "Queued (#2): 3 expeditions are already running, so it starts when one finishes";
  expect((await screen.findByRole("status")).textContent).toContain(said);
  expect(store.getState().items.at(-1)).toMatchObject({ kind: "sys", text: said });
});
