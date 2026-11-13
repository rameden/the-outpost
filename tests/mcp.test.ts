// MCP connectors: per-agent, read-only by default, writes need approval.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox, REPO } from "./helpers/sandbox.ts";

enterSandbox("mcp");
mkdirSync("notes");
writeFileSync("notes/shopping.md", "buy rope\n");
cpSync(join(REPO, "tests/fixtures/notes-server.mjs"), "notes-server.mjs");
writeFileSync("camp/mcp.json", JSON.stringify({
  servers: {
    notes: { command: "node", args: ["notes-server.mjs", "notes"], agents: ["scribe"], allowWrite: true },
    readonly: { command: "node", args: ["notes-server.mjs", "notes"], agents: ["scout"] },
    broken: { command: "definitely-not-a-real-command-xyz", agents: ["artificer"] },
  },
}));
const { mcpToolsFor, connectorStatus, closeConnectors } = await import("../src/mcp.ts");
const { setAsker } = await import("../src/ask.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { await closeConnectors(); rl.close(); });

const names = async (agent: string) => (await mcpToolsFor(agent)).map((t: any) => t.def.name);

test("only assigned agents get a server's tools", async () => {
  assert.deepEqual(await names("scribe"), ["mcp__notes__list_notes", "mcp__notes__read_note", "mcp__notes__delete_note"]);
  assert.deepEqual(await names("quartermaster"), []);
});

test("read-only by default: write tools aren't offered", async () => {
  assert.deepEqual(await names("scout"), ["mcp__readonly__list_notes", "mcp__readonly__read_note"]);
});

test("read tools run straight away; write tools ask every time", async () => {
  const tools = await mcpToolsFor("scribe");
  const list = tools.find((t: any) => t.def.name.endsWith("list_notes"))!;
  const del = tools.find((t: any) => t.def.name.endsWith("delete_note"))!;
  let asked = 0;
  setAsker(async () => { asked++; return "n"; });
  assert.match(String(await list.run!({})), /shopping\.md/);
  assert.equal(asked, 0);
  assert.match(String(await del.run!({ name: "shopping.md" })), /declined/);
  assert.ok(existsSync("notes/shopping.md"));
  setAsker(async () => { asked++; return "y"; });
  assert.match(String(await del.run!({ name: "shopping.md" })), /deleted/);
  assert.ok(!existsSync("notes/shopping.md"));
  assert.equal(asked, 2);
});

test("status shows connected servers and errors", async () => {
  const status = await connectorStatus();
  assert.equal(status.find((s) => s.name === "notes")?.state, "connected");
  const broken = status.find((s) => s.name === "broken");
  assert.equal(broken?.state, "error");
  assert.match(broken?.error ?? "", /ENOENT|Connection closed/); // (how a missing program is reported differs on Windows)
});
