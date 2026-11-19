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
const steers: any[] = [];
const zips: any[] = [];
let landing: ((r: Response) => void)[] = []; // each /api/send waits here until the test lets it land
let position = 0;
beforeEach(() => {
  sends.length = 0; steers.length = 0; zips.length = 0; landing = []; position = 0;
  localStorage.clear();
  forgetModelLists();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/send") {
      sends.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((answer) => landing.push(answer));
    }
    if (url === "/api/upload/zip") {
      zips.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response(JSON.stringify({ path: "camp/uploads/b1/site", name: "site", count: 3, batch: "b1" })));
    }
    if (url === "/api/steer" || url === "/api/stop") {
      steers.push({ path: url, ...JSON.parse(String(init?.body)) });
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    }
    return Promise.resolve(new Response(JSON.stringify(url === "/api/repos" ? { repos: [] } : { live: true, models: [], files: [] })));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const S = { characters: [], links: [], running: [], queued: [], parallel: 3, pausedUntil: null, runtime: "api", providers: [], snippets: [],
  history: { projects: [{ id: "general", name: "General" }], conversations: [] } } as unknown as CampState;
const land = (n: number) => act(async () => { landing[n](new Response(JSON.stringify({ ok: true, id: `run${n}`, position, attached: 0, thread: `t${n}` }))); });

function setup(context: SendContext = { placeholder: "Ask…" }, draftKey = "new:", state: CampState = S) {
  const ref = createRef<ComposerHandle>();
  const store = createFeedStore();
  const onSent = vi.fn();
  const props = { S: state, store, refresh: () => {}, patch: () => {}, onSent };
  const view = render(<><StatusLine /><Composer ref={ref} {...props} context={context} draftKey={draftKey} /></>);
  const go = (context: SendContext, draftKey: string) => view.rerender(<><StatusLine /><Composer ref={ref} {...props} context={context} draftKey={draftKey} /></>);
  const write = (text: string) => act(() => ref.current!.setText(text));
  const submit = () => fireEvent.submit(view.container.querySelector("form.composer-box")!);
  const button = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  return { ref, store, onSent, go, write, submit, button, container: view.container };
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

// While the conversation's run is working, the message box is how you talk to it.
const working = { ...S, running: [{ id: "run-1", label: "@quartermaster", task: "Plan the work" }] } as unknown as CampState;

test("while the conversation's run works, Send is a red Stop, and Enter queues behind the run", async () => {
  const { write, submit } = setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a", working);
  expect(screen.getByRole("textbox").getAttribute("aria-placeholder")).toBe("Queue a message for when they're done…");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop" })); });
  expect(steers).toEqual([{ path: "/api/stop", id: "run-1" }]);
  expect((screen.getByRole("button", { name: "Stopping…" }) as HTMLButtonElement).disabled).toBe(true);

  steers.length = 0;
  write("Then write the docs");
  expect(screen.getByRole("button", { name: "Stopping…" }).closest(".send-split.stop")).toBeTruthy(); // still Stop with text in the box
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0]).toMatchObject({ text: "Then write the docs", replyTo: "run-1", after: "run-1" });
  expect(steers).toEqual([]);
  await act(async () => { landing[0](new Response(JSON.stringify({ ok: true, id: "run2", position: 0, attached: 0, thread: "t", after: "run-1" }))); });
  expect((await screen.findByRole("status")).textContent).toContain("Queued: it goes once this run has finished.");
});

test("a second queued message waits behind the first, not beside it", async () => {
  const lined = { ...working, queued: [{ id: "q1", label: "@quartermaster", task: "Then write the docs", after: "run-1", held: null }] } as unknown as CampState;
  const { write, submit } = setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a", lined);
  write("And update the changelog");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0].after).toBe("q1");
  await land(0);
});

test("the menu beside Stop queues what you've typed, or sends it to the run now", async () => {
  const { write } = setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a", working);
  fireEvent.click(screen.getByRole("button", { name: "More ways to send" }));
  expect((screen.getByRole("menuitem", { name: "Queue" }) as HTMLButtonElement).disabled).toBe(true); // nothing typed yet
  fireEvent.click(screen.getByRole("button", { name: "More ways to send" }));

  write("Then write the docs");
  fireEvent.click(screen.getByRole("button", { name: "More ways to send" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Queue" }));
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0]).toMatchObject({ text: "Then write the docs", after: "run-1" });
  await land(0);

  write("Focus on the tests");
  fireEvent.click(screen.getByRole("button", { name: "More ways to send" }));
  const now = screen.getByRole("menuitem", { name: "Send now" });
  expect(now.textContent).toBe("Send now"); // no line under it
  fireEvent.click(now);
  await waitFor(() => expect(steers).toEqual([{ path: "/api/steer", id: "run-1", text: "Focus on the tests" }]));
  expect(sends.length).toBe(1);
});

test("the menu highlights the option you're on: Queue when it opens, then wherever the arrows or the mouse go", () => {
  const { write } = setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a", working);
  write("Then write the docs");
  fireEvent.click(screen.getByRole("button", { name: "More ways to send" }));
  const queue = screen.getByRole("menuitem", { name: "Queue" });
  const now = screen.getByRole("menuitem", { name: "Send now" });
  expect(queue.className).toContain("active");
  expect(document.activeElement).toBe(queue);
  fireEvent.keyDown(queue, { key: "ArrowDown" });
  expect(now.className).toContain("active");
  expect(queue.className).not.toContain("active");
  expect(document.activeElement).toBe(now);
  fireEvent.keyDown(now, { key: "ArrowDown" }); // round to the top
  expect(queue.className).toContain("active");
  fireEvent.mouseEnter(now);
  expect(now.className).toContain("active");
});

test("a message sent for you (a review's \"fix these\") goes to the working run now, and leaves what you've typed alone", async () => {
  const { ref, write } = setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a", working);
  write("my half-written note");
  let how: unknown;
  await act(async () => { how = await ref.current!.send("Fix these review findings."); });
  expect(how).toBe("now");
  expect(steers).toEqual([{ path: "/api/steer", id: "run-1", text: "Fix these review findings." }]);
  expect(sends).toEqual([]);
  expect((screen.getByRole("textbox") as HTMLElement).textContent).toContain("my half-written note");
});

test("with no run working, a message sent for you goes as a reply in the conversation", async () => {
  const { ref, write } = setup({ replyTo: "run-0", placeholder: "Reply…" }, "c:a");
  write("my half-written note");
  let done: Promise<unknown> | undefined;
  act(() => { done = ref.current!.send("Fix these review findings."); });
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0]).toEqual({ text: "Fix these review findings.", attachments: [], replyTo: "run-0" });
  await land(0);
  expect(await done).toBe("sent");
  expect(steers).toEqual([]);
  expect((screen.getByRole("textbox") as HTMLElement).textContent).toContain("my half-written note");
});

test("a message for someone else still starts their own work while a run is going", async () => {
  const { write, submit } = setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a", working);
  write("@scout look into caching");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(steers).toEqual([]);
  expect(sends[0].after).toBeUndefined();
  await land(0);
});

test("once the run has finished, Send is a plain reply with no Queue menu", () => {
  setup({ replyTo: "run-1", live: "run-1", placeholder: "Reply…" }, "c:a"); // nothing running
  expect(screen.queryByRole("button", { name: "More ways to send" })).toBeNull();
  expect(screen.queryByText("Enter to send")).toBeNull();
});

test("a .zip dropped on the box goes in as the folder it holds", async () => {
  const { write, submit, container } = setup();
  const file = new File(["PK..."], "site.zip", { type: "application/zip" });
  fireEvent.drop(container.querySelector(".composer")!, { dataTransfer: { files: [file], types: ["Files"] } });
  await waitFor(() => expect(zips.length).toBe(1));
  expect(zips[0].name).toBe("site.zip");
  await screen.findByText(/site/);
  write("Look at this site");
  submit();
  await waitFor(() => expect(sends.length).toBe(1));
  expect(sends[0].attachments).toEqual([expect.objectContaining({ kind: "folder", name: "site", path: "camp/uploads/b1/site" })]);
  await land(0);
});
