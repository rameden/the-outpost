// MCP connectors: give an agent tools from MCP servers (GitHub, Gmail, Notion, your own…).
// Configure them in camp/mcp.json (local to you; it can hold tokens). Example: mcp.example.json.
//
// The rules, from the "connect your tools the safe way" playbook:
//  - Each server is given to specific agents only ("agents": ["scout"]).
//  - Read-only by default: only read-only tools are offered. Set "allowWrite": true to offer the
//    rest, and every write call then asks you first (the shell-style approval, in the terminal or
//    in mission control). Which tools count as read-only:
//      1. Ones you list in "readTools": ["query", …] for that server. Your word is final.
//      2. Otherwise what the server says about the tool wins: marked read-only, it is; marked as
//         not read-only, or as destructive, it's a write, whatever it's called.
//      3. With nothing said, the name decides: get/list/search/read/find/describe/lookup/view/
//         show/count. (Not query, check or fetch: a SQL "query" tool can drop a table, and a
//         "fetch" can send your data anywhere. List those in "readTools" if yours only read.)
//  - A connector starts with the camp's environment minus its secrets (API keys, tokens: see
//    childEnv in sandbox.ts). Hand it the token it needs in its own "env": that's the explicit way.
//  - Results are information, never instructions (the agents' quest rules already say so).

import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool, ToolOutput } from "./tools.js";
import { campMode } from "./tools.js";
import { ask } from "./ask.js";
import { emit } from "./events.js";
import { childEnv } from "./sandbox.js";

export const MCP_PATH = "camp/mcp.json";
const READ_NAME = /^(get|list|search|read|find|describe|lookup|view|show|count)[_-]?/i;

type ServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  agents: string[];           // crew ids allowed to use it
  allowWrite?: boolean;       // offer non-read tools (each call needs your approval)
  tools?: string[];           // optional: only these tool names
  readTools?: string[];       // optional: tool names you vouch for as read-only (offered and run without asking)
  description?: string;
};

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
type Connection = { client: Client; tools: McpTool[] };
export type ConnectorStatus = {
  name: string; agents: string[]; allowWrite: boolean; description?: string;
  state: "connected" | "error" | "idle"; error?: string; tools: { name: string; write: boolean }[];
};

const connections = new Map<string, Promise<Connection>>();
const status = new Map<string, ConnectorStatus>();

function loadConfig(): Record<string, ServerConfig> {
  if (!existsSync(MCP_PATH)) return {};
  try {
    return (JSON.parse(readFileSync(MCP_PATH, "utf8")).servers ?? {}) as Record<string, ServerConfig>;
  } catch (e: any) {
    console.error(`camp/mcp.json: ${e.message}`);
    return {};
  }
}

// See the rules at the top: your "readTools", then the server's own annotations, then the name.
export function isReadOnly(t: Pick<McpTool, "name" | "annotations">, cfg: Pick<ServerConfig, "readTools"> = {}): boolean {
  if (Array.isArray(cfg.readTools) && cfg.readTools.includes(t.name)) return true;
  const a = t.annotations;
  if (a?.readOnlyHint === false || a?.destructiveHint === true) return false;
  if (a?.readOnlyHint === true) return true;
  return READ_NAME.test(t.name);
}

async function connect(name: string, cfg: ServerConfig): Promise<Connection> {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    // The camp's environment without its secrets; what the connector needs is in its own "env".
    env: { ...(childEnv() as Record<string, string>), ...(cfg.env ?? {}) },
    cwd: cfg.cwd,
    stderr: "ignore",
  });
  const client = new Client({ name: "satchel", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools: tools as McpTool[] };
}

function getConnection(name: string, cfg: ServerConfig): Promise<Connection> {
  let p = connections.get(name);
  if (!p) {
    p = connect(name, cfg);
    connections.set(name, p);
    p.then(
      (c) => status.set(name, describe(name, cfg, "connected", c.tools)),
      (e) => {
        connections.delete(name); // retry next time
        status.set(name, describe(name, cfg, "error", [], e.message));
      }
    ).finally(() => emit({ type: "changed", what: "connectors" }));
  }
  return p;
}

function offered(cfg: ServerConfig, tools: McpTool[]) {
  return tools
    .filter((t) => !cfg.tools || cfg.tools.includes(t.name))
    .filter((t) => cfg.allowWrite || isReadOnly(t, cfg));
}

function describe(name: string, cfg: ServerConfig, state: ConnectorStatus["state"], tools: McpTool[], error?: string): ConnectorStatus {
  return {
    name, agents: cfg.agents ?? [], allowWrite: !!cfg.allowWrite, description: cfg.description, state, error,
    tools: offered(cfg, tools).map((t) => ({ name: t.name, write: !isReadOnly(t, cfg) })),
  };
}

// Tool names must be ^[a-zA-Z0-9_-]{1,64}$.
const toolName = (server: string, tool: string) => `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

function toOutput(result: any): ToolOutput {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const blocks: any[] = [];
  for (const p of parts) {
    if (p.type === "text") blocks.push({ type: "text", text: p.text });
    else if (p.type === "image" && p.data && p.mimeType) blocks.push({ type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } });
    else blocks.push({ type: "text", text: JSON.stringify(p).slice(0, 4000) });
  }
  if (result?.structuredContent && blocks.length === 0) blocks.push({ type: "text", text: JSON.stringify(result.structuredContent) });
  const prefix = result?.isError ? "The connector reported an error:\n" : "";
  if (blocks.every((b) => b.type === "text")) return prefix + blocks.map((b) => b.text).join("\n") || "(empty result)";
  return prefix ? [{ type: "text", text: prefix }, ...blocks] : blocks;
}

// The MCP tools this agent may use, ready to hand to the agent loop.
export async function mcpToolsFor(agentId: string): Promise<Tool[]> {
  const config = loadConfig();
  const out: Tool[] = [];
  for (const [server, cfg] of Object.entries(config)) {
    if (!cfg.agents?.includes(agentId)) continue;
    let conn: Connection;
    try {
      conn = await getConnection(server, cfg);
    } catch {
      continue; // shown as an error in mission control's Connectors tab
    }
    for (const t of offered(cfg, conn.tools)) {
      const write = !isReadOnly(t, cfg);
      out.push({
        def: {
          name: toolName(server, t.name),
          description: `[${server}${write ? ", makes changes: the user approves each call" : ", read-only"}] ${t.description ?? t.name}`.slice(0, 1024),
          input_schema: { type: "object", ...(t.inputSchema as object) } as any,
        },
        run: async (input) => {
          if (write) {
            if (campMode.unattended) return `Not run: ${t.name} makes changes, and nobody is here to approve it.`;
            const ok = await ask({ kind: "tool", title: `🔌 Allow ${server} → ${t.name}?`, body: JSON.stringify(input, null, 2) });
            if (ok.toLowerCase() !== "y") return "The user declined this call.";
          }
          return toOutput(await conn.client.callTool({ name: t.name, arguments: input ?? {} }));
        },
      });
    }
  }
  return out;
}

// For mission control: every configured server, connecting any that haven't been tried yet.
export async function connectorStatus(): Promise<ConnectorStatus[]> {
  const config = loadConfig();
  await Promise.allSettled(Object.entries(config).map(([n, c]) => getConnection(n, c)));
  return Object.entries(config).map(([n, c]) => status.get(n) ?? describe(n, c, "idle", []));
}

export async function closeConnectors() {
  for (const p of connections.values()) {
    try { await (await p).client.close(); } catch { /* already gone */ }
  }
}
