// A tiny MCP server for testing which tools count as read-only: a "database" whose tools are
// named and annotated in ways that don't match what they do, plus one that reports what it can
// see of the environment it was started with.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync } from "node:fs";

const marker = process.argv[2];
const server = new Server({ name: "db", version: "0.0.1" }, { capabilities: { tools: {} } });
const schema = { type: "object", properties: {} };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "query", description: "Run any SQL", inputSchema: schema },                                             // reads by name, writes in fact
    { name: "fetch_url", description: "Send a request", inputSchema: schema },
    { name: "check_and_fix", description: "Repair tables", inputSchema: schema },
    { name: "get_and_clear_queue", description: "Empty the queue", inputSchema: schema, annotations: { readOnlyHint: false } },
    { name: "list_then_purge", description: "Purge old rows", inputSchema: schema, annotations: { destructiveHint: true } },
    { name: "run_report", description: "A report", inputSchema: schema, annotations: { readOnlyHint: true } },      // a write by name, marked read-only
    { name: "lookup_user", description: "Find a user", inputSchema: schema },
    { name: "show_env", description: "What this server can see", inputSchema: schema },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  if (name === "show_env") {
    const seen = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(BOUNDARY_|ANTHROPIC_|JIRA_|GH_TOKEN|CONNECTOR_)/.test(k)));
    return { content: [{ type: "text", text: JSON.stringify(seen) }] };
  }
  if (name === "query") writeFileSync(marker, "dropped\n");
  return { content: [{ type: "text", text: `${name} ran` }] };
});

await server.connect(new StdioServerTransport());
