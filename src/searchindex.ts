// The search index: one SQLite file (camp/index.db) that makes the camp's records findable by
// words without reading them all again for every search.
//
// It is derived, never the record. The files under camp/ stay the source of truth: sessions
// (camp/agents/<id>/sessions), conversations (camp/threads.jsonl), the wiki (camp/wiki) and the
// lines of memory (each agent's memory.md, about-you.md, each project's notes.md). The index
// can be deleted at any time: it's built again from those files the next time something
// searches. The same happens when it's missing, from an older layout, or damaged.
//
// Keeping in step: every source file has a stamp here (size, time, inode). Before a search the
// stamps are compared, and only what changed is read again: a new session is added, a changed
// memory file or wiki page has its lines replaced, and threads.jsonl (which only grows) is read
// from where the last read stopped. Writers also call noteWritten() so the index follows a
// write straight away; a file changed by hand is caught by its stamp just the same.
//
// What's in it: one row per piece of text (docs): a session's request, each message of its
// transcript and its answer; each run of a conversation; each stretch of a wiki page; each
// memory line. Two FTS5 tables index those rows: docs_fts (words, by their roots, ranked with
// BM25) and docs_tri (trigrams, so part of a word matches: "turns" in "maxTurns").
//
// It runs on Node's built-in node:sqlite. Where that isn't there (Node before 22.13), nothing
// here is available and the callers search the files directly, as they did before.
//
// No imports from the rest of the camp, so anything can use it without import cycles.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { posix } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const join = posix.join;
export const INDEX_PATH = join("camp", "index.db");
const LAYOUT = 1;              // raise it when the tables or what goes into them change: an older index is built again
const SETTLE_MS = 2000;        // a file changed this recently is read again next time (its time may not have moved: see wiki.ts)
const TEXT_MAX = 20_000;       // characters of one piece that are kept and indexed
const TOOL_INPUT_MAX = 300, TOOL_RESULT_MAX = 600;
const WIKI_STRETCH = 1500;     // about how long a stretch of a wiki page is

export type DocKind = "session" | "turn" | "wiki" | "memory";
// kind session: owner the agent, project the one it was recorded in ("" for none), key the transcript's name, seq the message, role asked | answered | user | assistant | tool.
// kind turn:    key the conversation (thread), seq the run's place in it, ref the run, role "turn" ("open" while it has no answer), extra how long the request is.
// kind wiki:    key the page's path, seq the stretch.
// kind memory:  key the place ("agent:<id>", "project:<id>", "about"), seq the line, extra the line as written.
export type Doc = { id: number; kind: DocKind; owner: string; project: string; key: string; seq: number; role: string; ref: string; time: string; text: string; extra: string };
export type Hit = Doc & { rank: number; partial: boolean }; // rank: BM25, higher is better. partial: found only as part of a word

type Sqlite = { DatabaseSync: new (path: string) => DatabaseSync };
let sqlite: Sqlite | null | undefined;
function driver(): Sqlite | null {
  if (sqlite !== undefined) return sqlite;
  sqlite = null;
  if (process.env.CAMP_SEARCH_INDEX === "off") return sqlite;
  try {
    const mod = (process as any).getBuiltinModule?.("node:sqlite") as Sqlite | undefined;
    if (mod?.DatabaseSync) {
      // FTS5 and its trigram tokenizer have to be in this build of SQLite.
      const probe = new mod.DatabaseSync(":memory:");
      try { probe.exec("CREATE VIRTUAL TABLE a USING fts5(t, tokenize='trigram'); CREATE VIRTUAL TABLE b USING fts5(t, tokenize='porter unicode61')"); sqlite = mod; }
      finally { probe.close(); }
    }
  } catch { /* no sqlite here: the callers search the files */ }
  return sqlite;
}
// For tests: forget whether sqlite was found, so CAMP_SEARCH_INDEX is read again.
export function resetIndexDriver() { closeIndex(); sqlite = undefined; }

export const indexAvailable = () => !!driver();

const SCHEMA = `
CREATE TABLE docs(
  id INTEGER PRIMARY KEY, src TEXT NOT NULL, kind TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, extra TEXT NOT NULL DEFAULT '');
CREATE INDEX docs_key ON docs(kind, key, seq);
CREATE INDEX docs_src ON docs(src);
CREATE INDEX docs_ref ON docs(ref) WHERE ref <> '';
CREATE VIRTUAL TABLE docs_fts USING fts5(text, content='docs', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE docs_tri USING fts5(text, content='docs', content_rowid='id', tokenize='trigram');
CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, text) VALUES (new.id, new.text);
  INSERT INTO docs_tri(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO docs_tri(docs_tri, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TABLE sources(path TEXT PRIMARY KEY, stamp TEXT NOT NULL, hash TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL DEFAULT 0);
`;

// One open index per camp folder (tests move between folders; a camp server stays in one).
const open = new Map<string, DatabaseSync>();
const at = () => `${process.cwd()}|${INDEX_PATH}`;

function removeFiles() {
  for (const tail of ["", "-wal", "-shm", "-journal"]) rmSync(INDEX_PATH + tail, { force: true });
}
export function closeIndex() {
  const db = open.get(at());
  if (!db) return;
  open.delete(at());
  try { db.close(); } catch { /* already closed */ }
}

function connect(): DatabaseSync {
  const d = driver();
  if (!d) throw new Error("node:sqlite isn't available");
  const had = open.get(at());
  if (had) {
    if (existsSync(INDEX_PATH)) return had;
    closeIndex(); // the file was deleted under us: start again
  }
  mkdirSync("camp", { recursive: true });
  const make = () => {
    const db = new d.DatabaseSync(INDEX_PATH);
    try {
      db.exec("PRAGMA busy_timeout = 4000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      const version = (db.prepare("PRAGMA user_version").get() as any)?.user_version ?? 0;
      const tables = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('docs','docs_fts','docs_tri','sources')").get() as any).n;
      if (version !== LAYOUT || tables !== 4) {
        if (tables || version) throw Object.assign(new Error("another layout"), { stale: true });
        db.exec(`BEGIN IMMEDIATE; ${SCHEMA} PRAGMA user_version = ${LAYOUT}; COMMIT;`);
      }
      return db;
    } catch (err) { try { db.close(); } catch { /* */ } throw err; }
  };
  let db: DatabaseSync;
  try { db = make(); }
  catch {
    // Not a database, from another layout, or half made: it's only an index, so it's made again.
    removeFiles();
    db = make();
  }
  open.set(at(), db);
  return db;
}

const DAMAGED = /malformed|corrupt|not a database|no such table|no such column|vtable constructor failed|missing from index/i;
// Run something against the index, in step with the files. If the index turns out to be damaged,
// it's deleted, built again from the files, and the thing is tried once more.
function withIndex<T>(fn: (db: DatabaseSync) => T): T {
  try {
    const db = connect();
    sync(db);
    return fn(db);
  } catch (err: any) {
    if (!DAMAGED.test(String(err?.message ?? err))) throw err;
    closeIndex();
    removeFiles();
    const db = connect();
    sync(db);
    return fn(db);
  }
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (err) { try { db.exec("ROLLBACK"); } catch { /* nothing open */ } throw err; }
}

// ---------- Reading the camp's files into rows ----------
type Row = Omit<Doc, "id">;
type Stat = { stamp: string; settled: boolean; size: number; ino: number };
function statOf(path: string): Stat | null {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    return { stamp: `${st.size}:${st.mtimeMs}:${st.ino}`, settled: Date.now() - st.mtimeMs > SETTLE_MS, size: st.size, ino: Number(st.ino) };
  } catch { return null; }
}
const hashOf = (text: string | Buffer) => createHash("sha1").update(text).digest("hex");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const names = (dir: string) => { try { return readdirSync(dir).sort(); } catch { return []; } };

function insert(db: DatabaseSync, rows: Row[]) {
  const add = db.prepare("INSERT INTO docs(src, kind, owner, project, key, seq, role, ref, time, text, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of rows) {
    const text = clip(r.text, TEXT_MAX);
    if (text.trim()) add.run((r as any).src, r.kind, r.owner, r.project, r.key, r.seq, r.role, r.ref, r.time, text, r.extra);
  }
}
const row = (src: string, kind: DocKind, key: string, seq: number, text: string, more: Partial<Row> = {}): Row & { src: string } =>
  ({ src, kind, key, seq, text, owner: "", project: "", role: "", ref: "", time: "", extra: "", ...more });

// The lines of a memory file that are entries ("- …"), each as its own row.
function memoryRows(src: string, key: string, text: string): Row[] {
  const out: Row[] = [];
  text.split("\n").forEach((line, n) => {
    if (!line.trim().startsWith("- ")) return;
    out.push(row(src, "memory", key, n, line.trim().slice(2), { time: line.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "", extra: line }));
  });
  return out;
}

// A wiki page in stretches of whole paragraphs, so a match has a place and a long page ranks by the part that answers.
export function stretches(text: string, size = WIKI_STRETCH): string[] {
  const out: string[] = [];
  let now = "";
  for (const para of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    if (!para.trim()) continue;
    if (now && now.length + para.length > size) { out.push(now); now = ""; }
    now = now ? `${now}\n\n${para}` : para;
    while (now.length > size * 4) { out.push(now.slice(0, size * 4)); now = now.slice(size * 4); } // one enormous paragraph
  }
  if (now) out.push(now);
  return out;
}
function wikiRows(src: string, text: string): Row[] {
  const updated = text.match(/^updated:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return stretches(text).map((part, n) => row(src, "wiki", src, n, part, { time: updated }));
}

// What a message of a transcript says, as text: its words, the tools it used (briefly), what they gave back (briefly).
const resultText = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n") : "";
export function messageText(m: any): { role: string; text: string } {
  const c = m?.content;
  const who = m?.role === "assistant" ? "assistant" : "user";
  if (typeof c === "string") return { role: who, text: c };
  if (!Array.isArray(c)) return { role: who, text: "" };
  const parts: string[] = [];
  let said = false;
  for (const b of c) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") { parts.push(b.text); said = true; }
    else if (b.type === "tool_use") { let input = ""; try { input = JSON.stringify(b.input ?? {}); } catch { /* */ } parts.push(`[used ${b.name}: ${clip(input, TOOL_INPUT_MAX)}]`); }
    else if (b.type === "tool_result") parts.push(`[result: ${clip(resultText(b.content).trim(), TOOL_RESULT_MAX)}]`);
  }
  return { role: who === "user" && !said ? "tool" : who, text: parts.join("\n").trim() };
}

type SessionLine = { time?: string; task?: string; result?: string; file?: string; project?: string };
const sessionKey = (file: string) => posix.basename(file.replace(/\\/g, "/")).replace(/\.json$/, "");
// One session: what was asked (0), each message after the request, and the answer (last). The
// transcript has all of it while it's kept; once it's pruned, the index line's opening is what there is.
function sessionRows(src: string, owner: string, line: SessionLine): Row[] {
  const key = sessionKey(String(line.file ?? ""));
  const base = { owner, project: line.project ?? "", time: line.time ?? "" };
  let full: { task?: unknown; result?: unknown; messages?: unknown } | null = null;
  try { full = JSON.parse(readFileSync(String(line.file), "utf8")); } catch { /* pruned, or not a transcript */ }
  const task = typeof full?.task === "string" ? full.task : String(line.task ?? "");
  const result = typeof full?.result === "string" ? full.result : String(line.result ?? "");
  const out: Row[] = [row(src, "session", key, 0, task, { ...base, role: "asked" })];
  const messages = Array.isArray(full?.messages) ? full.messages : [];
  messages.forEach((m, n) => {
    if (n === 0 && m?.role === "user") return; // the request itself (with what was put in front of it)
    const { role, text } = messageText(m);
    if (!text) return;
    if (n === messages.length - 1 && role === "assistant" && result.trim().startsWith(text)) return; // the answer, which comes next
    out.push(row(src, "session", key, n, text, { ...base, role }));
  });
  out.push(row(src, "session", key, Math.max(1, messages.length), result, { ...base, role: "answered" }));
  return out;
}

type TurnLine = { thread?: string; expedition?: string; time?: string; task?: string; reply?: string };
function putTurn(db: DatabaseSync, src: string, t: TurnLine) {
  if (typeof t?.thread !== "string" || typeof t?.expedition !== "string") return;
  // The last line for a run is the one that counts; it keeps the time and the place of the first.
  const prior = db.prepare("SELECT id, seq, time FROM docs WHERE ref = ? AND kind = 'turn'").get(t.expedition) as { id: number; seq: number; time: string } | undefined;
  if (prior) db.prepare("DELETE FROM docs WHERE id = ?").run(prior.id);
  const seq = prior?.seq ?? (db.prepare("SELECT count(*) AS n FROM docs WHERE kind = 'turn' AND key = ?").get(t.thread) as any).n;
  const task = String(t.task ?? ""), reply = String(t.reply ?? "");
  // What was asked, a blank line, what was answered; extra says where the request ends (see turnParts).
  insert(db, [row(src, "turn", t.thread, seq, reply ? `${task}\n\n${reply}` : task,
    { ref: t.expedition, role: reply ? "turn" : "open", time: prior?.time ?? String(t.time ?? ""), extra: String(task.length) })]);
}

// A run's row, back in its two parts.
export function turnParts(d: Pick<Doc, "text" | "extra">): { task: string; reply: string } {
  const at = Math.min(Number(d.extra) || 0, d.text.length);
  return { task: d.text.slice(0, at), reply: d.text.slice(at).replace(/^\n\n/, "") };
}

// ---------- Keeping in step ----------
const THREADS = "camp/threads.jsonl";
type Job = { path: string; stat: Stat; run: (db: DatabaseSync, known: Known | undefined) => { hash?: string; at?: number } };
type Known = { stamp: string; hash: string; at: number };

// A file that is read whole when it changes: its rows are replaced (unless it reads the same as before).
function whole(path: string, stat: Stat, rows: (text: string) => Row[]): Job {
  return { path, stat, run: (db, known) => {
    const text = readFileSync(path, "utf8");
    const hash = hashOf(text);
    if (known?.hash !== hash) {
      db.prepare("DELETE FROM docs WHERE src = ?").run(path);
      insert(db, rows(text));
    }
    return { hash };
  } };
}

// An agent's sessions: the ones its index lists that aren't in yet are added; ones it no longer lists are dropped.
function sessionsJob(path: string, stat: Stat, owner: string): Job {
  return { path, stat, run: (db, known) => {
    const text = readFileSync(path, "utf8");
    const hash = hashOf(text);
    if (known?.hash === hash) return { hash };
    const listed = new Map<string, SessionLine>();
    for (const l of text.split("\n")) {
      if (!l) continue;
      try { const s = JSON.parse(l) as SessionLine; if (typeof s?.file === "string") listed.set(sessionKey(s.file), s); } catch { /* a torn line */ }
    }
    const have = new Set((db.prepare("SELECT DISTINCT key FROM docs WHERE src = ?").all(path) as { key: string }[]).map((r) => r.key));
    const drop = db.prepare("DELETE FROM docs WHERE src = ? AND key = ?");
    for (const key of have) if (!listed.has(key)) drop.run(path, key);
    for (const [key, line] of listed) if (!have.has(key)) insert(db, sessionRows(path, owner, line));
    return { hash };
  } };
}

// threads.jsonl only grows (a compaction replaces the file): read from where the last read stopped.
function threadsJob(stat: Stat): Job {
  return { path: THREADS, stat, run: (db, known) => {
    const [, , inoWas] = (known?.stamp ?? "").replace(/\?$/, "").split(":");
    let from = known && Number(inoWas) === stat.ino && known.at <= stat.size ? known.at : 0;
    if (from === 0) db.prepare("DELETE FROM docs WHERE src = ?").run(THREADS);
    const fd = openSync(THREADS, "r");
    let text = "";
    try {
      const buf = Buffer.alloc(Math.max(0, stat.size - from));
      const got = readSync(fd, buf, 0, buf.length, from);
      const end = buf.lastIndexOf(0x0a, got - 1) + 1; // whole lines only: a line still being written waits for next time
      text = buf.toString("utf8", 0, end);
      from += end;
    } finally { closeSync(fd); }
    for (const l of text.split("\n")) {
      if (!l) continue;
      try { putTurn(db, THREADS, JSON.parse(l)); } catch { /* a torn line */ }
    }
    return { at: from };
  } };
}

function jobs(): Job[] {
  const out: Job[] = [];
  const add = (path: string, make: (stat: Stat) => Job) => { const st = statOf(path); if (st) out.push(make(st)); };
  for (const id of names(join("camp", "agents"))) {
    add(join("camp", "agents", id, "memory.md"), (st) => whole(join("camp", "agents", id, "memory.md"), st, (text) => memoryRows(join("camp", "agents", id, "memory.md"), `agent:${id}`, text.replace(/^# .*\n+/, ""))));
    add(join("camp", "agents", id, "sessions", "index.jsonl"), (st) => sessionsJob(join("camp", "agents", id, "sessions", "index.jsonl"), st, id));
  }
  add(join("camp", "about-you.md"), (st) => whole(join("camp", "about-you.md"), st, (text) => memoryRows(join("camp", "about-you.md"), "about", text)));
  for (const id of names(join("camp", "projects"))) {
    const path = join("camp", "projects", id, "notes.md");
    add(path, (st) => whole(path, st, (text) => memoryRows(path, `project:${id}`, text)));
  }
  for (const section of ["facts", "notes"]) for (const f of names(join("camp", "wiki", section))) {
    if (!f.endsWith(".md")) continue;
    const path = join("camp", "wiki", section, f);
    add(path, (st) => whole(path, st, (text) => wikiRows(path, text)));
  }
  add(THREADS, (st) => threadsJob(st));
  return out;
}

function sync(db: DatabaseSync) {
  const known = new Map((db.prepare("SELECT path, stamp, hash, at FROM sources").all() as (Known & { path: string })[]).map((s) => [s.path, s]));
  const all = jobs();
  const seen = new Set(all.map((j) => j.path));
  const changed = all.filter((j) => known.get(j.path)?.stamp !== j.stat.stamp);
  const gone = [...known.keys()].filter((p) => !seen.has(p));
  if (!changed.length && !gone.length) return;
  tx(db, () => {
    const put = db.prepare("INSERT INTO sources(path, stamp, hash, at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET stamp = excluded.stamp, hash = excluded.hash, at = excluded.at");
    for (const j of changed) {
      // (Read again inside the transaction: another camp process may have brought it in step meanwhile.)
      const was = db.prepare("SELECT stamp, hash, at FROM sources WHERE path = ?").get(j.path) as Known | undefined;
      try {
        const now = j.run(db, was);
        put.run(j.path, j.stat.settled ? j.stat.stamp : `${j.stat.stamp}?`, now.hash ?? "", now.at ?? 0);
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err; // gone between the listing and the read: next time drops it
      }
    }
    for (const path of gone) {
      db.prepare("DELETE FROM docs WHERE src = ?").run(path);
      db.prepare("DELETE FROM sources WHERE path = ?").run(path);
    }
  });
}

// Bring the index in step with the files now. True when it's there and in step.
export function syncIndex(): boolean {
  if (!driver()) return false;
  try { withIndex(() => undefined); return true; } catch { return false; }
}

// A camp file that's indexed was just written. The index follows, if there is one already (the
// first search builds it otherwise). A writer must never fail because of the index.
export function noteWritten() {
  try { if (driver() && (open.has(at()) || existsSync(INDEX_PATH))) withIndex(() => undefined); } catch { /* the next search catches up */ }
}

// Throw the index away and build it from the camp's files. How many rows it has afterwards.
export function rebuildIndex(): number {
  if (!driver()) return 0;
  closeIndex();
  removeFiles();
  return withIndex((db) => (db.prepare("SELECT count(*) AS n FROM docs").get() as any).n as number);
}

export function indexStats(): { docs: number; sources: number; byKind: Record<string, number> } | null {
  if (!driver()) return null;
  return withIndex((db) => ({
    docs: (db.prepare("SELECT count(*) AS n FROM docs").get() as any).n,
    sources: (db.prepare("SELECT count(*) AS n FROM sources").get() as any).n,
    byKind: Object.fromEntries((db.prepare("SELECT kind, count(*) AS n FROM docs GROUP BY kind").all() as any[]).map((r) => [r.kind, r.n])),
  }));
}

// ---------- Searching ----------
// What a search may look through. Each part that is given is one more place; none given, nothing.
export type Scope = {
  sessions?: { owner: string; projects: string[] };  // one agent's sessions, recorded in these projects ("" is "none")
  threads?: string[];                                // these conversations' answered runs
  wiki?: boolean;
  memory?: string[];                                 // these places' lines ("agent:scout", "project:abc", "about")
};
function scopeSql(scope: Scope): { sql: string; args: string[] } | null {
  const parts: string[] = [], args: string[] = [];
  if (scope.sessions) { parts.push("(d.kind = 'session' AND d.owner = ? AND d.project IN (SELECT value FROM json_each(?)))"); args.push(scope.sessions.owner, JSON.stringify(scope.sessions.projects)); }
  if (scope.threads?.length) { parts.push("(d.kind = 'turn' AND d.role = 'turn' AND d.key IN (SELECT value FROM json_each(?)))"); args.push(JSON.stringify(scope.threads)); }
  if (scope.wiki) parts.push("d.kind = 'wiki'");
  if (scope.memory?.length) { parts.push("(d.kind = 'memory' AND d.key IN (SELECT value FROM json_each(?)))"); args.push(JSON.stringify(scope.memory)); }
  return parts.length ? { sql: `(${parts.join(" OR ")})`, args } : null;
}

const quoted = (s: string) => `"${s.replace(/"/g, '""')}"`;
const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
// A term for the word index: itself, or a phrase when it has marks inside ("nav.test.tsx" is nav, test, tsx in a row).
const asWords = (term: string) => { const ws = wordsOf(term); return ws.length ? quoted(ws.join(" ")) : ""; };
const COLS = "d.id, d.kind, d.owner, d.project, d.key, d.seq, d.role, d.ref, d.time, d.text, d.extra";
const chars = (s: string) => [...s].length;

// The rows that hold any of the terms, the best first by BM25. Whole words first (by their roots,
// so "tests" finds "test"); then rows where a term is only part of a word (trigrams: "turns" in
// "maxTurns"), which rank after them. The caller decides what counts as a match among these.
export function searchDocs(terms: string[], scope: Scope, limit = 300): Hit[] {
  const where = scopeSql(scope);
  const wanted = [...new Set(terms.map((t) => t.toLowerCase()).filter(Boolean))];
  if (!where || !wanted.length) return [];
  return withIndex((db) => {
    const out = new Map<number, Hit>();
    const words = wanted.map(asWords).filter(Boolean);
    if (words.length) {
      const rows = db.prepare(`SELECT ${COLS}, -bm25(docs_fts) AS rank FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid WHERE docs_fts MATCH ? AND ${where.sql} ORDER BY bm25(docs_fts) LIMIT ?`)
        .all(words.join(" OR "), ...where.args, limit) as unknown as Hit[];
      for (const r of rows) out.set(r.id, { ...r, partial: false });
    }
    const parts = wanted.filter((t) => chars(t) >= 3).map(quoted);
    if (parts.length) {
      const rows = db.prepare(`SELECT ${COLS}, -bm25(docs_tri) AS rank FROM docs_tri JOIN docs d ON d.id = docs_tri.rowid WHERE docs_tri MATCH ? AND ${where.sql} ORDER BY bm25(docs_tri) LIMIT ?`)
        .all(parts.join(" OR "), ...where.args, limit) as unknown as Hit[];
      for (const r of rows) if (!out.has(r.id)) out.set(r.id, { ...r, rank: 0, partial: true });
    }
    // Two characters are too few for a trigram (a short word in a script written without spaces): looked for directly.
    for (const t of wanted.filter((t) => chars(t) < 3)) {
      const rows = db.prepare(`SELECT ${COLS} FROM docs d WHERE d.text LIKE ? ESCAPE '\\' AND ${where.sql} LIMIT ?`).all(`%${t.replace(/[\\%_]/g, "\\$&")}%`, ...where.args, limit) as unknown as Hit[];
      for (const r of rows) if (!out.has(r.id)) out.set(r.id, { ...r, rank: 0, partial: true });
    }
    return [...out.values()];
  });
}

// Every piece of one thing, in order: a session's messages, a conversation's runs, a page's stretches.
export function docsOf(kind: DocKind, key: string): Doc[] {
  return withIndex((db) => db.prepare(`SELECT ${COLS} FROM docs d WHERE d.kind = ? AND d.key = ? ORDER BY d.seq, d.id`).all(kind, key) as unknown as Doc[]);
}

// What a session was asked and what it answered, for each of these sessions of one agent.
export function sessionEnds(owner: string, keys: string[]): Doc[] {
  if (!keys.length) return [];
  return withIndex((db) => db.prepare(`SELECT ${COLS} FROM docs d WHERE d.kind = 'session' AND d.owner = ? AND d.role IN ('asked', 'answered') AND d.key IN (SELECT value FROM json_each(?)) ORDER BY d.key, d.seq`).all(owner, JSON.stringify(keys)) as unknown as Doc[]);
}

// Conversations that mention what was typed: one row per conversation. First the ones that hold
// it exactly as typed, anywhere, even inside a word (so it works while you're still typing), the
// newest first; then runs that hold all of its words in any order (the last one as the start of
// a word), the best first by BM25.
export function searchTurns(query: string, limit = 200): { thread: string; task: string; reply: string; time: string; exact: boolean }[] {
  const q = query.trim().toLowerCase();
  if (chars(q) < 2) return [];
  return withIndex((db) => {
    type Found = { thread: string; text: string; extra: string; time: string };
    const rows: (Found & { exact: boolean })[] = [];
    const exact = (found: unknown) => (found as Found[]).map((r) => ({ ...r, exact: true }));
    const pick = "d.key AS thread, d.text AS text, d.extra AS extra, d.time AS time";
    if (chars(q) >= 3) rows.push(...exact(db.prepare(`SELECT ${pick} FROM docs_tri JOIN docs d ON d.id = docs_tri.rowid WHERE docs_tri MATCH ? AND d.kind = 'turn' ORDER BY d.time DESC, d.id DESC LIMIT ?`).all(quoted(q), limit * 4)));
    else rows.push(...exact(db.prepare(`SELECT ${pick} FROM docs d WHERE d.kind = 'turn' AND d.text LIKE ? ESCAPE '\\' ORDER BY d.time DESC, d.id DESC LIMIT ?`).all(`%${q.replace(/[\\%_]/g, "\\$&")}%`, limit * 4)));
    const words = wordsOf(q);
    if (words.length) {
      const match = words.map((w, n) => quoted(w) + (n === words.length - 1 ? "*" : "")).join(" AND ");
      rows.push(...(db.prepare(`SELECT ${pick} FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid WHERE docs_fts MATCH ? AND d.kind = 'turn' ORDER BY bm25(docs_fts), d.time DESC LIMIT ?`).all(match, limit * 4) as unknown as Found[]).map((r) => ({ ...r, exact: false })));
    }
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.thread) && seen.add(r.thread)).slice(0, limit).map((r) => ({ thread: r.thread, ...turnParts(r), time: r.time, exact: r.exact }));
  });
}
