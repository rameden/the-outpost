// Other models (Gemini, Groq, OpenRouter): connecting with a key, what's kept and what's shown,
// the request and reply translated both ways, a crew member running on one, the camp's small
// jobs sent to one, and confidential projects kept with Claude. A stand-in plays the provider.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi } from "./helpers/fake-api.ts";

enterSandbox("providers");
const claude = await startFakeApi(() => ({ text: "claude answered" }));
process.env.ANTHROPIC_BASE_URL = claude.url;

// The stand-in provider: lists models, and answers chat requests from a script, as a stream.
type Said = { text?: string; calls?: { name: string; args: string; id?: string }[]; finish?: string; status?: number; error?: string };
let say: (body: any) => Said = () => ({ text: "ok" });
const seen: { path: string; auth: string; body: any }[] = [];
let models: any = { data: [{ id: "llama-fast", name: "Llama Fast" }, { id: "text-embedding-1" }, { id: "whisper-large" }] };
const provider = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ path: req.url ?? "", auth: String(req.headers.authorization ?? ""), body });
    if (req.headers.authorization !== "Bearer good-key-123456") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "Invalid API Key" } })); }
    if (req.url === "/models") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(models)); }
    const r = say(body);
    if (r.status) { res.writeHead(r.status, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: r.error ?? "nope" } })); }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (j: object) => res.write(`data: ${JSON.stringify(j)}\n\n`);
    // Words and tool-call arguments arrive in pieces, as they do for real.
    for (const piece of (r.text ?? "").match(/.{1,7}/gs) ?? []) send({ choices: [{ delta: { content: piece } }] });
    (r.calls ?? []).forEach((c, index) => {
      send({ choices: [{ delta: { tool_calls: [{ index, id: c.id ?? `call_${index}`, type: "function", function: { name: c.name, arguments: "" } }] } }] });
      for (const piece of c.args.match(/.{1,9}/gs) ?? []) send({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: piece } }] } }] });
    });
    send({ choices: [{ delta: {}, finish_reason: r.finish ?? (r.calls?.length ? "tool_calls" : "stop") }] });
    send({ choices: [], usage: { prompt_tokens: 321, completion_tokens: 45 } });
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise<void>((ok) => provider.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
for (const id of ["GEMINI", "GROQ", "OPENROUTER"]) process.env[`PROVIDER_BASE_URL_${id}`] = base;
for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) delete process.env[k];

const p = await import("../src/providers.ts");
const { runDirect, runExpedition } = await import("../src/quartermaster.ts");
const { threadFor } = await import("../src/threads.ts");
const { listModels } = await import("../src/agent.ts");
const { setAgentSettings, setSmallModel, smallModel } = await import("../src/settings.ts");
const { askSmall } = await import("../src/small.ts");
const c = await import("../src/conversations.ts");
const { readFileFor, rl } = await import("../src/tools.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
after(async () => { rl.close(); await claude.close(); provider.closeAllConnections(); provider.close(); });
setAsker(async () => "y");
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { seen.length = 0; events.length = 0; claude.seen.length = 0; say = () => ({ text: "ok" }); });

test("connecting: the provider checks the key, it's kept on disk for you alone, and the page is never shown it", async () => {
  assert.deepEqual(p.providersState().map((s) => [s.id, s.connected]), [["gemini", false], ["groq", false], ["openrouter", false]]);
  await assert.rejects(p.connectProvider("groq", "bad-key-000000"), /Groq didn't accept that key: Invalid API Key/);
  await assert.rejects(p.connectProvider("groq", "short"), /doesn't look like an API key/);
  await assert.rejects(p.connectProvider("groq", "has a space in it"), /doesn't look like an API key/);
  await assert.rejects(p.connectProvider("chatgpt", "good-key-123456"), /no such provider/);
  await assert.rejects(p.connectProvider("openrouter", "bad-key-000000"), /OpenRouter didn't accept that key/);
  assert.ok(!existsSync(p.PROVIDERS_PATH), "nothing is kept for a key that wasn't accepted");

  const state = await p.connectProvider("groq", "  good-key-123456 ");
  assert.deepEqual([state.connected, state.from, state.models, state.free], [true, "camp", 1, 0]); // the embedding and speech models aren't offered
  assert.equal(seen.at(-1)!.path, "/models");
  assert.equal(statSync(p.PROVIDERS_PATH).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(p.providersState()).includes("good-key"), "the key isn't in what the page gets");
  assert.match(p.providersState()[1].privacy, /free tier/);
  // No crew member can read it.
  await assert.rejects(() => readFileFor("scout").run!({ path: "camp/providers.json" }) as Promise<unknown>);

  // Gemini names its models "models/…"; OpenRouter marks the free ones, which come first.
  models = { data: [{ id: "models/gemini-flash", display_name: "Gemini Flash" }, { id: "models/embedding-001" }] };
  await p.connectProvider("gemini", "good-key-123456");
  assert.deepEqual(await p.providerModels("gemini"), [{ id: "gemini-flash", name: "Gemini Flash" }]);
  models = { data: [{ id: "big/paid", name: "Paid", pricing: { prompt: "0.000003", completion: "0.000015" } }, { id: "meta/llama:free", name: "Llama (free)", pricing: { prompt: "0", completion: "0" } }] };
  seen.length = 0;
  await p.connectProvider("openrouter", "good-key-123456");
  assert.deepEqual(seen.map((s) => s.path), ["/key", "/models"], "its model list is public, so the key is checked where only a valid key is answered");
  assert.deepEqual((await p.providerModels("openrouter")).map((m) => [m.id, !!m.free]), [["meta/llama:free", true], ["big/paid", false]]);

  // In the camp's own list: after Claude's, named by provider; OpenRouter's paid ones are left off.
  const others = (await listModels()).models.filter((m) => m.provider);
  assert.deepEqual(others.map((m) => [m.id, m.provider, m.price ?? null, m.efforts.length]), [
    ["gemini:gemini-flash", "Gemini", null, 0], ["groq:llama-fast", "Groq", null, 0], ["openrouter:meta/llama:free", "OpenRouter", "free", 0]]);
  assert.deepEqual(p.otherModel("openrouter:meta/llama:free"), { provider: "openrouter", name: "OpenRouter", model: "meta/llama:free" });
  assert.equal(p.otherModel("claude-haiku-5-5"), null);

  assert.equal(p.disconnectProvider("gemini"), true);
  assert.equal(p.disconnectProvider("gemini"), false);
  assert.ok(!readFileSync(p.PROVIDERS_PATH, "utf8").includes("gemini"));
  assert.deepEqual(await p.providerModels("gemini"), []);
  // A key set where the camp starts is used, and can't be forgotten from the page.
  process.env.GEMINI_API_KEY = "good-key-123456";
  assert.deepEqual([p.providersState()[0].connected, p.providersState()[0].from], [true, "env"]);
  assert.equal(p.disconnectProvider("gemini"), false);
  delete process.env.GEMINI_API_KEY;
});

test("the camp's request and the provider's reply are translated both ways", async () => {
  const messages = [
    { role: "user" as const, content: "Read the notes" },
    { role: "assistant" as const, content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Reading." }, { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "notes.md" } }] },
    { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "# Notes" }] }, { type: "text", text: "(3 turns left)" }] },
    { role: "user" as const, content: [{ type: "text", text: "And this picture" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
  ];
  assert.deepEqual(p.toChatMessages("You are the Scout.", messages), [
    { role: "system", content: "You are the Scout." },
    { role: "user", content: "Read the notes" },
    { role: "assistant", content: "Reading.", tool_calls: [{ id: "tu_1", type: "function", function: { name: "read_file", arguments: '{"path":"notes.md"}' } }] },
    { role: "tool", tool_call_id: "tu_1", content: "# Notes" },
    { role: "user", content: "(3 turns left)" },
    { role: "user", content: [{ type: "text", text: "And this picture" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
  ]);
  // Claude's own web search has no schema of ours and no equivalent there: it's left out.
  assert.deepEqual(p.toChatTools([{ type: "web_search_20250305", name: "web_search" }, { name: "grep", description: "Search", input_schema: { type: "object", properties: {} } }]),
    [{ type: "function", function: { name: "grep", description: "Search", parameters: { type: "object", properties: {} } } }]);

  // A reply in pieces: the words as they come, a tool call's arguments put back together, the usage.
  say = () => ({ text: "Looking at the file now.", calls: [{ name: "read_file", args: '{"path":"docs/a long name.md"}', id: "c9" }, { name: "grep", args: '{"pattern":"x"}' }] });
  let streamed = "";
  const r = await p.providerChat({ provider: "groq", model: "llama-fast", system: "S", messages: [{ role: "user", content: "go" }], tools: [{ name: "read_file", input_schema: {} }], onDelta: (d) => (streamed += d) });
  assert.equal(streamed, "Looking at the file now.");
  assert.deepEqual(r, { stop_reason: "tool_use", usage: { input_tokens: 321, output_tokens: 45 }, content: [
    { type: "text", text: "Looking at the file now." },
    { type: "tool_use", id: "c9", name: "read_file", input: { path: "docs/a long name.md" } },
    { type: "tool_use", id: "call_1", name: "grep", input: { pattern: "x" } }] });
  const sent = seen.at(-1)!;
  assert.equal(sent.path, "/chat/completions");
  assert.deepEqual([sent.body.model, sent.body.stream, sent.body.tools.length, sent.body.messages[0].role], ["llama-fast", true, 1, "system"]);

  say = () => ({ text: "The end." });
  assert.equal((await p.providerChat({ provider: "groq", model: "m", system: "", messages: [{ role: "user", content: "x" }] })).stop_reason, "end_turn");
  assert.equal(seen.at(-1)!.body.tools, undefined, "no tools: none are sent");
  // Cut off: by length, or with a tool call whose arguments stop mid-way (which must not be run).
  say = () => ({ text: "Half a", finish: "length" });
  assert.equal((await p.providerChat({ provider: "groq", model: "m", system: "", messages: [{ role: "user", content: "x" }] })).stop_reason, "max_tokens");
  say = () => ({ calls: [{ name: "write_file", args: '{"path":"a.md","content":"half' }] });
  assert.equal((await p.providerChat({ provider: "groq", model: "m", system: "", messages: [{ role: "user", content: "x" }] })).stop_reason, "max_tokens");
  say = () => ({ text: "", finish: "content_filter" });
  assert.equal((await p.providerChat({ provider: "groq", model: "m", system: "", messages: [{ role: "user", content: "x" }] })).stop_reason, "refusal");
  // What goes wrong is said plainly.
  say = () => ({ status: 429, error: "Rate limit reached for model" });
  await assert.rejects(p.providerChat({ provider: "groq", model: "m", system: "", messages: [{ role: "user", content: "x" }] }), /Groq says you've hit its rate limit: Rate limit reached for model Free tiers allow only so many requests a minute/);
  await assert.rejects(p.providerChat({ provider: "gemini", model: "m", system: "", messages: [{ role: "user", content: "x" }] }), /Gemini isn't connected\. Add its key under Settings → Models/);
});

test("a crew member set to another provider's model runs there: same tools, same loop, nothing sent to Claude", async () => {
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/policy.md", "Deploy freezes start on the 15th.\n");
  setAgentSettings("scout", { model: "groq:llama-fast" });
  say = (body) => (body.messages.some((m: any) => m.role === "tool")
    ? { text: "Freezes start on the **15th** (docs/policy.md)." }
    : { text: "Let me look.", calls: [{ name: "read_file", args: '{"path":"docs/policy.md"}' }] });
  const r = await runDirect("scout", "When do deploy freezes start?");
  assert.equal(r?.status, "done");
  assert.match(r!.text, /15th/);
  assert.equal(r!.model, "groq:llama-fast");
  assert.equal(claude.seen.length, 0, "Claude wasn't asked");
  const chats = seen.filter((s) => s.path === "/chat/completions");
  assert.equal(chats.length, 2);
  assert.match(chats[0].body.messages[0].content, /You are the Scout/);
  const names = chats[0].body.tools.map((t: any) => t.function.name);
  assert.ok(names.includes("read_file") && names.includes("recall") && names.includes("remember"));
  assert.ok(!names.includes("web_search") && !names.includes("web_fetch"), "Claude's web tools aren't offered there");
  // The second request carries the tool's result back.
  assert.deepEqual(chats[1].body.messages.at(-1), { role: "tool", tool_call_id: "call_0", content: chats[1].body.messages.at(-1).content });
  assert.match(chats[1].body.messages.at(-1).content, /Deploy freezes start on the 15th/);
  // The page sees it like any run: words as they come, the tool, the final text.
  assert.ok(events.some((e) => e.type === "text_delta" && e.who === "Scout"));
  assert.ok(events.some((e) => e.type === "tool" && e.tool === "read_file"));
  assert.deepEqual([r!.usage.input, r!.usage.output], [642, 90]);

  // A project you've marked confidential isn't sent there: the run stops and says how to fix it.
  const secret = c.addProject({ name: "Work app" });
  c.updateProject(secret.id, { settings: { web: "careful" } });
  seen.length = 0;
  await assert.rejects(runDirect("scout", "Summarise the repo", "direct", [], undefined, "conf1", undefined, { project: secret.id, links: [] }),
    /Scout is set to run on Groq \(llama-fast\), but this project is marked confidential, so nothing from it is sent to another provider/);
  assert.equal(seen.length, 0, "nothing reached the provider");
  // Unless you've said that provider is approved for confidential work: then it runs there.
  assert.equal(p.maySend("groq", "careful"), false);
  assert.equal(p.maySend("groq", undefined), true, "a project that isn't confidential never needed it");
  assert.equal(p.approveProvider("groq", true), true);
  assert.equal(p.approveProvider("chatgpt", true), false);
  assert.deepEqual(p.providersState().map((s) => [s.id, s.approved]), [["gemini", false], ["groq", true], ["openrouter", false]]);
  assert.deepEqual([p.maySend("groq", "careful"), p.maySend("groq", "off"), p.maySend("openrouter", "careful")], [true, true, false], "the approval is that provider's alone");
  say = () => ({ text: "A summary of the work app." });
  const ok = await runDirect("scout", "Summarise the repo", "direct", [], undefined, "conf2", undefined, { project: secret.id, links: [] });
  assert.equal(ok?.status, "done");
  assert.equal(seen.filter((s) => s.path === "/chat/completions").length, 1);
  p.approveProvider("groq", false);
  await assert.rejects(runDirect("scout", "Again", "direct", [], undefined, "conf3", undefined, { project: secret.id, links: [] }), /If Groq is approved for this work, say so under Settings → Models/);
  // A provider that fails mid-run is a failed run with its reason, not a crash.
  say = () => ({ status: 500, error: "upstream exploded" });
  await assert.rejects(runDirect("scout", "Anything"), /Groq answered 500: upstream exploded/);
  setAgentSettings("scout", { model: null });
});

test("the camp's small jobs go to the model you chose, except for a confidential project's", async () => {
  assert.equal(smallModel(), null);
  setSmallModel("openrouter:meta/llama:free");
  say = () => ({ text: "Release notes plan" });
  assert.equal(await askSmall("You name conversations.", "The user asked: write the release notes"), "Release notes plan");
  const sent = seen.at(-1)!;
  assert.deepEqual([sent.path, sent.body.model, sent.body.messages.map((m: any) => m.role).join(","), sent.body.tools], ["/chat/completions", "meta/llama:free", "system,user", undefined]);
  assert.equal(claude.seen.length, 0);
  // A confidential project's text stays with Claude, whatever you chose.
  const secret = c.history().projects.find((x) => x.name === "Work app")!;
  seen.length = 0;
  await askSmall("You name conversations.", "The user asked about the work app", 40, { project: secret.id }).catch(() => "");
  assert.equal(seen.length, 0, "the provider wasn't sent it");
  assert.equal(claude.seen.length, 1, "Claude was asked instead");
  assert.equal(claude.seen[0].body.model, "claude-haiku-5-5");
  // Approved, that provider gets the confidential project's small jobs too. Forgetting its key takes the approval with it.
  p.approveProvider("openrouter", true);
  say = () => ({ text: "Work app title" });
  assert.equal(await askSmall("You name conversations.", "The user asked about the work app", 40, { project: secret.id }), "Work app title");
  assert.equal(p.disconnectProvider("openrouter"), true);
  assert.equal(p.providersState()[2].approved, false);
  setSmallModel(null);
});

test("a conversation can name its own model: whoever you're talking to answers on it, replies keep it, and quests keep theirs", async () => {
  // A direct chat with the Scribe, on Groq for this conversation only.
  say = () => ({ text: "Hello from the stand-in." });
  const r = await runDirect("scribe", "Say hello", "direct", [], undefined, "pick1", undefined, { project: "general", links: [], model: "groq:llama-fast" });
  assert.equal(r?.model, "groq:llama-fast");
  assert.equal(seen.at(-1)!.body.model, "llama-fast");
  assert.equal(claude.seen.length, 0);
  // It's the conversation's: kept with its record, and what a reply starts from.
  assert.equal(threadFor("pick1")!.model, "groq:llama-fast");
  assert.equal(c.history().conversations.find((x) => x.id === "pick1")!.model, "groq:llama-fast");
  // The Scribe's own setting hasn't changed: another conversation with no pick is on Claude.
  seen.length = 0;
  const plain = await runDirect("scribe", "Say hello again", "direct", [], undefined, "pick2", undefined, { project: "general", links: [] });
  assert.notEqual(plain?.model, "groq:llama-fast");
  assert.equal(seen.length, 0);
  assert.equal(claude.seen.at(-1)!.who, "Scribe");
  assert.equal(threadFor("pick2")!.model, undefined);

  // With the Quartermaster: it plans and dispatches on the picked model; the Scout it sends stays on its own (Claude).
  seen.length = 0; claude.seen.length = 0;
  say = (body) => {
    const results = body.messages.filter((m: any) => m.role === "tool").length;
    return results === 0 ? { calls: [{ name: "submit_plan", args: '{"plan":"Ask the Scout."}' }] }
      : results === 1 ? { calls: [{ name: "dispatch", args: '{"adventurer":"scout","brief":"Look it up"}' }] }
      : { text: "The Scout is back. Done." };
  };
  const x = await runExpedition("Find something out", { id: "pick3", project: "general", links: [], model: "groq:llama-fast" });
  assert.equal(x.status, "done");
  assert.equal(x.model, "groq:llama-fast");
  assert.ok(seen.filter((s) => s.path === "/chat/completions").every((s) => /You are the Quartermaster/.test(s.body.messages[0].content)), "only the Quartermaster went to the provider");
  assert.deepEqual(claude.seen.map((s) => s.who), ["Scout"], "the quest ran on the Scout's own model");
});

test("the models guide: every model the camp can reach, by cost, speed and what it's good for, saying what's known and what's a rule of thumb", async () => {
  const { rateModel, modelGuide, writeModelGuide, GUIDE_PATH } = await import("../src/modelguide.ts");
  // Claude: real prices, from the camp's own table.
  const haiku = rateModel({ id: "claude-haiku-5-5", name: "Claude Haiku 5.5" });
  assert.deepEqual([haiku.cost, haiku.speed, haiku.rated], ["$ ($0.1 in / $0.5 out per million tokens)", "Fastest", true]);
  assert.match(rateModel({ id: "claude-opus-5-5", name: "Opus" }).cost, /^\$\$\$ \(\$4 in \/ \$20 out/);
  assert.match(rateModel({ id: "claude-opus-5-5", name: "Opus" }).fit, /Hard, many-step work/);
  assert.match(rateModel({ id: "claude-fable-5-1", name: "Fable" }).cost, /^\$\$\$\$/);
  // Others: judged from the family name, and said to be unrated when the name says nothing.
  const g = (id: string, provider = "Gemini", free = false) => rateModel({ id: `${provider.toLowerCase()}:${id}`, name: id, provider, free });
  assert.deepEqual([g("gemini-2.5-flash-lite").speed, g("gemini-2.5-flash").speed, g("gemini-2.5-pro").speed], ["Fastest", "Fast", "Steady"]);
  assert.deepEqual([g("gemini-2.5-flash").cost, g("gemini-2.5-pro").cost], ["$", "$$$"]);
  assert.match(g("llama-3.1-8b-instant", "Groq").fit, /Simple jobs/);
  assert.match(g("llama-3.3-70b-versatile", "Groq").fit, /Everyday work where speed or cost matters/);
  assert.match(g("llama-3.3-70b-versatile", "Groq").speed, /^Very fast/);
  assert.equal(g("meta/llama-small:free", "OpenRouter", true).cost, "free");
  assert.deepEqual([g("mystery-model", "Groq").rated, g("mystery-model", "Groq").fit], [false, "Not rated: try it on a small task first."]);

  models = { data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" }, { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B" }] };
  await p.connectProvider("groq", "good-key-123456");
  p.approveProvider("groq", true);
  const page = await modelGuide(new Date("2026-11-12T10:00:00Z"));
  assert.match(page, /^---\nsummary: Every model the camp can use[^\n]*\nupdated: 2026-11-12\n---\n\n# Models guide/);
  assert.match(page, /## How to choose/);
  assert.match(page, /## Claude\n\nRuns the crew by default\. Prices are the camp's own/);
  assert.match(page, /\| Claude Haiku 5\.5 \| `claude-haiku-5-5` \| \$ \(\$0\.1 in \/ \$0\.5 out per million tokens\) \| Fastest \|/);
  // The provider's section says whether it's approved, what to watch for, and that its ratings are a rule of thumb.
  assert.match(page, /## Groq\n\nYou've approved it for confidential projects\. [^\n]*judged from each model's family name, as a rule of thumb/);
  assert.match(page, /\| Llama 3\.3 70B \| `groq:llama-3\.3-70b-versatile` \| \$ \| Very fast/);
  assert.match(page, /Treat the ratings for other providers as a starting point, not a measurement/);
  assert.match(page, /## Not connected\n\nGemini, OpenRouter: add a key under Settings → Models/);
  assert.ok(page.indexOf("claude-haiku") < page.indexOf("claude-opus"), "cheapest first within a group");
  assert.ok(!page.includes("good-key"), "no key is ever in it");
  // Written into the wiki's notes (claims to weigh), where the crew's index lists it.
  assert.equal(await writeModelGuide(), "camp/wiki/notes/models-guide.md");
  assert.ok(readFileSync(GUIDE_PATH, "utf8").includes("# Models guide"));
  const { wikiIndex } = await import("../src/wiki.ts");
  assert.match(wikiIndex(), /camp\/wiki\/notes\/models-guide\.md: Every model the camp can use/);
  p.approveProvider("groq", false);
});
