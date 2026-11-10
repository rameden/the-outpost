// Mission control: a local web dashboard for the camp.
// Run: npm run ui   → open the printed http://127.0.0.1:4747/?t=… link
// The page itself is a React app in ui/, built into ui/dist (see src/ui-files.ts).
//
// It streams every camp event to the browser, routes approvals (plans, shell commands, new jobs)
// to buttons on the page, and runs scheduled jobs while it's open (so don't also run `npm run watch`).
//
// Safety: it listens on 127.0.0.1 only, checks the Host header (blocks DNS rebinding), and
// requires a random per-launch token on every request (the page's scripts and styles included),
// so other websites can't drive the camp. The page runs under a Content-Security-Policy that
// allows no inline code: only the scripts and styles this server serves.

import http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join, normalize, resolve, sep } from "node:path";
import { onEvent, attachConsole, emit, continueSeqFrom, type CampEvent } from "./events.js";
import { setAsker, type Question } from "./ask.js";
import { currentExpeditionId, newSteering, steer, type Steering } from "./context.js";
import { linkedRepos, prepareWorkspaces, workspaceStatus, commitWorkspace, openPullRequest, removeWorkspace } from "./repos.js";
import { sandboxAvailable } from "./sandbox.js";
import { DEFAULT_ALLOW } from "./shell.js";
import { runExpedition, runDirect, QM_DEFAULTS, quartermasterSpec } from "./quartermaster.js";
import { ROSTER } from "./roster.js";
import { DEFAULT_MODEL, listModels, resolveModel, resolveTurns } from "./agent.js";
import { agentSettings, setAgentSettings, EFFORTS, budgetUsd, setBudgetUsd, campRuntime, setRuntime, parallelLimit, setParallelLimit, PARALLEL_MAX, shellSettings, setShellSandbox, approvalLevel, setApprovalLevel, setShellLists, questLimit, setQuestLimit, QUESTS_MAX, selfEditAllowed, setSelfEdit, phoneSettings, setPhoneSettings, DEFAULT_TURNS, TURNS_MIN, TURNS_MAX, type Effort } from "./settings.js";
import { claudeLogin } from "./claude-code.js";
import { costOf } from "./costs.js";
import { connectorStatus, closeConnectors, mcpToolsFor } from "./mcp.js";
import { CAMP_ROOT } from "./tools.js";
import { CREW, CREW_IDS, findCrew, type CrewId } from "./crew.js";
import { readMemory, recentSessions, readSession, writeMemory, listOutputs, workspace, ensureWorkspace } from "./memory.js";
import { loadJobs, saveJobs } from "./jobs.js";
import { recentQuests, questCost } from "./questlog.js";
import { wikiPages, WIKI_DIR } from "./wiki.js";
import { pendingDetails, approveSkill, rejectSkill } from "./forge.js";
import { dueJobs, runJob, inboxEntries, claimScheduler, schedulerOwner } from "./scheduler.js";
import { keepInFeed, loadFeed, saveToFeed } from "./feed.js";
import { planLimits, pausedUntil, pauseMessage, resumeNow, limitLabel } from "./limits.js";
import { checkpointDiff, undoCheckpoint } from "./checkpoints.js";
import { latestDirect, threadFor } from "./threads.js";
import { phoneConfig, startPhoneBridge } from "./phone.js";
import { buildRequest, imageType, saveUpload, searchFiles, UPLOADS_DIR, type Attachment } from "./attachments.js";
import { loadSnippets, addSnippet, deleteSnippet } from "./snippets.js";
import { loadLinks, addLink, removeLink, setLinkVerify } from "./links.js";
import { pickFolder } from "./picker.js";
import { uiPage, uiAsset, UI_CSP, UI_NOT_BUILT } from "./ui-files.js";

const PORT = Number(process.env.CAMP_PORT ?? 4747);
const TOKEN = randomBytes(24).toString("hex");
const BOOT_ID = randomBytes(6).toString("hex");
const MAX_BODY = 1_000_000;
const MAX_UPLOAD_BODY = 36_000_000; // one file per request: ~25 MB once base64-encoded
const BUFFER_SIZE = 800;
const TICK_MS = 30_000;

attachConsole(); // the terminal still shows everything

// ---------- Event buffer + live streams ----------
// The feed is saved to camp/feed.jsonl and reloaded here, so it survives a restart.
const buffer: CampEvent[] = loadFeed(BUFFER_SIZE);
continueSeqFrom(buffer.reduce((m, e) => Math.max(m, e.seq), 0));
const streams = new Set<http.ServerResponse>();
onEvent((e) => {
  // Live streaming text goes out as it happens but isn't replayed (the final "text" event is).
  if (e.type !== "text_delta") {
    buffer.push(e);
    if (buffer.length > BUFFER_SIZE) buffer.shift();
  }
  if (keepInFeed(e)) saveToFeed(e);
  for (const res of streams) res.write(`data: ${JSON.stringify(e)}\n\n`);
});

// ---------- Approvals answered from the browser ----------
// Each remembers its expedition, so stopping one expedition only declines its own questions.
const pendingAsks = new Map<string, { q: Question; resolve: (answer: string) => void; expeditionId?: string }>();
setAsker((q) => new Promise((resolve) => pendingAsks.set(q.id, { q, resolve, expeditionId: currentExpeditionId() })));

// ---------- Several expeditions at once; past the limit, work waits its turn ----------
// Each piece of work has its own expedition id and stop signal, so its events, approvals, and
// Stop button stay its own. The limit (settings "parallel", default 3) keeps a subscription's
// usage limits (or API spend) from draining all at once.
// steering: what you say to it while it runs (the Steer box on its card) reaches the agents working in it.
type Work = { id: string; label: string; run: (signal: AbortSignal, id: string, steering: Steering) => Promise<unknown>; controller?: AbortController; steering: Steering };
const queue: Work[] = [];
const running = new Map<string, Work>();

function enqueue(work: Omit<Work, "id" | "steering">): Work {
  const w = { ...work, id: randomUUID(), steering: newSteering() };
  queue.push(w);
  drain();
  return w;
}

// While your plan's usage limit is used up, nothing new starts; the queue picks up at the reset.
let resumeTimer: NodeJS.Timeout | null = null;
function drain() {
  const paused = pausedUntil();
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  if (paused) {
    resumeTimer = setTimeout(drain, Math.min(paused - Date.now() + 1000, 2_000_000_000));
    resumeTimer.unref();
  }
  while (!paused && running.size < parallelLimit() && queue.length) {
    const w = queue.shift()!;
    w.controller = new AbortController();
    running.set(w.id, w);
    w.run(w.controller.signal, w.id, w.steering)
      .catch((err: any) => console.error(`💥 ${w.label}: ${err.message}`))
      .finally(() => {
        running.delete(w.id);
        emit({ type: "changed", what: "queue" });
        drain();
      });
  }
  emit({ type: "changed", what: "queue" });
}

// Stop one expedition (or, with no id, everything running): cancel its calls and answer the
// approvals it's waiting on with "no". A queued one is simply taken off the queue.
function stopWork(id?: string): string[] {
  const stopped: string[] = [];
  const waiting = id ? queue.findIndex((w) => w.id === id) : -1;
  if (waiting >= 0) stopped.push(queue.splice(waiting, 1)[0].label);
  for (const w of running.values()) {
    if (id && w.id !== id) continue;
    if (!w.controller || w.controller.signal.aborted) continue;
    w.controller.abort();
    stopped.push(w.label);
    for (const [askId, p] of pendingAsks) {
      if (p.expeditionId !== w.id) continue;
      pendingAsks.delete(askId);
      p.resolve("n");
    }
  }
  if (stopped.length) emit({ type: "changed", what: "queue" });
  return stopped;
}

function queuedJob(name: string) {
  return [...running.values(), ...queue].some((w) => w.label === `job:${name}`);
}

setInterval(() => {
  if (!claimScheduler("ui")) return; // `npm run watch` already has the jobs
  for (const job of dueJobs()) if (!queuedJob(job.name)) enqueue({ label: `job:${job.name}`, run: (signal, id) => runJob(job, signal, id) });
}, TICK_MS);

// ---------- State for the panels ----------
// Spending from the quest log: every API call is logged once (the Quartermaster's own calls,
// and each quest's), so summing entries doesn't double count.
function spending(all: ReturnType<typeof recentQuests>) {
  const now = Date.now();
  const day = new Date(); day.setHours(0, 0, 0, 0);
  let today = 0, week = 0, total = 0;
  for (const q of all) {
    const c = questCost(q);
    total += c;
    const t = new Date(q.time).getTime();
    if (t >= day.getTime()) today += c;
    if (now - t < 7 * 86_400_000) week += c;
  }
  return { today, week, total };
}

// Skills a crew member can use: its own plus the shared ones.
function skillsFor(id: CrewId) {
  const out: { owner: string; name: string; description: string }[] = [];
  for (const owner of [id, "shared"]) {
    const dir = join("skills", owner);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, "SKILL.md");
      if (!existsSync(file)) continue;
      const description = readFileSync(file, "utf8").match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      out.push({ owner, name, description });
    }
  }
  return out;
}

// Every approved skill on disk, by owner (a crew member, or "shared").
function installedSkills() {
  const out: { owner: string; name: string; description: string; path: string }[] = [];
  if (!existsSync("skills")) return out;
  for (const owner of readdirSync("skills")) {
    const dir = join("skills", owner);
    if (!existsSync(dir) || owner.startsWith(".")) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, "SKILL.md");
      if (!existsSync(file)) continue;
      const description = readFileSync(file, "utf8").match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      out.push({ owner, name, description, path: file });
    }
  }
  return out;
}

async function agentDetail(id: CrewId) {
  const c = CREW[id];
  const spec = id === "quartermaster" ? quartermasterSpec() : ROSTER[id];
  const { model, effort } = resolveModel({ id, model: spec.model, effort: spec.effort });
  const runs = recentQuests(Number.MAX_SAFE_INTEGER).filter((q) => q.character === c.name).reverse();
  const done = runs.filter((r) => r.status === "done").length;
  const costs = runs.map((r) => questCost(r));
  ensureWorkspace(id);
  const memoryFile = workspace(id).memory;
  const mcp = await mcpToolsFor(id);
  // Runs from before runs were linked to transcripts: find the session that ended during the run.
  const sessions = recentSessions(id, 2000);
  const linked = runs.map((r) => {
    if (r.session) return r;
    const start = new Date(r.time).getTime();
    const match = sessions.find((s) => {
      const end = new Date(s.time).getTime();
      return end >= start && end <= start + (r.seconds + 10) * 1000;
    });
    return match ? { ...r, session: match.file } : r;
  });
  return {
    id, name: c.name, emoji: c.emoji, role: c.role, personality: c.personality, handles: c.handles, notFor: c.notFor, aliases: c.aliases,
    model, effort: effort ?? "default", defaultModel: spec.model ?? DEFAULT_MODEL, defaultEffort: spec.effort ?? "default",
    overridden: !!(agentSettings(id).model || agentSettings(id).effort),
    xp: done * 10,
    stats: {
      runs: runs.length,
      done,
      successRate: runs.length ? Math.round((100 * done) / runs.length) : null,
      cost: costs.reduce((a, b) => a + b, 0),
      avgSeconds: runs.length ? Math.round(runs.reduce((s, r) => s + r.seconds, 0) / runs.length) : null,
      lastActive: runs[0]?.time ?? null,
    },
    runs: linked.slice(0, 100).map((r, i) => ({ ...r, cost: costs[i] })),
    sessions: recentSessions(id, 60),
    memory: existsSync(memoryFile) ? readFileSync(memoryFile, "utf8").replace(/^# .*\n+/, "") : "",
    outputs: listOutputs(id),
    tools: [...spec.tools, ...mcp].map((t) => ("name" in t.def ? t.def.name : "tool")),
    skills: skillsFor(id),
  };
}

// What /api/agent and /api/state send. The page imports these types (ui/src/types.ts), so it is
// checked against what the server really returns.
export type AgentDetail = Awaited<ReturnType<typeof agentDetail>>;
export type CampState = Awaited<ReturnType<typeof state>>;

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
        maxTurns: resolveTurns({ id, maxTurns: base?.maxTurns }), defaultMaxTurns: base?.maxTurns ?? DEFAULT_TURNS,
        defaultModel: base?.model ?? DEFAULT_MODEL, defaultEffort: base?.effort ?? "default",
        overridden: !!(override.model || override.effort || override.maxTurns),
      };
    }),
    memories: CREW_IDS.map((id) => ({ id, name: CREW[id].name, emoji: CREW[id].emoji, memory: readMemory(id), sessions: recentSessions(id, 1000).length })),
    xp,
    running: [...running.values()].map((w) => ({ id: w.id, label: w.label })),
    queued: queue.map((w) => ({ id: w.id, label: w.label })),
    parallel: parallelLimit(),
    sandbox: { on: shellSettings().sandbox === true, available: sandboxAvailable() },
    // Everything the Settings page shows that isn't already above.
    settings: {
      approval: approvalLevel(),
      allow: shellSettings().allow ?? [],
      exact: shellSettings().exact ?? [],
      defaultAllow: DEFAULT_ALLOW,
      questsAtOnce: questLimit(),
      questsMax: QUESTS_MAX,
      parallelMax: PARALLEL_MAX,
      selfEdit: selfEditAllowed(),
      phone: { topic: phoneSettings().topic ?? "", server: phoneSettings().server ?? "", approve: phoneSettings().approve ?? null, on: !!phoneConfig() },
      runtimeLocked: process.env.CAMP_RUNTIME ?? null,
    },
    installedSkills: installedSkills(),
    limits: campRuntime() === "claude-code" ? planLimits().map((l) => ({ ...l, label: limitLabel(l.type) })) : [],
    pausedUntil: pausedUntil(),
    pauseMessage: pausedUntil() ? pauseMessage(pausedUntil()!) : null,
    jobsRunBy: schedulerOwner()?.owner ?? null, // "ui" (here), "watch" (a terminal or background watcher), or nobody yet
    phone: !!phoneConfig(),
    asks: [...pendingAsks.entries()].map(([id, { q }]) => ({ id, ...q })),
    jobs: loadJobs(),
    quests: all.slice(-80).reverse().map((q) => ({ ...q, cost: questCost(q) })),
    spend: spending(all),
    budgetUsd: budgetUsd() ?? null,
    connectors: await connectorStatus(),
    wiki: wikiPages(),
    skills: pendingDetails(),
    inbox: inboxEntries(),
    snippets: loadSnippets(),
    links: loadLinks(),
    runtime: campRuntime(),
    login: campRuntime() === "claude-code" ? await claudeLogin() : null,
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
      const page = uiPage(TOKEN);
      if (!page) return send(res, 503, UI_NOT_BUILT, "text/plain; charset=utf-8");
      res.setHeader("content-security-policy", UI_CSP);
      return send(res, 200, page, "text/html; charset=utf-8");
    }
    if (!authed) return send(res, 401, { error: "Missing or wrong camp token" });

    // The page's built scripts and styles (ui/dist/assets). The page links them with the token.
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const asset = uiAsset(url.pathname);
      if (!asset) return send(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      return res.end(asset.body);
    }

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

    // One crew member's page: identity, model, stats, runs, chat history, memory, outputs, tools, skills.
    if (req.method === "GET" && url.pathname === "/api/agent") {
      const id = String(url.searchParams.get("id")) as CrewId;
      if (!CREW[id]) return send(res, 404, { error: "No such crew member" });
      return send(res, 200, await agentDetail(id));
    }

    // One run's full transcript.
    if (req.method === "GET" && url.pathname === "/api/agent/session") {
      const id = String(url.searchParams.get("id")) as CrewId;
      const s = CREW[id] ? readSession(id, String(url.searchParams.get("file"))) : null;
      return s ? send(res, 200, s) : send(res, 404, { error: "No such session" });
    }

    // A file from an agent's outputs folder: images as images, text as JSON.
    if (req.method === "GET" && url.pathname === "/api/agent/output") {
      const id = String(url.searchParams.get("id")) as CrewId;
      if (!CREW[id]) return send(res, 404, { error: "No such crew member" });
      const abs = resolve(CAMP_ROOT, normalize(url.searchParams.get("path") ?? ""));
      if (!abs.startsWith(resolve(CAMP_ROOT, workspace(id).outputs) + sep) || !existsSync(abs)) return send(res, 404, { error: "No such file" });
      const media = imageType(abs);
      if (media) {
        res.writeHead(200, { "content-type": media, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return res.end(readFileSync(abs));
      }
      const buf = readFileSync(abs);
      if (buf.length > 300_000 || buf.includes(0)) return send(res, 200, { binary: true, size: buf.length });
      return send(res, 200, { text: buf.toString("utf8") });
    }

    // Linked folders that are git repositories, with their worktrees (for the "work in" picker).
    if (req.method === "GET" && url.pathname === "/api/repos") return send(res, 200, { repos: await linkedRepos() });

    // Where one worktree stands now: uncommitted files and commits since the expedition started.
    if (req.method === "GET" && url.pathname === "/api/repo/status") {
      const q = url.searchParams;
      return send(res, 200, await workspaceStatus({ link: String(q.get("link")), path: String(q.get("path")), branch: "", base: q.get("base") ?? undefined }));
    }

    // What an expedition's file tools changed: the files and a unified diff.
    if (req.method === "GET" && url.pathname === "/api/checkpoint") {
      return send(res, 200, checkpointDiff(String(url.searchParams.get("id") ?? "")));
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
      // { resume: <expedition id> }: pick up a run that was cut off or stopped, from what it had done.
      const resume = typeof body.resume === "string" ? body.resume : undefined;
      if (resume) { body.replyTo = resume; text ||= "Pick up where this left off and finish the job. Check what's already done before redoing anything."; }
      if (!text && attachments.length === 0) return send(res, 400, { error: "Empty request" });
      if (!text) text = "Take a look at what I attached.";
      const direct = text.match(/^@(\w+)\s+([\s\S]+)$/) ?? (attachments.length ? text.match(/^@(\w+)$/) : null);
      const who = direct ? findCrew(direct[1]) : undefined;
      if (direct && !who) return send(res, 400, { error: `No crew member named "${direct[1]}"` });
      const { content, attached } = buildRequest(direct ? direct[2] ?? "Take a look at what I attached." : text, attachments);
      // A follow-up: { replyTo: <expedition id> } continues that conversation with whoever it was
      // with (unless the message names someone else). An agent's chat page sends { chat: true }
      // to carry on its latest direct chat.
      let replyTo = typeof body.replyTo === "string" ? body.replyTo : undefined;
      if (!replyTo && body.chat && who && who.id !== "quartermaster") replyTo = latestDirect(who.id);
      const thread = threadFor(replyTo);
      if (!thread || (who && who.id !== thread.agent)) replyTo = undefined; // addressed to someone else: a fresh start
      const target = who ?? (replyTo && thread?.direct ? findCrew(thread.agent) : undefined);
      // { workspaces: { <link>: { mode: "new", branch? } | { mode: "existing", path } } }: work in a
      // worktree of that linked repo instead of the linked checkout. A reply without it stays
      // where its conversation was working.
      let workspaces: Awaited<ReturnType<typeof prepareWorkspaces>> | undefined;
      try {
        const chosen = body.workspaces && typeof body.workspaces === "object" ? body.workspaces : undefined;
        if (chosen && Object.keys(chosen).length) workspaces = await prepareWorkspaces(chosen, direct ? direct[2] ?? text : text, randomUUID());
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
      const w = target && target.id !== "quartermaster"
        ? enqueue({ label: `@${target.id}`, run: (signal, id, steering) => runDirect(target.id, content, "direct", attached, signal, id, replyTo, { workspaces, steering }) })
        : enqueue({ label: "expedition", run: (signal, id, steering) => runExpedition(content, { attached, signal, id, replyTo, workspaces, steering }) });
      const position = queue.indexOf(w) + 1; // 0: it started right away
      return send(res, 200, { ok: true, id: w.id, position, attached: attached.length });
    }

    // Pick an agent's model and effort. { id, model, effort } sets them; { id, reset: true } goes back to defaults.
    if (url.pathname === "/api/agents") {
      const id = String(body.id) as keyof typeof CREW;
      if (!CREW[id]) return send(res, 404, { error: "No such crew member" });
      if (body.reset) {
        setAgentSettings(id, { model: null, effort: null, maxTurns: null });
        return send(res, 200, { ok: true });
      }
      // Turn limit: a whole number in range, or null/"" for the crew default.
      let maxTurns: number | null | undefined;
      if (body.maxTurns === null || body.maxTurns === "") maxTurns = null;
      else if (body.maxTurns !== undefined) {
        maxTurns = Number(body.maxTurns);
        if (!Number.isInteger(maxTurns) || maxTurns < TURNS_MIN || maxTurns > TURNS_MAX) {
          return send(res, 400, { error: `Max turns must be a whole number from ${TURNS_MIN} to ${TURNS_MAX}` });
        }
      }
      const { models } = await listModels();
      const model = models.find((m) => m.id === body.model);
      if (!model) return send(res, 400, { error: `Unknown model "${body.model}"` });
      const effort = body.effort ? String(body.effort) as Effort : null;
      if (effort && (!EFFORTS.includes(effort) || !model.efforts.includes(effort))) {
        return send(res, 400, { error: `${model.name} doesn't support effort "${effort}"` });
      }
      setAgentSettings(id, { model: model.id, effort, maxTurns });
      return send(res, 200, { ok: true });
    }

    // Per-expedition budget in dollars ({ usd: 2.5 }); 0 or empty removes it.
    // Switch what runs the crew: { runtime: "claude-code" | "api" }.
    if (url.pathname === "/api/runtime") {
      if (body.runtime !== "claude-code" && body.runtime !== "api") return send(res, 400, { error: "runtime must be claude-code or api" });
      if (process.env.CAMP_RUNTIME) return send(res, 409, { error: `CAMP_RUNTIME=${process.env.CAMP_RUNTIME} is set for this server; change it there.` });
      setRuntime(body.runtime);
      const login = body.runtime === "claude-code" ? await claudeLogin(true) : null;
      return send(res, 200, { ok: true, runtime: body.runtime, login });
    }

    if (url.pathname === "/api/budget") {
      const v = Number(body.usd);
      if (body.usd !== null && body.usd !== "" && (!Number.isFinite(v) || v < 0)) return send(res, 400, { error: "Budget must be a positive number of dollars" });
      setBudgetUsd(body.usd === null || body.usd === "" ? null : v);
      return send(res, 200, { ok: true, budgetUsd: budgetUsd() ?? null });
    }

    // Link a folder on your disk ({ path, access: "read" | "write" }) instead of uploading it.
    if (url.pathname === "/api/links") {
      try {
        const link = addLink(String(body.path ?? ""), body.access === "write" ? "write" : "read", CAMP_ROOT);
        emit({ type: "changed", what: "links" });
        return send(res, 200, link);
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }
    // Open the system's folder dialog on this machine and return the chosen path (not linked yet).
    if (url.pathname === "/api/links/pick") {
      try {
        return send(res, 200, await pickFolder());
      } catch (e: any) {
        return send(res, 500, { error: `The folder dialog didn't open: ${e.message}` });
      }
    }
    // Commands to run by themselves after a quest changes files in a linked folder ({ name, commands: [...] }).
    if (url.pathname === "/api/links/verify") {
      const ok = setLinkVerify(String(body.name), Array.isArray(body.commands) ? body.commands : []);
      if (ok) emit({ type: "changed", what: "links" });
      return send(res, ok ? 200 : 404, { ok });
    }

    // Say something to a running expedition ({ id, text }). The agents working in it see it on their next step.
    if (url.pathname === "/api/steer") {
      const w = running.get(String(body.id));
      const said = String(body.text ?? "").trim();
      if (!w) return send(res, 409, { error: "That expedition isn't running any more. Use Reply to follow up." });
      if (!said) return send(res, 400, { error: "Nothing to send" });
      steer(w.steering, said.slice(0, 8000));
      emit({ type: "steer", id: w.id, text: said.slice(0, 8000), expeditionId: w.id });
      return send(res, 200, { ok: true });
    }

    // Your own git actions on an expedition's worktree. Nothing here is ever triggered by an agent.
    if (url.pathname === "/api/repo/commit" || url.pathname === "/api/repo/pr" || url.pathname === "/api/repo/remove") {
      const w = { link: String(body.link ?? ""), path: String(body.path ?? "") };
      try {
        if (url.pathname === "/api/repo/commit") return send(res, 200, { ok: true, commit: await commitWorkspace(w, String(body.message ?? "")) });
        if (url.pathname === "/api/repo/pr") return send(res, 200, { ok: true, url: await openPullRequest(w, String(body.title ?? ""), String(body.body ?? "")) });
        await removeWorkspace(w);
        return send(res, 200, { ok: true });
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }

    // The shell sandbox ({ on: true | false }); see sandbox.ts.
    if (url.pathname === "/api/sandbox") {
      if (body.on && !sandboxAvailable()) return send(res, 400, { error: "The sandbox needs macOS (sandbox-exec)." });
      setShellSandbox(!!body.on);
      return send(res, 200, { ok: true, on: !!body.on });
    }

    // The approval level for shell commands ({ level: "ask" | "safe" | "sandbox" }); see settings.ts.
    if (url.pathname === "/api/approvals") {
      const level = body.level;
      if (level !== "ask" && level !== "safe" && level !== "sandbox") return send(res, 400, { error: "level must be ask, safe or sandbox" });
      if (level === "sandbox" && !sandboxAvailable()) return send(res, 400, { error: "The sandbox needs macOS (sandbox-exec)." });
      setApprovalLevel(level);
      return send(res, 200, { ok: true, level: approvalLevel() });
    }

    // Your shell allow-list and "Always allow" commands ({ allow?: string[], exact?: string[] }).
    if (url.pathname === "/api/shell") {
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
      setShellLists({ allow: list(body.allow), exact: list(body.exact) });
      return send(res, 200, { ok: true });
    }

    // How many dispatched quests run at once, camp-wide ({ n: 1–16 }).
    if (url.pathname === "/api/quests-at-once") {
      const n = Number(body.n);
      if (!Number.isInteger(n) || n < 1 || n > QUESTS_MAX) return send(res, 400, { error: `Pick a number from 1 to ${QUESTS_MAX}` });
      setQuestLimit(n);
      return send(res, 200, { ok: true, questsAtOnce: questLimit() });
    }

    // Let agents edit the camp's own source ({ on }).
    if (url.pathname === "/api/self-edit") {
      setSelfEdit(!!body.on);
      return send(res, 200, { ok: true, selfEdit: selfEditAllowed() });
    }

    // Phone approvals through ntfy ({ topic, server, approve: [...] }); an empty topic turns it off.
    if (url.pathname === "/api/phone") {
      const topic = String(body.topic ?? "").trim();
      const server = String(body.server ?? "").trim();
      if (topic && !/^[A-Za-z0-9_-]{12,64}$/.test(topic)) return send(res, 400, { error: "The topic must be 12–64 letters, digits, - or _ (make it long and random: anyone who knows it can answer)." });
      if (server && !/^https?:\/\//.test(server)) return send(res, 400, { error: "The server must start with https:// (or http://)" });
      const kinds = ["plan", "job", "question", "shell", "tool"];
      const approve = Array.isArray(body.approve) ? body.approve.map(String).filter((k: string) => kinds.includes(k)) : undefined;
      setPhoneSettings(topic ? { topic, ...(server ? { server } : {}), ...(approve ? { approve } : {}) } : {});
      return send(res, 200, { ok: true, on: !!phoneConfig() });
    }

    if (url.pathname === "/api/links/remove") {
      const ok = removeLink(String(body.name));
      if (ok) emit({ type: "changed", what: "links" });
      return send(res, ok ? 200 : 404, { ok });
    }

    if (url.pathname === "/api/snippets") {
      if (body.action === "add") return send(res, 200, addSnippet(String(body.title ?? ""), String(body.text ?? "")));
      if (body.action === "delete") return send(res, deleteSnippet(String(body.id)) ? 200 : 404, { ok: true });
      return send(res, 400, { error: "Unknown action" });
    }

    // Edit a crew member's memory by hand ({ id, text }).
    if (url.pathname === "/api/agent/memory") {
      const id = String(body.id) as CrewId;
      if (!CREW[id]) return send(res, 404, { error: "No such crew member" });
      if (typeof body.text !== "string" || body.text.length > 50_000) return send(res, 400, { error: "Memory must be text under 50,000 characters" });
      writeMemory(id, body.text);
      return send(res, 200, { ok: true });
    }

    // Put back every file an expedition's file tools changed ({ id }).
    if (url.pathname === "/api/checkpoint/undo") {
      const id = String(body.id ?? "");
      if (running.has(id)) return send(res, 409, { error: "That expedition is still running. Stop it first." });
      const r = undoCheckpoint(id);
      emit({ type: "changed", what: "checkpoints" });
      return send(res, 200, { ok: true, ...r });
    }

    // "Try anyway": start queued work even though the plan's limit was reported as used up.
    if (url.pathname === "/api/limits/resume") {
      resumeNow();
      drain();
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/stop") {
      const stopped = stopWork(body.id ? String(body.id) : undefined);
      return send(res, stopped.length ? 200 : 409, stopped.length ? { ok: true, stopped } : { error: "Nothing is running" });
    }

    // How many expeditions run at once ({ parallel: 1–8 }).
    if (url.pathname === "/api/parallel") {
      const n = Number(body.parallel);
      if (!Number.isInteger(n) || n < 1 || n > PARALLEL_MAX) return send(res, 400, { error: `Pick a number from 1 to ${PARALLEL_MAX}` });
      setParallelLimit(n);
      drain(); // a higher limit starts queued work now
      return send(res, 200, { ok: true, parallel: parallelLimit() });
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
        if (!queuedJob(name)) enqueue({ label: `job:${name}`, run: (signal, id) => runJob(job, signal, id) });
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

// Approvals from your phone (off unless camp/settings.json has a "phone" topic; see phone.ts).
startPhoneBridge((askId, answer) => {
  const pending = pendingAsks.get(askId);
  if (!pending) return false;
  pendingAsks.delete(askId);
  pending.resolve(answer);
  return true;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🏕️  Mission control is up: http://127.0.0.1:${PORT}/?t=${TOKEN}`);
  console.log(`   Scheduled jobs run while this is open. Ctrl+C to break camp.`);
  void announceRuntime();
});

// Say up front what the crew runs on, and warn if the subscription login isn't usable.
async function announceRuntime() {
  if (campRuntime() === "api") return console.log("   Crew runs on: the API (ANTHROPIC_API_KEY).");
  const login = await claudeLogin();
  console.log(login.ok
    ? `   Crew runs on: your Claude ${login.plan ? login.plan[0].toUpperCase() + login.plan.slice(1) + " " : ""}subscription, through Claude Code${login.version ? ` ${login.version}` : ""}.`
    : `   ⚠️  ${login.problem}`);
}
