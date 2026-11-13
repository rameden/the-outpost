// The camp server as a process: started for real in a throwaway camp, so what's checked is what
// happens when it starts, is asked things, and is told to stop.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { enterSandbox, REPO } from "./helpers/sandbox.ts";

const camp = enterSandbox("server");

const freePort = () => new Promise<number>((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); });
});

// code: the one-time sign-in code in the link it printed. token: the key that code was traded for.
type Camp = { child: ChildProcess; port: number; code: string; token: string; out: () => string; exited: Promise<number | null> };
const started: ChildProcess[] = [];
const login = (port: number, code: string) => fetch(`http://127.0.0.1:${port}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
async function start(env: Record<string, string> = {}, opts: { signIn?: boolean } = {}): Promise<Camp> {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "server.ts")], {
    cwd: camp, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CAMP_PORT: String(port), CAMP_RUNTIME: "api", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ...env },
  });
  started.push(child);
  let text = "";
  child.stdout!.on("data", (d) => (text += d));
  child.stderr!.on("data", (d) => (text += d));
  const exited = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
  const code = await new Promise<string>((ok, no) => {
    const giveUp = setTimeout(() => no(new Error(`the camp didn't start:\n${text}`)), 30_000);
    const look = () => {
      const m = text.match(/\/#k=([0-9a-f]+)/);
      if (m) { clearTimeout(giveUp); child.stdout!.off("data", look); ok(m[1]); }
    };
    child.stdout!.on("data", look);
    void exited.then(() => { clearTimeout(giveUp); no(new Error(`the camp exited before it was up:\n${text}`)); });
  });
  // Sign in the way the page does: the code, once, for the key.
  const token = opts.signIn === false ? "" : ((await (await login(port, code)).json()) as { token: string }).token;
  return { child, port, code, token, out: () => text, exited };
}
const stop = async (c: Camp) => { c.child.kill("SIGTERM"); return c.exited; };
after(() => { for (const c of started) if (c.exitCode === null) c.kill("SIGKILL"); });

const get = (c: Camp, path: string, token: string | null = c.token) =>
  fetch(`http://127.0.0.1:${c.port}${path}`, { headers: token ? { "x-camp-token": token } : {} });

test("signing in: the link carries a code that works once, never the key; the page itself needs neither", async () => {
  const c = await start({}, { signIn: false });
  assert.doesNotMatch(c.out(), /[?&]t=/, "the key isn't printed");
  const key = readFileSync(join(camp, "camp", ".token"), "utf8").trim();
  assert.ok(!c.out().includes(key));
  // The page and its files hold nothing of the camp: anyone on this machine may fetch them.
  const page = await get(c, "/", null);
  assert.ok(page.status === 200 || page.status === 503, "served (or not built yet), with no key asked for");
  assert.ok(!(await page.text()).includes(key));
  assert.equal((await get(c, "/assets/nope.js", null)).status, 404);
  assert.equal((await get(c, "/api/ping", null)).status, 401, "what the page asks for does need the key");
  // A wrong code gets nothing; the right one gets the key, once.
  assert.equal((await login(c.port, "0".repeat(32))).status, 401);
  assert.equal((await login(c.port, "")).status, 401);
  const first = await login(c.port, c.code);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as any).token, key);
  const again = await login(c.port, c.code);
  assert.equal(again.status, 401, "a link that's been used is spent");
  assert.match(((await again.json()) as any).error, /Press Enter in the camp's terminal/);
  assert.equal((await get(c, "/api/ping", key)).status, 200);
  assert.equal(await stop(c), 0);
});

test("the page's key is the same after a restart (an open tab carries on), is yours alone to read, and can be renewed", async () => {
  const first = await start();
  assert.match(first.token, /^[0-9a-f]{48}$/);
  assert.notEqual(first.code, first.token);
  assert.equal(readFileSync(join(camp, "camp", ".token"), "utf8").trim(), first.token);
  assert.equal(statSync(join(camp, "camp", ".token")).mode & 0o777, 0o600);
  assert.equal((await get(first, "/api/state?full=0")).status, 200);
  assert.equal((await get(first, "/api/state?full=0", null)).status, 401, "no key, no answer");
  assert.equal((await get(first, "/api/state?full=0", "0".repeat(48))).status, 401);
  assert.equal(await stop(first), 0);

  const second = await start();
  assert.equal(second.token, first.token, "the link you already have open still works");
  assert.equal(await stop(second), 0);

  const renewed = await start({ CAMP_NEW_TOKEN: "1" });
  assert.notEqual(renewed.token, first.token);
  assert.equal((await get(renewed, "/api/state?full=0", first.token)).status, 401, "the old key stops working");
  assert.equal(await stop(renewed), 0);
});

test("it stays up through bad input, and stops promptly when told to", async () => {
  // A typo in a hand-edited file used to end the camp thirty seconds after every start.
  writeFileSync(join(camp, "camp", "jobs.json"), '[{"name": "broken", ');
  const c = await start();
  const state = await get(c, "/api/state?full=0");
  assert.equal(state.status, 200);
  assert.deepEqual((await state.json() as any).jobs, []);

  const post = (body: string) => fetch(`http://127.0.0.1:${c.port}/api/send`, { method: "POST", headers: { "x-camp-token": c.token, "content-type": "application/json" }, body });
  const bad = await post('{"text": "hello"');
  assert.equal(bad.status, 400, "a malformed request is the sender's mistake, not a server error");
  assert.match((await bad.json() as any).error, /valid JSON/);
  assert.equal((await post(JSON.stringify({ text: "x".repeat(1_100_000) }))).status, 413);
  assert.equal((await post(JSON.stringify({ text: "" }))).status, 400);
  // A folder the page merely names is never handed to git.
  const status = await (await get(c, `/api/repo/status?link=nope&path=${encodeURIComponent("/tmp")}&base=--output%3Dx`)).json() as any;
  assert.equal(status.exists, false);

  const before = Date.now();
  assert.equal(await stop(c), 0, "SIGTERM ends it cleanly");
  assert.ok(Date.now() - before < 5000, "and without hanging");
  assert.equal((c.child as any).signalCode, null, "it exited on its own terms: the exit hooks ran");
});
