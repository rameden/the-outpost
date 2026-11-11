// Settings → Terminal: the terminal's quick actions are added, edited, reordered and saved here.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState, TermAction } from "../types.ts";
import { TerminalActions } from "./TerminalActions.tsx";

const posts: { path: string; body: any }[] = [];
let answer: () => Response = () => new Response("{}");
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => { posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) }); return answer(); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const state = (termActions: TermAction[]) => ({ settings: { termActions }, links: [{ name: "mi-web-app" }, { name: "mira" }] }) as unknown as CampState;
const card = (n: number) => within(screen.getByRole("group", { name: `Quick action ${n}` }));

test("start from an example, make it a chain in a new terminal in a folder, and save", async () => {
  const refresh = vi.fn();
  render(<TerminalActions S={state([])} refresh={refresh} />);
  expect(screen.getByText("0 of 5")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true); // nothing to save yet
  fireEvent.click(screen.getByRole("button", { name: "Dev server" }));
  expect((card(1).getByLabelText("Quick action 1: name") as HTMLInputElement).value).toBe("Dev");
  // More than one command: it shows what the chain comes to.
  expect(card(1).getByText("pnpm install && pnpm dev")).toBeTruthy();
  fireEvent.change(card(1).getByLabelText("Quick action 1: commands"), { target: { value: "pnpm install\npnpm dev:production" } });
  // A folder inside a linked folder is offered once a folder is picked.
  expect(card(1).queryByLabelText(/folder inside/)).toBeNull();
  fireEvent.change(card(1).getByLabelText("Quick action 1: folder"), { target: { value: "mi-web-app" } });
  fireEvent.change(card(1).getByLabelText("Quick action 1: folder inside mi-web-app"), { target: { value: "apps/root" } });
  fireEvent.click(card(1).getByRole("checkbox")); // don't run it straight away

  answer = () => new Response(JSON.stringify({ ok: true, termActions: [{ label: "Dev", commands: ["pnpm install", "pnpm dev:production"], where: "new", folder: "mi-web-app", sub: "apps/root", ask: true }] }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("status")).textContent).toBe("Saved. They're in the terminal now.");
  expect(posts).toEqual([{ path: "/api/term/actions", body: { actions: [{ label: "Dev", commands: ["pnpm install", "pnpm dev:production"], where: "new", folder: "mi-web-app", sub: "apps/root", ask: true }] } }]);
  expect(refresh).toHaveBeenCalled();
});

test("five at most; they can be reordered and removed; what the camp refuses is shown and nothing is lost", async () => {
  const five = ["A", "B", "C", "D", "E"].map((label) => ({ label, commands: ["ls"], where: "current" as const }));
  render(<TerminalActions S={state(five)} refresh={() => {}} />);
  expect(screen.getByText("5 of 5")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Add a quick action" }) as HTMLButtonElement).disabled).toBe(true);
  // A terminal you're looking at has no folder to choose.
  expect(card(1).queryByLabelText("Quick action 1: folder")).toBeNull();
  const names = () => screen.getAllByLabelText(/Quick action \d: name/).map((i) => (i as HTMLInputElement).value);
  expect((screen.getByRole("button", { name: "Move A up" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Move A down" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove E" }));
  expect(names()).toEqual(["B", "A", "C", "D"]);
  expect((screen.getByRole("button", { name: "Add a quick action" }) as HTMLButtonElement).disabled).toBe(false);

  fireEvent.change(card(1).getByLabelText("Quick action 1: name"), { target: { value: "" } });
  answer = () => new Response(JSON.stringify({ error: "Quick action 1 needs a name." }), { status: 400 });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Quick action 1 needs a name.");
  expect(names()).toEqual(["", "A", "C", "D"]); // still what you had
});
