// Settings → Plugins: each plugin listed with what it adds, on unless turned off, and its switch saved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { PluginsPage } from "./PluginsPage.tsx";

const posts: { path: string; body: any }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => { posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) }); return new Response(JSON.stringify({ ok: true })); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const state = (plugins?: Record<string, boolean>) => ({ settings: { plugins } }) as unknown as CampState;

test("both plugins are listed with what they add, and on until turned off", () => {
  render(<PluginsPage S={state()} refresh={() => {}} />);
  expect((screen.getByRole("checkbox", { name: "HD Orbit" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Barnstorm" }) as HTMLInputElement).checked).toBe(true);
  expect(within(screen.getByRole("list", { name: "What HD Orbit adds" })).getAllByRole("listitem").length).toBeGreaterThan(0);
  cleanup();
  render(<PluginsPage S={state({ barnstorm: false })} refresh={() => {}} />);
  expect((screen.getByRole("checkbox", { name: "Barnstorm" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("checkbox", { name: "HD Orbit" }) as HTMLInputElement).checked).toBe(true);
});

test("a switch saves the plugin on or off, then the page is refreshed", async () => {
  const refresh = vi.fn();
  render(<PluginsPage S={state()} refresh={refresh} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "HD Orbit" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts).toEqual([{ path: "/api/plugins", body: { id: "orbit-hd", on: false } }]);
});
