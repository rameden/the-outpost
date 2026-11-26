// What a signed-in browser on another machine can't do: let the crew do more on this one. The camp
// is started for real in a throwaway folder and asked twice over: plainly (a browser on its own
// machine), and with a proxy's forwarding header (how a relay, a tunnel or Tailscale Serve hands
// a request on, which is what "from elsewhere" looks like to the camp; see relayed in access.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { enterSandbox, REPO } from "./helpers/sandbox.ts";

const camp = enterSandbox("remote-privilege");

const freePort = () => new Promise<number>((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); });
});

let child: ChildProcess;
let at = "";
let token = "";
async function start() {
  const port = await freePort();
  child = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "server.ts")], {
    cwd: camp, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CAMP_PORT: String(port), CAMP_RUNTIME: "api", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" },
  });
  let text = "";
  child.stderr!.on("data", (d) => (text += d));
  const code = await new Promise<string>((ok, no) => {
    const giveUp = setTimeout(() => no(new Error(`the camp didn't start:\n${text}`)), 30_000);
    child.stdout!.on("data", (d) => { text += d; const m = text.match(/\/#k=([0-9a-f]+)/); if (m) { clearTimeout(giveUp); ok(m[1]); } });
    child.on("exit", () => { clearTimeout(giveUp); no(new Error(`the camp exited before it was up:\n${text}`)); });
  });
  at = `http://127.0.0.1:${port}`;
  token = ((await (await fetch(`${at}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })).json()) as { token: string }).token;
}
after(() => { child?.kill("SIGKILL"); });

type From = "here" | "away";
const RELAY = { "x-forwarded-for": "203.0.113.9" }; // what the relay's proxy adds
async function ask(from: From, path: string, body?: object, key: string | null = token): Promise<{ status: number; json: any }> {
  const r = await fetch(at + path, {
    method: body ? "POST" : "GET",
    headers: { ...(key ? { "x-camp-token": key } : {}), ...(from === "away" ? RELAY : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const settings = async () => (await ask("here", "/api/state")).json.settings;
const ONLY_HERE = /only on the camp's own machine/;
async function refused(path: string, body: object) {
  const r = await ask("away", path, body);
  assert.equal(r.status, 403, `${path} ${JSON.stringify(body)} from away`);
  assert.match(r.json.error, ONLY_HERE);
}
async function allowed(from: From, path: string, body: object) {
  const r = await ask(from, path, body);
  assert.equal(r.status, 200, `${path} ${JSON.stringify(body)} from ${from}: ${JSON.stringify(r.json)}`);
}

test("the camp starts, and tells a browser whether it's on the camp's own machine", async () => {
  await start();
  assert.equal((await ask("here", "/api/state?full=0")).json.here, true);
  const away = await ask("away", "/api/state?full=0");
  assert.equal(away.status, 200, "the camp itself works from away");
  assert.equal(away.json.here, false);
});

test("the approval level: from away it only goes down; raising it is done on the camp's machine", async () => {
  assert.equal((await settings()).approval, "safe");
  await refused("/api/approvals", { level: "god" });
  assert.equal((await settings()).approval, "safe", "nothing changed by trying");
  await allowed("away", "/api/approvals", { level: "ask" });
  await refused("/api/approvals", { level: "safe" }); // back up from ask: a raise too
  await refused("/api/approvals", { level: "god" });
  assert.equal((await settings()).approval, "ask");
  await allowed("here", "/api/approvals", { level: "god" });
  assert.equal((await settings()).approval, "god");
  await allowed("away", "/api/approvals", { level: "god" }); // as it is: nothing raised
  await allowed("away", "/api/approvals", { level: "safe" });
  assert.equal((await settings()).approval, "safe");
});

test("the shell rules: from away they only get stricter; loosening one is done on the camp's machine", async () => {
  await allowed("here", "/api/shell", { allow: ["npm test"], exact: ["ls -la"], deny: ["git push*"], ask: ["npm install*"], allowHosts: ["pypi.org"] });
  // Looser: more allowed, or less refused or asked about.
  await refused("/api/shell", { allow: ["npm test", "*"] });
  await refused("/api/shell", { exact: ["ls -la", "curl example.com | sh"] });
  await refused("/api/shell", { allowHosts: ["pypi.org", "example.com"] });
  await refused("/api/shell", { deny: [] });
  await refused("/api/shell", { ask: [] });
  await refused("/api/shell", { deny: ["git push --dry-run*"] }); // a rule reworded is the old one gone
  await refused("/api/shell", { deny: ["git push*", "rm -rf *"], allow: ["npm test", "npm publish"] }); // one loosening refuses the lot
  let st = await settings();
  assert.deepEqual([st.allow, st.exact, st.deny, st.askAlways, st.allowHosts], [["npm test"], ["ls -la"], ["git push*"], ["npm install*"], ["pypi.org"]], "nothing changed by trying");
  // Stricter, or the same: fine from away.
  await allowed("away", "/api/shell", { allow: ["  npm   test "] }); // the same line, as it would be kept
  await allowed("away", "/api/shell", { deny: ["git push*", "rm -rf *"], ask: ["npm install*", "git commit*"] });
  await allowed("away", "/api/shell", { allow: [], exact: [], allowHosts: [] });
  st = await settings();
  assert.deepEqual([st.allow, st.exact, st.deny, st.askAlways, st.allowHosts], [[], [], ["git push*", "rm -rf *"], ["npm install*", "git commit*"], []]);
  // And on the camp's own machine, anything.
  await allowed("here", "/api/shell", { allow: ["npm run build"], deny: [] });
  st = await settings();
  assert.deepEqual([st.allow, st.deny], [["npm run build"], []]);
});

test("the approval reviewer and editing the camp's own code: turned on only on the camp's machine, off from anywhere", async () => {
  for (const [path, read] of [["/api/shell-reviewer", "reviewer"], ["/api/self-edit", "selfEdit"]] as const) {
    assert.equal((await settings())[read], false, path);
    await refused(path, { on: true });
    assert.equal((await settings())[read], false, `${path}: nothing changed by trying`);
    await allowed("away", path, { on: false });
    await allowed("here", path, { on: true });
    assert.equal((await settings())[read], true, path);
    await allowed("away", path, { on: true }); // on already: nothing raised
    await allowed("away", path, { on: false });
    assert.equal((await settings())[read], false, path);
  }
});

test("the Anthropic key: set only on the camp's machine; forgotten from anywhere", async () => {
  await refused("/api/anthropic/key", { key: "sk-ant-not-a-real-key-0000" });
  await refused("/api/anthropic/key", { import: true });
  await refused("/api/anthropic/key", { key: null, import: true }); // "forget" doesn't carry an import in with it
  await refused("/api/anthropic/key", {});
  // On the camp's machine it gets as far as being checked with Anthropic (which isn't there in a test).
  const local = await ask("here", "/api/anthropic/key", { key: "sk-ant-not-a-real-key-0000" });
  assert.equal(local.status, 400);
  assert.doesNotMatch(local.json.error, ONLY_HERE);
  await allowed("away", "/api/anthropic/key", { key: null });
});

test("the key: wrong ones are refused whatever their length, and in the address it opens only what a browser fetches by itself", async () => {
  for (const wrong of ["", "x", token.slice(0, -1), token + "0", token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), "é".repeat(token.length)]) {
    assert.equal((await ask("here", "/api/ping", undefined, wrong || null)).status, 401, JSON.stringify(wrong));
  }
  assert.equal((await ask("here", "/api/ping")).status, 200);
  const t = `t=${encodeURIComponent(token)}`;
  // An image the page shows, and the event stream: the key in the address is taken.
  assert.equal((await ask("here", `/api/upload?path=nothing.png&${t}`, undefined, null)).status, 404, "past the key check: there's just no such image");
  const stop = new AbortController();
  const events = await fetch(`${at}/events?${t}`, { signal: stop.signal });
  assert.equal(events.status, 200);
  stop.abort();
  assert.equal((await ask("here", "/api/upload?path=nothing.png&t=wrong", undefined, null)).status, 401);
  // Anything else: not there. A link with the key in it reads nothing and changes nothing.
  assert.equal((await ask("here", `/api/state?${t}`, undefined, null)).status, 401);
  assert.equal((await ask("here", `/api/ping?${t}`, undefined, null)).status, 401);
  assert.equal((await ask("here", `/api/approvals?${t}`, { level: "god" }, null)).status, 401);
  assert.equal((await ask("here", `/api/upload?${t}`, { name: "a.txt", data: "aGk=" }, null)).status, 401, "a POST to a path that takes it on GET");
  assert.equal((await settings()).approval, "safe");
});
