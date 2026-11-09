// Mission control: a local web dashboard for the camp.
// Run: npm run ui   → open the printed http://127.0.0.1:4747/?t=… link
//
// It streams every camp event to the browser, routes approvals (plans, shell commands, new jobs)
// to buttons on the page, and runs scheduled jobs while it's open (so don't also run `npm run watch`).
//
// Safety: it listens on 127.0.0.1 only, checks the Host header (blocks DNS rebinding), and
// requires a random per-launch token on every request, so other websites can't drive the camp.

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { onEvent, attachConsole, type CampEvent } from "./events.js";
import { setAsker, type Question } from "./ask.js";
import { runExpedition, runDirect, QM_DEFAULTS } from "./quartermaster.js";
import { ROSTER } from "./roster.js";
import { DEFAULT_MODEL, listModels, resolveModel } from "./agent.js";
import { agentSettings, setAgentSettings, EFFORTS, budgetUsd, setBudgetUsd, type Effort } from "./settings.js";
import { costOf } from "./costs.js";
import { connectorStatus, closeConnectors } from "./mcp.js";
import { CAMP_ROOT } from "./tools.js";
import { CREW, CREW_IDS, findCrew } from "./crew.js";
import { readMemory, recentSessions } from "./memory.js";
import { loadJobs, saveJobs } from "./jobs.js";
import { recentQuests } from "./questlog.js";
import { wikiPages, WIKI_DIR } from "./wiki.js";
import { pendingDetails, approveSkill, rejectSkill } from "./forge.js";
import { dueJobs, runJob, inboxEntries } from "./scheduler.js";
import { buildRequest, imageType, saveUpload, searchFiles, UPLOADS_DIR, type Attachment } from "./attachments.js";
import { loadSnippets, addSnippet, deleteSnippet } from "./snippets.js";

const PORT = Number(process.env.CAMP_PORT ?? 4747);
const TOKEN = randomBytes(24).toString("hex");
const BOOT_ID = randomBytes(6).toString("hex");
const HERE = fileURLToPath(new URL(".", import.meta.url));
const PAGE_PATH = join(HERE, "ui", "index.html");
const MAX_BODY = 1_000_000;
const MAX_UPLOAD_BODY = 36_000_000; // one file per request: ~25 MB once base64-encoded
const BUFFER_SIZE = 800;
const TICK_MS = 30_000;

attachConsole(); // the terminal still shows everything

// ---------- Event buffer + live streams ----------
const buffer: CampEvent[] = [];
const streams = new Set<http.ServerResponse>();
onEvent((e) => {
  // Live streaming text goes out as it happens but isn't replayed (the final "text" event is).
  if (e.type !== "text_delta") {
    buffer.push(e);
    if (buffer.length > BUFFER_SIZE) buffer.shift();
  }
  for (const res of streams) res.write(`data: ${JSON.stringify(e)}\n\n`);
});

// ---------- Approvals answered from the browser ----------
const pendingAsks = new Map<string, { q: Question; resolve: (answer: string) => void }>();
setAsker((q) => new Promise((resolve) => pendingAsks.set(q.id, { q, resolve })));

// ---------- One expedition at a time; everything else waits its turn ----------
// Each piece of work gets a stop signal, so the Stop button can cancel it (quests included).
type Work = { label: string; run: (signal: AbortSignal) => Promise<unknown>; controller?: AbortController };
const queue: Work[] = [];
let current: Work | null = null;

function enqueue(work: Work) {
  queue.push(work);
  void drain();
}

async function drain() {
  if (current) return;
  while ((current = queue.shift() ?? null)) {
    current.controller = new AbortController();
    try {
      await current.run(current.controller.signal);
    } catch (err: any) {
      console.error(`💥 ${current.label}: ${err.message}`);
    }
  }
}

// Stop what's running now: cancel its API calls and answer any approval it's waiting on with "no".
function stopCurrent(): string | null {
  if (!current?.controller || current.controller.signal.aborted) return null;
  current.controller.abort();
  for (const [id, { resolve }] of pendingAsks) {
    pendingAsks.delete(id);
    resolve("n");
  }
  return current.label;
}

function queuedJob(name: string) {
  return current?.label === `job:${name}` || queue.some((w) => w.label === `job:${name}`);
}

setInterval(() => {
  for (const job of dueJobs()) if (!queuedJob(job.name)) enqueue({ label: `job:${job.name}`, run: (signal) => runJob(job, signal) });
}, TICK_MS);

// ---------- State for the panels ----------
// Spending from the quest log: every API call is logged once (the Quartermaster's own calls,
// and each quest's), so summing entries doesn't double count.
function spending(all: ReturnType<typeof recentQuests>) {
  const now = Date.now();
  const day = new Date(); day.setHours(0, 0, 0, 0);
  let today = 0, week = 0, total = 0;
  for (const q of all) {
    const c = costOf(q.model, q.usage);
    total += c;
    const t = new Date(q.time).getTime();
    if (t >= day.getTime()) today += c;
    if (now - t < 7 * 86_400_000) week += c;
  }
  return { today, week, total };
}

async function state() {
  const all = recentQuests(Number.MAX_SAFE_INTEGER);
  const xp: Record<string, number> = {};
  for (const q of all) if (q.status === "done") xp[q.character] = (xp[q.character] ?? 0) + 10;
  return {
    bootId: BOOT_ID,
    characters: CREW_IDS.map((id) => {
      const c = CREW[id];
      const base = id === "quartermaster" ? QM_DEFAULTS : ROSTER[id];
      const { model, effort } = resolveModel({ id, model: base?.model, effort: base?.effort });
      const override = agentSettings(id);
      return {
        id, name: c.name, emoji: c.emoji, role: c.role, personality: c.personality,
        model, effort: effort ?? "default",
        defaultModel: base?.model ?? DEFAULT_MODEL, defaultEffort: base?.effort ?? "default",
        overridden: !!(override.model || override.effort),
      };
    }),
    memories: CREW_IDS.map((id) => ({ id, name: CREW[id].name, emoji: CREW[id].emoji, memory: readMemory(id), sessions: recentSessions(id, 1000).length })),
    xp,
    busy: current?.label ?? null,
    queued: queue.map((w) => w.label),
    asks: [...pendingAsks.entries()].map(([id, { q }]) => ({ id, ...q })),
    jobs: loadJobs(),
    quests: all.slice(-80).reverse().map((q) => ({ ...q, cost: costOf(q.model, q.usage) })),
    spend: spending(all),
    budgetUsd: budgetUsd() ?? null,
    connectors: await connectorStatus(),
    wiki: wikiPages(),
    skills: pendingDetails(),
    inbox: inboxEntries(),
    snippets: loadSnippets(),
  };
}

// ---------- HTTP plumbing ----------
function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

async function readJson(req: http.IncomingMessage, limit = MAX_BODY): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error(limit === MAX_BODY ? "Request too large" : "File too large (25 MB max)");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function hostOk(req: http.IncomingMessage) {
  return req.headers.host === `127.0.0.1:${PORT}` || req.headers.host === `localhost:${PORT}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) return send(res, 403, { error: "Bad host" });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const authed = req.headers["x-camp-token"] === TOKEN || url.searchParams.get("t") === TOKEN;

    // The page itself carries the token; without it you get a pointer to the terminal.
    if (req.method === "GET" && url.pathname === "/") {
      if (url.searchParams.get("t") !== TOKEN) {
        return send(res, 401, "Open the link printed in the terminal (it includes this launch's key).", "text/plain; charset=utf-8");
      }
      const page = readFileSync(PAGE_PATH, "utf8").replace("__CAMP_TOKEN__", TOKEN);
      res.setHeader("content-security-policy",
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return send(res, 200, page, "text/html; charset=utf-8");
    }
    if (!authed) return send(res, 401, { error: "Missing or wrong camp token" });

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ bootId: BOOT_ID })}\n\n`);
      for (const e of buffer) res.write(`data: ${JSON.stringify(e)}\n\n`);
      streams.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
      req.on("close", () => {
        clearInterval(ping);
        streams.delete(res);
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, await state());

    if (req.method === "GET" && url.pathname === "/api/wiki") {
      const rel = normalize(url.searchParams.get("path") ?? "");
      const abs = resolve(CAMP_ROOT, rel);
      const wikiRoot = resolve(CAMP_ROOT, WIKI_DIR) + sep;
      if (!abs.startsWith(wikiRoot) || !abs.endsWith(".md") || !existsSync(abs)) return send(res, 404, { error: "No such page" });
      return send(res, 200, { path: rel, text: readFileSync(abs, "utf8") });
    }

    // Uploaded images, for thumbnails in the feed and the composer. Images only, from camp/uploads/.
    if (req.method === "GET" && url.pathname === "/api/upload") {
      const abs = resolve(CAMP_ROOT, normalize(url.searchParams.get("path") ?? ""));
      const media = imageType(abs);
      if (!abs.startsWith(resolve(CAMP_ROOT, UPLOADS_DIR) + sep) || !media || !existsSync(abs)) return send(res, 404, { error: "No such image" });
      res.writeHead(200, { "content-type": media, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
      return res.end(readFileSync(abs));
    }

    // Models this API key can use, with the effort levels each supports.
    if (req.method === "GET" && url.pathname === "/api/models") return send(res, 200, await listModels());

    // Project files for @ autocomplete.
    if (req.method === "GET" && url.pathname === "/api/files") {
      return send(res, 200, { files: searchFiles(url.searchParams.get("q") ?? "") });
    }

    if (req.method !== "POST") return send(res, 404, { error: "Not found" });

    if (url.pathname === "/api/upload") {
      const body = await readJson(req, MAX_UPLOAD_BODY);
      if (typeof body.data !== "string" || typeof body.name !== "string") return send(res, 400, { error: "Missing file" });
      return send(res, 200, saveUpload({ name: body.name, data: body.data, batch: body.batch, relPath: body.relPath }));
    }

    const body = await readJson(req);

    if (url.pathname === "/api/send") {
      let text = String(body.text ?? "").trim();
      const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments.slice(0, 30) : [];
      if (!text && attachments.length === 0) return send(res, 400, { error: "Empty request" });
      if (!text) text = "Take a look at what I attached.";
      const direct = text.match(/^@(\w+)\s+([\s\S]+)$/) ?? (attachments.length ? text.match(/^@(\w+)$/) : null);
      const who = direct ? findCrew(direct[1]) : undefined;
      if (direct && !who) return send(res, 400, { error: `No crew member named "${direct[1]}"` });
      const { content, attached } = buildRequest(direct ? direct[2] ?? "Take a look at what I attached." : text, attachments);
      if (who) enqueue({ label: `@${who.id}`, run: (signal) => runDirect(who.id, content, "direct", attached, signal) });
      else enqueue({ label: "expedition", run: (signal) => runExpedition(content, { attached, signal }) });
      return send(res, 200, { ok: true, position: queue.length, attached: attached.length });
    }

    // Pick an agent's model and effort. { id, model, effort } sets them; { id, reset: true } goes back to defaults.
    if (url.pathname === "/api/agents") {
      const id = String(body.id) as keyof typeof CREW;
      if (!CREW[id]) return send(res, 404, { error: "No such crew member" });
      if (body.reset) {
        setAgentSettings(id, { model: null, effort: null });
        return send(res, 200, { ok: true });
      }
      const { models } = await listModels();
      const model = models.find((m) => m.id === body.model);
      if (!model) return send(res, 400, { error: `Unknown model "${body.model}"` });
      const effort = body.effort ? String(body.effort) as Effort : null;
      if (effort && (!EFFORTS.includes(effort) || !model.efforts.includes(effort))) {
        return send(res, 400, { error: `${model.name} doesn't support effort "${effort}"` });
      }
      setAgentSettings(id, { model: model.id, effort });
      return send(res, 200, { ok: true });
    }

    // Per-expedition budget in dollars ({ usd: 2.5 }); 0 or empty removes it.
    if (url.pathname === "/api/budget") {
      const v = Number(body.usd);
      if (body.usd !== null && body.usd !== "" && (!Number.isFinite(v) || v < 0)) return send(res, 400, { error: "Budget must be a positive number of dollars" });
      setBudgetUsd(body.usd === null || body.usd === "" ? null : v);
      return send(res, 200, { ok: true, budgetUsd: budgetUsd() ?? null });
    }

    if (url.pathname === "/api/snippets") {
      if (body.action === "add") return send(res, 200, addSnippet(String(body.title ?? ""), String(body.text ?? "")));
      if (body.action === "delete") return send(res, deleteSnippet(String(body.id)) ? 200 : 404, { ok: true });
      return send(res, 400, { error: "Unknown action" });
    }

    if (url.pathname === "/api/stop") {
      const stopped = stopCurrent();
      return send(res, stopped ? 200 : 409, stopped ? { ok: true, stopped } : { error: "Nothing is running" });
    }

    if (url.pathname === "/api/answer") {
      const pending = pendingAsks.get(String(body.id));
      if (!pending) return send(res, 404, { error: "That question was already answered" });
      pendingAsks.delete(String(body.id));
      pending.resolve(String(body.answer ?? ""));
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/skills") {
      const { owner, name, action } = body;
      const ok = action === "approve" ? approveSkill(owner, name) : action === "reject" ? rejectSkill(owner, name) : false;
      return send(res, ok ? 200 : 404, { ok });
    }

    if (url.pathname === "/api/jobs") {
      const { name, action } = body;
      const jobs = loadJobs();
      const job = jobs.find((j) => j.name === name);
      if (!job) return send(res, 404, { error: `No job named "${name}"` });
      if (action === "enable" || action === "disable") {
        saveJobs(jobs.map((j) => (j.name === name ? { ...j, enabled: action === "enable" } : j)));
      } else if (action === "delete") {
        saveJobs(jobs.filter((j) => j.name !== name));
      } else if (action === "run") {
        if (!queuedJob(name)) enqueue({ label: `job:${name}`, run: (signal) => runJob(job, signal) });
      } else {
        return send(res, 400, { error: "Unknown action" });
      }
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "Not found" });
  } catch (err: any) {
    return send(res, 500, { error: err.message });
  }
});

process.on("exit", () => { void closeConnectors(); });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🏕️  Mission control is up: http://127.0.0.1:${PORT}/?t=${TOKEN}`);
  console.log(`   Scheduled jobs run while this is open. Ctrl+C to break camp.`);
});
