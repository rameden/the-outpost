// Release notes: what changed in Outpost itself (the app), written up from the pull requests merged into its
// repository. Every 48 hours (while mission control is open) the camp reads the pull requests
// merged since the last write-up, asks the small model to sum them up in two halves, front end
// and back end, with the big features first, and keeps the result in camp/releases.json. The
// star chart's Release notes drawer shows them, newest first. A window with nothing merged writes nothing.
//
// If the model can't be reached, each pull request becomes one line on its own, placed by the
// files it touched (ui/, docs/, extension/ are the front end; the rest is the back end), so a
// write-up is never lost for want of a model. Nothing here writes to GitHub.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { emit } from "./events.js";
import { gh } from "./github.js";
import { clip } from "./helpers.js";
import { askSmall } from "./small.js";

export const RELEASES_PATH = "camp/releases.json";
export const EVERY_MS = 48 * 3_600_000;
const FIRST_LOOK_DAYS = 14;        // the first write-up reaches back this far
const MAX_PULLS = 100;
const BODY_CHARS = 700, FILES_SHOWN = 25;
const MAJOR_LINES = 400;           // changed lines that make a pull request a major one, without the model
const KEPT = 60;                   // write-ups kept
// Mae's own checkout (where this code lives), whichever outpost's folder the server runs in.
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type Merged = { number: number; title: string; url: string; merged: string; author: string; body: string; files: string[]; lines: number };
export type Note = { title: string; detail: string; major: boolean; prs: number[] };
export type Release = { id: string; from: string; to: string; written: string; byModel: boolean; prs: { number: number; title: string; url: string; author: string }[]; frontend: Note[]; backend: Note[] };
export type Releases = { checked: string; repo: string; releases: Release[]; error?: string };

const none = (): Releases => ({ checked: "", repo: "", releases: [] });
export function releases(): Releases {
  const r = readJsonFile(RELEASES_PATH, none()) as Releases;
  return r && Array.isArray(r.releases) ? r : none();
}

// ---------- Reading what was merged ----------
export type Lister = (since: string) => Promise<{ repo: string; pulls: Merged[] }>;
export const ghLister: Lister = async (since) => {
  const o = { cwd: APP_ROOT, maxBuffer: 32 * 1024 * 1024 };
  const repo = (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], o).catch(() => "")).trim();
  const raw = await gh(["pr", "list", "--state", "merged", "--limit", String(MAX_PULLS), "--search", `merged:>${since}`,
    "--json", "number,title,url,mergedAt,author,body,files,additions,deletions"], o);
  const pulls = (JSON.parse(raw) as any[]).map((p): Merged => ({
    number: p.number, title: String(p.title ?? ""), url: String(p.url ?? ""), merged: String(p.mergedAt ?? ""),
    author: String(p.author?.login ?? ""), body: String(p.body ?? ""), files: (p.files ?? []).map((f: any) => String(f.path)),
    lines: Number(p.additions ?? 0) + Number(p.deletions ?? 0),
  }));
  return { repo, pulls };
};

// ---------- Front end or back end ----------
const FRONT = /^(ui|docs|extension)\//;
export function sideOf(files: string[]): "frontend" | "backend" {
  const front = files.filter((f) => FRONT.test(f)).length;
  return front > files.length - front ? "frontend" : "backend";
}

// One line per pull request, placed by its files: what's kept when the model can't be asked.
export function plainNotes(pulls: Merged[]): { frontend: Note[]; backend: Note[] } {
  const out = { frontend: [] as Note[], backend: [] as Note[] };
  for (const p of pulls) {
    const first = p.body.split(/\n\s*\n/).map((s) => s.replace(/^#+\s*/, "").trim()).find((s) => s && !s.startsWith("🤖")) ?? "";
    out[sideOf(p.files)].push({ title: p.title, detail: clip(first.replace(/\s+/g, " "), 240), major: p.lines >= MAJOR_LINES, prs: [p.number] });
  }
  return { frontend: majorFirst(out.frontend), backend: majorFirst(out.backend) };
}
// New features first, then the rest; newest pull request first within each.
const newest = (n: Note) => Math.max(0, ...n.prs);
export const majorFirst = (notes: Note[]) => [...notes].sort((a, b) => Number(b.major) - Number(a.major) || newest(b) - newest(a));

// ---------- The write-up ----------
const SYSTEM = `You write release notes for Outpost, a multi-agent app: a Node/TypeScript back end (src/, scripts/, tests/) and a React front end (ui/), plus an in-app tour (docs/) and a browser extension (extension/), which count as front end.
You're given the pull requests merged in one window. Sum them up for someone who uses the app: what they can now do, see, or rely on, in plain words. Group related pull requests into one note. Leave out pure test, CI or refactor work unless it changes behaviour, folding it into a related note if there is one.
Answer with JSON only, no prose and no code fence:
{"frontend":[{"title":"...","detail":"...","major":true,"prs":[12]}],"backend":[...]}
title: under 70 characters. detail: one or two sentences. major: true for a new feature or a large change people will notice; false for fixes and polish. prs: the numbers it covers. Every pull request number appears at least once. Either list may be empty.`;

export type Summarizer = (system: string, prompt: string) => Promise<string>;
const smallSummarizer: Summarizer = (system, prompt) => askSmall(system, prompt, 2500);

function promptFor(pulls: Merged[]): string {
  return pulls.map((p) => [
    `#${p.number} ${p.title} (${p.lines} lines changed)`,
    `Files: ${p.files.slice(0, FILES_SHOWN).join(", ")}${p.files.length > FILES_SHOWN ? `, and ${p.files.length - FILES_SHOWN} more` : ""}`,
    p.body.trim() ? `Description: ${clip(p.body.replace(/🤖 Generated with[^\n]*/g, ""), BODY_CHARS)}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

// The model's answer, checked: only numbers that were merged, and every pull request somewhere.
export function readNotes(reply: string, pulls: Merged[]): { frontend: Note[]; backend: Note[] } | null {
  const json = reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  let parsed: any;
  try { parsed = JSON.parse(json); } catch { return null; }
  const known = new Map(pulls.map((p) => [p.number, p]));
  const read = (list: unknown): Note[] => (Array.isArray(list) ? list : []).flatMap((n: any) => {
    const prs = (Array.isArray(n?.prs) ? n.prs : []).map(Number).filter((x: number) => known.has(x));
    const title = clip(n?.title, 100);
    return title ? [{ title, detail: clip(n?.detail, 400), major: n?.major === true, prs }] : [];
  });
  const out = { frontend: read(parsed?.frontend), backend: read(parsed?.backend) };
  if (!out.frontend.length && !out.backend.length) return null;
  // A pull request the model left out still gets its line.
  const covered = new Set([...out.frontend, ...out.backend].flatMap((n) => n.prs));
  const missed = plainNotes(pulls.filter((p) => !covered.has(p.number)));
  return { frontend: majorFirst([...out.frontend, ...missed.frontend]), backend: majorFirst([...out.backend, ...missed.backend]) };
}

// ---------- Writing one ----------
let writing: Promise<Releases> | null = null;
export function writeReleaseNotes(o: { lister?: Lister; summarize?: Summarizer; now?: Date } = {}): Promise<Releases> {
  return (writing ??= (async () => {
    const now = o.now ?? new Date();
    const before = releases();
    const since = before.releases[0]?.to || before.checked || new Date(now.getTime() - FIRST_LOOK_DAYS * 86_400_000).toISOString();
    try {
      const { repo, pulls: all } = await (o.lister ?? ghLister)(since.slice(0, 19) + "Z");
      const pulls = all.filter((p) => p.merged > since).sort((a, b) => a.merged.localeCompare(b.merged));
      if (!pulls.length) return save({ ...before, checked: now.toISOString(), repo: repo || before.repo, error: undefined });
      let notes = null as ReturnType<typeof readNotes>;
      try { notes = readNotes(await (o.summarize ?? smallSummarizer)(SYSTEM, promptFor(pulls)), pulls); } catch { /* written plainly below */ }
      const release: Release = {
        id: pulls[pulls.length - 1].merged, from: since, to: pulls[pulls.length - 1].merged, written: now.toISOString(), byModel: !!notes,
        prs: pulls.map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author })),
        ...(notes ?? plainNotes(pulls)),
      };
      return save({ checked: now.toISOString(), repo: repo || before.repo, releases: [release, ...before.releases].slice(0, KEPT) });
    } catch (e: any) {
      const why = e?.code === "ENOENT" ? "The GitHub CLI (gh) isn't installed, so merged pull requests can't be read." : String(e?.stderr || e?.message || e).trim().split("\n").slice(-2).join(" ");
      return save({ ...before, error: clip(why, 300) });
    }
  })().finally(() => { writing = null; }));
}
function save(next: Releases): Releases {
  if (!next.error) delete next.error;
  writeJsonAtomic(RELEASES_PATH, next);
  emit({ type: "changed", what: "releases" });
  return next;
}

// Due: never written, or the last look was 48 hours ago (a failed look tries again next hour).
export function releaseNotesDue(r: Releases = releases(), now = Date.now()): boolean {
  return !r.checked || now - new Date(r.checked).getTime() >= EVERY_MS;
}

// While mission control is open: a look shortly after it starts, then once an hour, writing only when due.
export function startReleaseNotes(everyMs = 3_600_000): NodeJS.Timeout {
  const tick = () => { if (releaseNotesDue()) void writeReleaseNotes().catch(() => { /* next time */ }); };
  setTimeout(tick, 60_000).unref();
  const t = setInterval(tick, everyMs);
  t.unref();
  return t;
}
