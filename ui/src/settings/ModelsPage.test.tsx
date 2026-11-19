// Settings → Models: connecting a provider with a key, forgetting it, and choosing the small-jobs model.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState, ProviderState } from "../types.ts";
import { forgetModelLists } from "../components/ModelPicker.tsx";
import { ModelsPage } from "./ModelsPage.tsx";

const posts: { path: string; body: any }[] = [];
let answer: (path: string) => Response = () => new Response(JSON.stringify({ ok: true }));
const MODELS = { live: true, models: [
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", efforts: [] },
  { id: "groq:llama-fast", name: "Llama Fast", efforts: [], provider: "Groq" },
  { id: "openrouter:meta/llama:free", name: "Llama (free)", efforts: [], provider: "OpenRouter", free: true, price: "free" }] };
let routing: object = { policy: "auto-test.1", arms: [], matchedTasks: 0 };
beforeEach(() => {
  routing = { policy: "auto-test.1", arms: [], matchedTasks: 0 };
  posts.length = 0; forgetModelLists(); answer = () => new Response(JSON.stringify({ ok: true }));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/models") return new Response(JSON.stringify(MODELS));
    if (path === "/api/routing") return new Response(JSON.stringify(routing));
    posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    return answer(path);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const prov = (id: string, name: string, more: Partial<ProviderState> = {}): ProviderState => ({ id: id as ProviderState["id"], name, connected: false, keysAt: `https://example.com/${id}`, privacy: `${name}'s note on what it does with your data.`, models: 0, free: 0, approved: false, ...more });
const state = (providers: ProviderState[], smallModel: string | null = null) => ({ runtime: "claude-code", providers, settings: { smallModel } }) as unknown as CampState;

test("Anthropic uses the same masked connect flow as the other providers", async () => {
  const refresh = vi.fn();
  render(<ModelsPage S={state([prov("groq", "Groq")])} refresh={refresh} />);
  const anthropic = within(screen.getByRole("region", { name: "Anthropic" }));
  expect(anthropic.getByText("Not connected")).toBeTruthy();
  const input = anthropic.getByLabelText("Anthropic API key") as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.value).toBe("");
  expect((anthropic.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: "sk-ant-test-key" } });
  fireEvent.click(anthropic.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts).toContainEqual({ path: "/api/anthropic/key", body: { key: "sk-ant-test-key" } });
  expect(input.value).toBe("");
  expect(posts.some((p) => p.path === "/api/runtime")).toBe(false);
});

test("a failed Anthropic connection preserves the input and shows the error", async () => {
  const refresh = vi.fn();
  render(<ModelsPage S={state([])} refresh={refresh} />);
  const anthropic = within(screen.getByRole("region", { name: "Anthropic" }));
  const input = anthropic.getByLabelText("Anthropic API key") as HTMLInputElement;
  answer = () => new Response(JSON.stringify({ error: "Anthropic didn't accept that key." }), { status: 400 });
  fireEvent.change(input, { target: { value: "sk-ant-rejected" } });
  fireEvent.click(anthropic.getByRole("button", { name: "Connect" }));
  expect((await anthropic.findByRole("alert")).textContent).toBe("Anthropic didn't accept that key.");
  expect(input.value).toBe("sk-ant-rejected");
  expect(refresh).not.toHaveBeenCalled();
});

test("Anthropic's environment key can be imported without displaying or sending it to the page", async () => {
  const refresh = vi.fn();
  const S = { ...state([]), anthropic: { connected: true, saved: false, environment: true, from: "env" as const } };
  render(<ModelsPage S={S} refresh={refresh} />);
  const anthropic = within(screen.getByRole("region", { name: "Anthropic" }));
  expect(anthropic.getByText("Connected")).toBeTruthy();
  expect(anthropic.queryByLabelText("Anthropic API key")).toBeNull();
  fireEvent.click(anthropic.getByRole("button", { name: "Import environment key" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts).toContainEqual({ path: "/api/anthropic/key", body: { import: true } });
});

test("a saved Anthropic connection can be forgotten after confirmation, without an extra approval checkbox", async () => {
  const refresh = vi.fn();
  const S = { ...state([]), anthropic: { connected: true, saved: true, environment: false, from: "camp" as const } };
  render(<ModelsPage S={S} refresh={refresh} />);
  const anthropic = within(screen.getByRole("region", { name: "Anthropic" }));
  expect(anthropic.getByText("Connected")).toBeTruthy();
  expect(anthropic.queryByLabelText("Anthropic API key")).toBeNull();
  expect(anthropic.queryByRole("checkbox")).toBeNull();
  vi.stubGlobal("confirm", vi.fn(() => false));
  fireEvent.click(anthropic.getByRole("button", { name: "Disconnect and forget the key" }));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(posts.some((p) => p.path === "/api/anthropic/key")).toBe(false);
  vi.stubGlobal("confirm", vi.fn(() => true));
  fireEvent.click(anthropic.getByRole("button", { name: "Disconnect and forget the key" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts).toContainEqual({ path: "/api/anthropic/key", body: { key: null } });
});

test("paste a key to connect; what the provider says when it refuses is shown; the key is never shown back", async () => {
  const refresh = vi.fn();
  render(<ModelsPage S={state([prov("gemini", "Gemini"), prov("groq", "Groq"), prov("openrouter", "OpenRouter")])} refresh={refresh} />);
  const groq = within(screen.getByRole("region", { name: "Groq" }));
  expect(groq.getByText("Not connected")).toBeTruthy();
  expect(groq.getByText("Groq's note on what it does with your data.")).toBeTruthy();
  expect(groq.getByRole("link", { name: "Get a key" }).getAttribute("href")).toBe("https://example.com/groq");
  const box = groq.getByLabelText("Groq API key") as HTMLInputElement;
  expect(box.type).toBe("password");
  expect((groq.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(box, { target: { value: "bad-key" } });
  answer = () => new Response(JSON.stringify({ error: "Groq didn't accept that key: Invalid API Key" }), { status: 400 });
  fireEvent.click(groq.getByRole("button", { name: "Connect" }));
  expect((await groq.findByRole("alert")).textContent).toBe("Groq didn't accept that key: Invalid API Key");
  expect(box.value).toBe("bad-key"); // still there to correct
  answer = () => new Response(JSON.stringify({ ok: true }));
  fireEvent.change(box, { target: { value: "gsk_test_key" } });
  fireEvent.click(groq.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts.at(-1)).toEqual({ path: "/api/providers/connect", body: { id: "groq", key: "gsk_test_key" } });
  expect(box.value).toBe(""); // cleared once it's kept
});

test("a connected provider says what it offers and can be forgotten; one set where the camp starts can't", async () => {
  const refresh = vi.fn();
  render(<ModelsPage S={state([prov("gemini", "Gemini", { connected: true, from: "env", models: 12 }), prov("groq", "Groq"), prov("openrouter", "OpenRouter", { connected: true, from: "camp", models: 300, free: 28 })])} refresh={refresh} />);
  const router = within(screen.getByRole("region", { name: "OpenRouter" }));
  expect(router.getByText("Connected · 300 models, 28 free")).toBeTruthy();
  expect(router.queryByLabelText("OpenRouter API key")).toBeNull();
  fireEvent.click(router.getByRole("button", { name: "Disconnect and forget the key" }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/providers/disconnect", body: { id: "openrouter" } }));
  // Approved for confidential projects: off until you say so, per provider, and only offered once it's connected.
  const approve = router.getByRole("checkbox", { name: /OpenRouter is approved for confidential projects/ }) as HTMLInputElement;
  expect(approve.checked).toBe(false);
  expect(router.getByText("Until you tick this, a project marked confidential is never sent to OpenRouter.")).toBeTruthy();
  fireEvent.click(approve);
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/providers/approve", body: { id: "openrouter", on: true } }));
  expect(within(screen.getByRole("region", { name: "Groq" })).queryByRole("checkbox")).toBeNull();
  const gemini = within(screen.getByRole("region", { name: "Gemini" }));
  expect(gemini.getByText(/Its key comes from where the camp was started/)).toBeTruthy();
  expect(gemini.queryByRole("button", { name: /Disconnect/ })).toBeNull();
});

test("the small-jobs model: Claude Haiku unless you choose another, with each provider's models under its name", async () => {
  const refresh = vi.fn();
  render(<ModelsPage S={state([prov("groq", "Groq", { connected: true, from: "camp", models: 1 })], "groq:gone-model")} refresh={refresh} />);
  const pick = screen.getByLabelText("Model for small jobs") as HTMLSelectElement;
  await waitFor(() => expect(pick.disabled).toBe(false));
  expect([...pick.querySelectorAll("optgroup")].map((g) => `${g.label}: ${[...g.querySelectorAll("option")].map((o) => o.textContent).join(", ")}`)).toEqual(["Groq: Llama Fast", "OpenRouter: Llama (free) · free"]);
  expect(pick.querySelector("option")!.textContent).toBe("Claude Haiku (the default)");
  expect(within(pick).getByText("groq:gone-model (not available right now)")).toBeTruthy(); // what's set is shown even if the provider no longer lists it
  fireEvent.change(pick, { target: { value: "openrouter:meta/llama:free" } });
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/providers/small", body: { model: "openrouter:meta/llama:free" } }));
  fireEvent.change(pick, { target: { value: "" } });
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/providers/small", body: { model: null } }));
  // Auto is one of the choices, after the default.
  expect([...pick.querySelectorAll(":scope > option")].map((o) => o.textContent).slice(0, 2)).toEqual(["Claude Haiku (the default)", "Auto (the cheapest model that's up to it)"]);
  fireEvent.change(pick, { target: { value: "auto" } });
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/providers/small", body: { model: "auto" } }));
  expect(screen.getByText(/Confidential projects stay with Claude unless you approve a provider\./)).toBeTruthy();
  // The wiki's models guide: rewritten on request, and opened from here.
  const asked: object[] = [];
  const hear = (ev: Event) => asked.push((ev as CustomEvent).detail);
  window.addEventListener("camp:ask", hear);
  fireEvent.click(screen.getByRole("button", { name: "Update the guide" }));
  expect((await screen.findByText("Written to the wiki.")).getAttribute("role")).toBe("status");
  expect(posts.at(-1)).toEqual({ path: "/api/providers/guide", body: {} });
  fireEvent.click(screen.getByRole("button", { name: "Open the guide" }));
  expect(asked).toEqual([{ do: "open-file", path: "camp/wiki/notes/models-guide.md" }]);
  window.removeEventListener("camp:ask", hear);
});

test("Auto: what it is, its three settings, how it has done so far, and what it means for small jobs", async () => {
  routing = { policy: "auto-test.1", matchedTasks: 0, arms: [
    { arm: "auto:balanced", source: "observed", tasks: 12, completed: 11, completionRate: 11 / 12, usdPerSuccess: 0.25, medianSeconds: 40 },
    { arm: "auto:economy", source: "observed", tasks: 1, completed: 1, completionRate: 1, usdPerSuccess: null, medianSeconds: 9 },
    { arm: "auto:quality", source: "fixture", tasks: 5, completed: 5, completionRate: 1, usdPerSuccess: 1, medianSeconds: 90 },
    { arm: "manual:claude-opus-5-5@high", source: "observed", tasks: 3, completed: 3, completionRate: 1, usdPerSuccess: 2, medianSeconds: 60 }] };
  render(<ModelsPage S={state([], "auto")} refresh={() => {}} />);
  expect(screen.getByRole("heading", { name: "Auto" })).toBeTruthy();
  for (const name of ["Auto · Balanced (recommended).", "Auto · Economy.", "Auto · Quality."]) expect(screen.getByText(name)).toBeTruthy();
  expect(screen.getByText(/picks a model and an effort from the ones you can use/)).toBeTruthy();
  expect(screen.getByText(/On your Claude subscription it chooses at the start of a run/)).toBeTruthy(); // (this camp runs on one)
  // What's run on Auto here, and nothing that ran on a fixed model or came from a fixture.
  const done = await screen.findByRole("status", { name: "How Auto has done" });
  expect(done.textContent).toBe("So far: Auto · Balanced has run 12 tasks and finished 11 ($0.25 each); Auto · Economy has run 1 task and finished 1. Policy auto-test.1.");
  await waitFor(() => expect(screen.getByText(/\(3 right now\)/)).toBeTruthy()); // how many models it's choosing among
  // Small jobs set to Auto: the choice is shown, and what it means is said under it.
  const pick = screen.getByLabelText("Model for small jobs") as HTMLSelectElement;
  expect(pick.value).toBe("auto");
  expect(screen.getByText(/Auto sends each small job to the cheapest model that's connected and up to it/)).toBeTruthy();
  expect(within(pick).queryByText(/not available right now/)).toBeNull();
  expect(posts).toEqual([]); // (looking is all it did)
});

test("Auto, before anything has run on it, says so", async () => {
  render(<ModelsPage S={state([])} refresh={() => {}} />);
  const done = await screen.findByRole("status", { name: "How Auto has done" });
  expect(done.textContent).toBe("Nothing has run on Auto yet. Policy auto-test.1.");
  expect(screen.queryByText(/Auto sends each small job/)).toBeNull();
});

test("Claude models switch one by one; another provider switches as a whole or opens to choose its models", async () => {
  const refresh = vi.fn();
  const S = { runtime: "claude-code", providers: [], settings: { smallModel: null, autoExclude: ["groq:llama-fast"] } } as unknown as CampState;
  render(<ModelsPage S={S} refresh={refresh} />);
  const haiku = await screen.findByLabelText("Auto may use Claude Haiku 5.5") as HTMLInputElement;
  expect(haiku.checked).toBe(true);
  fireEvent.click(haiku);
  await waitFor(() => expect(posts).toContainEqual({ path: "/api/providers/auto-exclude", body: { model: "claude-haiku-5-5", on: false } }));
  // Groq is on, with one of its models kept out.
  expect((screen.getByLabelText("Auto may use Groq") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("0 of 1 models")).toBeTruthy();
  expect(screen.queryByLabelText("Auto may use Llama Fast")).toBeNull(); // closed until you choose
  fireEvent.click(screen.getAllByRole("button", { name: "Choose…" })[0]);
  const llama = screen.getByLabelText("Auto may use Llama Fast") as HTMLInputElement;
  expect(llama.checked).toBe(false);
  fireEvent.click(llama);
  await waitFor(() => expect(posts).toContainEqual({ path: "/api/providers/auto-exclude", body: { model: "groq:llama-fast", on: true } }));
  // The provider's own switch covers all its models.
  fireEvent.click(screen.getByLabelText("Auto may use OpenRouter"));
  await waitFor(() => expect(posts).toContainEqual({ path: "/api/providers/auto-exclude", body: { model: "openrouter:", on: false } }));
  expect(refresh).toHaveBeenCalled();
});
