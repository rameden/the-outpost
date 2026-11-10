// The GitHub account button in the header: shows who gh is using, swaps on click.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GithubChip } from "./Header.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const accounts = (active: string) => ({
  available: true,
  accounts: ["rameden", "rameden-melt"].map((login) => ({ login, active: login === active, ok: true })),
});

test("shows the active account and swaps to the other one on click", async () => {
  let active = "rameden";
  const calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path === "/api/github/switch") active = body.login;
    return new Response(JSON.stringify(accounts(active)), { status: 200 });
  }));
  render(<GithubChip />);
  const button = await screen.findByRole("button", { name: /gh is using rameden .*Click to switch to rameden-melt/ });
  expect(button.textContent).toContain("rameden");

  await act(async () => { fireEvent.click(button); });
  expect(calls.at(-1)).toEqual({ path: "/api/github/switch", body: { login: "rameden-melt" } });
  expect(await screen.findByRole("button", { name: /gh is using rameden-melt\b.*Click to switch to rameden\./ })).toBeTruthy();
});

test("hidden when gh isn't installed or signed in", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ available: false, reason: "The GitHub CLI (gh) isn't installed." }), { status: 200 })));
  const { container } = render(<GithubChip />);
  await act(async () => { await Promise.resolve(); });
  expect(container.innerHTML).toBe("");
});
