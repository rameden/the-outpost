// A stand-in for the Messages API that streams scripted replies, like the real one does.
// Tests decide each reply from the request (who's asking, what came last).

import http from "node:http";
import type { AddressInfo } from "node:net";

export type Reply = {
  text?: string;
  tools?: { name: string; input: unknown }[];
  stop?: "end_turn" | "tool_use" | "max_tokens" | "refusal";
  usage?: { input_tokens: number; output_tokens: number };
  delayMs?: number; // wait before replying (to test parallel runs and Stop)
};

export type Seen = { at: number; who: string; body: any; headers: http.IncomingHttpHeaders };

// Helpers for reading a request.
export const whoAsks = (body: any): string => body.system?.[0]?.text?.match(/You are the (\w+)/)?.[1] ?? "?";
export const lastToolResults = (body: any): string => {
  const last = body.messages.at(-1);
  return Array.isArray(last.content) ? last.content.map((c: any) => (typeof c.content === "string" ? c.content : "")).join("\n") : "";
};
export const isFirstTurn = (body: any): boolean => typeof body.messages.at(-1).content === "string" || body.messages.length === 1;

export async function startFakeApi(respond: (body: any) => Reply | Promise<Reply>) {
  const seen: Seen[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      if (!req.url?.startsWith("/v1/messages")) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end("{}"); // e.g. /v1/models: the camp falls back to its built-in model list
      }
      const body = JSON.parse(raw);
      seen.push({ at: Date.now(), who: whoAsks(body), body, headers: req.headers });
      const r = await respond(body);
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
      if (res.destroyed) return; // the client gave up (Stop)
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
      const usage = r.usage ?? { input_tokens: 100, output_tokens: 20 };
      send("message_start", { message: { id: `msg_${++n}`, type: "message", role: "assistant", model: "fake", content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      let i = 0;
      if (r.text) {
        send("content_block_start", { index: i, content_block: { type: "text", text: "" } });
        send("content_block_delta", { index: i, delta: { type: "text_delta", text: r.text } });
        send("content_block_stop", { index: i++ });
      }
      for (const t of r.tools ?? []) {
        send("content_block_start", { index: i, content_block: { type: "tool_use", id: `tu_${n}_${i}`, name: t.name, input: {} } });
        send("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(t.input) } });
        send("content_block_stop", { index: i++ });
      }
      const stop = r.stop ?? (r.tools?.length ? "tool_use" : "end_turn");
      send("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
      send("message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    seen,
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
