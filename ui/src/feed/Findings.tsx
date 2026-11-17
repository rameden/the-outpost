// A review's findings, as a list you can act on. A reviewer asked for them ends its answer with
// a fenced block (```findings, holding a JSON list); the feed shows that block as this list
// instead of as code. Each finding says how serious it is, where it is (click to open the file)
// and what's wrong; tick the ones you want fixed and "Ask for these to be fixed" sends them as a
// change request: to the crew straight away if they're still working (the findings are about the work
// in progress, so waiting would mean redoing it), else as a reply. Untick what you disagree with first:
// the reviewer's words are its opinion, and may be wrong. Posting them on the pull request puts a
// request in the message box instead (the Warden drafts the comment and you approve it, word for word).

import { useState } from "react";
import { say, type Sent } from "../bus.ts";
import { cx, plural } from "../format.ts";

export type Finding = { severity: "blocker" | "should" | "nit"; file: string; line?: number; title: string; detail: string };
const LABEL = { blocker: "Must fix", should: "Should fix", nit: "Small" } as const;
const ORDER = { blocker: 0, should: 1, nit: 2 } as const;
const MAX_FINDINGS = 60;
const HINT = {
  sending: "Sending…",
  now: "Sent to the crew: they'll take it on their next step.",
  sent: "Sent: the crew is on it.",
  failed: "It didn't go: the message box says why.",
  box: "It's in the message box: read it over, then send.",
} as const;

// What the block holds, if it's a list of findings we can show (null: show it as code).
export function parseFindings(text: string): Finding[] | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const out: Finding[] = [];
  for (const r of raw.slice(0, MAX_FINDINGS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = String(o.title ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!title) continue;
    const sev = String(o.severity ?? "").toLowerCase();
    const line = Number(o.line);
    out.push({
      severity: sev === "blocker" || sev === "nit" ? sev : "should",
      file: String(o.file ?? "").trim().slice(0, 300),
      ...(Number.isInteger(line) && line > 0 ? { line } : {}),
      title, detail: String(o.detail ?? "").trim().slice(0, 2000),
    });
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

// The change request the ticked findings become.
export function fixRequest(list: Finding[]): string {
  return "Fix these review findings. Where you think one is wrong, say why instead of changing the code.\n\n" +
    list.map((f, i) => `${i + 1}. [${LABEL[f.severity].toLowerCase()}] ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\` — ` : ""}${f.title}${f.detail ? `\n   ${f.detail.replace(/\n/g, "\n   ")}` : ""}`).join("\n");
}

// The request to post the ticked findings on the pull request. The Warden drafts the comment
// from these and shows you the exact text on an approval card before anything is posted.
export function postRequest(list: Finding[]): string {
  return "Post these findings on the pull request as a review comment from me. Show me the exact text before it goes.\n\n" +
    list.map((f, i) => `${i + 1}. ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\` — ` : ""}${f.title}${f.detail ? `\n   ${f.detail.replace(/\n/g, "\n   ")}` : ""}`).join("\n");
}

export function Findings({ list }: { list: Finding[] }) {
  const [picked, setPicked] = useState<boolean[]>(() => list.map((f) => f.severity !== "nit"));
  // What became of the last request from here: going, gone (to the working run, or as a new request),
  // didn't go, or put in the message box. Ticking or unticking starts afresh.
  const [sent, setSent] = useState<"sending" | Exclude<Sent, null> | "failed" | "box" | null>(null);
  if (!list.length) return <div className="findings none">The review found nothing to fix.</div>;
  const chosen = list.filter((_, i) => picked[i]);
  const blockers = list.filter((f) => f.severity === "blocker").length;
  return (
    <div className="findings" role="group" aria-label="Review findings">
      <div className="findings-head"><b>{list.length} {plural(list.length, "finding")}</b>{blockers > 0 && <span className="pill bad">{blockers} must fix</span>}</div>
      <ul>
        {list.map((f, i) => (
          <li key={i} className={cx("finding", f.severity)}>
            <input type="checkbox" checked={picked[i]} aria-label={`Include: ${f.title}`} onChange={(ev) => { setSent(null); setPicked((p) => p.map((v, j) => (j === i ? ev.target.checked : v))); }} />
            <div>
              <div className="finding-top">
                <span className={cx("pill", f.severity === "blocker" ? "bad" : f.severity === "should" && "live")}>{LABEL[f.severity]}</span>
                <b>{f.title}</b>
              </div>
              {f.file && (
                <code className="path-link" role="link" tabIndex={0} title="Open this file" onClick={() => say({ do: "open-file", path: f.file, line: f.line })}
                  onKeyDown={(ev) => { if (ev.key === "Enter") say({ do: "open-file", path: f.file, line: f.line }); }}>{f.file}{f.line ? `:${f.line}` : ""}</code>
              )}
              {f.detail && <p>{f.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="findings-foot">
        <button type="button" className="btn small primary" disabled={!chosen.length || sent === "sending" || sent === "now" || sent === "sent"}
          title="Send the ticked findings as a change request: to the crew now if they're working, else as a reply"
          onClick={() => { setSent("sending"); say({ do: "send", text: fixRequest(chosen), sent: (how) => setSent(how ?? "failed") }); }}>Ask for {chosen.length === list.length ? "these" : `${chosen.length} of them`} to be fixed</button>
        <button type="button" className="btn small" disabled={!chosen.length} title="Put a request in the message box to post the ticked findings on the pull request as you. You approve the exact text before anything is posted."
          onClick={() => { say({ do: "compose", text: postRequest(chosen) }); setSent("box"); }}>Post on the pull request…</button>
        <span className="meta" role="status">{sent ? HINT[sent] : "A reviewer's opinion, not a verdict: untick what you disagree with."}</span>
      </div>
    </div>
  );
}
