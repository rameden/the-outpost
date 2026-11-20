// The Quartermaster can look things up: general questions get a web search and an answer with
// sources, without a plan or a dispatch.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, whoAsks } from "./helpers/fake-api.ts";

enterSandbox("qm-web");
const seen: any[] = [];
const api = await startFakeApi((body) => { seen.push(body); return { text: "Paris. Sources: https://example.com/france" }; });
process.env.ANTHROPIC_BASE_URL = api.url;
process.env.CAMP_APPROVE_PLANS = "0";

const { runExpedition, quartermasterSpec } = await import("../src/quartermaster.ts");
const { crewSetup } = await import("../src/agent.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

const names = (tools: { def: object }[]) => tools.flatMap((t) => ("name" in t.def ? [String((t.def as any).name)] : []));

test("the Quartermaster has web search and fetch, and is told to research general questions itself", () => {
  const spec = quartermasterSpec();
  assert.ok(names(spec.tools).includes("web_search"));
  assert.ok(names(spec.tools).includes("web_fetch"));
  assert.match(spec.persona, /General questions:[\s\S]*web_search[\s\S]*sources/);
  assert.match(crewSetup(spec), /web_search, web_fetch/);
});

test("a general question reaches the model with the web tools on the Quartermaster's turn", async () => {
  const result = await runExpedition("What's the capital of France?");
  assert.match(result.text, /Paris/);
  const qm = seen.find((b) => whoAsks(b) === "Quartermaster");
  assert.ok(qm, "the Quartermaster was asked");
  const tools = qm.tools.map((t: any) => t.name);
  assert.ok(tools.includes("web_search") && tools.includes("web_fetch"), `tools sent: ${tools.join(", ")}`);
});
