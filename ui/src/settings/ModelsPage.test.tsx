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
beforeEach(() => {
  posts.length = 0; forgetModelLists(); answer = () => new Response(JSON.stringify({ ok: true }));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/models") return new Response(JSON.stringify(MODELS));
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
