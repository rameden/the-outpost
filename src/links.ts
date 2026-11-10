// Linked folders: let the crew read (or, if you allow it, edit) a folder where it lives on your
// disk, without uploading it. Agents see each link as links/<name>/… and use the usual file tools.
// Links are stored in camp/links.json (local to you).
//
// Safety:
//  - System and credential folders can't be linked (/, your home folder itself, ~/.ssh, ~/Library…).
//  - Read-only unless linked with "write" access.
//  - Inside a link, secret files (.env*, private keys, .netrc…) stay off limits, and symlinks
//    can't lead outside the linked folder.
//  - If a link contains this camp, paths into the camp still follow the camp's own rules
//    (so a link can't be used to read .env or another agent's memory).

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

export const LINKS_PATH = "camp/links.json";
export type LinkAccess = "read" | "write";
export type Link = { name: string; path: string; access: LinkAccess; added: string; files?: number };

const HOME = homedir();
// Never linkable: the whole disk, your whole home folder, system folders, and credential stores.
const FORBIDDEN_EXACT = ["/", HOME, "/Users", "/home", "/Volumes"];
const FORBIDDEN_UNDER = [
  "/etc", "/private/etc", "/var/db", "/private/var/db", "/var/root", "/private/var/root", "/var/log", "/private/var/log",
  "/System", "/Library", "/usr", "/bin", "/sbin", "/dev", "/proc", "/opt/homebrew/etc",
  join(HOME, ".ssh"), join(HOME, ".aws"), join(HOME, ".gnupg"), join(HOME, ".config"), join(HOME, ".kube"),
  join(HOME, ".docker"), join(HOME, "Library"), join(HOME, ".claude"), join(HOME, ".hermes"),
];
// File and folder names that stay off limits inside a link.
export const SECRET_NAME = /^(\.env.*|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|id_ecdsa.*|\.netrc|\.npmrc|\.pypirc|\.git-credentials|credentials(\.json)?|.*\.p12|.*\.pfx|\.ssh|\.aws|\.gnupg)$/i;

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
};

export function loadLinks(): Link[] {
  if (!existsSync(LINKS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LINKS_PATH, "utf8")) as Link[];
  } catch {
    return [];
  }
}

function saveLinks(links: Link[]) {
  mkdirSync(dirname(LINKS_PATH), { recursive: true });
  writeFileSync(LINKS_PATH, JSON.stringify(links, null, 2) + "\n");
}

export const findLink = (name: string) => loadLinks().find((l) => l.name === name);

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "folder";
}

// Count files (skipping the usual heavy folders), stopping early on huge trees.
export function countFiles(root: string, cap = 50_000): number {
  let n = 0;
  const stack = [root];
  while (stack.length && n < cap) {
    const d = stack.pop()!;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      if (e.isDirectory()) stack.push(join(d, e.name));
      else if (e.isFile()) n++;
    }
  }
  return n;
}

// Link a folder. Returns the link (an existing one for the same folder is reused and updated).
export function addLink(rawPath: string, access: LinkAccess = "read", campRoot = process.cwd()): Link {
  const expanded = rawPath.trim().replace(/^['"]|['"]$/g, "").replace(/^~(?=$|\/)/, HOME);
  if (!isAbsolute(expanded)) throw new Error("Use the folder's full path, e.g. /Users/you/Projects/site (in Finder: right-click, hold Option, Copy as Pathname).");
  if (!existsSync(expanded)) throw new Error(`There's no folder at ${expanded}.`);
  const real = realpathSync(expanded);
  if (!statSync(real).isDirectory()) throw new Error(`${expanded} is a file, not a folder. Attach files with Files… instead.`);
  if (FORBIDDEN_EXACT.includes(real) || FORBIDDEN_UNDER.some((f) => inside(real, f))) {
    throw new Error(`For safety, ${real} can't be linked (system, home, or credential folder). Link a specific project folder instead.`);
  }
  if (inside(real, realpathSync(campRoot))) throw new Error("That folder is already inside the camp; reference it with @path instead.");

  const links = loadLinks();
  const existing = links.find((l) => l.path === real);
  const files = countFiles(real);
  if (existing) {
    existing.access = access;
    existing.files = files;
    saveLinks(links);
    return existing;
  }
  let name = slug(basename(real));
  for (let i = 2; links.some((l) => l.name === name); i++) name = `${slug(basename(real))}-${i}`;
  const link: Link = { name, path: real, access, added: new Date().toISOString(), files };
  saveLinks([...links, link]);
  return link;
}

export function removeLink(name: string): boolean {
  const links = loadLinks();
  if (!links.some((l) => l.name === name)) return false;
  saveLinks(links.filter((l) => l.name !== name));
  return true;
}

// Map links/<name>/… (or an absolute path inside a linked folder) to a real path, enforcing the
// rules above. Returns undefined when the path isn't about a link at all.
export function resolveLinked(path: string, mode: "read" | "write"): string | undefined {
  const parts = path.replace(/^\.\//, "").split(/[\\/]+/);
  let link: Link | undefined;
  let abs: string;
  if (parts[0] === "links" && parts.length >= 1 && !isAbsolute(path)) {
    if (!parts[1]) throw new Error(`Linked folders: ${loadLinks().map((l) => `links/${l.name}`).join(", ") || "none yet"}.`);
    link = findLink(parts[1]);
    if (!link) throw new Error(`No linked folder named "${parts[1]}". Linked: ${loadLinks().map((l) => l.name).join(", ") || "none"}.`);
    abs = resolve(link.path, ...parts.slice(2));
  } else if (isAbsolute(path)) {
    link = loadLinks().find((l) => inside(resolve(path), l.path));
    if (!link) return undefined;
    abs = resolve(path);
  } else {
    return undefined;
  }
  if (!inside(abs, link.path)) throw new Error(`That path leaves links/${link.name}.`);
  const within = relative(link.path, abs).split(sep).filter(Boolean);
  if (within.some((seg) => SECRET_NAME.test(seg))) throw new Error(`${path} looks like a secret (keys, .env, credentials) and is off limits.`);
  // Symlinks can't lead out of the linked folder.
  let probe = abs;
  while (!existsSync(probe) && probe !== link.path) probe = dirname(probe);
  if (!inside(realpathSync(probe), realpathSync(link.path))) throw new Error(`${path} points outside links/${link.name}.`);
  if (mode === "write" && link.access !== "write") throw new Error(`links/${link.name} is linked read-only. Re-link it with edit access to change files there.`);
  return abs;
}

// How agents and the dashboard should see a real path: links/<name>/… for linked folders.
export function linkedDisplayPath(abs: string): string | undefined {
  const link = loadLinks().find((l) => inside(abs, l.path));
  if (!link) return undefined;
  const rest = relative(link.path, abs).split(sep).join("/");
  return rest ? `links/${link.name}/${rest}` : `links/${link.name}`;
}

// For prompts: what's linked, so agents know where to look.
export function linksBlock(): string {
  const links = loadLinks();
  if (!links.length) return "";
  return (
    "## Linked folders (on the user's disk; browse with list_dir, glob, grep, read_file)\n" +
    links.map((l) => `- links/${l.name}/ (${l.access === "write" ? "you may edit files here" : "read-only"}${l.files != null ? `, ~${l.files} files` : ""})`).join("\n")
  );
}
