// Mission control: a local web dashboard for the camp.
// Run: npm run ui   → open the printed http://127.0.0.1:4747/?t=… link
// The page itself is a React app in ui/, built into ui/dist (see src/ui-files.ts).
//
// It streams every camp event to the browser, routes approvals (plans, shell commands, new jobs)
// to buttons on the page, and runs scheduled jobs while it's open (so don't also run `npm run watch`).
//
// Safety: it listens on 127.0.0.1 only, checks the Host header (blocks DNS rebinding), and
// requires a random token on everything that reads or changes the camp, so other websites can't
// drive it. The token is kept between starts (camp/.token, see campToken) and never appears in a
// link: the page (which holds nothing of the camp, and is served to anyone on this machine)
// trades a one-time sign-in code for it, and keeps it in this browser (see "Signing in" below). The page runs under a Content-Security-Policy that
// allows no inline code: only the scripts and styles this server serves.

import http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join, normalize, resolve, sep } from "node:path";
import { onEvent, attachConsole, emit, continueSeqFrom, type CampEvent } from "./events.js";
import { setAsker, type Question } from "./ask.js";
import { currentExpeditionId, newSteering, steer, type Steering } from "./context.js";
import { checked, linkedRepos, prepareWorkspaces, workspaceStatus, commitWorkspace, openPullRequest, pullRequestFeedback, pushWorkspace, removeWorkspace, switchBranch, tryGit } from "./repos.js";
import { draftPullRequest, updatePullRequest, ticketOf, prStates, needsYou, checkPullRequests, markSeen, startPrWatch } from "./prs.js";
import { sandboxAvailable, sandboxKind, SANDBOX_NEEDS } from "./sandbox.js";
import { DEFAULT_ALLOW } from "./shell.js";
import { runExpedition, runDirect, QM_DEFAULTS, quartermasterSpec, runChat, CHAT, heldPlans } from "./quartermaster.js";
import { ROSTER } from "./roster.js";
import { DEFAULT_MODEL, listModels, resolveModel, resolveTurns } from "./agent.js";
import { agentSettings, setAgentSettings, EFFORTS, budgetUsd, setBudgetUsd, campRuntime, setRuntime, parallelLimit, setParallelLimit, PARALLEL_MAX, shellSettings, setShellSandbox, approvalLevel, setApprovalLevel, setShellLists, setShellReviewer, setPlainApprovals, questLimit, setQuestLimit, QUESTS_MAX, selfEditAllowed, setSelfEdit, autoTitlesOn, setAutoTitles, fixAttempts, setFixAttempts, FIX_ATTEMPTS_MAX, reviewChangesOn, setReviewChanges, prWatchOn, setPrWatch, phoneSettings, setPhoneSettings, DEFAULT_TURNS, TURNS_MIN, TURNS_MAX, type Effort, termActions, setTermActions, memoryCare, setMemoryCare, smallModel, setSmallModel, uploadKeepDays, setUploadKeepDays } from "./settings.js";
import { pruneUploads, uploadsUsage } from "./uploads.js";
import { claudeLogin, refreshPlanUsage } from "./claude-code.js";
import { costOf } from "./costs.js";
import { connectorStatus, closeConnectors, mcpToolsFor } from "./mcp.js";
import { CAMP_ROOT, rl } from "./tools.js";
import { CREW, CREW_IDS, findCrew, addMember, updateMember, removeMember, type CrewId } from "./crew.js";
import { readMemory, recentSessions, readSession, writeMemory, listOutputs, workspace, ensureWorkspace } from "./memory.js";
import { loadJobs, saveJobs } from "./jobs.js";
import { briefFor, cleanTrigger, loadTriggers, pollTrigger, pullItems, saveTriggers, setTriggerEnabled, POLL_MS, PR_TASK, type Trigger, type TriggerItem } from "./triggers.js";
import { checkPulls, freshPulls, pulls as knownPulls } from "./pulls.js";
import { briefDays, briefDue, dayOf, readBrief, writeBrief } from "./brief.js";
import { readRetro, retrosDue, runRetro, type Retro } from "./retro.js";
import { offers, scoreboard } from "./scoreboard.js";
import { drive, setDrive } from "./settings.js";
import { recentQuests, questCost } from "./questlog.js";
import { wikiPages, WIKI_DIR, saveWikiPage, removeWikiPage } from "./wiki.js";
import { pendingDetails, approveSkill, rejectSkill } from "./forge.js";
import { inspectPack, installPack, removeSkill, skillDetail, readSkillFile, saveSkillFile, alwaysFor, setSkillAlways } from "./skillpacks.js";
import { skillCommands } from "./settings.js";
import { dueJobs, runJob, inboxEntries, inboxUnread, markInboxSeen, claimScheduler, schedulerOwner } from "./scheduler.js";
import { feedEventsOf, feedSince, keepInFeed, loadFeed, saveToFeed, trimFeed } from "./feed.js";
import { accessFrom, addressOf, hostAllowed, isLocal } from "./access.js";
import { hostname, networkInterfaces } from "node:os";
import { writeAtomic } from "./atomic.js";
import { planLimits, pausedUntil, pauseMessage, resumeNow, limitLabel, usageMeasuredAt } from "./limits.js";
import { checkpointDiff, undoCheckpoint } from "./checkpoints.js";
import { allTurns, latestDirect, setPlanAside, threadFor } from "./threads.js";
import { chainNote, chainReady } from "./chains.js";
import { ASIDE_BRIEFS, isAsideBrief } from "./review.js";
import { projectPayoff } from "./payoff.js";
import { phoneConfig, startPhoneBridge } from "./phone.js";
import { buildRequest, imageType, saveUpload, searchFiles, UPLOADS_DIR, type Attachment } from "./attachments.js";
import { loadSnippets, addSnippet, deleteSnippet } from "./snippets.js";
import { loadNotes, saveNote, removeNote, patchNote } from "./notes.js";
import { noteName, parseTicket, ticketRequest } from "./ticket.js";
import { passIdea, suggestIdeas } from "./ideas.js";
import { loadLinks, addLink, removeLink, setLinkVerify, setLinkSetup } from "./links.js";
import { githubStatus, switchGithub } from "./github.js";
import { history, conversationEvents, addProject, updateProject, renameProject, removeProject, renameConversation, moveConversation, removeConversation, fileConversation, projectOf, getProject, searchConversations, forkConversation, historyVersion, GENERAL } from "./conversations.js";
import { projectPage, setProjectNotes, setProjectBrief, surveyRequest } from "./projects.js";
import { titleConversation } from "./titles.js";
import { afterRun, forgetLine, pinLine, memoryOverview, proposals, proposeTidy, settleProposal } from "./keeping.js";
import { logKept, writeAbout } from "./memlog.js";
import { anthropicKeyState, setAnthropicKey, approveProvider, connectProvider, disconnectProvider, providersState } from "./providers.js";
import { writeModelGuide } from "./modelguide.js";
import { isAutoChoice, POLICY } from "./routing.js";
import { routingReport } from "./autoroute.js";
import { chroniclePage, chronicleRequest, saveChronicle, weekFacts, weekLabel, weekOf } from "./chronicle.js";
import { giveFeedback, feedbackFor } from "./feedback.js";
import { listTerminals, openTerminal, streamTerminal, writeTerminal, resizeTerminal, closeTerminal, lockTerminal } from "./term.js";
import { connectJira, disconnectJira, findIssues, JIRA_KEY, JIRA_NOTE, JiraError, jiraStatus, pulledTickets, readIssue, saveJiraFilter, ticketDetail, writeBack, writeBackSettings, saveWriteBack } from "./jira.js";
import { runFinished } from "./jiramoments.js";
import { CAMP_FILES, campFile, explorerRoot, listFolder, previewFile, imageFile, changedFiles, findFiles, fileDiff } from "./explorer.js";
import { pickFolder } from "./picker.js";
import { uiPage, uiAsset, uiCsp, UI_NOT_BUILT, splashPage, SPLASH_CSP } from "./ui-files.js";

const PORT = Number(process.env.CAMP_PORT ?? 4747);
// The page's key. It's kept in camp/.token (yours alone to read, and off limits to the crew's
// tools) and used again on the next start, so a tab you left open carries on after the camp
// restarts instead of being locked out. Start with CAMP_NEW_TOKEN=1 (or delete the file) for a new one.
const TOKEN_PATH = "camp/.token";
function campToken(): string {
  if (process.env.CAMP_NEW_TOKEN !== "1") {
    try {
      const kept = readFileSync(TOKEN_PATH, "utf8").trim();
      if (/^[0-9a-f]{48}$/.test(kept)) return kept;
    } catch { /* none yet */ }
  }
  const fresh = randomBytes(24).toString("hex");
  try { writeAtomic(TOKEN_PATH, fresh + "\n", { mode: 0o600 }); } catch { /* it still works for this launch */ }
  return fresh;
}
const TOKEN = campToken();

// ---------- Signing in ----------
// The link the camp prints carries a sign-in code, not the key: good once, for one browser. The
// page trades it for the key (POST /api/login) and keeps the key in that browser's own storage
// for this address and port, which no other site or local server can read. So nothing lasting
// ends up in the browser's history, the address bar, or a bookmark, and after the first time
// http://127.0.0.1:<port>/ opens by itself. (A cookie would have been simpler, but browsers send
// a cookie to every port on 127.0.0.1: any other local server you opened would be handed it.)
// Who can reach it: this machine only, or (CAMP_LAN=1) your other machines at home too. See access.ts.
const ACCESS = accessFrom(process.env, hostname(), networkInterfaces());
const signInCodes = new Map<string, number>(); // code → when it lapses (Infinity: when it's used, or the camp stops)
// lasts: how long the code is good for, in minutes. The ones the camp's own terminal prints keep
// until used; one made from the page, for another device, lapses after ten minutes.
function newSignInCode(lasts = Infinity): string {
  const code = randomBytes(16).toString("hex");
  signInCodes.set(code, lasts === Infinity ? Infinity : Date.now() + lasts * 60_000);
  if (signInCodes.size > 20) signInCodes.delete(signInCodes.keys().next().value!); // the oldest unused ones lapse
  return code;
}
const takeSignInCode = (code: string) => { const until = signInCodes.get(code); signInCodes.delete(code); return until !== undefined && Date.now() < until; };
const linkAt = (origin: string, code: string) => `${origin}#k=${code}`;
const HERE = `http://127.0.0.1:${PORT}/`;
// The address to use from another machine (LAN mode): the first name this machine goes by.
const fromElsewhere = () => (ACCESS.names.length ? addressOf(ACCESS.names[0], PORT) : null);
// One code, good once, as a link for this machine and (in LAN mode) for another.
function newSignInLink(): string {
  const code = newSignInCode();
  return linkAt(HERE, code) + (fromElsewhere() ? `\n   From another machine: ${linkAt(fromElsewhere()!, code)}` : "");
}
const STYLE_NONCE = randomBytes(18).toString("base64url"); // for the terminal pane's style rules (see ui-files.ts)
const BOOT_ID = randomBytes(6).toString("hex");
const MAX_BODY = 1_000_000;
const MAX_UPLOAD_BODY = 36_000_000; // one file per request: ~25 MB once base64-encoded
const BUFFER_SIZE = 800;
const TICK_MS = 30_000;
const STREAM_BACKLOG_MAX = 8_000_000;

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
  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of streams) {
    // A tab that has stopped reading (asleep, or stalled) would otherwise have every event held
    // in memory for it. Past a few megabytes it's dropped: the page reconnects and is replayed the feed.
    if (res.writableLength > STREAM_BACKLOG_MAX) { streams.delete(res); res.destroy(); continue; }
    res.write(line);
  }
});

// ---------- Approvals answered from the browser ----------
// Each remembers its expedition, so stopping one expedition only declines its own questions.
const pendingAsks = new Map<string, { q: Question; resolve: (answer: string) => void; expeditionId?: string }>();
setAsker((q) => new Promise((resolve) => pendingAsks.set(q.id, { q, resolve, expeditionId: currentExpeditionId() })));

// Plans held for later that have been started this time the camp is up (a run records it as it starts,
// and this covers one still waiting in the queue), so a second click doesn't start one twice.
const startedPlans = new Set<string>();

// ---------- Several expeditions at once; past the limit, work waits its turn ----------
// Each piece of work has its own expedition id and stop signal, so its events, approvals, and
// Stop button stay its own. The limit (settings "parallel", default 3) keeps a subscription's
// usage limits (or API spend) from draining all at once.
// steering: what you say to it while it runs (the Steer box on its card) reaches the agents working in it.
// task: the request's opening words, for the page's list of what's running and waiting.
// after: a chained request, held until that run has finished. held: the run it waited on didn't
// finish cleanly (how it ended), so it stays put until you start it anyway or take it off.
type Work = { id: string; label: string; run: (signal: AbortSignal, id: string, steering: Steering) => Promise<unknown>; controller?: AbortController; steering: Steering;
  task?: string; after?: string; held?: string };
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
  while (!paused && running.size < parallelLimit()) {
    const at = queue.findIndex(ready);
    if (at < 0) break;
    const w = queue.splice(at, 1)[0];
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

// A chained request waits for the run it follows (chains.ts).
const inFlight = (id: string) => running.has(id) || queue.some((q) => q.id === id);
const ready = (w: Work) => chainReady(w, inFlight);

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
  try {
    if (!claimScheduler("ui")) return; // `npm run watch` already has the jobs
    for (const job of dueJobs()) if (!queuedJob(job.name)) enqueue({ label: `job:${job.name}`, run: (signal, id) => runJob(job, signal, id) });
  } catch (e: any) {
    console.error(`💥 scheduled jobs: ${e?.message ?? e}`); // a timer has nobody to catch for it: one bad tick mustn't end the camp
  }
}, TICK_MS);

// Uploads nothing uses any more are deleted once they're as old as you said (Settings → General),
// a little after start-up and then once a day. Never, unless you set a number of days.
function tidyUploads() {
  const days = uploadKeepDays();
  if (!days) return;
  try {
    const gone = pruneUploads(days);
    if (gone.batches) console.log(`🧹 Cleared ${gone.files} upload${gone.files === 1 ? "" : "s"} nothing uses any more (older than ${days} days).`);
  } catch (e: any) { console.error(`💥 clearing uploads: ${e?.message ?? e}`); }
}
setTimeout(tidyUploads, 60_000).unref();
setInterval(tidyUploads, 24 * 3_600_000).unref();

// The feed file is trimmed at start-up; a camp that stays up for weeks checks now and then too.
setInterval(() => { trimFeed(); }, 6 * 3_600_000).unref();

// ---------- Triggers: work that starts when an issue or ticket arrives (triggers.ts) ----------
// Each new item starts an ordinary expedition, filed under the trigger's project, whose plan
// waits for your OK like any other.
async function startFromTrigger(t: Trigger, item: TriggerItem) {
  const brief = await briefFor(t, item);
  if (t.kind === "github-pr" && item.pr) return startFromPull(t, item, brief);
  const project = projectOf(undefined, t.project);
  let workspaces: Awaited<ReturnType<typeof prepareWorkspaces>> | undefined;
  if (t.worktree) {
    const repos = new Set((await linkedRepos()).filter((r) => r.access === "write").map((r) => r.link));
    const wanted = t.link ? [t.link] : project.links ?? [];
    const chosen = Object.fromEntries(wanted.filter((l) => repos.has(l)).map((l) => [l, { mode: "new" as const, branch: `camp/${t.kind === "jira" ? item.id.toLowerCase() : `issue-${item.id.slice(1)}`}` }]));
    try { if (Object.keys(chosen).length) workspaces = await prepareWorkspaces(chosen, item.title, randomUUID()); }
    catch (e: any) { console.error(`💥 trigger ${t.name}: ${e.message}`); }
  }
  const links = [...new Set([...(t.link ? [t.link] : []), ...Object.keys(workspaces ?? {})])];
  const shown = `${t.kind === "jira" ? item.id : `Issue ${item.id}`}: ${item.title}`;
  const stillRunning = (id: string) => running.has(id) || queue.some((q) => q.id === id);
  const w = enqueue({ label: `trigger:${t.name}`, task: shown.slice(0, 90), run: async (signal, id, steering) => {
    const r = await runExpedition(brief, { signal, id, steering, stillRunning, displayTask: shown, workspaces, project: project.id, links, by: `trigger:${t.name}`,
      ...(item.jira ? { jira: item.jira } : {}) });
    void titleConversation(id, shown, r.text);
    return r;
  } });
  fileConversation(w.id, project.id);
}

// Something new on one of your pull requests (pulls.ts). Feedback carries on the conversation
// that did the work, so the crew has what was done and why in front of it; with no such
// conversation it starts one. New commits to describe go to the Scribe, who steps into that
// conversation for the one turn. Either way what happens next waits for you: a plan to approve,
// or the exact new description on a card.
function startFromPull(t: Trigger, item: TriggerItem, brief: string, by = `trigger:${t.name}`) {
  const pr = item.pr!;
  const stillRunning = (id: string) => running.has(id) || queue.some((q) => q.id === id);
  const found = threadFor(pr.continues, stillRunning);
  // The Quartermaster's conversations are carried on; someone else's (a chat with one crew member) is left as it is.
  const thread = found && (pr.describe || !found.direct) && found.agent !== CHAT ? found : null;
  const replyTo = thread ? pr.continues : undefined;
  const project = projectOf(thread?.thread, t.project);
  const links = [...new Set([...(thread?.links ?? []), ...(t.link ? [t.link] : [])])];
  const shown = `Pull request #${pr.number}: ${pr.describe ? "new commits to describe" : "new feedback"} (${item.title})`;
  const w = pr.describe
    ? enqueue({ label: by, task: shown.slice(0, 90), run: async (signal, id, steering) => {
        const r = await runDirect("scribe", brief, "direct", undefined, signal, id, replyTo, { steering, stillRunning, project: project.id, links, by, aside: !!thread && thread.agent !== "scribe" });
        if (!replyTo && r) void titleConversation(id, shown, r.text);
        return r;
      } })
    : enqueue({ label: by, task: shown.slice(0, 90), run: async (signal, id, steering) => {
        const r = await runExpedition(brief, { signal, id, steering, stillRunning, displayTask: shown, replyTo, project: project.id, links, by, ...(thread?.model ? { model: thread.model } : {}) });
        if (!replyTo) void titleConversation(id, shown, r.text);
        return r;
      } });
  if (!replyTo) fileConversation(w.id, project.id);
  return { id: w.id, thread: thread?.thread ?? w.id };
}

// ---------- What the camp does unasked: the morning brief and the weekly retro ----------
// Both are worked out from the record (brief.ts, retro.ts). The brief calls no model; the retro
// makes one small call per project per week, and only proposes: you approve what's kept.
const isRunning = (id: string) => running.has(id) || queue.some((q) => q.id === id);
const waitingOnYou = () => { try { return { memory: proposals().length, skills: pendingDetails().length }; } catch { return { memory: 0, skills: 0 }; } };
let retroing = false;
setInterval(() => {
  try {
    if (briefDue()) void writeBrief({ running: isRunning, waiting: waitingOnYou(), announce: true }).catch((e) => console.error(`💥 morning brief: ${e?.message ?? e}`));
    if (!retroing && !pausedUntil()) {
      const due = retrosDue();
      if (due.length) {
        retroing = true;
        void (async () => { for (const r of due) await runRetro(r.id, r.week).catch((e) => console.error(`💥 retro: ${e?.message ?? e}`)); })().finally(() => { retroing = false; });
      }
    }
  } catch (e: any) {
    console.error(`💥 brief and retro: ${e?.message ?? e}`);
  }
}, 60_000).unref();
// Your pull requests are read again every ten minutes while the watch is on (the same switch as prs.ts).
setInterval(() => { if (prWatchOn()) void freshPulls(9 * 60_000).catch(() => { /* next time */ }); }, 10 * 60_000).unref();
setTimeout(() => { if (prWatchOn()) void freshPulls(9 * 60_000).catch(() => {}); }, 25_000).unref();

// What to call you on the entry page: the first name git commits under here, if it has one.
let yourName = "";
void tryGit(process.cwd(), ["config", "user.name"]).then((n) => { yourName = n.trim().split(/\s+/)[0] ?? ""; });

// The entry page: today's brief (or the latest there is), the scoreboard, what the camp could
// take over, and each project's latest retro. project: one project's numbers only.
function homePage(project?: string) {
  const days = briefDays();
  const board = scoreboard({ project });
  const retros: (Retro & { project: string; name: string })[] = [];
  for (const p of history().projects) {
    if (p.id === GENERAL) continue;
    const latest = [board.weeks.at(-1)?.week, board.weeks.at(-2)?.week].flatMap((w) => (w ? [readRetro(p.id, w)] : [])).find(Boolean);
    if (latest) retros.push({ ...latest, project: p.id, name: p.name });
  }
  const known = knownPulls();
  // held: plans approved to start later, waiting for you (read live, not from the morning's brief).
  const held = heldPlans().filter((h) => !project || h.project === project);
  return { name: yourName, today: dayOf(new Date()), brief: days.length ? readBrief(days[0]) : null, days, board, offers: offers(board), retros, drive: drive(), held,
    pulls: { fetched: known.fetched, count: known.pulls.filter((p) => p.state === "OPEN").length, ...(known.error ? { error: known.error } : {}) } };
}
export type HomePage = ReturnType<typeof homePage>;
let polling = false;
async function pollTriggers() {
  if (polling || pausedUntil()) return;
  polling = true;
  try {
    for (const t of loadTriggers().filter((x) => x.enabled)) {
      for (const item of await pollTrigger(t)) await startFromTrigger(t, item).catch((e) => console.error(`💥 trigger ${t.name}: ${e.message}`));
    }
  } finally { polling = false; }
}
setInterval(() => void pollTriggers(), POLL_MS).unref();
setTimeout(() => void pollTriggers(), 15_000).unref();

// ---------- State for the panels ----------
// Spending from the quest log: every API call is logged once (the Quartermaster's own calls,
// and each quest's), so summing entries doesn't double count.
function spending(all: ReturnType<typeof recentQuests>) {
  const now = Date.now();
  const day = new Date(); day.setHours(0, 0, 0, 0);
  let today = 0, week = 0, total = 0;
  const byAgent: Record<string, number> = {}; // today's, by whose calls they were (Orbit's gauge on each planet)
  for (const q of all) {
    const c = questCost(q);
    total += c;
    const t = new Date(q.time).getTime();
    if (t >= day.getTime()) { today += c; if (q.character) byAgent[q.character] = (byAgent[q.character] ?? 0) + c; }
    if (now - t < 7 * 86_400_000) week += c;
  }
  return { today, week, total, byAgent };
}

// Skills a crew member can use: its own plus the shared ones.
function skillsFor(id: CrewId) {
  const out: { owner: string; name: string; description: string; always: boolean }[] = []; // always: its instructions are in every one of their prompts
  for (const owner of [id, "shared"]) {
    const dir = join("skills", owner);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, "SKILL.md");
      if (!existsSync(file)) continue;
      const description = readFileSync(file, "utf8").match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      out.push({ owner, name, description, always: alwaysFor(owner, name).includes(id) });
    }
  }
  return out;
}

// Every approved skill on disk, by owner (a crew member, or "shared").
function installedSkills() {
  const out: { owner: string; name: string; description: string; path: string; commands: string[]; alwaysFor: string[] }[] = [];
  if (!existsSync("skills")) return out;
  for (const owner of readdirSync("skills")) {
    const dir = join("skills", owner);
    if (!existsSync(dir) || owner.startsWith(".")) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, "SKILL.md");
      if (!existsSync(file)) continue;
      const description = readFileSync(file, "utf8").match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      // commands: what you let this skill run without asking (an imported skill's scripts, or prefixes you gave it).
      out.push({ owner, name, description, path: file, commands: (skillCommands()[`${owner}/${name}`] ?? []).map((c) => c.prefix),
        alwaysFor: alwaysFor(owner, name) }); // the crew members who follow it always, not just when a task matches
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

// full: everything. Otherwise the records only Settings shows (every agent's memory, the quest
// log, the wiki, connectors, the inbox, installed skills) are left out: the page asks for those
// when Settings is open, and every other refresh stays light.
export type CampState = Awaited<ReturnType<typeof fullState>>;
// historySeen: the history stamp the page already has. A light refresh leaves history out when
// it's unchanged (it's most of the answer, and the sidebar needn't redraw).
async function state(full = true, historySeen?: string): Promise<CampState> {
  return fullState(full, historySeen);
}
async function fullState(full: boolean, historySeen?: string) {
  const historyNow = historyVersion();
  const sameHistory = !full && historySeen === historyNow;
  const all = recentQuests(Number.MAX_SAFE_INTEGER);
  const none = <T,>(make: () => T): T => (full ? make() : (undefined as T)); // not sent: the page keeps what it had
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
        // A crew member you added: everything the dialog needs to show and edit them.
        custom: !!c.custom, color: c.color ?? null,
        ...(c.custom ? { handles: c.handles, notFor: c.notFor, persona: c.persona ?? "", abilities: c.abilities ?? {}, aliases: c.aliases } : {}),
        model, effort: effort ?? "default",
        maxTurns: resolveTurns({ id, maxTurns: base?.maxTurns }), defaultMaxTurns: base?.maxTurns ?? DEFAULT_TURNS,
        defaultModel: base?.model ?? DEFAULT_MODEL, defaultEffort: base?.effort ?? "default",
        overridden: !!(override.model || override.effort || override.maxTurns),
      };
    }),
    // Other models you've connected (DeepSeek, Gemini, Groq, OpenRouter): which, and how many models each offers. Never a key.
    providers: none(() => providersState()),
    anthropic: anthropicKeyState(),
    // What's remembered, line by line, and what's waiting for your say (keeping.ts).
    memory: none(() => memoryOverview()),
    memoryProposals: none(() => proposals()),
    memories: none(() => CREW_IDS.map((id) => ({ id, name: CREW[id].name, emoji: CREW[id].emoji, memory: readMemory(id), sessions: recentSessions(id, 1000).length }))),
    xp,
    running: [...running.values()].map((w) => ({ id: w.id, label: w.label, task: w.task ?? "" })),
    queued: queue.map((w) => ({ id: w.id, label: w.label, task: w.task ?? "", after: w.after ?? null, held: w.held ?? null })),
    parallel: parallelLimit(),
    sandbox: { on: shellSettings().sandbox === true, available: sandboxAvailable(), kind: sandboxKind() },
    // Everything the Settings page shows that isn't already above.
    settings: {
      approval: approvalLevel(),
      allow: shellSettings().allow ?? [],
      exact: shellSettings().exact ?? [],
      deny: shellSettings().deny ?? [],
      allowHosts: shellSettings().allowHosts ?? [],
      askAlways: shellSettings().ask ?? [],
      reviewer: shellSettings().reviewer === true,
      plainApprovals: shellSettings().explain === true,
      defaultAllow: DEFAULT_ALLOW,
      questsAtOnce: questLimit(),
      questsMax: QUESTS_MAX,
      parallelMax: PARALLEL_MAX,
      selfEdit: selfEditAllowed(),
      autoTitles: autoTitlesOn(),
      uploadKeepDays: uploadKeepDays(), // null: uploads are never deleted by themselves
      fixAttempts: fixAttempts(),
      fixAttemptsMax: FIX_ATTEMPTS_MAX,
      reviewChanges: reviewChangesOn(),
      prWatch: prWatchOn(),
      termActions: termActions(),
      memoryCare: memoryCare(),
      smallModel: smallModel(),
      jiraWrite: writeBackSettings(),
      phone: { topic: phoneSettings().topic ?? "", server: phoneSettings().server ?? "", approve: phoneSettings().approve ?? null, on: !!phoneConfig() },
      runtimeLocked: process.env.CAMP_RUNTIME ?? null,
      // Where it can be reached from: only here, or (LAN mode) your other machines, at these addresses.
      lan: ACCESS.lan ? ACCESS.names.map((n) => addressOf(n, PORT)) : null,
    },
    installedSkills: none(() => installedSkills()),
    limits: campRuntime() === "claude-code" ? planLimits().map((l) => ({ ...l, label: limitLabel(l.type) })) : [],
    limitsMeasured: usageMeasuredAt() || null, // when the plan's own usage figures were last read
    pausedUntil: pausedUntil(),
    pauseMessage: pausedUntil() ? pauseMessage(pausedUntil()!) : null,
    jobsRunBy: schedulerOwner()?.owner ?? null, // "ui" (here), "watch" (a terminal or background watcher), or nobody yet
    phone: !!phoneConfig(),
    asks: [...pendingAsks.entries()].map(([id, { q }]) => ({ id, ...q })),
    jobs: loadJobs(),
    triggers: loadTriggers().map(({ seen, ...t }) => ({ ...t, seen: seen?.length ?? 0 })),
    quests: none(() => all.slice(-80).reverse().map((q) => ({ ...q, cost: questCost(q) }))),
    spend: spending(all),
    budgetUsd: budgetUsd() ?? null,
    connectors: full ? await connectorStatus() : (undefined as unknown as Awaited<ReturnType<typeof connectorStatus>>),
    wiki: none(() => wikiPages()),
    skills: pendingDetails(),
    inboxCount: inboxUnread(), // for the badge in Settings' own menu: what you haven't marked as read
    inbox: none(() => inboxEntries()),
    snippets: loadSnippets(),
    links: loadLinks(),
    history: sameHistory ? (undefined as unknown as ReturnType<typeof history>) : history(), // your conversations, filed under projects (the sidebar)
    historyVersion: historyNow,
    jira: jiraStatus(),   // whether your Jira account is linked, and as whom (never the token)
    // The pull requests of recent worktrees, as the camp last saw them (prs.ts). attention: there's something new to look at.
    prs: prStates().map((p) => ({ ...p, attention: needsYou(p) })),
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
  const tooLarge = () => Object.assign(new Error(limit === MAX_BODY ? "Request too large" : "File too large (25 MB max)"), { status: 413 });
  for await (const chunk of req) {
    size += chunk.length;
    // Past the limit the rest is read and thrown away, so the sender gets the answer saying why:
    // stopping here would cut the connection under it. Far past the limit, it's simply cut.
    if (size > limit * 4) throw tooLarge();
    if (size > limit) { chunks.length = 0; continue; }
    chunks.push(chunk);
  }
  if (size > limit) throw tooLarge();
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("The request wasn't valid JSON."), { status: 400 }); }
}

function hostOk(req: http.IncomingMessage) {
  return hostAllowed(req.headers.host, PORT, ACCESS);
}
// Did this request come from the camp's own machine? (Asked of the connection, never of a header.)
const fromHere = (req: http.IncomingMessage) => isLocal(req.socket.remoteAddress);
const NOT_FROM_HERE = "The terminal is a shell on the camp's own machine, so it only opens in a browser on that machine. Everything else works from here.";

const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) return send(res, 403, { error: "Bad host" });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const authed = req.headers["x-camp-token"] === TOKEN || url.searchParams.get("t") === TOKEN;

    // The page and its scripts and styles: the same built files for everyone, with nothing of the
    // camp in them, so they need no key. What the page then asks for does.
    if (req.method === "GET" && url.pathname === "/") {
      const page = uiPage(undefined, STYLE_NONCE);
      if (!page) return send(res, 503, UI_NOT_BUILT, "text/plain; charset=utf-8");
      res.setHeader("content-security-policy", uiCsp(STYLE_NONCE));
      return send(res, 200, page, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const asset = uiAsset(url.pathname);
      if (!asset) return send(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      return res.end(asset.body);
    }
    // A sign-in code for the key: once. { code } → { token }.
    if (req.method === "POST" && url.pathname === "/api/login") {
      const code = String((await readJson(req)).code ?? "");
      if (!takeSignInCode(code)) return send(res, 401, { error: "That sign-in link has been used, has lapsed, or is from an earlier start. Press Enter in the camp's terminal for a new one, or make one under Settings → General in a browser that's signed in." });
      return send(res, 200, { token: TOKEN });
    }
    // The tour (docs/index.html): a static page with nothing of the camp in it, so no token.
    if (req.method === "GET" && url.pathname === "/splash") {
      const page = splashPage();
      if (!page) return send(res, 404, "The tour page (docs/index.html) is missing.", "text/plain; charset=utf-8");
      res.setHeader("content-security-policy", SPLASH_CSP);
      return send(res, 200, page, "text/html; charset=utf-8");
    }
    if (!authed) return send(res, 401, { error: "Missing or wrong camp token" });
    // Uploads: how much is kept, and how much of it nothing uses any more (?days= how old that must be).
    if (req.method === "GET" && url.pathname === "/api/uploads/usage") return send(res, 200, { ...uploadsUsage(Number(url.searchParams.get("days")) || undefined), keepDays: uploadKeepDays() });
    // { } → { link, lasts }: a one-time sign-in link for another device, from a browser that's
    // already signed in. For the address that device will use: this machine's name on the
    // network in LAN mode, else the one this request came to.
    if (req.method === "POST" && url.pathname === "/api/login/link") {
      const origin = fromElsewhere() ?? `http://${req.headers.host}/`;
      return send(res, 200, { link: linkAt(origin, newSignInCode(10)), minutes: 10 });
    }
    // Is this browser's key still good? (The page asks as it opens.)
    if (req.method === "GET" && url.pathname === "/api/ping") return send(res, 200, { ok: true, bootId: BOOT_ID });

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ bootId: BOOT_ID })}\n\n`);
      // The buffer is the newest events only, so a long run's start can have scrolled out of it. A
      // page that loads then would have nowhere to put that run's events: send the earlier part of
      // every running expedition first (from the feed on disk), then the buffer. Events arrive in
      // order, and a page that's only reconnecting skips the ones it has by number.
      const from = buffer[0]?.seq ?? Infinity;
      const begun = new Set(buffer.flatMap((e) => (e.type === "expedition_start" ? [e.id] : [])));
      const cutOff = [...running.keys()].filter((id) => !begun.has(id));
      if (cutOff.length) {
        try { for (const e of feedEventsOf(cutOff)) if (e.seq < from) res.write(`data: ${JSON.stringify(e)}\n\n`); }
        catch { /* the feed file couldn't be read: the page shows what the buffer has */ }
      }
      for (const e of buffer) res.write(`data: ${JSON.stringify(e)}\n\n`);
      streams.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
      req.on("close", () => {
        clearInterval(ping);
        streams.delete(res);
      });
      return;
    }

    // The last day of the feed, for Orbit to play back.
    if (req.method === "GET" && url.pathname === "/api/feed/day") return send(res, 200, { events: feedSince(Date.now() - 86_400_000) });

    if (req.method === "GET" && url.pathname === "/api/state") { freshenUsage(); return send(res, 200, await state(url.searchParams.get("full") !== "0", url.searchParams.get("history") ?? undefined)); }

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

    // Which GitHub account gh is using (the header's account button).
    if (req.method === "GET" && url.pathname === "/api/github") return send(res, 200, await githubStatus());

    // Where one worktree stands now: uncommitted files and commits since the expedition started.
    if (req.method === "GET" && url.pathname === "/api/repo/status") {
      const q = url.searchParams;
      const w = { link: String(q.get("link")), path: String(q.get("path")), branch: "", base: /^[0-9a-f]{7,64}$/.test(q.get("base") ?? "") ? q.get("base")! : undefined };
      // Only a real worktree of a linked repo is looked at (git never runs in a folder the page merely names).
      try { w.path = await checked(w); } catch { return send(res, 200, { ...w, changed: 0, commits: 0, exists: false, ahead: 0 }); }
      return send(res, 200, await workspaceStatus(w));
    }

    // What an expedition's file tools changed: the files and a unified diff.
    // The terminal pane: your own shell sessions (term.ts). No agent has a tool that reaches these.
    // And no other machine does: a shell on this one isn't handed out over the network (access.ts).
    if (url.pathname === "/api/term" || url.pathname.startsWith("/api/term/")) {
      if (!fromHere(req)) return send(res, 403, { error: NOT_FROM_HERE });
    }
    if (req.method === "GET" && url.pathname === "/api/term") return send(res, 200, { terminals: listTerminals() });
    if (req.method === "GET" && url.pathname === "/api/term/stream") {
      if (!streamTerminal(String(url.searchParams.get("id") ?? ""), res, (fn) => req.on("close", fn))) return send(res, 404, { error: "No such terminal" });
      return;
    }

    // A project's page: its notes and survey, usage, worktrees, recently changed files, and jobs.
    if (req.method === "GET" && url.pathname === "/api/project") {
      const page = projectPage(String(url.searchParams.get("id") ?? ""));
      if (!page) return send(res, 404, { error: "No such project" });
      const workspaces = (await Promise.all(page.workspaces.map((w) => workspaceStatus(w).catch(() => null)))).filter((w) => w?.exists);
      return send(res, 200, { ...page, workspaces });
    }

    // An installed skill, for editing: its files (?owner=&name=), or one of them as text (&path=).
    if (req.method === "GET" && url.pathname === "/api/skills/files") {
      const q = url.searchParams, owner = String(q.get("owner") ?? ""), name = String(q.get("name") ?? "");
      try { return send(res, 200, q.get("path") ? readSkillFile(owner, name, q.get("path")!) : skillDetail(owner, name)); }
      catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }

    // What a project's reviews, second opinions, fix-ups and pull requests came to lately, and what they used.
    // The entry page (?project= for one project's numbers), and one day's brief (?day=).
    if (req.method === "GET" && url.pathname === "/api/home") return send(res, 200, homePage(url.searchParams.get("project") ?? undefined));
    if (req.method === "GET" && url.pathname === "/api/brief") {
      const b = readBrief(String(url.searchParams.get("day") ?? ""));
      return b ? send(res, 200, b) : send(res, 404, { error: "There's no brief for that day." });
    }
    if (req.method === "GET" && url.pathname === "/api/project/payoff") {
      const p = projectPayoff(String(url.searchParams.get("id") ?? ""));
      return p ? send(res, 200, p) : send(res, 404, { error: "No such project" });
    }

    // A project's weekly chronicles, and whether this week and last have anything to write up.
    if (req.method === "GET" && url.pathname === "/api/project/chronicle") {
      const page = chroniclePage(String(url.searchParams.get("id") ?? ""));
      return page ? send(res, 200, page) : send(res, 404, { error: "No such project" });
    }

    // Conversations that mention the words, in their title, requests, or answers.
    if (req.method === "GET" && url.pathname === "/api/history/search") {
      return send(res, 200, { results: searchConversations(String(url.searchParams.get("q") ?? "")) });
    }

    if (req.method === "GET" && url.pathname === "/api/conversation") {
      return send(res, 200, { events: conversationEvents(String(url.searchParams.get("id") ?? ""), feedbackFor) });
    }

    if (req.method === "GET" && url.pathname === "/api/checkpoint") {
      return send(res, 200, checkpointDiff(String(url.searchParams.get("id") ?? "")));
    }

    // Models this API key can use, with the effort levels each supports.
    if (req.method === "GET" && url.pathname === "/api/models") return send(res, 200, await listModels());
    // Auto's policy version and how it compares with fixed models on matched tasks (autoroute.ts).
    if (req.method === "GET" && url.pathname === "/api/routing") return send(res, 200, { policy: POLICY.version, ...routingReport() });

    // The Files flyout: one folder's contents inside a linked folder (or one of its worktrees), a
    // file to preview, or an image's bytes. link: the linked folder; root: a worktree of it; path:
    // where, from the top of that folder.
    if (req.method === "GET" && url.pathname.startsWith("/api/tree")) {
      const q = url.searchParams;
      try {
        // link "@camp": a file the camp keeps for you (a crew member's output, a wiki page, an upload). Opened, never listed.
        const own = q.get("link") === CAMP_FILES ? campFile(q.get("path") ?? "", CAMP_ROOT) : null;
        if (own && url.pathname !== "/api/tree/file" && url.pathname !== "/api/tree/raw") return send(res, 400, { error: "The camp's own files can be opened, not listed." });
        const root = own?.root ?? await explorerRoot(String(q.get("link") ?? ""), q.get("root") || undefined);
        const path = own?.path ?? q.get("path") ?? "";
        if (url.pathname === "/api/tree") return send(res, 200, { ...listFolder(root, path), ...(path ? {} : { changed: await changedFiles(root) }) });
        if (url.pathname === "/api/tree/file") return send(res, 200, previewFile(root, path));
        if (url.pathname === "/api/tree/find") return send(res, 200, { files: await findFiles(root, q.get("q") ?? "") });
        if (url.pathname === "/api/tree/diff") return send(res, 200, await fileDiff(root, path));
        if (url.pathname === "/api/tree/raw") {
          const { media, bytes } = imageFile(root, path);
          res.writeHead(200, { "content-type": media, "cache-control": "no-store", "x-content-type-options": "nosniff" });
          return res.end(bytes);
        }
      } catch (e: any) { return send(res, 400, { error: e.message }); }
    }

    // Jira tickets for the attach menu: the ones you looked at last, or a search (?q=).
    if (req.method === "GET" && url.pathname === "/api/jira/issues") {
      try { return send(res, 200, { issues: await findIssues(url.searchParams.get("q") ?? "") }); }
      catch (e: any) { return send(res, e instanceof JiraError && e.fixable ? 400 : 502, { error: e.message }); }
    }

    // The Jira page: the tickets your filter pulls in (?jql= tries another filter without keeping it), and one ticket in full (?key=).
    if (req.method === "GET" && (url.pathname === "/api/jira/tickets" || url.pathname === "/api/jira/ticket")) {
      try { return send(res, 200, url.pathname === "/api/jira/ticket" ? await ticketDetail(url.searchParams.get("key") ?? "") : await pulledTickets(url.searchParams.get("jql") ?? undefined)); }
      catch (e: any) { return send(res, e instanceof JiraError && e.fixable ? 400 : 502, { error: e.message }); }
    }

    // Your notes (notes.ts): all of them. The Notes panel asks when it opens, and when you come back to the window.
    if (req.method === "GET" && url.pathname === "/api/notes") return send(res, 200, { notes: loadNotes() });

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

    // A packaged skill ({ name, data }: the .skill file, base64): opened in memory and described.
    // Nothing is written and nothing in it runs; installing is a second step (/api/skills/install).
    if (url.pathname === "/api/skills/inspect") {
      const body = await readJson(req, MAX_UPLOAD_BODY);
      if (typeof body.data !== "string") return send(res, 400, { error: "Missing file" });
      try { return send(res, 200, inspectPack(Buffer.from(body.data, "base64"), String(body.name ?? ""))); }
      catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }

    const body = await readJson(req);

    // Install a skill you've looked at ({ id, owner, scripts, commands, replace }), or take one off the disk ({ owner, name }).
    if (url.pathname === "/api/skills/install") {
      try { return send(res, 200, { ok: true, ...installPack(String(body.id ?? ""), body) }); }
      catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }
    // Your own wiki pages: add one ({ create: true, section, title, summary, text }), change one ({ path, summary, text }), or take one away ({ path }).
    if (url.pathname === "/api/wiki/save" || url.pathname === "/api/wiki/remove") {
      try { return send(res, 200, url.pathname === "/api/wiki/save" ? { ok: true, page: saveWikiPage(body) } : { ok: removeWikiPage(String(body.path ?? "")) }); }
      catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }
    // Save your edit to one file of an installed skill ({ owner, name, path, text, create? }).
    if (url.pathname === "/api/skills/save") {
      try { return send(res, 200, { ok: true, ...saveSkillFile(String(body.owner ?? ""), String(body.name ?? ""), String(body.path ?? ""), body.text, body.create === true) }); }
      catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }
    // Who follows a skill always, with its instructions in every prompt ({ owner, name, agents: [...] }).
    if (url.pathname === "/api/skills/always") {
      try { return send(res, 200, { ok: true, alwaysFor: setSkillAlways(String(body.owner ?? ""), String(body.name ?? ""), body.agents) }); }
      catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }
    // { days }: delete uploads nothing uses that are at least that old (a day at the least). For good.
    if (url.pathname === "/api/uploads/clear") return send(res, 200, { ok: true, cleared: pruneUploads(Number(body.days) || undefined) });
    // { days: 30 | null }: from now on, delete them by themselves at that age; null stops that.
    if (url.pathname === "/api/uploads/keep") {
      const days = body.days === null ? null : Number(body.days);
      if (days !== null && !(Number.isFinite(days) && days >= 1)) return send(res, 400, { error: "Give a number of days (1 or more), or turn it off." });
      setUploadKeepDays(days);
      return send(res, 200, { ok: true, keepDays: uploadKeepDays() });
    }
    // { heading } or { all: true }: mark inbox entries as read, so they stop counting on the badge.
    if (url.pathname === "/api/inbox/seen") {
      const ok = markInboxSeen({ heading: typeof body.heading === "string" ? body.heading : undefined, all: body.all === true });
      return send(res, ok ? 200 : 404, ok ? { ok, unread: inboxUnread() } : { error: "No such entry in the inbox." });
    }
    if (url.pathname === "/api/skills/remove") {
      const ok = removeSkill(String(body.owner ?? ""), String(body.name ?? ""));
      return send(res, ok ? 200 : 404, ok ? { ok } : { error: "No such skill." });
    }

    if (url.pathname === "/api/send") {
      let text = String(body.text ?? "").trim();
      const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments.slice(0, 30) : [];
      // { resume: <expedition id> }: pick up a run that was cut off or stopped, from what it had done.
      const resume = typeof body.resume === "string" ? body.resume : undefined;
      if (resume) { body.replyTo = resume; text ||= "Pick up where this left off and finish the job. Check what's already done before redoing anything."; }
      // { start: <plan card id> }: start a plan you approved earlier to start later. It carries on
      // the conversation it was planned in, already approved, and goes once.
      let held: { text: string; ask: string } | undefined;
      if (typeof body.start === "string") {
        const planned = allTurns().find((t) => t.parked?.ask === body.start);
        if (!planned?.parked) return send(res, 404, { error: "That plan can't be found any more. Ask for it again." });
        if (planned.parked.aside) return send(res, 410, { error: "That plan was set aside, so it won't start. Start the plan that took its place, or ask for it again." });
        if (startedPlans.has(body.start) || allTurns().some((t) => t.started === body.start)) return send(res, 409, { error: "That plan has already been started." });
        held = planned.parked;
        body.replyTo = planned.expedition;
        text ||= "Start the plan.";
      }
      // { aside: true, brief: "opinion" | "review" }, with "@who" as the text: the standing brief for a second opinion or a review (review.ts).
      const brief: unknown = body.brief;
      if (body.aside === true && isAsideBrief(brief) && /^@\w+$/.test(text)) text = `${text} ${ASIDE_BRIEFS[brief]}`;
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
      const stillRunning = (id: string) => running.has(id) || queue.some((q) => q.id === id);
      const thread = threadFor(replyTo, stillRunning);
      // { aside: true }: someone else steps into the conversation for this one turn (a second
      // opinion, a review): it reads the conversation, and the conversation stays who it was with.
      const aside = body.aside === true && !!thread && !!who && who.id !== "quartermaster";
      if (!thread || (who && who.id !== thread.agent && !aside)) replyTo = undefined; // addressed to someone else: a fresh start
      // { jira: "APP-123" }: the ticket a new conversation is working on; a reply keeps its conversation's.
      const jira = replyTo ? thread?.jira : (typeof body.jira === "string" && JIRA_KEY.test(body.jira.toUpperCase()) ? body.jira.toUpperCase() : undefined);
      const target = who ?? (replyTo && thread?.direct ? findCrew(thread.agent) : undefined);
      // { workspaces: { <link>: { mode: "new", branch? } | { mode: "existing", path } } }: work in a
      // worktree of that linked repo instead of the linked checkout. A reply without it stays
      // where its conversation was working.
      // { after: <run id> }: a chained request. It waits until that run has finished, then starts
      // (told what that run did, and working where it worked unless you chose somewhere else).
      const after = typeof body.after === "string" && (inFlight(body.after) || allTurns().some((t) => t.expedition === body.after)) ? body.after : undefined;
      if (typeof body.after === "string" && !after) return send(res, 400, { error: "The work this was to follow can't be found any more. Send it without waiting." });
      let workspaces: Awaited<ReturnType<typeof prepareWorkspaces>> | undefined;
      try {
        const chosen = body.workspaces && typeof body.workspaces === "object" ? body.workspaces : undefined;
        if (chosen && Object.keys(chosen).length) workspaces = await prepareWorkspaces(chosen, direct ? direct[2] ?? text : text, randomUUID());
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
      // { project: <id> }: a new conversation is filed under that project. The run sees that
      // project's folders, plus any linked folder attached or mentioned here or earlier in the
      // conversation, and no others.
      const project = projectOf(replyTo ? thread?.thread : undefined, body.project);
      const named = new Set(loadLinks().map((l) => l.name));
      const mentioned = [...attached.map((a) => a.path ?? ""), text].flatMap((t) => [...t.matchAll(/(?:^|[\s@("'`])links\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
      // { use: [<link>, …] }: folders picked for a new conversation under "Where to work", to be used as
      // they are (their linked checkout). It's how a conversation outside a project is given one.
      // On a reply it brings a folder into the conversation from then on.
      const picked: string[] = Array.isArray(body.use) ? body.use.map(String) : [];
      // { without: [<link>, …] }: folders this conversation goes without. On a new one, folders of its
      // project it's started without; on a reply, folders taken out from this message on (the reply
      // keeps its conversation's others). One that's attached, mentioned or picked here is in after all.
      const asked: string[] = Array.isArray(body.without) ? body.without.map(String) : [];
      const links = [...new Set([...(replyTo ? (thread?.links ?? []).filter((l) => !asked.includes(l)) : []), ...mentioned, ...picked, ...Object.keys(workspaces ?? {})])].filter((l) => named.has(l));
      const without = [...new Set([...(replyTo ? thread?.without ?? [] : []), ...asked])].filter((l) => named.has(l) && !links.includes(l));
      // A project can start every new conversation in its own worktree of each of its repos.
      if (!replyTo && !workspaces && !after && project.settings?.workIn === "worktree" && project.links?.length) {
        try {
          const repos = new Set((await linkedRepos()).filter((r) => r.access === "write").map((r) => r.link));
          const chosen = Object.fromEntries(project.links.filter((l) => repos.has(l) && !without.includes(l)).map((l) => [l, { mode: "new" as const }]));
          if (Object.keys(chosen).length) workspaces = await prepareWorkspaces(chosen, direct ? direct[2] ?? text : text, randomUUID());
        } catch (e: any) {
          return send(res, 400, { error: `Couldn't set up this project's worktree: ${e.message}` });
        }
      }
      // { model }: the model whoever this conversation is with answers on (a Claude model, or
      // "<provider>:<model>"). A reply keeps its conversation's unless it names another; null goes
      // back to their own. Someone stepping in for a turn (a second opinion) uses their own.
      let model: string | undefined = replyTo ? thread?.model : undefined;
      if (body.model === null) model = undefined;
      else if (typeof body.model === "string" && body.model) {
        if (!isAutoChoice(body.model) && !(await listModels()).models.some((m) => m.id === body.model)) return send(res, 400, { error: `Unknown model "${body.model}". Pick another beside the message box.` });
        model = body.model;
      }
      if (aside) model = undefined;
      const where = { project: project.id, links, ...(without.length ? { without } : {}), ...(jira ? { jira } : {}), ...(model ? { model } : {}) };
      const isNew = !replyTo;
      const task = (direct ? direct[2] ?? text : text).replace(/\s+/g, " ").slice(0, 90);
      // Worked out when it starts, not now: a chained request follows what its predecessor ended up doing.
      const chained = () => {
        if (!after) return { workspaces, links: where.links, extraSystem: undefined as string | undefined };
        const before = allTurns().find((t) => t.expedition === after);
        return {
          workspaces: workspaces ?? (replyTo ? undefined : before?.workspaces),
          links: [...new Set([...where.links, ...(before?.links ?? []), ...Object.keys(before?.workspaces ?? {})])].filter((l) => named.has(l) && !without.includes(l)),
          extraSystem: chainNote(before, !!thread && before?.thread === thread.thread),
        };
      };
      // A plain chat: outside any project, a message with no @ goes to a model and nobody else (no
      // Quartermaster, no plan, no quests). A reply in one stays one. Asking for a worktree, or
      // starting from a ticket, is asking for work to be done, so that still goes to the crew.
      const plain = !who && !aside && !jira && !workspaces && (replyTo ? thread?.agent === CHAT : project.id === GENERAL);
      const w = plain
        ? enqueue({ label: "chat", task, after, run: async (signal, id, steering) => {
            const c = chained();
            const r = await runChat(content, { attached, signal, id, replyTo, steering, stillRunning, links: c.links, without: where.without, model: where.model, extraSystem: c.extraSystem });
            if (isNew) void titleConversation(id, text, r.text);
            return r;
          } })
        : target && target.id !== "quartermaster"
        ? enqueue({ label: `@${target.id}`, task, after, run: async (signal, id, steering) => {
            const c = chained();
            const r = await runDirect(target.id, content, "direct", attached, signal, id, replyTo, { workspaces: c.workspaces, steering, stillRunning, ...where, links: c.links, extraSystem: c.extraSystem, aside });
            if (isNew && r) void titleConversation(id, text, r.text);
            if (r && !aside) void afterRun({ run: id, who: target.id, project: where.project, task: text, reply: r.text });
            if (r && !aside) void runFinished(id, r.status).catch(() => { /* the ticket goes without */ });
            return r;
          } })
        : enqueue({ label: "expedition", task, after, run: async (signal, id, steering) => {
            const c = chained();
            // { review: true | false }: have this run's changes reviewed before it reports, whatever the project and camp are set to.
            const r = await runExpedition(content, { attached, signal, id, replyTo, workspaces: c.workspaces, steering, stillRunning, ...where, links: c.links, extraSystem: c.extraSystem,
              ...(typeof body.review === "boolean" ? { review: body.review } : {}), ...(held ? { approvedPlan: held } : {}) });
            if (isNew) void titleConversation(id, text, r.text);
            void afterRun({ run: id, who: "quartermaster", project: where.project, task: text, reply: r.text });
            void runFinished(id, r.status).catch(() => { /* the ticket goes without */ });
            return r;
          } });
      if (held) { startedPlans.add(held.ask); emit({ type: "plan_started", ask: held.ask, run: w.id }); }
      const position = queue.indexOf(w) + 1; // 0: it started right away
      const conversation = replyTo && thread ? thread.thread : w.id; // a new conversation is named after its first run
      if (isNew) fileConversation(conversation, project.id);
      // Started from a ticket, with write-back on: say so on the ticket (and move it, if you named a status).
      if (isNew && jira) void writeBack("start", jira, { branch: Object.values(workspaces ?? {})[0]?.branch }).then((note) => { if (note) emit({ type: "notice", who: "Jira", emoji: "🔖", depth: 0, text: note, expeditionId: w.id }); });
      return send(res, 200, { ok: true, id: w.id, position, attached: attached.length, thread: conversation, ...(after ? { after } : {}) });
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
      // Auto ("auto:balanced"…) picks the model and effort for each task itself: no effort is kept with it.
      if (isAutoChoice(body.model)) {
        setAgentSettings(id, { model: body.model, effort: null, maxTurns });
        return send(res, 200, { ok: true });
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
    if (url.pathname === "/api/anthropic/key") {
      try {
        const key = body.import === true ? process.env.ANTHROPIC_API_KEY : body.key;
        return send(res, 200, { ok: true, anthropic: await setAnthropicKey(key) });
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : "Couldn't update the Anthropic key." });
      }
    }

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
    // Your rating of a finished run ({ id, rating: "up" | "down", note?, keep? }); see feedback.ts.
    if (url.pathname === "/api/feedback") {
      try {
        const f = giveFeedback(String(body.id ?? ""), { rating: body.rating, note: body.note, keep: body.keep });
        return send(res, 200, { ok: true, rating: f.rating, note: f.note ?? "", kept: f.kept ?? null });
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }

    // The crew: add, change, or remove a crew member of your own ({ action: "add" | "update" | "remove", ... }).
    if (url.pathname === "/api/crew") {
      try {
        const id = String(body.id ?? "");
        if (body.action === "remove") {
          if ([...running.values(), ...queue].some((w) => w.label === `@${id}`)) return send(res, 409, { error: "They're in the middle of something. Wait for it to finish, or stop it first." });
          if (!removeMember(id)) return send(res, 404, { error: "No such crew member (the original ones can't be removed)." });
        } else if (body.action === "update") updateMember(id, body.member ?? {});
        else if (body.action === "add") addMember(body.member ?? {});
        else return send(res, 400, { error: "Unknown action" });
        emit({ type: "changed", what: "crew" });
        return send(res, 200, { ok: true });
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }

    // History: projects and conversations ({ action, ... }).
    if (url.pathname === "/api/history") {
      const id = String(body.id ?? "");
      // { folders: [{ path, access }] }: link those folders first, and add them to the project's own.
      let links: unknown = body.links;
      const saving = body.action === "project.add" || body.action === "project.update";
      if (saving && Array.isArray(body.folders) && body.folders.length) {
        try {
          const added = body.folders.map((f: any) => addLink(String(f?.path ?? ""), f?.access === "write" ? "write" : "read", CAMP_ROOT).name);
          links = [...(Array.isArray(body.links) ? body.links : []), ...added];
          emit({ type: "changed", what: "links" });
        } catch (e: any) {
          return send(res, 400, { error: e.message });
        }
      }
      const details = { name: body.name, description: body.description, links, pins: body.pins, pinned: body.pinned, settings: body.settings };
      let project: string | undefined;
      const done =
        body.action === "project.add" ? !!(project = addProject(details).id)
        : body.action === "project.update" ? updateProject(id, details)
        : body.action === "project.pin" ? updateProject(id, { pinned: !!body.pinned })
        : body.action === "project.notes" ? (id !== GENERAL && !!getProject(id) ? (setProjectNotes(id, String(body.notes ?? "")), true) : false)
        : body.action === "project.brief" ? (id !== GENERAL && !!getProject(id) ? (setProjectBrief(id, String(body.brief ?? "")), true) : false)
        : body.action === "project.rename" ? renameProject(id, body.name)
        : body.action === "project.remove" ? removeProject(id)
        : body.action === "conversation.rename" ? (renameConversation(id, body.title), true)
        : body.action === "conversation.move" ? moveConversation(id, String(body.project ?? ""))
        : body.action === "conversation.remove" ? (running.has(id) ? false : (removeConversation(id), true))
        : null;
      if (done === null) return send(res, 400, { error: "Unknown action" });
      return send(res, done ? 200 : 404, done ? { ok: true, history: history(), project } : { error: "That didn't work: it may be gone already, or still running." });
    }

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
      // The dialog opens on the camp's machine: no use to someone sitting at another one.
      if (!fromHere(req)) return send(res, 200, { unsupported: "The folder dialog opens on the camp's own machine, not this one. Paste the folder's full path (as it is on the camp's machine) instead." });
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
    // Commands to run once in each new worktree the camp creates for a linked repository ({ name, commands: [...] }).
    if (url.pathname === "/api/links/setup") {
      const ok = setLinkSetup(String(body.name), Array.isArray(body.commands) ? body.commands : []);
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
    // Your Jira account: link it ({ siteUrl, email, apiToken }: checked with Jira first), or unlink it ({ disconnect: true }).
    if (url.pathname === "/api/jira") {
      try { return send(res, 200, body.disconnect ? disconnectJira() : await connectJira(body)); }
      catch (e: any) { return send(res, e instanceof JiraError && e.fixable ? 400 : 502, { error: e.message }); }
    }
    // Which tickets are pulled in ({ jql }; empty goes back to "assigned to me, not done"). Jira runs it first: a filter it rejects isn't kept.
    if (url.pathname === "/api/jira/filter") {
      try { return send(res, 200, await saveJiraFilter(body.jql)); }
      catch (e: any) { return send(res, e instanceof JiraError && e.fixable ? 400 : 502, { error: e.message }); }
    }
    // Attach a ticket to the message being written ({ key, batch? }): saved as a file in this
    // message's uploads, so it's read like any other attachment and stays as it was when attached.
    if (url.pathname === "/api/jira/attach") {
      try {
        const t = await readIssue(String(body.key ?? ""));
        const saved = saveUpload({ name: `${t.key}.md`, data: Buffer.from(`${JIRA_NOTE}\n\n${t.text}\n`).toString("base64"), batch: body.batch });
        return send(res, 200, { ...saved, key: t.key, summary: t.summary, url: t.url });
      } catch (e: any) { return send(res, e instanceof JiraError && e.fixable ? 400 : 502, { error: e.message }); }
    }

    // Switch your checkout of a linked repository to a branch, or make a new one ({ link, name, create }).
    if (url.pathname === "/api/repo/branch") {
      try { return send(res, 200, { ok: true, branch: await switchBranch(String(body.link ?? ""), String(body.name ?? ""), body.create === true), repos: await linkedRepos() }); }
      catch (e: any) { return send(res, 400, { error: e.message }); }
    }

    // The pull requests the camp is watching: look again now, or note that you've brought one's feedback in ({ path }).
    if (url.pathname === "/api/prs/check") return send(res, 200, { prs: (await checkPullRequests()).map((p) => ({ ...p, attention: needsYou(p) })) });
    if (url.pathname === "/api/prs/seen") return send(res, markSeen(String(body.path ?? "")) ? 200 : 404, { ok: true });
    // Whether recent worktrees' pull requests are looked at now and then ({ on }).
    if (url.pathname === "/api/pr-watch") {
      setPrWatch(!!body.on);
      return send(res, 200, { ok: true, prWatch: prWatchOn() });
    }
    // What the camp may write to Jira ({ on, startStatus, reviewStatus, prStatus, doneStatus }): nothing unless on.
    if (url.pathname === "/api/jira/write") return send(res, 200, saveWriteBack(body));

    if (url.pathname === "/api/repo/commit" || url.pathname === "/api/repo/pr" || url.pathname === "/api/repo/pr/draft" || url.pathname === "/api/repo/remove" || url.pathname === "/api/repo/feedback" || url.pathname === "/api/repo/push") {
      const w = { link: String(body.link ?? ""), path: String(body.path ?? "") };
      const expedition = typeof body.expedition === "string" ? body.expedition : undefined;
      try {
        // What reviewers and the checks have said on the branch's pull request: for you to read and send on.
        if (url.pathname === "/api/repo/feedback") { const f = await pullRequestFeedback(w); markSeen(w.path); return send(res, 200, f); }
        if (url.pathname === "/api/repo/commit") return send(res, 200, { ok: true, commit: await commitWorkspace(w, String(body.message ?? "")) });
        // New commits, pushed to where the branch already goes (its pull request).
        if (url.pathname === "/api/repo/push") { const pushed = await pushWorkspace(w); void checkPullRequests().catch(() => {}); return send(res, 200, { ok: true, pushed }); }
        // A title and description drafted from the record, for you to edit ({ expedition, base }).
        if (url.pathname === "/api/repo/pr/draft") return send(res, 200, await draftPullRequest(w, { expedition, base: typeof body.base === "string" ? body.base : undefined }));
        if (url.pathname === "/api/repo/pr") {
          // { update: true }: the branch has a pull request already; change its title and description.
          if (body.update === true) {
            const at = await updatePullRequest(w, String(body.title ?? ""), String(body.body ?? ""));
            void checkPullRequests().catch(() => {});
            return send(res, 200, { ok: true, url: at, updated: true });
          }
          const at = await openPullRequest(w, String(body.title ?? ""), String(body.body ?? ""));
          const jira = await writeBack("pr", ticketOf(w, expedition), { url: at });
          void checkPullRequests().catch(() => {});
          return send(res, 200, { ok: true, url: at, ...(jira ? { jira } : {}) });
        }
        await removeWorkspace(w);
        return send(res, 200, { ok: true });
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }

    // The shell sandbox ({ on: true | false }); see sandbox.ts.
    // Switch gh's active GitHub account ({ login }, or {} to swap to the other of two).
    if (url.pathname === "/api/github/switch") {
      try {
        return send(res, 200, await switchGithub(typeof body.login === "string" && body.login ? body.login : undefined));
      } catch (e: any) {
        return send(res, 400, { error: e.message });
      }
    }

    if (url.pathname === "/api/sandbox") {
      if (body.on && !sandboxAvailable()) return send(res, 400, { error: SANDBOX_NEEDS });
      setShellSandbox(!!body.on);
      return send(res, 200, { ok: true, on: !!body.on });
    }

    // The approval level for shell commands ({ level: "ask" | "safe" | "sandbox" }); see settings.ts.
    if (url.pathname === "/api/approvals") {
      const level = body.level;
      if (level !== "ask" && level !== "safe" && level !== "sandbox") return send(res, 400, { error: "level must be ask, safe or sandbox" });
      if (level === "sandbox" && !sandboxAvailable()) return send(res, 400, { error: SANDBOX_NEEDS });
      setApprovalLevel(level);
      return send(res, 200, { ok: true, level: approvalLevel() });
    }

    // Your shell allow-list and "Always allow" commands ({ allow?: string[], exact?: string[] }).
    if (url.pathname === "/api/shell") {
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
      setShellLists({ allow: list(body.allow), exact: list(body.exact), deny: list(body.deny), ask: list(body.ask), allowHosts: list(body.allowHosts) });
      return send(res, 200, { ok: true });
    }
    // The approval reviewer ({ on }): the smallest model clears routine commands before you're asked (reviewer.ts).
    if (url.pathname === "/api/shell-reviewer") {
      setShellReviewer(!!body.on);
      return send(res, 200, { ok: true, on: !!body.on });
    }

    // Approvals in plain words ({ on }): the smallest model says what a command does, on its card (explain.ts).
    if (url.pathname === "/api/plain-approvals") {
      setPlainApprovals(!!body.on);
      return send(res, 200, { ok: true, on: !!body.on });
    }

    // How many dispatched quests run at once, camp-wide ({ n: 1–16 }).
    if (url.pathname === "/api/quests-at-once") {
      const n = Number(body.n);
      if (!Number.isInteger(n) || n < 1 || n > QUESTS_MAX) return send(res, 400, { error: `Pick a number from 1 to ${QUESTS_MAX}` });
      setQuestLimit(n);
      return send(res, 200, { ok: true, questsAtOnce: questLimit() });
    }

    if (url.pathname === "/api/term/open") {
      // { folder, sub, title, action, type }: a quick action's new terminal (see openTerminal).
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      try { return send(res, 200, openTerminal({ project: str(body.project), cols: body.cols, rows: body.rows, folder: str(body.folder), sub: str(body.sub), title: str(body.title), action: str(body.action), type: str(body.type), locked: body.locked === true })); }
      catch (e: any) { return send(res, 400, { error: e.message }); }
    }
    // The terminal's quick actions ({ actions: [...] }, at most five): your own commands, kept in camp/settings.json.
    if (url.pathname === "/api/term/actions") {
      try { return send(res, 200, { ok: true, termActions: setTermActions(body.actions) }); }
      catch (e: any) { return send(res, 400, { error: e.message }); }
    }
    if (url.pathname === "/api/term/lock") { const t = lockTerminal(String(body.id), body.on === true); return send(res, t ? 200 : 404, t ?? { error: "That terminal has closed." }); }
    if (url.pathname === "/api/term/input") return send(res, writeTerminal(String(body.id), body.data) ? 200 : 404, { ok: true });
    if (url.pathname === "/api/term/resize") return send(res, resizeTerminal(String(body.id), body.cols, body.rows) ? 200 : 404, { ok: true });
    if (url.pathname === "/api/term/close") return send(res, closeTerminal(String(body.id)) ? 200 : 404, { ok: true });

    // Name new conversations with the smallest model ({ on }).
    // After a quest: how many times it's sent back to fix failing checks ({ fixAttempts }), and
    // whether changes are reviewed before the report ({ review }).
    if (url.pathname === "/api/quest-checks") {
      if (body.fixAttempts !== undefined) {
        const n = Number(body.fixAttempts);
        if (!Number.isFinite(n) || n < 0 || n > FIX_ATTEMPTS_MAX) return send(res, 400, { error: `Fix attempts go from 0 to ${FIX_ATTEMPTS_MAX}.` });
        setFixAttempts(n);
      }
      if (body.review !== undefined) setReviewChanges(!!body.review);
      return send(res, 200, { ok: true, fixAttempts: fixAttempts(), reviewChanges: reviewChangesOn() });
    }

    if (url.pathname === "/api/auto-titles") {
      setAutoTitles(!!body.on);
      return send(res, 200, { ok: true, autoTitles: autoTitlesOn() });
    }

    // Survey a project's folders ({ id }): the Scout reads through them and saves a brief to the project.
    if (url.pathname === "/api/project/survey") {
      const p = getProject(String(body.id ?? ""));
      if (!p || !p.links?.length) return send(res, 400, { error: "Give the project a folder first: there's nothing to survey." });
      const request = surveyRequest(p);
      const w = enqueue({ label: "@scout", run: (signal, id, steering) => runDirect("scout", request, "direct", undefined, signal, id, undefined, { steering, project: p.id, links: [] }) });
      fileConversation(w.id, p.id);
      renameConversation(w.id, `Survey of ${p.name}`);
      return send(res, 200, { ok: true, id: w.id, thread: w.id, position: queue.indexOf(w) + 1 });
    }

    // Write a week's chronicle for a project ({ id, week? }): the camp gathers the week's record,
    // the Scribe writes it up from that alone, and the result is kept with the project.
    if (url.pathname === "/api/project/chronicle") {
      const p = getProject(String(body.id ?? ""));
      if (!p) return send(res, 404, { error: "No such project" });
      let week: string, facts: string, conversations: number;
      try { ({ week, facts, conversations } = weekFacts(p, typeof body.week === "string" && body.week ? body.week : weekOf())); }
      catch (e: any) { return send(res, 400, { error: e.message }); }
      if (!conversations) return send(res, 400, { error: `Nothing happened in ${p.name} in the week of ${weekLabel(week)}, so there's nothing to write up.` });
      const w = enqueue({ label: "@scribe", task: `Chronicle of ${p.name}`, run: async (signal, id, steering) => {
        const r = await runDirect("scribe", chronicleRequest(p, week, facts), "direct", undefined, signal, id, undefined, { steering, project: p.id, links: [] });
        if (r?.status === "done" && r.text.trim()) saveChronicle(p.id, week, r.text);
        return r;
      } });
      fileConversation(w.id, p.id);
      renameConversation(w.id, `Chronicle: ${weekLabel(week)}`);
      return send(res, 200, { ok: true, id: w.id, thread: w.id, position: queue.indexOf(w) + 1, week });
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

    // Keep a note ({ action: "save", id, title, text, from? }: new, or a change to one that's there), delete one ({ action: "remove", id }),
    // or say a suggestion of the camp's is yours to keep ({ action: "keep", id }).
    if (url.pathname === "/api/notes") {
      try {
        if (body.action === "save") return send(res, 200, { ok: true, note: saveNote(body) });
        if (body.action === "remove") {
          // A suggestion you never kept: its title is remembered, so it isn't suggested again (ideas.ts).
          const going = loadNotes().find((n) => n.id === String(body.id ?? ""));
          if (going) passIdea(going);
          return send(res, 200, { ok: removeNote(String(body.id ?? "")) });
        }
        if (body.action === "keep") {
          const note = patchNote(String(body.id ?? ""), (n) => (n.idea ? { ...n, idea: { ...n.idea, kept: true } } : n));
          return send(res, note ? 200 : 404, note ? { ok: true, note } : { error: "That note isn't there any more." });
        }
        return send(res, 400, { error: "Unknown action" });
      } catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }

    // Write a note up as a ticket ({ id, project? }): the Scout reads the project's code and writes
    // it, as a conversation you can open, and the ticket is kept on the note (ticket.ts).
    if (url.pathname === "/api/notes/ticket") {
      const note = loadNotes().find((n) => n.id === String(body.id ?? ""));
      if (!note) return send(res, 404, { error: "That note isn't there any more." });
      if (!note.title.trim() && !note.text.trim()) return send(res, 400, { error: "Write something in the note first: there's nothing to write up." });
      const found = getProject(String(body.project ?? note.idea?.project ?? ""));
      const p = found && found.id !== "general" ? found : undefined;
      const name = noteName(note);
      const w = enqueue({ label: "@scout", task: `Ticket: ${name}`, run: async (signal, id, steering) => {
        let ticket: ReturnType<typeof parseTicket> = null;
        try {
          const r = await runDirect("scout", ticketRequest(note, p), "direct", undefined, signal, id, undefined, { steering, ...(p ? { project: p.id } : {}), links: [] });
          if (r?.status === "done") ticket = parseTicket(r.text);
          return r;
        } finally {
          // Kept on the note; if its words changed while this was being written, the ticket is already older than it.
          patchNote(note.id, (n) => {
            const { writing: _done, ...rest } = n;
            return ticket ? { ...rest, ticket: { ...ticket, written: new Date().toISOString(), conversation: id, ...(n.title !== note.title || n.text !== note.text ? { stale: true } : {}) } } : rest;
          });
          emit({ type: "changed", what: "notes" });
        }
      } });
      patchNote(note.id, (n) => ({ ...n, writing: { run: w.id, started: new Date().toISOString() } }));
      if (p) fileConversation(w.id, p.id);
      renameConversation(w.id, `Ticket: ${name}`);
      return send(res, 200, { ok: true, id: w.id, thread: w.id, position: queue.indexOf(w) + 1, notes: loadNotes() });
    }

    // Ideas for a project ({ project, replace? }): the camp asks the smallest model what the project's
    // record points at, and what comes back goes into your notes as suggestions (ideas.ts).
    if (url.pathname === "/api/ideas") {
      const p = getProject(String(body.project ?? ""));
      if (!p || p.id === "general") return send(res, 400, { error: "Ideas are suggested for a project: open one first." });
      try {
        const r = await suggestIdeas(p, { replace: body.replace === true });
        return send(res, 200, { ok: true, added: r.added.length, cleared: r.cleared, notes: loadNotes() });
      } catch (e: any) { return send(res, 502, { error: `Ideas couldn't be suggested: ${e.message}` }); }
    }

    if (url.pathname === "/api/snippets") {
      if (body.action === "add") return send(res, 200, addSnippet(String(body.title ?? ""), String(body.text ?? "")));
      if (body.action === "delete") return send(res, deleteSnippet(String(body.id)) ? 200 : 404, { ok: true });
      return send(res, 400, { error: "Unknown action" });
    }

    // Other models (providers.ts). connect: keep a provider's key ({ id, key }), once the provider
    // has accepted it. disconnect: forget it ({ id }). small: which model does the camp's own small
    // jobs ({ model }: a Claude model, "<provider>:<model>", "auto", or null for the default).
    if (url.pathname.startsWith("/api/providers/")) {
      try {
        // guide: write the wiki's models guide now (it's also rewritten whenever what's connected changes).
        if (url.pathname === "/api/providers/guide") return send(res, 200, { ok: true, path: await writeModelGuide() });
        if (url.pathname === "/api/providers/connect") {
          const provider = await connectProvider(String(body.id ?? ""), body.key);
          void writeModelGuide().catch(() => {});
          return send(res, 200, { ok: true, provider });
        }
        if (url.pathname === "/api/providers/disconnect") {
          const id = String(body.id ?? "");
          const gone = disconnectProvider(id);
          if (gone && smallModel()?.startsWith(`${id}:`)) setSmallModel(null); // its small-jobs model went with it
          if (gone) void writeModelGuide().catch(() => {});
          return send(res, 200, { ok: gone });
        }
        // approve: say a provider may be sent confidential projects' work ({ id, on }).
        if (url.pathname === "/api/providers/approve") {
          const ok = approveProvider(String(body.id ?? ""), body.on === true);
          if (ok) void writeModelGuide().catch(() => {});
          return send(res, 200, { ok });
        }
        if (url.pathname === "/api/providers/small") {
          // "auto": Auto picks for each small job (small.ts). It has one setting there: the cheapest model that's up to it.
          const model = body.model ? (isAutoChoice(String(body.model)) ? "auto" : String(body.model)) : null;
          if (model && model !== "auto" && !(await listModels()).models.some((m) => m.id === model)) return send(res, 400, { error: `Unknown model "${model}"` });
          setSmallModel(model);
          emit({ type: "changed", what: "settings" });
          return send(res, 200, { ok: true, smallModel: smallModel() });
        }
      } catch (e: any) { return send(res, e.fixable ? 400 : 500, { error: e.message }); }
    }

    // Looking after memory (keeping.ts). about: your own edit of the note the whole crew shares.
    // forget: take one line out. tidy: draft a merged version, to approve. proposal: your answer to
    // one that's waiting ({ id, action: "approve" | "dismiss", text? }). care: the two switches.
    if (url.pathname.startsWith("/api/memory/")) {
      try {
        if (url.pathname === "/api/memory/about") {
          if (typeof body.text !== "string" || body.text.length > 20_000) return send(res, 400, { error: "That's too long for a note about you." });
          writeAbout(body.text);
          logKept("about", "Edited by you.", "you");
          emit({ type: "changed", what: "memory" });
          return send(res, 200, { ok: true });
        }
        if (url.pathname === "/api/memory/forget") return send(res, 200, { ok: forgetLine(String(body.where ?? ""), String(body.line ?? "")) });
        // { where, line, on }: keep this line in every prompt (or stop keeping it there).
        if (url.pathname === "/api/memory/pin") return send(res, 200, { ok: pinLine(String(body.where ?? ""), String(body.line ?? ""), body.on !== false) });
        if (url.pathname === "/api/memory/tidy") return send(res, 200, { ok: true, proposal: await proposeTidy(String(body.where ?? "")) });
        if (url.pathname === "/api/memory/proposal") return send(res, 200, settleProposal(String(body.id ?? ""), body.action === "approve" ? "approve" : "dismiss", typeof body.text === "string" ? body.text : undefined));
        if (url.pathname === "/api/memory/care") { setMemoryCare({ tidy: body.tidy, suggest: body.suggest }); return send(res, 200, { ok: true, memoryCare: memoryCare() }); }
      } catch (e: any) { return send(res, e.fixable || /no such memory/i.test(e.message) ? 400 : 500, { error: e.message }); }
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

    // Read your plan's usage figures now (it sends no message, so it uses none of your plan).
    if (url.pathname === "/api/limits/refresh") {
      if (campRuntime() !== "claude-code") return send(res, 400, { error: "Plan limits only apply when the crew runs on your Claude subscription." });
      const ok = await refreshPlanUsage(true);
      return send(res, ok ? 200 : 502, ok ? { ok: true } : { error: "Claude Code didn't report your plan's usage. Check that you're signed in (claude /login), then try again." });
    }

    // Fork a conversation from one of its runs ({ id, rewind }): a copy up to that run, to carry on
    // from there. With rewind, what every later run changed is put back first.
    if (url.pathname === "/api/fork") {
      const r = forkConversation(String(body.id ?? ""), { rewind: !!body.rewind, running: (e) => running.has(e) });
      if ("error" in r) return send(res, 409, r);
      if (body.rewind) emit({ type: "changed", what: "checkpoints" });
      return send(res, 200, { ok: true, ...r });
    }

    // "Try anyway": start queued work even though the plan's limit was reported as used up.
    if (url.pathname === "/api/limits/resume") {
      resumeNow();
      drain();
      return send(res, 200, { ok: true });
    }

    // A chained request that's held (what it waited on didn't finish cleanly), or still waiting:
    // start it without waiting any longer ({ id }).
    if (url.pathname === "/api/queue/release") {
      const w = queue.find((q) => q.id === String(body.id));
      if (!w) return send(res, 404, { error: "That one isn't waiting any more." });
      delete w.after; delete w.held;
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

    // { ask: <plan card id> }: take a plan you approved to start later off Ready to start, unstarted.
    if (url.pathname === "/api/plans/aside") {
      const ask = String(body.ask ?? "");
      if (startedPlans.has(ask)) return send(res, 409, { error: "That plan has already been started." });
      if (!setPlanAside(ask)) return send(res, 404, { error: "That plan isn't waiting to start any more." });
      emit({ type: "plan_aside", ask });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/skills") {
      const { owner, name, action } = body;
      const ok = action === "approve" ? approveSkill(owner, name) : action === "reject" ? rejectSkill(owner, name) : false;
      return send(res, ok ? 200 : 404, { ok });
    }

    // Write today's brief now (it replaces this morning's; nothing is announced).
    if (url.pathname === "/api/brief") return send(res, 200, await writeBrief({ running: isRunning, waiting: waitingOnYou() }));
    // What the camp does unasked ({ brief, briefAt, retro }).
    if (url.pathname === "/api/drive") { setDrive(body); return send(res, 200, { ok: true, drive: drive() }); }
    // Hold a project's retro for a week now ({ id, week? }).
    if (url.pathname === "/api/retro") {
      try { return send(res, 200, await runRetro(String(body.id ?? ""), typeof body.week === "string" ? body.week : undefined)); }
      catch (e: any) { return send(res, 400, { error: e.message }); }
    }
    // Bring one of your pull requests' feedback to the crew ({ url }): what the pull-request
    // trigger does by itself, as one click from the brief. Triggers watching that repository are
    // told it's been dealt with, so the same comments don't start work twice.
    if (url.pathname === "/api/pulls/address") {
      const read = await checkPulls();
      const p = read.pulls.find((x) => x.url === body.url);
      if (!p) return send(res, 404, { error: read.error ?? "That pull request isn't one the camp knows of any more." });
      const item = pullItems([p], false)[0];
      if (!item) return send(res, 400, { error: "Nothing is waiting on that pull request right now." });
      const watching = loadTriggers().find((t) => t.kind === "github-pr" && t.link === p.link);
      const t: Trigger = watching ?? { name: "brief", kind: "github-pr", task: PR_TASK, enabled: true, created: new Date().toISOString(), link: p.link };
      const unseen = (x: Trigger) => x.kind === "github-pr" && x.link === p.link && !x.seen?.includes(item.id);
      if (loadTriggers().some(unseen)) saveTriggers(loadTriggers().map((x) => (unseen(x) ? { ...x, seen: [...(x.seen ?? []), item.id] } : x)));
      return send(res, 200, { ok: true, ...startFromPull(t, item, await briefFor(t, item), "brief") });
    }

    // Triggers ({ action: "add", trigger } | { action: "enable" | "disable" | "delete" | "check", name }).
    if (url.pathname === "/api/triggers") {
      const action = String(body.action ?? "");
      if (action === "add") {
        const t = cleanTrigger(body.trigger);
        if ("error" in t) return send(res, 400, t);
        const list = loadTriggers();
        if (list.some((x) => x.name === t.name)) return send(res, 409, { error: `There's already a trigger named ${t.name}.` });
        saveTriggers([...list, t]);
        void pollTriggers(); // its first look: notes what's already there
        return send(res, 200, { ok: true });
      }
      const name = String(body.name ?? "");
      if (!loadTriggers().some((t) => t.name === name)) return send(res, 404, { error: `No trigger named ${name}.` });
      if (action === "enable" || action === "disable") setTriggerEnabled(name, action === "enable");
      else if (action === "delete") saveTriggers(loadTriggers().filter((t) => t.name !== name));
      else if (action === "check") await pollTriggers();
      else return send(res, 400, { error: "Unknown action." });
      return send(res, 200, { ok: true });
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
    if (res.headersSent) return void res.end(); // it failed part-way through an answer: nothing more to say
    return send(res, Number.isInteger(err?.status) ? err.status : 500, { error: err.message });
  }
});

// ---------- Staying up, and going down cleanly ----------
// The camp runs for days with work in flight, so one stray error (a socket that reset, a bug in
// a timer) is logged and the camp carries on, instead of every running expedition dying with it.
process.on("uncaughtException", (err) => console.error("💥 Unexpected error (the camp keeps running):", err));
process.on("unhandledRejection", (err) => console.error("💥 Unhandled rejection (the camp keeps running):", err));

// However the camp ends (Ctrl+C, a closed terminal window, `kill`), the work it started ends with
// it: stopping each run also ends the commands it spawned, which run in their own process groups
// and would otherwise be left behind. This part has to be immediate: nothing is waited for on exit.
process.on("exit", () => {
  for (const w of running.values()) { try { w.controller?.abort(); } catch { /* already stopped */ } }
  void closeConnectors();
});
let closing = false;
function shutDown(signal: string) {
  if (closing) process.exit(1); // asked twice: go now
  closing = true;
  const stopped = stopWork();
  if (stopped.length || queue.length) console.log(`\n🏕️  Breaking camp (${signal}): stopped ${stopped.length} running, ${queue.length} waiting. Reply "resume" in a conversation to pick its work back up.`);
  queue.length = 0;
  for (const res of streams) res.end();
  server.close();
  // A moment for stopped commands to end and the connectors to close, then out (the exit hooks do the rest).
  void closeConnectors().catch(() => {}).finally(() => setTimeout(() => process.exit(0), 300));
  setTimeout(() => process.exit(0), 3000).unref();
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => shutDown(sig));

// Approvals from your phone (off unless camp/settings.json has a "phone" topic; see phone.ts).
startPhoneBridge((askId, answer) => {
  const pending = pendingAsks.get(askId);
  if (!pending) return false;
  pendingAsks.delete(askId);
  pending.resolve(answer);
  return true;
});

startPrWatch();

// On the subscription: read the plan's usage as the camp starts, and again whenever the page asks
// for its state and the figures are more than five minutes old (it costs nothing; see refreshPlanUsage).
const USAGE_STALE = 5 * 60_000;
const freshenUsage = () => { if (campRuntime() === "claude-code" && Date.now() - usageMeasuredAt() > USAGE_STALE) void refreshPlanUsage(); };
server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(err.code === "EADDRINUSE"
    ? `💥 Port ${PORT} is taken: another camp may be running. Stop it, or set CAMP_PORT to a free port.`
    : `💥 Mission control couldn't start: ${err.message}`);
  process.exit(1);
});
server.listen(PORT, ACCESS.listen, () => {
  freshenUsage();
  console.log(`🏕️  Mission control is up: ${newSignInLink()}`);
  console.log(`   That link signs one browser in, once. After that, the plain address opens by itself there.`);
  if (ACCESS.lan) {
    console.log(`   ⚠️  LAN mode: other machines on this network can reach it${fromElsewhere() ? ` (${ACCESS.names.map((n) => addressOf(n, PORT)).join(", ")})` : ", but this machine has no network address just now"}.`);
    console.log(`      It's plain HTTP: for a home network you trust, never a port forwarded to the internet. The terminal pane only opens on this machine.`);
  }
  console.log(`   Press Enter here for another sign-in link. Scheduled jobs run while this is open. Ctrl+C to break camp.`);
  void announceRuntime();
});

// Enter in the camp's terminal: a sign-in link for another browser (or after clearing this one's storage).
rl.on("line", () => console.log(`   Sign in with: ${newSignInLink()}`));

// Say up front what the crew runs on, and warn if the subscription login isn't usable.
async function announceRuntime() {
  if (campRuntime() === "api") return console.log("   Crew runs on: the API (ANTHROPIC_API_KEY).");
  const login = await claudeLogin();
  console.log(login.ok
    ? `   Crew runs on: your Claude ${login.plan ? login.plan[0].toUpperCase() + login.plan.slice(1) + " " : ""}subscription, through Claude Code${login.version ? ` ${login.version}` : ""}.`
    : `   ⚠️  ${login.problem}`);
}
