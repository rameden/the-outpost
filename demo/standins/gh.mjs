#!/usr/bin/env node
// The demo's stand-in for the GitHub CLI. Mae opens, reads and comments on pull requests by
// running `gh`; in the demo it runs this instead, so nothing needs a GitHub account and nothing
// leaves this machine. It answers only the commands Mae uses, from the state in
// demo/.instance/forge/ (see forge.mjs).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BASE, LOGIN, ensureCheck, loadPrs, prFacts, prUrl, prView, remoteGit, savePrs } from "./forge.mjs";

const args = process.argv.slice(2);
const fail = (message, code = 1) => { process.stderr.write(message + "\n"); process.exit(code); };
const out = (value) => process.stdout.write(typeof value === "string" ? value + "\n" : JSON.stringify(value) + "\n");
// The value after a flag ("--title", "X"), or undefined.
const flag = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const FLAGS_WITH_VALUES = new Set(["--json", "--title", "--body", "--head", "--base", "--state", "--limit", "--method", "--input", "--jq", "--hostname", "--user"]);
// What's left once flags and their values are taken out.
function positionals(from) {
  const rest = [];
  for (let i = from; i < args.length; i++) {
    if (FLAGS_WITH_VALUES.has(args[i])) { i++; continue; }
    if (!args[i].startsWith("-")) rest.push(args[i]);
  }
  return rest;
}
const only = (object, fields) => (fields ? Object.fromEntries(fields.split(",").map((f) => [f, object[f] ?? null])) : object);
const currentBranch = () => { try { return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const stdin = () => { try { return JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return {}; } };
const now = () => new Date().toISOString();

// The pull request that was meant: by number, or the open one for the branch checked out here.
function find(state, number) {
  if (number !== undefined) {
    const pr = state.prs.find((p) => p.number === Number(String(number).replace("#", "")));
    if (!pr) fail(`GraphQL: Could not resolve to a PullRequest with the number of ${number}. (repository.pullRequest)`);
    return pr;
  }
  const branch = currentBranch();
  const mine = state.prs.filter((p) => p.head === branch);
  const pr = mine.find((p) => p.state === "OPEN") ?? mine.at(-1);
  if (!pr) fail(`no pull requests found for branch "${branch}"`);
  return pr;
}

try {
  const [group, action] = args;
  const state = loadPrs();

  if (group === "auth" && action === "status") {
    out({ hosts: { "github.com": [{ login: LOGIN, active: true, state: "success", host: "github.com" }] } });
  } else if (group === "auth" && action === "switch") {
    process.stderr.write(`✓ Switched active account for github.com to ${LOGIN}\n`);
  } else if (group === "pr" && action === "create") {
    const head = flag("--head") ?? currentBranch();
    try { remoteGit(["rev-parse", "--verify", "--quiet", `refs/heads/${head}`]); } catch { fail(`The branch "${head}" hasn't been pushed, so there's nothing to open a pull request from.`); }
    const open = state.prs.find((p) => p.head === head && p.state === "OPEN");
    if (open) fail(`a pull request for branch "${head}" into branch "${open.base}" already exists:\n${prUrl(open.number)}`);
    const pr = { number: state.next, title: flag("--title") || head, body: flag("--body") ?? "", head, base: flag("--base") ?? BASE, state: "OPEN", author: LOGIN, createdAt: now(), updatedAt: now(), reviews: [], lineComments: [] };
    if (!prFacts(pr).files.length) fail(`No commits between ${pr.base} and ${head}.`);
    ensureCheck(pr);
    savePrs({ next: state.next + 1, prs: [...state.prs, pr] });
    out(prUrl(pr.number));
  } else if (group === "pr" && action === "view") {
    const pr = find(state, positionals(2)[0]);
    if (pr.state === "OPEN" && ensureCheck(pr)) savePrs(state); // new commits were pushed since the last look
    out(only(prView(pr), flag("--json")));
  } else if (group === "pr" && action === "diff") {
    process.stdout.write(prFacts(find(state, positionals(2)[0])).diff);
  } else if (group === "pr" && action === "edit") {
    const pr = find(state, positionals(2)[0]);
    if (flag("--title") !== undefined) pr.title = flag("--title");
    if (flag("--body") !== undefined) pr.body = flag("--body");
    pr.updatedAt = now();
    savePrs(state);
    out(prUrl(pr.number));
  } else if (group === "pr" && action === "list") {
    out(state.prs.filter((p) => p.state === "OPEN").map((p) => only({ ...prView(p), updatedAt: p.updatedAt }, flag("--json"))));
  } else if (group === "api") {
    const method = (flag("--method") ?? "GET").toUpperCase();
    const path = positionals(1)[0] ?? "";
    const pull = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)(?:\/(reviews|comments))?$/.exec(path);
    if (path === "user") out(flag("--jq") === ".login" ? LOGIN : { login: LOGIN });
    else if (pull && method === "POST" && pull[2] === "reviews") {
      // A review: a summary and, perhaps, comments on lines. Always a plain comment.
      const pr = find(state, pull[1]);
      const sent = stdin();
      const changed = new Set(prFacts(pr).files.map((f) => f.path));
      const comments = Array.isArray(sent.comments) ? sent.comments : [];
      const off = comments.find((c) => !changed.has(String(c.path)));
      if (off) fail(`gh: Unprocessable Entity (HTTP 422): ${off.path} isn't part of this pull request's diff`);
      const id = pr.reviews.length + 1;
      pr.reviews.push({ id, author: LOGIN, body: String(sent.body ?? ""), at: now() });
      for (const c of comments) pr.lineComments.push({ review: id, author: LOGIN, path: String(c.path), line: Number(c.line), body: String(c.body ?? ""), at: now() });
      pr.updatedAt = now();
      savePrs(state);
      out({ id, html_url: `${prUrl(pr.number)}#pullrequestreview-${id}` });
    } else if (pull && method === "PATCH" && !pull[2]) {
      const pr = find(state, pull[1]);
      const sent = stdin();
      if (typeof sent.title === "string") pr.title = sent.title;
      if (typeof sent.body === "string") pr.body = sent.body;
      pr.updatedAt = now();
      savePrs(state);
      out({ number: pr.number, html_url: prUrl(pr.number) });
    } else if (pull && method === "GET" && pull[2] === "comments") {
      out(find(state, pull[1]).lineComments.map((c) => ({ path: c.path, line: c.line, body: c.body, user: { login: c.author } })));
    } else fail(`The demo's stand-in for gh doesn't answer: gh ${args.join(" ")}`, 2);
  } else if (group === "issue" && action === "list") {
    out([]);
  } else {
    fail(`The demo's stand-in for gh doesn't answer: gh ${args.join(" ")}`, 2);
  }
} catch (e) {
  fail(e?.message ?? String(e));
}
