// Signing in: the link's one-time code is traded for the camp's key, which is kept in this
// browser and never left in the address.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Call = { path: string; method: string; body: any; key: string | null };
let calls: Call[] = [];
let answer: (c: Call) => Response;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

// A fresh copy of the module each time: it reads the kept key as it loads.
const load = async () => { vi.resetModules(); return import("./api.ts"); };

beforeEach(() => {
  calls = [];
  localStorage.clear();
  history.replaceState(null, "", "/");
  answer = (c) => (c.path === "/api/login" ? json({ token: "the-key" }) : json({ ok: true }));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const c: Call = { path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, key: (init?.headers as Record<string, string> | undefined)?.["x-camp-token"] ?? null };
    calls.push(c);
    return answer(c);
  }));
});
afterEach(() => vi.unstubAllGlobals());

test("the code in the link is traded for the key, once, and neither stays in the address", async () => {
  history.replaceState(null, "", "/?view=wiki#k=abc123");
  const api = await load();
  expect(await api.signIn()).toBe(true);
  expect(calls[0]).toMatchObject({ path: "/api/login", method: "POST", body: { code: "abc123" }, key: null });
  expect(calls[1]).toMatchObject({ path: "/api/ping", key: "the-key" });
  expect(api.TOKEN).toBe("the-key");
  expect(localStorage.getItem("camp-key")).toBe("the-key");
  expect(location.hash).toBe("");
  expect(location.pathname + location.search).toBe("/?view=wiki");
  expect(api.eventsUrl()).toBe("/events?t=the-key");
  // From then on every request carries it.
  await api.api("/api/state");
  expect(calls.at(-1)).toMatchObject({ path: "/api/state", key: "the-key" });
});

test("next time the plain address is enough: the key kept in this browser signs it in", async () => {
  localStorage.setItem("camp-key", "kept-key");
  const api = await load();
  expect(await api.signIn()).toBe(true);
  expect(calls.map((c) => c.path)).toEqual(["/api/ping"]);
  expect(api.TOKEN).toBe("kept-key");
});

test("no code and no kept key: not signed in, and the camp isn't asked for anything", async () => {
  const api = await load();
  expect(await api.signIn()).toBe(false);
  expect(calls).toEqual([]);
});

test("a spent link falls back on the key already here; with none, it's not signed in", async () => {
  answer = (c) => (c.path === "/api/login" ? json({ error: "That sign-in link has been used" }, 401) : json({ ok: true }));
  history.replaceState(null, "", "/#k=spent");
  let api = await load();
  expect(await api.signIn()).toBe(false);
  expect(location.hash).toBe("");

  localStorage.setItem("camp-key", "kept-key");
  history.replaceState(null, "", "/#k=spent");
  api = await load();
  expect(await api.signIn()).toBe(true);
  expect(api.TOKEN).toBe("kept-key");
});

test("a key the camp no longer accepts is forgotten, at sign-in or part-way through", async () => {
  localStorage.setItem("camp-key", "old-key");
  answer = () => json({ error: "Missing or wrong camp token" }, 401);
  let api = await load();
  expect(await api.signIn()).toBe(false);
  expect(localStorage.getItem("camp-key")).toBeNull();

  // Later, mid-session: the camp was restarted with a new key.
  localStorage.setItem("camp-key", "old-key");
  answer = () => json({ ok: true });
  api = await load();
  expect(await api.signIn()).toBe(true);
  const heard = vi.fn();
  window.addEventListener("camp:signed-out", heard);
  answer = () => json({ error: "Missing or wrong camp token" }, 401);
  await expect(api.api("/api/state")).rejects.toThrow(/wrong camp token/);
  expect(heard).toHaveBeenCalledTimes(1);
  expect(api.TOKEN).toBe("");
  expect(localStorage.getItem("camp-key")).toBeNull();
  window.removeEventListener("camp:signed-out", heard);
});

test("the camp being down doesn't sign you out: the page opens and waits for it", async () => {
  localStorage.setItem("camp-key", "kept-key");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const api = await load();
  expect(await api.signIn()).toBe(true);
  expect(localStorage.getItem("camp-key")).toBe("kept-key");
});

test("a link from before sign-in codes (?t=key) is taken once and removed from the address", async () => {
  history.replaceState(null, "", "/?t=legacy-key");
  const api = await load();
  expect(await api.signIn()).toBe(true);
  expect(api.TOKEN).toBe("legacy-key");
  expect(localStorage.getItem("camp-key")).toBe("legacy-key");
  expect(location.search).toBe("");
});
