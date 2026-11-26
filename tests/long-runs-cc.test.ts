// Long runs on the Claude Code runtime (the subscription): tool output too long to show is set
// aside in a file there too, and a run that broke off is picked up from its saved transcript.
// Claude Code keeps its own conversation within the context, so the camp's compaction doesn't run here.
import { test as nodeTest, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox, REPO, NEEDS_SH } from "./helpers/sandbox.ts";

const test = (name: string, fn: () => void | Promise<void>) => nodeTest(name, { skip: NEEDS_SH }, fn);

enterSandbox("long-runs-cc");
process.env.CAMP_RUNTIME = "claude-code";
const fakeClaude = join(REPO, "tests/fixtures/fake-claude.sh");
chmodSync(fakeClaude, 0o755);
process.env.CLAUDE_CODE_EXECUTABLE = fakeClaude;

const { useQueryForTests } = await import("../src/claude-code.ts");
const { runAgent } = await import("../src/agent.ts");
const { withExpedition } = await import("../src/context.ts");
const { onEvent } = await import("../src/events.ts");
const { RUNS_DIR } = await import("../src/runstore.ts");
const { MAX_TOOL_OUTPUT, rl } = await import("../src/tools.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
after(() => { useQueryForTests(null); rl.close(); });

const events: any[] = [];
onEvent((e) => events.push(e));
let seen: any = null;
beforeEach(() => { events.length = 0; seen = null; });

// A stand-in for Claude Code: calls the camp's tools over MCP, then answers, or breaks off where it's told to.
function fakeSession(calls: { name: string; args: any }[], finalText: string, o: { failAfterCalls?: boolean } = {}) {
  return async function* ({ prompt, options }: any) {
    seen = { results: [] as string[] };
    for await (const first of prompt) { seen.first = JSON.stringify(first); break; }
    const [a, b] = InMemoryTransport.createLinkedPair();
    await options.mcpServers.camp.instance.connect(b);
    const client = new Client({ name: "fake-claude", version: "0" });
    await client.connect(a);
    for (const c of calls) {
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: `tu_${c.name}`, name: `mcp__camp__${c.name}`, input: c.args }] } };
      const res: any = await client.callTool({ name: c.name, arguments: c.args });
      const text = res.content.map((x: any) => x.text ?? `[${x.type}]`).join("");
      seen.results.push(text);
      yield { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${c.name}`, content: text }] } };
    }
    await client.close();
    if (o.failAfterCalls) throw new Error("Claude Code process exited with code 1");
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: finalText }] } };
    yield { type: "result", subtype: "success", result: finalText, num_turns: calls.length + 1, total_cost_usd: 0.01, is_error: false,
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
}
const shellTool = (run: (input: any) => string) => ({ def: { name: "bash", description: "run", input_schema: { type: "object" as const, properties: { command: { type: "string" } } } }, run: async (input: any) => run(input) });
const specWith = (tools: any[]) => ({ id: "scribe" as const, name: "Scribe", emoji: "📜", role: "test", persona: "test", tools, skillDirs: [] });

test("on Claude Code, long tool output is spilled to a file the same way", async () => {
  const big = "START " + "q".repeat(MAX_TOOL_OUTPUT + 5_000) + " END";
  useQueryForTests(fakeSession([{ name: "bash", args: { command: "cat big.log" } }], "Read it.") as any);
  const r = await runAgent(specWith([shellTool(() => big)]) as any, "Look at the log", { plain: true });
  assert.equal(r.status, "done");
  assert.equal(r.runtime, "claude-code");
  const got = seen.results[0] as string;
  assert.ok(got.length < 12_000 && got.startsWith("START ") && got.includes(" END"));
  const path = got.match(/saved at (camp\/spill\/scribe__[\w-]+\.txt)/)![1];
  assert.equal(readFileSync(path, "utf8"), big);
});

test("on Claude Code, a run that broke off leaves its transcript, and the reply to it starts from what was done", async () => {
  const file = `${RUNS_DIR}/t-cc_scribe.json`;
  const ran: string[] = [];
  const shell = shellTool(({ command }) => { ran.push(command); return `did ${command}`; });
  useQueryForTests(fakeSession([{ name: "bash", args: { command: "gh pr create" } }], "", { failAfterCalls: true }) as any);
  await assert.rejects(withExpedition({ id: "e1", thread: "t-cc" }, () => runAgent(specWith([shell]) as any, "Open the pull request, then announce it", { plain: true })));
  assert.deepEqual(ran, ["gh pr create"]);
  const left = JSON.parse(readFileSync(file, "utf8"));
  assert.match(JSON.stringify(left.messages), /gh pr create[\s\S]*did gh pr create/);

  useQueryForTests(fakeSession([], "Announced.") as any);
  const r = await withExpedition({ id: "e2", thread: "t-cc", replyTo: "e1" }, () => runAgent(specWith([shell]) as any, "carry on", { plain: true }));
  assert.equal(r.status, "done");
  assert.match(seen.first, /You called bash: .*gh pr create/);
  assert.match(seen.first, /Result: did gh pr create/);
  assert.match(seen.first, /Open the pull request, then announce it/);
  assert.match(seen.first, /carry on/);
  assert.deepEqual(ran, ["gh pr create"], "nothing was run again");
  assert.match(events.filter((e) => e.type === "notice").map((e) => e.text).join("\n"), /Picked up from the saved transcript/);
  assert.equal(existsSync(file), false, "the file goes once the run is done");
});
