// What the demo's stand-ins share: where their state is kept, the tickets, and the pull requests.
//
// Nothing here talks to Jira or GitHub. Tickets are the Markdown files in demo/tickets/. Pull
// requests are entries in a JSON file beside a bare git repository on this machine, which is
// what the sample project's "origin" points at. All of it lives under demo/.instance/forge/ and
// is thrown away by `npm run demo:reset`.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TICKETS = join(DEMO, "tickets");

// The repository the pull requests belong to. The owner has an underscore in it, which GitHub
// doesn't allow in a name: a pull request's address here can never be someone's real one.
export const OWNER = "mae_demo";
export const REPO = "ledgerline";
export const LOGIN = "demo-user";
export const BASE = "main";
export const prUrl = (number) => `https://github.com/${OWNER}/${REPO}/pull/${number}`;

export function forgeDir() {
  const dir = process.env.MAE_DEMO_FORGE;
  if (!dir) throw new Error("This is the Mae demo's stand-in, and it only runs as part of the demo (MAE_DEMO_FORGE isn't set). Start the demo with `npm run demo`.");
  return dir;
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

// ---------- Git, in the bare repository the sample project pushes to ----------
export const remotePath = () => join(forgeDir(), `${REPO}.git`);
export function remoteGit(args) {
  return execFileSync("git", ["--git-dir", remotePath(), ...args], { encoding: "utf8", maxBuffer: 20_000_000, stdio: ["ignore", "pipe", "pipe"] });
}
const tryRemoteGit = (args) => { try { return remoteGit(args); } catch { return ""; } };

// ---------- Pull requests ----------
const prsPath = () => join(forgeDir(), "prs.json");
export const loadPrs = () => readJson(prsPath(), { next: 1, prs: [] });
export const savePrs = (state) => writeJson(prsPath(), state);

// What git says about a pull request's branch: its latest commit, the files it changes, the diff.
export function prFacts(pr) {
  const range = `${pr.base}...${pr.head}`;
  const files = tryRemoteGit(["diff", "--numstat", range]).split("\n").filter(Boolean).map((line) => {
    const [added, removed, ...path] = line.split("\t");
    return { path: path.join("\t"), additions: Number(added) || 0, deletions: Number(removed) || 0 };
  });
  return {
    headRefOid: tryRemoteGit(["rev-parse", `refs/heads/${pr.head}`]).trim(),
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    diff: tryRemoteGit(["diff", range]),
  };
}

// ---------- The check ----------
// What a CI service does for a pull request: run the project's tests on the branch as it was
// pushed. It's a real run (`npm test` in a fresh clone of the branch), done once for each commit
// the branch has pointed at. Returns true when it ran one, so the caller knows to save.
export function ensureCheck(pr) {
  const sha = tryRemoteGit(["rev-parse", `refs/heads/${pr.head}`]).trim();
  if (!sha || pr.checks?.[sha]) return false;
  const dir = mkdtempSync(join(tmpdir(), "mae-demo-check-"));
  let conclusion = "FAILURE";
  try {
    execFileSync("git", ["clone", "-q", "--branch", pr.head, remotePath(), join(dir, "repo")], { stdio: "ignore" });
    conclusion = spawnSync("npm", ["test"], { cwd: join(dir, "repo"), stdio: "ignore", timeout: 120_000 }).status === 0 ? "SUCCESS" : "FAILURE";
  } catch { /* a branch that can't be cloned or tested has failed its check */ }
  finally { rmSync(dir, { recursive: true, force: true }); }
  pr.checks = { ...(pr.checks ?? {}), [sha]: { name: "npm test", conclusion, at: new Date().toISOString() } };
  return true;
}
// The check for the branch's latest commit, if it has run.
export function checkOf(pr) {
  const sha = tryRemoteGit(["rev-parse", `refs/heads/${pr.head}`]).trim();
  return (sha && pr.checks?.[sha]) || null;
}

// A pull request as `gh pr view --json …` gives it.
export function prView(pr) {
  const facts = prFacts(pr);
  const check = checkOf(pr);
  return {
    number: pr.number, url: prUrl(pr.number), title: pr.title, body: pr.body, state: pr.state, isDraft: false,
    author: { login: pr.author }, baseRefName: pr.base, headRefName: pr.head, headRefOid: facts.headRefOid,
    additions: facts.additions, deletions: facts.deletions, files: facts.files,
    mergeable: "MERGEABLE", reviewDecision: "", comments: [],
    statusCheckRollup: check ? [{ __typename: "CheckRun", name: check.name, status: "COMPLETED", conclusion: check.conclusion, completedAt: check.at }] : [],
    reviews: pr.reviews.map((r) => ({ author: { login: r.author }, state: "COMMENTED", body: r.body, submittedAt: r.at })),
    createdAt: pr.createdAt, updatedAt: pr.updatedAt,
  };
}

// ---------- Tickets ----------
export const STATUSES = [
  { name: "To Do", category: "new", transition: { id: "11", name: "Back to To Do" } },
  { name: "In Progress", category: "indeterminate", transition: { id: "21", name: "Start work" } },
  { name: "In Review", category: "indeterminate", transition: { id: "31", name: "Send for review" } },
  { name: "Done", category: "done", transition: { id: "41", name: "Done" } },
];
const SEEDED = "2026-11-12T09:00:00.000+0000";

const jiraPath = () => join(forgeDir(), "jira.json");
export const loadJira = () => readJson(jiraPath(), { status: {}, comments: {}, updated: {} });
export const saveJira = (state) => writeJson(jiraPath(), state);

// A ticket file: a few "name: value" lines between --- markers, then the description in Markdown.
function parseTicket(key, text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const head = Object.fromEntries((match?.[1] ?? "").split("\n").map((line) => { const at = line.indexOf(":"); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }).filter(([name]) => name));
  return {
    key, summary: head.summary ?? key, type: head.type ?? "Bug", priority: head.priority ?? "Medium", reporter: head.reporter ?? "Someone",
    labels: (head.labels ?? "").split(",").map((l) => l.trim()).filter(Boolean), description: (match?.[2] ?? text).trim(),
  };
}
export function loadTickets() {
  if (!existsSync(TICKETS)) return [];
  return readdirSync(TICKETS).filter((name) => /^[A-Z][A-Z0-9_]+-\d+\.md$/.test(name)).sort()
    .map((name) => parseTicket(name.replace(/\.md$/, ""), readFileSync(join(TICKETS, name), "utf8")));
}

// A ticket with where it stands now (its status and comments are the stand-in's own state).
export function ticketNow(ticket, state = loadJira()) {
  const status = STATUSES.find((s) => s.name === state.status[ticket.key]) ?? STATUSES[0];
  return { ...ticket, status, comments: state.comments[ticket.key] ?? [], updated: state.updated[ticket.key] ?? SEEDED };
}

// The same ticket in the shape Jira Cloud's REST API gives an issue.
export function issueJson(ticket, state = loadJira()) {
  const t = ticketNow(ticket, state);
  return {
    id: String(10_000 + Number(t.key.split("-")[1])), key: t.key,
    fields: {
      summary: t.summary, description: t.description, labels: t.labels, updated: t.updated,
      status: { name: t.status.name, statusCategory: { key: t.status.category } },
      issuetype: { name: t.type }, priority: { name: t.priority },
      reporter: { displayName: t.reporter }, assignee: { displayName: "Demo User" },
      project: { key: t.key.split("-")[0], name: "Ledgerline" }, parent: null,
      comment: { total: t.comments.length, comments: t.comments.map((c) => ({ author: { displayName: c.author }, created: c.created, body: c.body })) },
    },
  };
}
