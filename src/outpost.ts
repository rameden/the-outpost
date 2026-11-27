// Outposts: the app is Outpost, and each camp it runs is an outpost with a name of its own, so
// work and home can each have one that knows nothing of the other.
//
// An outpost is a folder the camp server runs in. Everything of the camp is already kept relative
// to the folder it runs in (camp/ for the crew, memory, settings, keys, jobs and records; skills/;
// .env), while the code and the built page are found from where the code lives. So one checkout
// can run any number of outposts, one server each, each on its own port, and none can read
// another's records: they don't share a folder, a process, a key or a scheduler.
//
// The first outpost is Mae: this checkout itself, with the camp/ it has always had. The others
// live under ~/Outposts/<name>/ (OUTPOSTS_DIR to put them elsewhere), outside the checkout, so
// Mae's crew, whose file tools reach the checkout, never sees inside them.
// `npm run outpost` makes, lists and starts them (scripts/outpost.ts).
//
// What an outpost says about itself is in its camp/outpost.json: { "name": "Work", "port": 4748 },
// and, when it's been given one, a "description": what the outpost is for, in a sentence or three
// ("Work: the payments team at Acme; Jira project PAY"). The crew reads it in every prompt and the
// star chart shows it on the outpost's card. What's true of one project goes in that project.
// With no file it's Mae on 4747, so the checkout as it is needs nothing new.

import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./atomic.js";
import { homedir } from "node:os";
import { join } from "node:path";

export const OUTPOST_FILE = join("camp", "outpost.json");
export const DEFAULT_NAME = "Mae";
export const DEFAULT_PORT = 4747;

export const DESCRIPTION_MAX = 400;

export type Outpost = { name: string; port: number; description?: string };

// What the outpost is for, as kept: one paragraph (line breaks and runs of spaces become one
// space), no control characters, at most DESCRIPTION_MAX characters. Empty means none.
export function cleanDescription(raw: unknown): string {
  return String(raw ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX).trim();
}

// A name as the header shows it: "Outpost <name>". Letters, digits, spaces and - ' . only, at
// most 24 characters, so it reads as one word or two and is safe in a title.
export function cleanName(raw: unknown): string {
  return String(raw ?? "").replace(/[^\p{L}\p{N} '.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24).trim();
}

// The outpost's folder name under ~/Outposts: "Home lab" → "home-lab".
export function outpostSlug(name: string): string {
  return cleanName(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// The outpost running in this folder (the server's working folder, unless asked about another).
export function readOutpost(dir = process.cwd()): Outpost {
  let raw: { name?: unknown; port?: unknown; description?: unknown } = {};
  const file = join(dir, OUTPOST_FILE);
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, "utf8")) ?? {}; }
    catch (e) { console.error(`${OUTPOST_FILE}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const port = Number(raw.port);
  const description = cleanDescription(raw.description);
  return { name: cleanName(raw.name) || DEFAULT_NAME, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT, ...(description ? { description } : {}) };
}

// This server's outpost, read as it starts. Renaming it (Settings, General) changes it in place, so
// whatever reads OUTPOST.name when it needs it has the new name at once.
export const OUTPOST: Outpost = readOutpost();

// Give the outpost in this folder a new name: kept in its camp/outpost.json (with the port it has),
// and this server's OUTPOST takes it. The folder isn't moved, so `npm run outpost -- start` finds
// it by its folder name as well as by its new name.
export function renameOutpost(raw: unknown, dir = process.cwd(), now: Outpost = OUTPOST): Outpost {
  const name = cleanName(raw);
  if (!name || !outpostSlug(name)) throw new Error("Give the outpost a name with a letter or digit in it (24 characters at most).");
  const file = join(dir, OUTPOST_FILE);
  let kept: Record<string, unknown> = {};
  if (existsSync(file)) {
    try { kept = JSON.parse(readFileSync(file, "utf8")) ?? {}; } catch { kept = {}; }
  }
  writeJsonAtomic(file, { ...kept, name, port: readOutpost(dir).port });
  now.name = name;
  return now;
}

// Say what the outpost in this folder is for (empty takes the description away). Kept in its
// camp/outpost.json beside the name and port it has; this server's OUTPOST takes it at once.
export function describeOutpost(raw: unknown, dir = process.cwd(), now: Outpost = OUTPOST): Outpost {
  const description = cleanDescription(raw);
  const file = join(dir, OUTPOST_FILE);
  let kept: Record<string, unknown> = {};
  if (existsSync(file)) {
    try { kept = JSON.parse(readFileSync(file, "utf8")) ?? {}; } catch { kept = {}; }
  }
  const { description: _was, ...rest } = kept;
  const here = readOutpost(dir);
  writeJsonAtomic(file, { ...rest, name: here.name, port: here.port, ...(description ? { description } : {}) });
  if (description) now.description = description; else delete now.description;
  return now;
}

// For every crew member's prompt: which outpost this is and what it's for. Empty when it hasn't
// been described, since the name alone tells the crew nothing it can use.
export function outpostBlock(o: Outpost = OUTPOST): string {
  return o.description ? `## This outpost\nYou're working in Outpost ${o.name}. What it's for, in the user's words: ${o.description}` : "";
}

// Where outposts other than Mae live.
export const outpostsHome = () => process.env.OUTPOSTS_DIR || join(homedir(), "Outposts");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The page with this outpost's name in it: the title, and the <meta name="outpost"> the page reads
// its name from before it has signed in (ui/src/outpost.ts). The page as built says Mae.
export function withOutpost(html: string, name = OUTPOST.name): string {
  const n = escapeHtml(cleanName(name) || DEFAULT_NAME);
  return html
    .replace(/<meta name="outpost" content="[^"]*">/, `<meta name="outpost" content="${n}">`)
    .replace(/<title>Outpost(?: [^<]*)?<\/title>/, `<title>Outpost ${n}</title>`); // the public page is just "Outpost"
}
