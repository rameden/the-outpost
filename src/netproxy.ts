// The sandbox's way out to the hosts you allow. A sandboxed command has no network except
// localhost; when you list hosts ("shell": { "allowHosts": ["registry.npmjs.org", "*.github.com"] }),
// the camp runs a small proxy on 127.0.0.1 and points the command at it (HTTPS_PROXY and friends,
// which npm, pip, git, curl and most tools follow). The proxy connects only to hosts on your list
// and refuses the rest; anything that ignores the proxy settings still has no network at all.
//
// It sees which host a connection is for, not what's sent (HTTPS stays encrypted end to end).
// Hosts it refused are remembered for a while, so a failed command can say which ones it wanted.

import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { shellSettings } from "./settings.js";

// "*.github.com" covers api.github.com and github.com itself; anything else matches exactly.
export function hostAllowed(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith("*.")) return h === p.slice(2) || h.endsWith(p.slice(1));
    return h === p;
  });
}
export const allowedHosts = () => (shellSettings().allowHosts ?? []).filter(Boolean);

const refused: { host: string; at: number }[] = [];
// Hosts refused since `since` (ms), newest last, each once.
export function refusedSince(since: number): string[] {
  return [...new Set(refused.filter((r) => r.at >= since).map((r) => r.host))];
}
function refuse(host: string) {
  refused.push({ host, at: Date.now() });
  if (refused.length > 200) refused.splice(0, refused.length - 200);
}

const splitHost = (target: string, fallbackPort: number): { host: string; port: number } => {
  const m = target.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  return { host: m?.[1] ?? target, port: Number(m?.[2] ?? fallbackPort) };
};

let started: Promise<number> | null = null;
let server: http.Server | null = null;

// The proxy's port, starting it the first time. Hosts are checked on every connection against
// the list as it is then, so a change in Settings applies straight away.
export function ensureProxy(): Promise<number> {
  if (started) return started;
  started = new Promise((ok, fail) => {
    const s = http.createServer((req, res) => {
      // Plain HTTP through a proxy: the request line carries the whole URL.
      let url: URL;
      try { url = new URL(req.url ?? ""); } catch { res.writeHead(400).end("Bad request\n"); return; }
      if (!hostAllowed(url.hostname, allowedHosts())) { refuse(url.hostname); res.writeHead(403).end(`${url.hostname} isn't on the sandbox's list of allowed hosts.\n`); return; }
      const up = http.request({ host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    });
    // HTTPS (and anything else) through a proxy: CONNECT host:port, then a raw tunnel.
    s.on("connect", (req, client: net.Socket, head) => {
      const { host, port } = splitHost(req.url ?? "", 443);
      if (!hostAllowed(host, allowedHosts())) {
        refuse(host);
        client.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n${host} isn't on the sandbox's list of allowed hosts.\n`);
        return;
      }
      const up = net.connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) up.write(head);
        up.pipe(client);
        client.pipe(up);
      });
      const close = () => { up.destroy(); client.destroy(); };
      up.on("error", () => { if (client.writable) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); close(); });
      client.on("error", close);
    });
    s.on("error", (e) => { started = null; fail(e); });
    s.listen(0, "127.0.0.1", () => { server = s; s.unref(); ok((s.address() as AddressInfo).port); });
  });
  return started;
}

// What to add to a sandboxed command's environment so it goes through the proxy.
export function proxyEnv(port: number): Record<string, string> {
  const url = `http://127.0.0.1:${port}`;
  return {
    HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, ALL_PROXY: url, all_proxy: url,
    npm_config_proxy: url, npm_config_https_proxy: url, PIP_PROXY: url,
    NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1",
  };
}

export function stopProxy() {
  server?.close();
  server = null;
  started = null;
}
