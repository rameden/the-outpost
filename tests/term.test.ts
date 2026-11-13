// The terminal pane's sessions: a real shell on a pseudo-terminal that starts in the project's
// folder, takes what's typed, keeps its recent output for a page that reattaches, and ends cleanly.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("term");
process.env.SHELL = "/bin/sh"; // a plain shell: no profile, no prompt theme
const folder = realpathSync(mkdtempSync(join(tmpdir(), "satchel-term-")));

const { addLink } = await import("../src/links.ts");
const { addProject } = await import("../src/conversations.ts");
const term = await import("../src/term.ts");
const { rl } = await import("../src/tools.ts");
after(() => { term.closeAllTerminals(); rl.close(); });

// node-pty ships ready-built for macOS and Windows; elsewhere it has to be compiled first.
let works = true;
try { term.closeTerminal(term.openTerminal({}).id); } catch { works = false; }
// These type POSIX shell commands (pwd, stty, $((…))). On Windows the pane opens PowerShell, which
// these tests don't speak: left out there, so the pane itself is not covered on Windows yet.
if (process.platform === "win32") works = false;

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

// What the hidden pane's rail shows: the last line the shell finished, read off a screen that
// draws the output the way the page would. No shell needed.
test("the last line is the newest finished one, as plain text, not the prompt you're at", async () => {
  const screen = term.makeScreen(20, 5)!;
  assert.ok(screen, "the screen package is installed");
  const show = (d: string) => new Promise<string>((r) => screen.write(d, () => r(term.lastLine(screen))));

  assert.equal(await show("\x1b[1mhost%\x1b[0m "), "host%", "nothing finished yet: the prompt itself");
  assert.equal(await show("ls\r\n"), "host% ls");
  assert.equal(await show("file-a  file-b  and a long wrapped line here\r\nhost% "), "file-a  file-b  and a long wrapped line here", "colours gone, a wrapped line whole, the new prompt skipped");
  assert.equal(await show("\r\n\r\n\r\nhost% "), "host%", "blank lines don't count; empty prompts are what's left");
  assert.equal(await show("npm i\r\n\x1b[32mprogress 10%\x1b[0m\rprogress 99%\r\nadded 3 packages\r\n"), "added 3 packages");
  assert.equal(await show("\x1b[?1049h\x1b[2J\x1b[Hvim draws here\x1b[?1049l"), "added 3 packages", "a full-screen program doesn't replace it");
  screen.dispose();
});

test("quick actions: at most five, each a name and one or more plain one-line commands; a bad one is refused whole", async () => {
  const { cleanTermActions, setTermActions, termActions } = await import("../src/settings.ts");
  // Tidied: names trimmed, a chain one command to a line, a folder only for a new terminal.
  assert.deepEqual(cleanTermActions([
    { label: "  Push ", commands: "git push origin HEAD\n", where: "current", folder: "web" },
    { label: "Dev", commands: ["pnpm install", "  ", "pnpm dev:production "], where: "new", folder: "web", sub: "./apps/root/", ask: true },
    { label: "Scratch", commands: "ls" },
  ]), [
    { label: "Push", commands: ["git push origin HEAD"], where: "current" },
    { label: "Dev", commands: ["pnpm install", "pnpm dev:production"], where: "new", folder: "web", sub: "apps/root", ask: true },
    { label: "Scratch", commands: ["ls"], where: "new" },
  ]);
  const ok = { label: "A", commands: "ls", where: "current" };
  assert.throws(() => cleanTermActions(Array.from({ length: 6 }, (_, i) => ({ ...ok, label: `A${i}` }))), /more than 5 quick actions/);
  assert.throws(() => cleanTermActions([{ ...ok, label: " " }]), /Quick action 1 needs a name/);
  assert.throws(() => cleanTermActions([{ ...ok, label: "A name far too long" }]), /keep the name to 14 characters/);
  assert.throws(() => cleanTermActions([ok, { ...ok, label: "a" }]), /Two quick actions are called "a"/);
  assert.throws(() => cleanTermActions([{ ...ok, commands: " \n " }]), /"A" needs a command/);
  assert.throws(() => cleanTermActions([{ ...ok, commands: ["echo hi\x1b[2J"] }]), /one line of plain text/, "nothing that would act as a key press");
  assert.throws(() => cleanTermActions([{ ...ok, commands: ["ls\tx"] }]), /one line of plain text/);
  assert.throws(() => cleanTermActions([{ ...ok, where: "new", folder: "../etc" }]), /pick one of your linked folders/);
  for (const sub of ["../x", "a/../../x", "/etc", "~/x"]) assert.throws(() => cleanTermActions([{ ...ok, where: "new", folder: "web", sub }]), /is a path within it/);
  assert.throws(() => cleanTermActions("ls"), /as a list/);

  // Kept in the camp's settings; an empty list clears them; a refused save leaves what was there.
  assert.deepEqual(termActions(), []);
  setTermActions([ok]);
  assert.deepEqual(termActions(), [{ label: "A", commands: ["ls"], where: "current" }]);
  assert.throws(() => setTermActions([{ ...ok, label: "" }]));
  assert.equal(termActions().length, 1);
  setTermActions([]);
  assert.deepEqual(termActions(), []);
});

test("a quick action's new terminal: it starts in the folder named, carries the action's name, and types its commands once the shell is up", { skip: !works }, async () => {
  const inside = realpathSync(mkdtempSync(join(tmpdir(), "satchel-term-act-")));
  mkdirSync(join(inside, "apps", "web"), { recursive: true });
  const link = addLink(inside, "read");
  const t = term.openTerminal({ folder: link.name, sub: "apps/web", title: "Dev", action: "Dev", type: "echo one-$((1+1)) && echo two-$((2+2))\r" });
  assert.equal(t.cwd, join(inside, "apps", "web"));
  assert.equal(t.title, "Dev");
  assert.equal(t.action, "Dev");
  assert.equal(term.listTerminals().find((x) => x.id === t.id)!.action, "Dev");
  const l = listener();
  term.streamTerminal(t.id, l.res, () => {});
  const out = await l.until(/one-2[\s\S]*two-4/);
  assert.match(out, /one-2[\s\S]*two-4/, "the chain ran, in order");
  term.closeTerminal(t.id);

  // Left for you to press Enter: it's typed, and nothing has run.
  const waits = term.openTerminal({ type: "echo not-$((3+3))-yet" });
  const w = listener();
  term.streamTerminal(waits.id, w.res, () => {});
  await w.until(/not-\$/);
  await new Promise((r) => setTimeout(r, 300));
  assert.doesNotMatch(w.data(), /not-6-yet/);
  term.writeTerminal(waits.id, "\r");
  assert.match(await w.until(/not-6-yet/), /not-6-yet/);
  term.closeTerminal(waits.id);

  // A lock is kept with the session: set when it's opened or later, and listed with it.
  const mine = term.openTerminal({ locked: true });
  assert.equal(term.listTerminals().find((x) => x.id === mine.id)!.locked, true);
  assert.equal(term.lockTerminal(mine.id, false)!.locked, undefined);
  assert.equal(term.lockTerminal(mine.id, true)!.locked, true);
  assert.ok(term.writeTerminal(mine.id, "true\r"), "what you type yourself still goes in");
  assert.equal(term.lockTerminal("nope", true), null);
  term.closeTerminal(mine.id);

  // A folder that isn't there (or isn't inside the link) opens nothing.
  assert.throws(() => term.openTerminal({ folder: "nope" }), /no linked folder called "nope"/);
  assert.throws(() => term.openTerminal({ folder: link.name, sub: "apps/missing" }), /isn't a folder that's there/);
  assert.throws(() => term.openTerminal({ folder: link.name, sub: "../.." }), /isn't a folder that's there/);
  assert.equal(term.listTerminals().length, 0);
});
