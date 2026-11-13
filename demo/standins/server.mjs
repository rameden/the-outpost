// The demo's stand-in for Jira, plus a page to look at the demo's tickets and pull requests.
//
// Mae reads tickets from Jira Cloud's REST API. In the demo it is pointed here instead (with
// JIRA_ALLOW_ANY_HOST=1, the same switch Mae's own tests use), and this answers the handful of
// calls Mae makes from the Markdown files in demo/tickets/. Starting work and opening a pull
// request move a ticket along and leave a comment on it, as Mae's Jira write-back does.
//
// It listens on 127.0.0.1 only and holds nothing but the demo's own data.

import http from "node:http";
import { BASE, LOGIN, OWNER, REPO, STATUSES, checkOf, issueJson, loadJira, loadPrs, loadTickets, prFacts, prUrl, saveJira, ticketNow } from "./forge.mjs";

const now = () => new Date().toISOString().replace("Z", "+0000");

// ---------- Jira's rich text → plain text (for a comment Mae leaves) ----------
const adfText = (node) => (typeof node === "string" ? node : node?.text ?? (node?.content ?? []).map(adfText).join(node?.type === "doc" ? "\n" : ""));

// ---------- Searching ----------
// Mae sends JQL. This understands the three kinds it sends: what sits under a ticket (nothing
// does here), words to look for, and a filter (every ticket that isn't done, unless it asks for all).
function search(jql) {
  const state = loadJira();
  const all = loadTickets();
  if (/^\s*parent\s*=/i.test(jql)) return [];
  const words = /text\s*~\s*"((?:[^"\\]|\\.)*)"/i.exec(jql)?.[1].replace(/\\(.)/g, "$1").replace(/\*/g, "").toLowerCase().trim();
  if (words !== undefined) return all.filter((t) => `${t.key} ${t.summary} ${t.description}`.toLowerCase().includes(words));
  const notDone = /statusCategory\s*!=\s*"?Done/i.test(jql);
  return all.filter((t) => !notDone || ticketNow(t, state).status.category !== "done");
}

// ---------- The pages ----------
// A time as the person at this machine reads a clock ("13 Nov 2026, 15:39").
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso ?? "") : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Markdown, as far as tickets, descriptions and reviews use it: headings, lists, check boxes,
// quotes, code, bold and links. Everything is escaped first, so what a ticket or a review says
// can only ever be text on the page.
function inlineMd(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}
function md(text) {
  const out = [];
  let list = "", para = [], code = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = ""; } };
  const closePara = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`); para = []; } };
  for (const line of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (code) { if (/^\s*```/.test(line)) { out.push(`<pre class="code">${esc(code.join("\n"))}</pre>`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { closePara(); closeList(); code = []; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (heading) { closePara(); closeList(); out.push(`<h3>${inlineMd(heading[2])}</h3>`); continue; }
    if (item) {
      closePara();
      const kind = item[1] ? "ul" : "ol";
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      const box = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
      out.push(box ? `<li class="check">${box[1] === " " ? "☐" : "☑"} ${inlineMd(box[2])}</li>` : `<li>${inlineMd(item[3])}</li>`);
      continue;
    }
    if (/^\s{2,}\S/.test(line) && list) { out.push(out.pop().replace(/<\/li>$/, ` ${inlineMd(line.trim())}</li>`)); continue; } // an item carried onto the next line
    if (!line.trim()) { closePara(); closeList(); continue; }
    closeList();
    if (line.startsWith("> ")) { closePara(); out.push(`<blockquote>${inlineMd(line.slice(2))}</blockquote>`); continue; }
    para.push(line);
  }
  if (code) out.push(`<pre class="code">${esc(code.join("\n"))}</pre>`);
  closePara(); closeList();
  return out.join("");
}

const STYLE = `
  :root { --bg: #fbfaf7; --ink: #1f1d1a; --muted: #6b665e; --line: #d9d4ca; --panel: #ffffff; --add: #e3f3e1; --del: #fbe4e1; --accent: #8a5a12; }
  @media (prefers-color-scheme: dark) { :root { --bg: #171614; --ink: #ece8e0; --muted: #a39d92; --line: #3a3732; --panel: #201f1c; --add: #1d3320; --del: #44211d; --accent: #e0b060; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 920px; margin: 0 auto; padding: 24px 16px 64px; }
  header.site { border-bottom: 1px solid var(--line); background: var(--panel); }
  header.site div { max-width: 920px; margin: 0 auto; padding: 10px 16px; display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
  header.site strong { font-size: 15px; }
  header.site span { color: var(--muted); font-size: 13px; }
  a { color: var(--accent); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  h1 { font-size: 22px; line-height: 1.3; margin: 0 0 6px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 32px 0 8px; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
  .tag { display: inline-block; border: 1px solid var(--line); padding: 0 6px; font-size: 12px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  td.key { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .box { background: var(--panel); border: 1px solid var(--line); padding: 4px 14px; overflow-wrap: anywhere; }
  .box h3 { font-size: 15px; margin: 14px 0 4px; }
  .box p, .box ul, .box ol, .box blockquote { margin: 8px 0; }
  .box ul, .box ol { padding-left: 22px; }
  .box li.check { list-style: none; margin-left: -18px; }
  .box blockquote { color: var(--muted); padding-left: 12px; border-left: 2px solid var(--line); }
  .box code, .meta code, td code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); border: 1px solid var(--line); padding: 0 3px; }
  .box pre.code { font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); border: 1px solid var(--line); padding: 8px 10px; overflow-x: auto; white-space: pre; }
  .box + .box { margin-top: 8px; }
  .who { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
  pre.diff { background: var(--panel); border: 1px solid var(--line); padding: 10px 0; margin: 0; overflow-x: auto; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre.diff span { display: block; padding: 0 12px; min-width: max-content; }
  pre.diff .add { background: var(--add); }
  pre.diff .del { background: var(--del); }
  pre.diff .hunk, pre.diff .file { color: var(--muted); }
  pre.diff .file { font-weight: 600; padding-top: 6px; }
  .empty { color: var(--muted); }
`;
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><header class="site"><div><strong><a href="/">Mae demo: tickets and pull requests</a></strong><span>A stand-in for Jira and GitHub on this machine. Nothing here is on the internet.</span></div></header><main>${body}</main></body></html>`;

function homePage() {
  const state = loadJira();
  const tickets = loadTickets().map((t) => ticketNow(t, state));
  const prs = loadPrs().prs;
  return page("Mae demo", `
    <h1>Ledgerline</h1>
    <p class="meta">The sample project the demo works on. Tickets come from <code>demo/tickets/</code>; pull requests are the ones opened from mission control.</p>
    <h2>Tickets</h2>
    <table><tr><th>Key</th><th>Summary</th><th>Priority</th><th>Status</th></tr>
    ${tickets.map((t) => `<tr><td class="key"><a href="/browse/${esc(t.key)}">${esc(t.key)}</a></td><td>${esc(t.summary)}</td><td>${esc(t.priority)}</td><td><span class="tag">${esc(t.status.name)}</span></td></tr>`).join("")}
    </table>
    <h2>Pull requests</h2>
    ${prs.length ? `<table><tr><th>#</th><th>Title</th><th>Branch</th><th>Reviews</th><th>State</th></tr>
    ${prs.map((p) => `<tr><td class="key"><a href="/pulls/${p.number}">#${p.number}</a></td><td>${esc(p.title)}</td><td><code>${esc(p.head)}</code></td><td>${p.reviews.length}</td><td><span class="tag">${esc(p.state.toLowerCase())}</span></td></tr>`).join("")}
    </table>` : `<p class="empty">None yet. One appears here when you open a pull request from mission control.</p>`}
  `);
}

function ticketPage(ticket) {
  const t = ticketNow(ticket);
  return page(`${t.key}: ${t.summary}`, `
    <p class="meta"><a href="/">All tickets</a></p>
    <h1>${esc(t.key)}: ${esc(t.summary)}</h1>
    <p class="meta"><span class="tag">${esc(t.status.name)}</span> ${esc(t.type)} · ${esc(t.priority)} priority · reported by ${esc(t.reporter)}${t.labels.length ? ` · ${t.labels.map(esc).join(", ")}` : ""}</p>
    <div class="box">${md(t.description)}</div>
    <h2>Comments</h2>
    ${t.comments.length ? t.comments.map((c) => `<div class="box"><div class="who">${esc(c.author)} · ${esc(when(c.created))}</div>${md(adfText(c.body))}</div>`).join("") : `<p class="empty">None yet.</p>`}
  `);
}

function diffHtml(diff) {
  if (!diff.trim()) return `<p class="empty">This branch changes nothing.</p>`;
  const lines = diff.replace(/\n$/, "").split("\n").map((line) => {
    const kind = line.startsWith("diff --git") ? "file" : line.startsWith("@@") ? "hunk" : /^(\+\+\+|---|index |new file|deleted file)/.test(line) ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
    return `<span${kind ? ` class="${kind}"` : ""}>${esc(line) || " "}</span>`;
  });
  return `<pre class="diff">${lines.join("")}</pre>`;
}

function pullPage(pr) {
  const facts = prFacts(pr);
  const check = checkOf(pr);
  return page(`#${pr.number} ${pr.title}`, `
    <p class="meta"><a href="/">All pull requests</a></p>
    <h1>${esc(pr.title)} <span class="meta">#${pr.number}</span></h1>
    <p class="meta"><span class="tag">${esc(pr.state.toLowerCase())}</span> ${esc(pr.author)} wants to merge <code>${esc(pr.head)}</code> into <code>${esc(pr.base)}</code> · ${facts.files.length} ${facts.files.length === 1 ? "file" : "files"} changed, +${facts.additions} −${facts.deletions}</p>
    <p class="meta">In mission control this pull request is ${esc(prUrl(pr.number))}. That address is made up for the demo; this page is where it really is.</p>
    <h2>Check</h2>
    <p class="meta">${check ? `${check.conclusion === "SUCCESS" ? "✓" : "✗"} <code>${esc(check.name)}</code> ${check.conclusion === "SUCCESS" ? "passed" : "failed"} on <code>${esc(facts.headRefOid.slice(0, 7))}</code>, run by this stand-in in a fresh clone of the branch (${esc(when(check.at))}).` : "Not run yet for the branch's latest commit. It runs the next time Mae looks at this pull request."}</p>
    <h2>Description</h2>
    <div class="box">${pr.body.trim() ? md(pr.body) : `<p class="empty">No description.</p>`}</div>
    <h2>Reviews</h2>
    ${pr.reviews.length ? pr.reviews.map((r) => `<div class="box"><div class="who">${esc(r.author)} commented · ${esc(when(r.at))}</div>${r.body.trim() ? md(r.body) : `<p class="empty">(no summary)</p>`}</div>` +
      pr.lineComments.filter((c) => c.review === r.id).map((c) => `<div class="box"><div class="who">On <code>${esc(c.path)}</code>, line ${c.line}</div>${md(c.body)}</div>`).join("")).join("") : `<p class="empty">None yet. Ask the Warden to review this pull request and post what it finds.</p>`}
    <h2>Changes</h2>
    ${diffHtml(facts.diff)}
  `);
}

// ---------- The server ----------
export function startStandIns(port) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 2_000_000) req.destroy(); });
    req.on("end", () => {
      const json = (status, data) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(data === undefined ? "" : JSON.stringify(data)); };
      const html = (status, text) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" }); res.end(text); };
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const path = url.pathname;
        const tickets = loadTickets();
        const byKey = (key) => tickets.find((t) => t.key === decodeURIComponent(key).toUpperCase());

        // Jira's REST API, as far as Mae uses it.
        if (path.startsWith("/rest/api/3/")) {
          if (!req.headers.authorization) return json(401, { errorMessages: ["You are not authenticated."] });
          const body = raw ? JSON.parse(raw) : {};
          if (path === "/rest/api/3/myself") return json(200, { accountId: "demo-user", displayName: "Demo User", emailAddress: "demo@example.com" });
          if (path === "/rest/api/3/search/jql" && req.method === "POST") {
            const found = search(String(body.jql ?? "")).slice(0, Number(body.maxResults) || 50);
            const state = loadJira();
            return json(200, { issues: found.map((t) => issueJson(t, state)), isLast: true });
          }
          const issue = /^\/rest\/api\/3\/issue\/([^/]+)(?:\/(comment|transitions))?$/.exec(path);
          const ticket = issue && byKey(issue[1]);
          if (issue && !ticket) return json(404, { errorMessages: ["Issue does not exist or you do not have permission to see it."] });
          if (issue && !issue[2] && req.method === "GET") return json(200, issueJson(ticket));
          if (issue?.[2] === "transitions" && req.method === "GET") return json(200, { transitions: STATUSES.map((s) => ({ ...s.transition, to: { name: s.name } })) });
          if (issue && req.method === "POST") {
            const state = loadJira();
            if (issue[2] === "comment") {
              (state.comments[ticket.key] ??= []).push({ author: "Demo User", created: now(), body: body.body ?? "" });
              state.updated[ticket.key] = now();
              saveJira(state);
              return json(201, { id: String(state.comments[ticket.key].length) });
            }
            const to = STATUSES.find((s) => s.transition.id === String(body.transition?.id));
            if (!to) return json(400, { errorMessages: ["That isn't a step this ticket can take."] });
            state.status[ticket.key] = to.name;
            state.updated[ticket.key] = now();
            saveJira(state);
            return json(204);
          }
          return json(404, { errorMessages: ["Not found."] });
        }

        // The pages.
        if (req.method !== "GET") return html(405, page("Not allowed", "<h1>This page is read-only.</h1>"));
        if (path === "/") return html(200, homePage());
        const browse = /^\/browse\/([^/]+)$/.exec(path);
        if (browse) { const t = byKey(browse[1]); return t ? html(200, ticketPage(t)) : html(404, page("No such ticket", `<h1>No ticket called ${esc(decodeURIComponent(browse[1]))}.</h1><p><a href="/">All tickets</a></p>`)); }
        const pull = /^\/pulls\/(\d+)$/.exec(path);
        if (pull) { const pr = loadPrs().prs.find((p) => p.number === Number(pull[1])); return pr ? html(200, pullPage(pr)) : html(404, page("No such pull request", `<h1>No pull request #${esc(pull[1])}.</h1><p><a href="/">All pull requests</a></p>`)); }
        return html(404, page("Not found", `<h1>Nothing here.</h1><p><a href="/">Tickets and pull requests</a></p>`));
      } catch (e) {
        json(500, { errorMessages: [String(e?.message ?? e)] });
      }
    });
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok(server));
  });
}

export const standInInfo = { owner: OWNER, repo: REPO, login: LOGIN, base: BASE };
