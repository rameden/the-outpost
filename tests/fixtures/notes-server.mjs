// A tiny MCP server for testing: one read-only tool, one read tool by name, one tool that deletes.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const server = new Server({ name: "notes", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "list_notes", description: "List note files", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "read_note", description: "Read one note", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    { name: "delete_note", description: "Delete a note", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name === "list_notes") return { content: [{ type: "text", text: readdirSync(dir).join("\n") }] };
  if (name === "read_note") return { content: [{ type: "text", text: readFileSync(join(dir, args.name), "utf8") }] };
  if (name === "delete_note") { rmSync(join(dir, args.name)); return { content: [{ type: "text", text: `deleted ${args.name}` }] }; }
  return { content: [{ type: "text", text: "unknown tool" }], isError: true };
});

await server.connect(new StdioServerTransport());
