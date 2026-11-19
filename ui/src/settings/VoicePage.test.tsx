// Settings → Voice: connecting ElevenLabs with a key, choosing the voice and model, and forgetting the key.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { VoicePage } from "./VoicePage.tsx";

const posts: { path: string; body: any }[] = [];
let voices: object = { voices: [{ id: "voiceRachel01", name: "Rachel", about: "American, calm" }, { id: "voiceRyley001", name: "Ryley", about: "your clone" }], limited: false };
let answer: (path: string) => Response = () => new Response(JSON.stringify({ ok: true }));
beforeEach(() => {
  posts.length = 0; answer = () => new Response(JSON.stringify({ ok: true }));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    return path === "/api/voice/voices" ? new Response(JSON.stringify(voices)) : answer(path);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const MODELS = [{ id: "eleven_multilingual_v2", name: "Multilingual v2 (best quality)" }, { id: "eleven_flash_v2_5", name: "Flash v2.5 (fastest, half the cost)" }];
const S = (voice: object) => ({ voice: { connected: false, from: null, voice: "voiceRachel01", voiceName: "Rachel", model: "eleven_multilingual_v2", models: MODELS, ...voice } }) as unknown as CampState;

test("not connected: paste a key to connect, and a refused key says why", async () => {
  const refresh = vi.fn();
  render(<VoicePage S={S({})} refresh={refresh} />);
  expect(screen.getByText("Not connected")).toBeTruthy();
  expect(screen.queryByLabelText("Voice")).toBeNull();
  const connect = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
  expect(connect.disabled).toBe(true);

  answer = () => new Response(JSON.stringify({ error: "ElevenLabs didn't accept that key." }), { status: 400 });
  fireEvent.change(screen.getByLabelText("ElevenLabs API key"), { target: { value: "sk_wrong" } });
  fireEvent.click(connect);
  expect((await screen.findByRole("alert")).textContent).toBe("ElevenLabs didn't accept that key.");
  expect(refresh).not.toHaveBeenCalled();

  answer = () => new Response(JSON.stringify({ ok: true }));
  fireEvent.change(screen.getByLabelText("ElevenLabs API key"), { target: { value: "sk_right" } });
  fireEvent.click(connect);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts.at(-1)).toEqual({ path: "/api/voice/connect", body: { key: "sk_right" } });
  expect((screen.getByLabelText("ElevenLabs API key") as HTMLInputElement).value).toBe("");
});

test("connected: your voices are listed, and choosing a voice or a model saves it", async () => {
  const refresh = vi.fn();
  render(<VoicePage S={S({ connected: true, from: "camp" })} refresh={refresh} />);
  expect(screen.getByText("Connected")).toBeTruthy();
  await screen.findByRole("option", { name: "Ryley (your clone)" });
  expect(screen.getByRole("button", { name: "Test voice" })).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "voiceRyley001" } });
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/voice/set", body: { voice: "voiceRyley001", voiceName: "Ryley" } }));
  fireEvent.change(screen.getByLabelText("Voice model"), { target: { value: "eleven_flash_v2_5" } });
  await waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/voice/set", body: { model: "eleven_flash_v2_5" } }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
});

test("a key that can't list voices says how to get your own, and an environment key can't be forgotten here", async () => {
  voices = { voices: [{ id: "voiceRachel01", name: "Rachel", about: "American, calm" }], limited: true };
  render(<VoicePage S={S({ connected: true, from: "env" })} refresh={() => {}} />);
  expect(await screen.findByText(/Voices: Read/)).toBeTruthy();
  expect(screen.getByText(/ELEVENLABS_API_KEY/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Disconnect and forget the key" })).toBeNull();
});
