// The model for a conversation outside a project: a label beside the message box that opens
// the list of every model you can use.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { ChatModel } from "./ChatModel.tsx";
import { forgetModelLists } from "./ModelPicker.tsx";

const MODELS = { live: true, models: [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: [] },
  { id: "groq:llama-fast", name: "Llama Fast", efforts: [], provider: "Groq" },
  { id: "gemini:gemini-flash", name: "Gemini Flash", efforts: [], provider: "Gemini" }] };
beforeEach(() => { forgetModelLists(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(MODELS)))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const S = { runtime: "claude-code", providers: [{ id: "groq", connected: true }, { id: "gemini", connected: true }] } as unknown as CampState;

test("it starts on the default model; pick one and it's named; go back and it says so", async () => {
  const onPick = vi.fn();
  const { rerender } = render(<ChatModel S={S} picked={undefined} onPick={onPick} />);
  const label = () => screen.getByRole("button", { name: /^Model for this conversation:/ });
  expect(label().getAttribute("aria-label")).toBe("Model for this conversation: Default model");
  expect(label().className).toBe("work-btn");
  fireEvent.click(label());
  const menu = screen.getByRole("dialog", { name: "Model for this conversation" });
  const pick = within(menu).getByLabelText("Model") as HTMLSelectElement;
  await waitFor(() => expect(pick.disabled).toBe(false));
  expect(pick.querySelector("option")!.textContent).toBe("Default model (Claude Sonnet; a crew member's own if you @ one)");
  expect([...pick.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Groq", "Gemini"]);
  expect(within(menu).getByText(/With no @, your message goes straight to this model: a plain chat, no crew\./)).toBeTruthy();
  fireEvent.change(pick, { target: { value: "groq:llama-fast" } });
  expect(onPick).toHaveBeenLastCalledWith("groq:llama-fast");
  expect(screen.queryByRole("dialog")).toBeNull(); // picked: the list closes

  rerender(<ChatModel S={S} picked="groq:llama-fast" onPick={onPick} />);
  expect(label().getAttribute("aria-label")).toBe("Model for this conversation: Groq · Llama Fast");
  expect(label().className).toBe("work-btn changed");
  expect(label().title).toMatch(/answered by Groq · Llama Fast, from this message on/);
});

test("in a conversation that already has one it shows that; another pick, or back to their own, goes with the next message", async () => {
  const onPick = vi.fn();
  const { rerender } = render(<ChatModel S={S} picked={undefined} standing="gemini:gemini-flash" onPick={onPick} />);
  const label = () => screen.getByRole("button", { name: /^Model for this conversation:/ });
  await waitFor(() => expect(label().getAttribute("aria-label")).toBe("Model for this conversation: Gemini · Gemini Flash"));
  expect(label().title).not.toMatch(/from this message on/); // it's what the conversation already runs on
  fireEvent.click(label());
  const pick = screen.getByLabelText("Model") as HTMLSelectElement;
  await waitFor(() => expect(pick.value).toBe("gemini:gemini-flash"));
  fireEvent.change(pick, { target: { value: "" } });
  expect(onPick).toHaveBeenLastCalledWith(null);
  rerender(<ChatModel S={S} picked={null} standing="gemini:gemini-flash" onPick={onPick} />);
  expect(label().getAttribute("aria-label")).toBe("Model for this conversation: Default model");
  // A model that's set but no longer listed is still shown for what it is. Escape closes the list.
  rerender(<ChatModel S={S} picked={undefined} standing="groq:gone" onPick={onPick} />);
  expect(label().getAttribute("aria-label")).toBe("Model for this conversation: groq:gone");
  fireEvent.click(label());
  expect(within(screen.getByRole("dialog")).getByText("groq:gone (not available right now)")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
