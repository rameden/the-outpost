// The Files flyout: your own view of a linked folder (or one of its git worktrees) from the page.
// Folders are listed one level at a time as you open them, and a file can be previewed.
//
// It reads only inside folders you linked:
//  - The folder is named by its link, never by a path from the page. A worktree is accepted only
//    if git says it belongs to that linked repository.
//  - Paths can't climb out, and a symlink that leads outside is shown but not followed.
//  - Git's own data (.git) is left out, and secrets (.env, keys, credentials) are listed but
//    never read, the same files that are off limits to the crew.

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { imageType } from "./attachments.js";
import { findLink, inside, SECRET_NAME } from "./links.js";
import { listWorktrees } from "./repos.js";

// secret: listed, but not opened. outside: a symlink that leads out of the folder.
export type TreeEntry = { name: string; dir: boolean; size?: number; secret?: true; outside?: true };
// changed: files git reports as changed, by path from the top of the folder ("M" modified,
// "A" added, "D" deleted, "U" untracked). A path ending in / is a whole untracked folder.
export type Listing = { root: string; entries: TreeEntry[]; more?: number; changed?: Record<string, string> };
export type FilePreview = { path: string; abs: string; size: number } & ({ text: string } | { image: true } | { binary: true } | { tooLarge: true });

const MAX_ENTRIES = 1500;           // per folder; the rest is counted, not listed
const MAX_PREVIEW = 512 * 1024;     // text shown in the page
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_CHANGED = 3000;
const HIDDEN = new Set([".git", ".DS_Store"]);

// The real folder behind a link, or behind one of that repository's worktrees.
export async function explorerRoot(linkName: string, worktree?: string): Promise<string> {
  const link = findLink(linkName);
  if (!link) throw new Error(`No linked folder named "${linkName}".`);
  if (!existsSync(link.path)) throw new Error(`${link.path} isn't there any more.`);
  if (!worktree || resolve(worktree) === resolve(link.path)) return link.path;
  const hit = (await listWorktrees(link.path)).find((w) => resolve(w.path) === resolve(worktree));
  if (!hit) throw new Error(`That isn't a worktree of links/${link.name}.`);
  return hit.path;
}

// What the camp itself keeps for you to read, opened in the same viewer: a crew member's outputs,
// the wiki, and what you uploaded. The page names it "@camp" (no linked folder can be called
// that) and a path under camp/. Nothing else in camp/ is opened this way: not its settings, its
// connectors, its Jira token, or anyone's memory. The path is tidied before it's checked, so
// "outputs/../../settings.json" is judged as what it is.
export const CAMP_FILES = "@camp";
const CAMP_READABLE = /^(agents\/[A-Za-z0-9_-]+\/outputs|wiki|uploads)\/./;
export function campFile(rel: string, campRoot = process.cwd()): { root: string; path: string } {
  const path = posix.normalize(String(rel).replace(/\\/g, "/")).replace(/^\.\//, "");
  if (!CAMP_READABLE.test(path)) throw new Error("Only the crew's outputs, the wiki and your uploads are opened from the camp folder.");
  return { root: resolve(campRoot, "camp"), path };
}

// A path inside the folder, checked: it stays inside (symlinks included) and isn't git's own data.
function locate(root: string, rel: string): { abs: string; parts: string[] } {
  const abs = resolve(root, rel || ".");
  if (!inside(abs, root)) throw new Error("That path leaves the folder.");
  const parts = relative(root, abs).split(sep).filter(Boolean);
  if (parts.includes(".git")) throw new Error("Git's own data isn't shown here.");
  if (!existsSync(abs)) throw new Error("That's no longer there.");
  if (!inside(realpathSync(abs), realpathSync(root))) throw new Error("That points outside the folder.");
  return { abs, parts };
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// One folder's contents: folders first, then files, by name.
export function listFolder(root: string, rel = ""): Listing {
  const { abs, parts } = locate(root, rel);
  if (parts.some((p) => SECRET_NAME.test(p))) throw new Error("That folder holds secrets (keys, credentials) and isn't shown here.");
  if (!statSync(abs).isDirectory()) throw new Error("That's a file, not a folder.");
  const realRoot = realpathSync(root);
  const entries: TreeEntry[] = [];
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (HIDDEN.has(e.name)) continue;
    const path = join(abs, e.name);
    const entry: TreeEntry = { name: e.name, dir: e.isDirectory() };
    try {
      if (e.isSymbolicLink()) {
        if (!inside(realpathSync(path), realRoot)) entry.outside = true;
        else entry.dir = statSync(path).isDirectory();
      }
      if (!entry.dir && !entry.outside) entry.size = statSync(path).size;
    } catch { entry.outside = true; } // a broken symlink, or something that vanished meanwhile
    if (SECRET_NAME.test(e.name)) entry.secret = true;
    entries.push(entry);
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || byName.compare(a.name, b.name));
  const more = entries.length - MAX_ENTRIES;
  return { root, entries: more > 0 ? entries.slice(0, MAX_ENTRIES) : entries, ...(more > 0 ? { more } : {}) };
}

function checkedFile(root: string, rel: string) {
  const { abs, parts } = locate(root, rel);
  if (parts.some((p) => SECRET_NAME.test(p))) throw new Error("That looks like a secret (keys, .env, credentials), so it isn't opened here.");
  const st = statSync(abs);
  if (!st.isFile()) throw new Error("That isn't a file.");
  return { abs, size: st.size, path: parts.join("/") };
}

// A file, for the page to show: its text, or what it is when it can't be shown as text.
export function previewFile(root: string, rel: string): FilePreview {
  const { abs, size, path } = checkedFile(root, rel);
  const about = { path, abs, size };
  if (imageType(abs)) return { ...about, image: true };
  if (size > MAX_PREVIEW) return { ...about, tooLarge: true };
  const buf = readFileSync(abs);
  return buf.includes(0) ? { ...about, binary: true } : { ...about, text: buf.toString("utf8") };
}

// An image's own bytes (the preview's <img> fetches these).
export function imageFile(root: string, rel: string): { media: string; bytes: Buffer } {
  const { abs, size } = checkedFile(root, rel);
  const media = imageType(abs);
  if (!media) throw new Error("That isn't an image.");
  if (size > MAX_IMAGE) throw new Error("That image is too large to show here.");
  return { media, bytes: readFileSync(abs) };
}

const run = (cwd: string, args: string[]) => new Promise<string>((done) => {
  execFile("git", args, { cwd, timeout: 8000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
    (err, stdout) => done(err ? "" : String(stdout)));
});

// Files under the folder whose path matches what was typed, best first. Git's own list is used
// where there is one (quick, and it leaves out what .gitignore leaves out); otherwise the folder
// is walked. Secrets and git's own data never come back.
const MAX_FOUND = 40;
const MAX_WALK = 20_000;
export async function findFiles(root: string, query: string): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  let all = (await run(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."])).split("\0").filter(Boolean);
  if (!all.length) {
    const stack = [""];
    while (stack.length && all.length < MAX_WALK) {
      const dir = stack.pop()!;
      let entries;
      try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (HIDDEN.has(e.name) || e.name === "node_modules") continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) stack.push(rel); else if (e.isFile()) all.push(rel);
      }
    }
  }
  const words = q.split(/\s+/);
  const hits: { path: string; score: number }[] = [];
  for (const path of all) {
    const low = path.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    if (path.split("/").some((seg) => SECRET_NAME.test(seg) || seg === ".git")) continue;
    const name = low.slice(low.lastIndexOf("/") + 1);
    // The name itself matching beats a folder matching; a name that starts with it beats that; shorter paths first.
    const score = (name === q ? 0 : name.startsWith(words[0]) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3) * 1000 + path.length;
    hits.push({ path, score });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, MAX_FOUND).map((h) => h.path);
}

// What has changed in one file since the last commit, as a unified diff ("" when nothing has,
// or the folder isn't a repository). A file git doesn't know yet is all additions.
const MAX_DIFF = 400_000;
export async function fileDiff(root: string, rel: string): Promise<{ diff: string; untracked: boolean }> {
  const { path } = checkedFile(root, rel);
  const status = await run(root, ["status", "--porcelain=v1", "--", path]);
  if (status.startsWith("??")) {
    const { abs, size } = checkedFile(root, rel);
    if (size > MAX_DIFF) return { diff: "", untracked: true };
    const lines = readFileSync(abs, "utf8").replace(/\n$/, "").split("\n");
    return { diff: `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`, untracked: true };
  }
  const diff = await run(root, ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", path]);
  return { diff: diff.length > MAX_DIFF ? "" : diff, untracked: false };
}

// What git reports as changed under the folder, or nothing when it isn't a repository.
export async function changedFiles(root: string): Promise<Record<string, string>> {
  const out = await run(root, ["status", "--porcelain=v1", "-z", "--", "."]);
  if (!out) return {};
  // Git names paths from the top of the repository; the folder may sit below it.
  const prefix = (await run(root, ["rev-parse", "--show-prefix"])).trim();
  const changed: Record<string, string> = {};
  const fields = out.split("\0");
  for (let i = 0, n = 0; i < fields.length && n < MAX_CHANGED; i++) {
    const f = fields[i];
    if (f.length < 4) continue;
    const xy = f.slice(0, 2);
    if (/[RC]/.test(xy)) i++; // a rename or copy is followed by the name it came from
    const path = f.slice(3);
    if (prefix && !path.startsWith(prefix)) continue;
    changed[path.slice(prefix.length)] = xy === "??" ? "U" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M";
    n++;
  }
  return changed;
}
