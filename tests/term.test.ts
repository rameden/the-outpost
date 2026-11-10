// The terminal pane's sessions: a real shell on a pseudo-terminal that starts in the project's
// folder, takes what's typed, keeps its recent output for a page that reattaches, and ends cleanly.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("term");
process.env.SHELL = "/bin/sh"; // a plain shell: no profile, no prompt theme
const folder = realpathSync(mkdtempSync(join(tmpdir(), "guild-camp-term-")));

const { addLink } = await import("../src/links.ts");
const { addProject } = await import("../src/conversations.ts");
const term = await import("../src/term.ts");
const { rl } = await import("../src/tools.ts");
after(() => { term.closeAllTerminals(); rl.close(); });

// node-pty ships ready-built for macOS and Windows; elsewhere it has to be compiled first.
let works = true;
try { term.closeTerminal(term.openTerminal({}).id); } catch { works = false; }

// A stand-in for the page's event stream.
function listener() {
  let text = "";
  const res = { writeHead() {}, write(chunk: string) { text += chunk; return true; }, end() {} } as any;
  const data = () => [...text.matchAll(/event: data\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as string).join("");
  const until = async (re: RegExp) => { for (let i = 0; i < 100 && !re.test(data()); i++) await new Promise((r) => setTimeout(r, 50)); return data(); };
  return { res, data, until, raw: () => text };
}

test("a session starts in the project's folder, runs what's typed, and reattaches with its output", { skip: !works }, async () => {
  const link = addLink(folder, "read");
  const project = addProject({ name: "Demo", links: [link.name] });
  const t = term.openTerminal({ project: project.id, cols: 90, rows: 20 });
  assert.equal(t.cwd, folder);
  assert.deepEqual(term.listTerminals().map((x) => x.id), [t.id]);

  const first = listener();
  assert.ok(term.streamTerminal(t.id, first.res, () => {}));
  assert.ok(term.writeTerminal(t.id, "echo camp-$((40+2)); pwd; stty size\r"));
  const out = await first.until(/camp-42[\s\S]*20 90/);
  assert.match(out, /camp-42/);
  assert.ok(out.includes(folder), "it runs in the project's folder");
  assert.match(out, /20 90/, "the size the page asked for");

  term.resizeTerminal(t.id, 120, 30);
  term.writeTerminal(t.id, "stty size\r");
  assert.match(await first.until(/30 120/), /30 120/);

  // Another page attaches later: it gets what was already printed.
  const second = listener();
  term.streamTerminal(t.id, second.res, () => {});
  assert.match(second.data(), /camp-42/);

  term.writeTerminal(t.id, "exit\r");
  for (let i = 0; i < 100 && !/event: exit/.test(first.raw()); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(first.raw(), /event: exit\ndata: \{"code":0\}/);
  assert.equal(term.listTerminals()[0].exited, 0);
  assert.ok(!term.writeTerminal(t.id, "ls\r"), "nothing can be typed into a shell that has ended");
  assert.ok(term.closeTerminal(t.id));
  assert.deepEqual(term.listTerminals(), []);
});

test("without a project it starts in the camp folder; unknown sessions are refused; there's a limit", { skip: !works }, () => {
  const t = term.openTerminal({});
  assert.equal(realpathSync(t.cwd), realpathSync(process.cwd()));
  assert.ok(!term.writeTerminal("nope", "ls\r"));
  assert.ok(!term.resizeTerminal("nope", 80, 24));
  assert.ok(!term.streamTerminal("nope", listener().res, () => {}));
  assert.ok(!term.closeTerminal("nope"));
  for (let i = 0; i < 7; i++) term.openTerminal({});
  assert.throws(() => term.openTerminal({}), /8 terminals already/);
  term.closeAllTerminals();
  assert.deepEqual(term.listTerminals(), []);
});
