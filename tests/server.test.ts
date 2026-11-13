// The camp server as a process: started for real in a throwaway camp, so what's checked is what
// happens when it starts, is asked things, and is told to stop.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { enterSandbox, REPO, WINDOWS } from "./helpers/sandbox.ts";

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
// On Windows a process can't be sent SIGTERM to handle: kill() ends it on the spot, with no exit
// code. (Ctrl+C and closing the window do reach the camp there; a test can't press either.) So on
// Windows this only checks that it stopped.
const stop = async (c: Camp) => { c.child.kill("SIGTERM"); const code = await c.exited; return WINDOWS ? 0 : code; };
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
  if (!WINDOWS) assert.equal(statSync(join(camp, "camp", ".token")).mode & 0o777, 0o600); // (Windows has no owner-only mode)
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
  if (!WINDOWS) assert.equal((c.child as any).signalCode, null, "it exited on its own terms: the exit hooks ran");
});

// ---------- LAN mode ----------
import http from "node:http";
import { networkInterfaces } from "node:os";

// A request to a chosen address with a chosen Host header (fetch allows neither).
function ask(o: { address: string; port: number; host: string; path: string; method?: string; key?: string; body?: object }): Promise<{ status: number; json: any }> {
  return new Promise((ok, no) => {
    const data = o.body ? JSON.stringify(o.body) : undefined;
    const req = http.request({ host: o.address, port: o.port, path: o.path, method: o.method ?? (data ? "POST" : "GET"),
      headers: { host: o.host, ...(o.key ? { "x-camp-token": o.key } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => { let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ } ok({ status: res.statusCode ?? 0, json }); });
    });
    req.on("error", no);
    req.end(data);
  });
}
// This machine's address on the network, if it has one: a connection to it arrives as "from elsewhere".
const lanAddress = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;

test("by default nothing off this machine can reach it, and only its own names are answered", async () => {
  const c = await start();
  assert.doesNotMatch(c.out(), /LAN mode/);
  assert.equal((await ask({ address: "127.0.0.1", port: c.port, host: `evil.example:${c.port}`, path: "/api/ping", key: c.token })).status, 403, "a page elsewhere pointing its name here is refused");
  assert.equal((await ask({ address: "127.0.0.1", port: c.port, host: `localhost:${c.port}`, path: "/api/ping", key: c.token })).status, 200);
  if (lanAddress) await assert.rejects(ask({ address: lanAddress, port: c.port, host: `${lanAddress}:${c.port}`, path: "/" }), /ECONNREFUSED/, "it isn't listening on the network at all");
  assert.equal(await stop(c), 0);
});

test("LAN mode: other machines reach it by this machine's names; the terminal and folder dialog stay on the camp's machine", async (t) => {
  const c = await start({ CAMP_LAN: "1", CAMP_NAMES: "testbox" });
  assert.match(c.out(), /LAN mode: other machines on this network can reach it \(http:\/\/testbox:\d+\//);
  assert.match(c.out(), /From another machine: http:\/\/testbox:\d+\/#k=[0-9a-f]{32}/);
  const local = { address: "127.0.0.1", port: c.port, key: c.token };
  // Addressed by a name it goes by: answered. By any other name: refused, key or no key.
  assert.equal((await ask({ ...local, host: `testbox:${c.port}`, path: "/api/ping" })).status, 200);
  assert.equal((await ask({ ...local, host: `evil.example:${c.port}`, path: "/api/ping" })).status, 403);
  assert.equal((await ask({ ...local, host: `testbox:${c.port}`, path: "/api/ping", key: "0".repeat(48) })).status, 401, "the key is still needed");
  // On the camp's own machine the terminal is there, and the state says where others reach it.
  assert.equal((await ask({ ...local, host: `127.0.0.1:${c.port}`, path: "/api/term" })).status, 200);
  const state = await ask({ ...local, host: `127.0.0.1:${c.port}`, path: "/api/state?full=0" });
  assert.equal(state.json.settings.lan[0], `http://testbox:${c.port}/`);
  // A signed-in browser makes a link for another device: for this machine's name, good once.
  const made = await ask({ ...local, host: `127.0.0.1:${c.port}`, path: "/api/login/link", body: {} });
  assert.equal(made.json.minutes, 10);
  const code = made.json.link.match(new RegExp(`^http://testbox:${c.port}/#k=([0-9a-f]{32})$`))?.[1];
  assert.ok(code, made.json.link);
  assert.equal((await ask({ address: "127.0.0.1", port: c.port, host: `testbox:${c.port}`, path: "/api/login", body: { code } })).json.token, c.token);
  assert.equal((await ask({ address: "127.0.0.1", port: c.port, host: `testbox:${c.port}`, path: "/api/login", body: { code } })).status, 401);
  assert.equal((await ask({ address: "127.0.0.1", port: c.port, host: `127.0.0.1:${c.port}`, path: "/api/login/link", body: {} })).status, 401, "making a link needs the key");

  if (!lanAddress) { t.diagnostic("this machine has no network address: the from-another-machine half wasn't run"); assert.equal(await stop(c), 0); return; }
  // From another machine (here: a connection that arrives over the network address).
  const away = { address: lanAddress, port: c.port, host: `${lanAddress}:${c.port}`, key: c.token };
  assert.equal((await ask({ ...away, path: "/api/ping" })).status, 200, "the camp itself works from there");
  assert.equal((await ask({ ...away, path: "/api/state?full=0" })).status, 200);
  for (const [path, body] of [["/api/term", undefined], ["/api/term/stream?id=x", undefined], ["/api/term/open", { cols: 80, rows: 24 }], ["/api/term/input", { id: "x", data: "whoami\r" }]] as const) {
    const r = await ask({ ...away, path, ...(body ? { body } : {}) });
    assert.equal(r.status, 403, path);
    assert.match(r.json.error, /only opens in a browser on that machine/);
  }
  assert.equal((await ask({ ...local, host: `127.0.0.1:${c.port}`, path: "/api/term" })).json.terminals.length, 0, "and nothing was opened by trying");
  const pick = await ask({ ...away, path: "/api/links/pick", body: {} });
  assert.match(pick.json.unsupported, /opens on the camp's own machine/);
  assert.equal(await stop(c), 0);
});
