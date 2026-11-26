// One registry of /commands (src/commands.ts): the terminal's slash commands and /help, the page's
// / menu and command palette all come from it. Here: what it holds, how a typed line is read, and
// how the terminal runs one (dispatch), with its busy policy and required arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMAND_REGISTRY, CATEGORIES, busyProblem, commandsOn, dispatch, findCommand, helpText, parseSlash, usageProblem,
  type CommandName, type Handlers,
} from "../src/commands.ts";

test("every command is well formed, and no name or alias is taken twice", () => {
  const seen = new Set<string>();
  for (const c of COMMAND_REGISTRY) {
    assert.match(c.name, /^[a-z][a-z-]*$/, c.name);
    assert.ok(c.description.length > 3, `${c.name} says what it does`);
    assert.ok(c.surfaces.length, `${c.name} is on some surface`);
    assert.ok(CATEGORIES.includes(c.category), `${c.name}'s category is listed`);
    assert.ok(c.busy === "dispatch" || c.busy === "reject");
    for (const n of [c.name, ...("aliases" in c ? c.aliases : [])]) {
      assert.ok(!seen.has(n), `/${n} is only one command`);
      seen.add(n);
    }
  }
});

test("each surface gets its own commands, with its own args and descriptions", () => {
  const cli = commandsOn("cli").map((c) => c.name);
  const ui = commandsOn("ui").map((c) => c.name);
  for (const n of ["link", "budget", "model", "turns", "reply", "undo", "review", "exit"]) assert.ok(cli.includes(n) && !ui.includes(n), n);
  for (const n of ["today", "orbit", "focus", "files", "note", "next"]) assert.ok(ui.includes(n) && !cli.includes(n), n);
  for (const n of ["help", "good", "bad", "memory"]) assert.ok(cli.includes(n) && ui.includes(n), n);
  // The terminal's /memory needs a name; the page's opens Memory without one.
  assert.equal(findCommand("memory", "cli")?.args, "<name>");
  assert.equal(findCommand("memory", "ui")?.args, "[name]");
  assert.notEqual(findCommand("memory", "cli")?.description, findCommand("memory", "ui")?.description);
  // Hidden ones run but aren't offered.
  assert.ok(!ui.includes("connectors") && !ui.includes("wiki"));
  assert.ok(commandsOn("ui", { hidden: true }).some((c) => c.name === "connectors"));
  assert.ok(findCommand("connectors", "ui"));
  assert.equal(findCommand("link", "ui"), undefined); // not on the page
});

test("a typed line: a command, an alias, something mistyped, or not a command at all", () => {
  assert.deepEqual(pick(parseSlash("/good  nice work ", "cli")), { name: "good", arg: "nice work" });
  assert.deepEqual(pick(parseSlash("/projects", "cli")), { name: "project", arg: "" }); // an alias
  assert.deepEqual(pick(parseSlash("/QUIT", "cli")), { name: "exit", arg: "" });
  assert.deepEqual(pick(parseSlash("/good line one\nline two", "cli")), { name: "good", arg: "line one\nline two" });
  assert.deepEqual(parseSlash("/mdoel opus", "cli"), { unknown: "mdoel", suggest: "model" });
  assert.deepEqual(parseSlash("/zzzzzz", "cli"), { unknown: "zzzzzz", suggest: undefined });
  assert.deepEqual(parseSlash("/orbit", "cli"), { unknown: "orbit", suggest: undefined }); // the page's, not the terminal's
  assert.equal(parseSlash("Fix the date test", "cli"), null);
  assert.equal(parseSlash("/etc/hosts is wrong", "cli"), null); // a path, not a command
  assert.equal(parseSlash("@scribe /help", "cli"), null);
});

test("required args, and what waits while a run is going", () => {
  const link = findCommand("link", "cli")!, links = findCommand("links", "cli")!, reply = findCommand("reply", "cli")!, good = findCommand("good", "cli")!;
  assert.equal(usageProblem(link, ""), "Usage: /link <path> [--edit]");
  assert.equal(usageProblem(link, "~/code"), null);
  assert.equal(usageProblem(links, ""), null);
  assert.equal(usageProblem(good, ""), null); // [note] is optional
  assert.match(busyProblem(reply, true)!, /waits until/);
  assert.equal(busyProblem(reply, false), null);
  assert.equal(busyProblem(good, true), null);
  // Filled in the pack's words where it's said.
  assert.match(busyProblem(reply, true, (t) => t.replace("{expedition}", "voyage"))!, /the voyage that's going/);
});

test("/help lists every command on the surface, grouped, in the pack's words", () => {
  const text = helpText("cli", (t) => t.replaceAll("{crew}", "ship's company").replace(/\{[^}]+\}/g, "…"));
  for (const c of commandsOn("cli")) assert.ok(text.includes(c.name === "exit" ? "  exit" : `/${c.name}`), c.name);
  assert.match(text, /\/project \[name \| off\] \(also \/projects\)/);
  assert.match(text, /^Requests:$/m);
  assert.match(text, /^Models & spend:$/m);
  assert.ok(text.includes("ship's company") && !/\{\w+\}/.test(text));
  assert.ok(!text.includes("/today")); // the page's
  // Long heads put the description on the next line, lined up.
  assert.match(text, /\/worktree .+\n {21}Work in a git worktree/);
});

test("dispatch: runs the command's handler, refuses what's wrong, and leaves requests alone", async () => {
  const ran: string[] = [];
  const handlers = Object.fromEntries(commandsOn("cli", { hidden: true }).map((c) => [c.name, (arg: string) => { ran.push(`${c.name}:${arg}`); return c.name; }])) as Handlers<"cli">;
  assert.deepEqual(await dispatch("/budget 2.50", "cli", handlers), { ran: "command", name: "budget", result: "budget" });
  assert.deepEqual(await dispatch("/projects web", "cli", handlers), { ran: "command", name: "project", result: "project" });
  assert.deepEqual(ran, ["budget:2.50", "project:web"]);
  assert.deepEqual(await dispatch("Tidy the README", "cli", handlers), { ran: "none" });
  assert.deepEqual(await dispatch("/link", "cli", handlers), { ran: "refused", message: "Usage: /link <path> [--edit]" });
  assert.deepEqual(await dispatch("/undoo", "cli", handlers), { ran: "refused", message: "There's no /undoo. Did you mean /undo? Type /help for the list." });
  const busy = await dispatch("/undo", "cli", handlers, { busy: true });
  assert.equal(busy.ran, "refused");
  assert.equal(ran.length, 2); // nothing refused ran
  // An async handler is waited for.
  const later = { ...handlers, diff: async () => { await new Promise((r) => setTimeout(r, 5)); return "late"; } };
  assert.deepEqual(await dispatch("/diff", "cli", later), { ran: "command", name: "diff", result: "late" });
});

test("the terminal has a handler for each of its commands, and its /help comes from the registry", () => {
  // The type makes camp.ts list every one (Handlers<"cli">); here, that it's the registry it reads.
  const src = readFileSync(new URL("../src/camp.ts", import.meta.url), "utf8");
  assert.match(src, /const CLI: Handlers<"cli"> = \{/);
  assert.match(src, /helpText\("cli", say\)/);
  assert.match(src, /dispatch\(cmd, "cli", CLI/);
  for (const c of commandsOn("cli", { hidden: true })) assert.match(src, new RegExp(`\\n  ${c.name}: `), `camp.ts handles /${c.name}`);
  // No slash command matched by hand any more.
  assert.doesNotMatch(src, /cmd\.match\(\/\^\\\//);
  // A compile-time check: these are the terminal's names, and the page's aren't among them.
  const name: CommandName<"cli"> = "worktree";
  // @ts-expect-error  /orbit is the page's
  const notOne: CommandName<"cli"> = "orbit";
  assert.ok(name && notOne);
});

function pick(p: ReturnType<typeof parseSlash>) {
  return p && "command" in p ? { name: p.command.name, arg: p.arg } : p;
}
