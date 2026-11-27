// The star chart: the way into the app, one command for every outpost.  npm start
//
// Starts a small server on this machine (port 4700; HUB_PORT to choose) and opens its page: a
// star chart with a star for each outpost (Mae, and those in ~/Outposts). Pick one to read about
// it, then Launch: the outpost's own server is started here, and the page goes to it, signed in.
//
//   npm start               the chart, opened in your browser
//   npm start -- --no-open  just print its address
//   npm start -- --dev      outposts start with the page reloading as you edit (like npm run ui)
//
// Outposts started from the chart run under this command: what they print shows here with their
// name in front, and stopping this (Ctrl-C) stops them. One that was already running by itself
// (npm run ui, npm run outpost -- start) is shown as running and opened as it is.
//
// The chart never holds an outpost's key. To get you in, it passes on the one-time sign-in link
// the outpost's own server prints (src/hub.ts). Only this machine can reach it, and only its own
// page can ask it for anything: each launch has a token, written into the page as it's served.

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_PORT, hubHostOk, hubPage, outpostFacts, signInLinkIn } from "../src/hub.ts";
import { outpostsHome } from "../src/outpost.ts";
import { readJsonFile } from "../src/atomic.ts";
import type { Releases } from "../src/releases.ts";
import { ASSET_CACHE, UI_CSP, UI_DIST, UI_NOT_BUILT, uiAsset } from "../src/ui-files.ts";
import { ROOT, buildPage, writeReleaseNotesNow, create, listening, outposts, spawnOutpost, type Place } from "./outpost.ts";

// What src/releases.ts keeps, read as a file: importing that module would hold the terminal open (scripts/release-notes.ts).
const RELEASES_FILE = join(ROOT, "camp", "releases.json");
const readReleases = (): Releases => {
  const r = readJsonFile(RELEASES_FILE, null) as Releases | null;
  return r && Array.isArray(r.releases) ? r : { checked: "", repo: "", releases: [] };
};

const HERE_ID = "_here"; // this checkout's outpost; the others go by their folder's name, which never starts with _
const idOf = (o: Place) => (o.dir === ROOT ? HERE_ID : basename(o.dir));

// An outpost this command started.
type Kid = {
  child: ChildProcess;
  base: string;                              // where its page is, once it has said
  waiting: ((link: string | null) => void)[]; // launches waiting on its next sign-in link
  tail: string[];                            // the last things it printed, for when it fails to start
};

export function startHub({ port = HUB_PORT, dev = false, log = (s: string) => console.log(s) } = {}) {
  const token = randomBytes(24).toString("hex");
  const kids = new Map<string, Kid>();
  const starting = new Map<string, Promise<string>>();

  const nextLink = (kid: Kid, ms: number) => new Promise<string | null>((done) => {
    const got = (link: string | null) => { clearTimeout(timer); done(link); };
    const timer = setTimeout(() => { kid.waiting = kid.waiting.filter((w) => w !== got); done(null); }, ms);
    kid.waiting.push(got);
  });

  function run(o: Place): Kid {
    const id = idOf(o);
    const child = spawnOutpost(o, dev, ["pipe", "pipe", "pipe"], { CAMP_CHART: `http://localhost:${port}/` });
    const kid: Kid = { child, base: "", waiting: [], tail: [] };
    kids.set(id, kid);
    const read = (stream: NodeJS.ReadableStream | null) => {
      let pending = "";
      stream?.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const link = signInLinkIn(line);
          if (link) {
            kid.base = link.replace(/#.*$/, "");
            // A link someone here is waiting for goes to them alone: it works once.
            const first = kid.waiting.shift();
            if (first) { first(link); continue; }
          }
          kid.tail.push(line); if (kid.tail.length > 12) kid.tail.shift();
          log(`[${o.name}] ${line}`);
        }
      });
    };
    read(child.stdout); read(child.stderr);
    child.on("exit", (code) => {
      if (kids.get(id) === kid) kids.delete(id);
      for (const w of kid.waiting.splice(0)) w(null);
      log(`[${o.name}] stopped${code ? ` (exit ${code})` : ""}.`);
    });
    return kid;
  }

  // Where to send the page so it lands in this outpost: a fresh sign-in link when it's ours to
  // ask, else its plain address (a browser that has been there before opens it by itself).
  async function launch(o: Place): Promise<string> {
    const id = idOf(o);
    const plain = `http://localhost:${o.port}/`;
    const ours = kids.get(id);
    if (ours && ours.base) {
      // Enter in an outpost's terminal prints a new link: press it for them.
      const wait = nextLink(ours, 4000);
      ours.child.stdin?.write("\n");
      return (await wait) ?? ours.base;
    }
    if (starting.has(id)) { await starting.get(id); return launch(o); }
    if (await listening(o.port)) return plain;
    const kid = run(o);
    const up = nextLink(kid, 120_000).then((link) => {
      if (link) return link;
      const said = kid.tail.slice(-6).join("\n");
      if (kid.child.exitCode === null) kid.child.kill("SIGTERM");
      throw new Error(`Outpost ${o.name} didn't start.${said ? `\n${said}` : ""}`);
    });
    starting.set(id, up);
    try { return await up; } finally { starting.delete(id); }
  }

  const stop = (id: string) => new Promise<void>((done) => {
    const kid = kids.get(id);
    if (!kid || kid.child.exitCode !== null) return done();
    const hard = setTimeout(() => kid.child.kill("SIGKILL"), 8000);
    kid.child.once("exit", () => { clearTimeout(hard); done(); });
    kid.child.kill("SIGTERM");
  });

  async function chart() {
    const all = outposts();
    const up = await Promise.all(all.map((o) => listening(o.port)));
    return {
      home: outpostsHome(),
      outposts: all.map((o, i) => {
        const id = idOf(o);
        return { id, name: o.name, description: o.description ?? "", port: o.port, dir: o.dir, here: o.dir === ROOT, running: up[i], starting: starting.has(id), ours: kids.has(id), ...outpostFacts(o.dir) };
      }),
    };
  }

  const send = (res: http.ServerResponse, status: number, body: unknown, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
    res.end(type === "application/json" ? JSON.stringify(body) : String(body));
  };
  const readJson = async (req: http.IncomingMessage) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 10_000) throw new Error("Request too large"); chunks.push(c); }
    try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {} : {}; } catch { return {}; }
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!hubHostOk(req.headers.host, port)) return send(res, 403, { error: "Bad host" });
      const path = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
      if (req.method === "GET" && path === "/") {
        const page = hubPage(UI_DIST, token);
        if (!page) return send(res, 503, UI_NOT_BUILT, "text/plain; charset=utf-8");
        res.setHeader("content-security-policy", UI_CSP);
        return send(res, 200, page, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && path.startsWith("/assets/")) {
        const asset = uiAsset(path, undefined, String(req.headers["accept-encoding"] ?? ""));
        if (!asset) return send(res, 404, { error: "Not found" });
        res.writeHead(200, { "content-type": asset.type, "cache-control": ASSET_CACHE, vary: "accept-encoding", ...(asset.encoding ? { "content-encoding": asset.encoding } : {}), "x-content-type-options": "nosniff" });
        return res.end(asset.body);
      }
      if (req.headers["x-hub-token"] !== token) return send(res, 401, { error: "This page is from an earlier launch. Reload it." });
      if (req.method === "GET" && path === "/api/outposts") return send(res, 200, await chart());
      // Release notes (src/releases.ts): what changed in Outpost itself, kept in this checkout's camp/. The page's
      // drawer reads them; Check now writes the next ones from the pull requests merged since.
      if (req.method === "GET" && path === "/api/releases") return send(res, 200, readReleases());
      if (req.method !== "POST") return send(res, 404, { error: "Not found" });
      const body = await readJson(req);
      const pick = () => outposts().find((o) => idOf(o) === String(body.id ?? ""));
      if (path === "/api/releases/refresh") { await writeReleaseNotesNow(); return send(res, 200, readReleases()); }
      if (path === "/api/launch") {
        const o = pick();
        if (!o) return send(res, 404, { error: "That outpost isn't on the chart any more." });
        try { return send(res, 200, { url: await launch(o) }); }
        catch (e) { return send(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
      }
      if (path === "/api/stop") {
        const o = pick();
        if (!o || !kids.has(idOf(o))) return send(res, 409, { error: "That outpost wasn't started from the chart, so it's stopped where it was started." });
        await stop(idOf(o));
        return send(res, 200, await chart());
      }
      if (path === "/api/new") {
        try { const o = create(String(body.name ?? ""), undefined, String(body.description ?? "")); return send(res, 200, { id: idOf(o), ...(await chart()) }); }
        catch (e) { return send(res, 400, { error: (e instanceof Error ? e.message : String(e)).replace(/: npm run outpost.*$/, ".") }); }
      }
      return send(res, 404, { error: "Not found" });
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  const close = async () => {
    await Promise.all([...kids.keys()].map(stop));
    await new Promise<void>((done) => server.close(() => done()));
  };
  const listen = () => new Promise<string>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => done(`http://localhost:${port}/`));
  });
  return { listen, close, token };
}

function openInBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the address is printed too */ }
}

async function main(args: string[]) {
  const port = Number(process.env.HUB_PORT ?? HUB_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("HUB_PORT takes a number from 1024 to 65535.");
  const taken = outposts().find((o) => o.port === port);
  if (taken) throw new Error(`Port ${port} is Outpost ${taken.name}'s. Set HUB_PORT to another.`);
  const built = buildPage();
  if (built !== 0) process.exit(built);
  const hub = startHub({ port, dev: args.includes("--dev") });
  let url: string;
  try { url = await hub.listen(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") throw new Error(`Port ${port} is taken: the star chart may already be up at http://localhost:${port}/. Or set HUB_PORT to another.`);
    throw e;
  }
  console.log(`🔭 The star chart is up: ${url}`);
  console.log("   Pick an outpost there to launch it. Ctrl-C here stops the chart and the outposts it started.");
  if (!args.includes("--no-open")) openInBrowser(url);
  let closing = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { if (closing) return; closing = true; void hub.close().then(() => process.exit(0)); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
