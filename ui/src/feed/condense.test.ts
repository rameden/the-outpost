// The condensed feed: which lines fold, and what the folded line says.
import { expect, test } from "vitest";
import { condense, isBehindTheScenes, parseDetail, sortOf, summarize } from "./condense.ts";
import type { AskNode, FeedNode } from "./reducer.ts";

const tool = (id: string, name: string, who = "Scout"): FeedNode => ({ kind: "tool", id, who, tool: name, input: "{}" });
const msg = (id: string): FeedNode => ({ kind: "msg", id, who: "Scout", emoji: "🔭", text: "hi", streaming: false });
const ask = (id: string, outcome: string | null, askKind: AskNode["askKind"] = "shell"): FeedNode =>
  ({ kind: "ask", id, askId: id, askKind, title: "t", body: "npm test", who: "Scout", outcome });

test("runs of tool calls and answered commands fold; messages and waiting approvals break them", () => {
  const out = condense([tool("1", "read_file"), ask("2", "✓ Command allowed"), msg("3"), tool("4", "grep"), ask("5", null), tool("6", "bash")]);
  expect(out.map((n) => n.kind)).toEqual(["steps", "msg", "steps", "ask", "steps"]);
  expect(out[0].kind === "steps" && out[0].nodes.map((n) => n.id)).toEqual(["1", "2"]);
});

test("a waiting approval, a plan and a file always stay in view", () => {
  expect(isBehindTheScenes(ask("a", null))).toBe(false);
  expect(isBehindTheScenes(ask("b", "✓ Plan approved", "plan"))).toBe(false);
  expect(isBehindTheScenes({ kind: "file", id: "f", who: "Scribe", path: "a.md", change: "created", bytes: 1 })).toBe(false);
});

test("tool names sort into what they did, MCP ones included", () => {
  expect(sortOf("read_file")).toBe("read");
  expect(sortOf("Read")).toBe("read");
  expect(sortOf("grep")).toBe("search");
  expect(sortOf("list_dir")).toBe("list");
  expect(sortOf("bash")).toBe("command");
  expect(sortOf("write_file")).toBe("edit");
  expect(sortOf("web_fetch")).toBe("web");
  expect(sortOf("mcp__jira__get_issue")).toBe("other");
});

test("the folded line counts the work, what you allowed and turned down, and who did it", () => {
  const s = summarize([tool("1", "read_file"), tool("2", "read_file", "Warden"), tool("3", "bash"), ask("4", "✓ Command allowed"), ask("5", "✕ Declined")]);
  expect(s.text).toBe("Read 2 files, ran 1 command");
  expect([s.allowed, s.declined]).toEqual([1, 1]);
  expect(s.who).toEqual(["Scout", "Warden"]);
});

test("condensed is the default view", () => {
  expect(parseDetail(null)).toBe("condensed");
  expect(parseDetail("junk")).toBe("condensed");
  expect(parseDetail("detailed")).toBe("detailed");
});
