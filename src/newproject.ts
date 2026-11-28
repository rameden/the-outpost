// A new project, started properly: its own git repository, linked with edit access.
//
// When the crew builds something new in a plain folder (inside the outpost's own folder, say),
// nothing the camp does for linked folders applies there: no folder lock, no worktree per writer
// (questtrees.ts), no automatic checks (verify.ts), no review before the report. So a build from
// scratch starts here instead: a folder of its own outside every outpost, `git init`, a first
// commit (a worktree can only be cut from a repository that has one), and a link with edit access.
//
// Where: <outposts home>/<outpost>-projects/<name> (OUTPOST_PROJECTS_DIR to put them elsewhere).
// Not inside the outpost's folder: a link can't be made there (links.ts), and the crew's file tools
// reach that folder under the camp's own rules anyway. Not inside another outpost's folder either.
//
// Adopting: a folder the crew already made inside the outpost's folder is moved out to that place
// and started the same way. Only a folder the outpost doesn't itself use: not camp/ (except a
// folder in a crew member's own outputs/), skills/ or anything else the outpost keeps, nothing git
// tracks in the outpost's own repository (for Mae, that's the app's own code), and nothing that
// holds a symlink.
//
// Its checks and setup: commands the camp then runs by itself (verify.ts, setup.ts), so they are
// kept only with the user's say-so (agreeCommands below), never on the Quartermaster's alone.

import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ask } from "./ask.js";
import { addLink, cleanCommands, findLink, inside, loadLinks, markCampMade, setLinkSetup, setLinkVerify, type Link } from "./links.js";
import { campGitEnv, SECRETS_OUT } from "./checkpoints.js";
import { isGitTop } from "./questtrees.js";
import { OUTPOST, outpostsHome, outpostSlug } from "./outpost.js";
import { canon } from "./platform.js";
import { autoApproval, shellRule } from "./shell.js";
import { campMode, godOn, sandboxOn } from "./tools.js";
import { w } from "./words.js";
import { CREW } from "./crew.js";

// Where new projects go: beside the outposts, in a folder of this outpost's own.
export const projectsHome = () => process.env.OUTPOST_PROJECTS_DIR || join(outpostsHome(), `${outpostSlug(OUTPOST.name) || "outpost"}-projects`);

// A project's folder name: lowercase letters, digits and dashes ("Holonet HUD" → holonet-hud).
export function projectSlug(raw: unknown): string {
  return String(raw ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

// What an outpost's folder keeps for itself at its top level: never adopted as a project.
const OUTPOST_OWN = new Set(["camp", "skills", "node_modules", ".git", ".claude", "src", "ui", "docs", "tests", "scripts", "evals", "extension", "links"]);

// What a new repository leaves out from the start, so a first commit of an adopted folder doesn't
// take installed packages or secrets with it. Only written when the folder has no .gitignore.
const GITIGNORE = ["node_modules/", ".env", ".env.*", "!.env.example", ".DS_Store", "*.log", ""].join("\n");

type Ran = { ok: boolean; out: string; err: string };
const git = (cwd: string, args: string[]) => new Promise<Ran>((done) => {
  execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 50_000_000, env: campGitEnv() }, (error, stdout, stderr) =>
    done({ ok: !error, out: String(stdout ?? "").trim(), err: String(stderr ?? "").trim() || (error?.message ?? "") }));
});
const must = async (cwd: string, args: string[]) => {
  const r = await git(cwd, args);
  if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.err.split("\n")[0]}`);
  return r.out;
};

export type Started = { link: Link; path: string; state: "new" | "adopted" | "existing"; movedFrom?: string; commit: string };

// A symlink anywhere in the folder (outside node_modules): moving the folder would change where a
// relative one leads, and an absolute one may lead back into the outpost.
function hasSymlink(root: string): string | undefined {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isSymbolicLink()) return p;
      if (e.isDirectory()) stack.push(p);
    }
  }
  return undefined;
}

// Why a folder inside the outpost's folder can't be adopted, or nothing when it can.
async function cantAdopt(from: string, campRoot: string): Promise<string | undefined> {
  if (!existsSync(from)) return `There's no folder at ${from}.`;
  if (lstatSync(from).isSymbolicLink()) return `${from} is a symlink, not a folder that was made here.`;
  if (!statSync(from).isDirectory()) return `${from} is a file, not a folder.`;
  const rel = relative(campRoot, from);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return `${from} isn't inside the outpost's folder (${campRoot}). Only a folder that was made there can be adopted; link a folder elsewhere from Files instead.`;
  const parts = rel.split(sep), top = parts[0];
  // A crew member's outputs are theirs to make things in: a folder there can become a project.
  const output = top === "camp" && parts[1] === "agents" && parts[3] === "outputs" && parts.length >= 5;
  if (!output && (OUTPOST_OWN.has(top) || top.startsWith("."))) return `${top}/ is part of the outpost itself, not a project.`;
  // In an outpost that is itself a repository (Mae is the app's own checkout), what git tracks there is the outpost's.
  const tracked = await git(campRoot, ["ls-files", "-z", "--", rel]);
  if (tracked.ok && tracked.out) return `${rel} holds files of the outpost's own repository, so it isn't moved.`;
  const link = hasSymlink(from);
  if (link) return `${relative(campRoot, link)} is a symlink: a folder with symlinks in it isn't moved. Move it yourself, or take the symlink out.`;
  return undefined;
}

// Moved, not copied, so nothing is left behind to be edited by mistake. (Across disks rename can't: copy, then remove.)
function move(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); return; } catch (e: any) { if (e?.code !== "EXDEV") throw e; }
  cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  rmSync(from, { recursive: true, force: true });
}

// The folder as a repository with a first commit: `git init` when it isn't one, a .gitignore when
// it has none, and everything in it (secrets left out) committed when there's no commit yet.
async function makeRepo(dir: string): Promise<string> {
  if (!existsSync(join(dir, ".git"))) await must(dir, ["init", "-q", "-b", "main"]);
  if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), GITIGNORE);
  if (!(await git(dir, ["rev-parse", "--verify", "-q", "HEAD^{commit}"])).ok) {
    await must(dir, ["add", "-A", "--", ".", ...SECRETS_OUT]);
    await must(dir, ["commit", "-q", "--no-verify", "--no-gpg-sign", "--allow-empty", "-m", `Start of ${basename(dir)} (made by Outpost ${OUTPOST.name})`]);
  }
  return must(dir, ["rev-parse", "HEAD"]);
}

// Start a project (or adopt one the crew already made in the outpost's folder) and link it with edit access.
// name: what to call it (its folder name). from: a folder inside the outpost's folder to adopt.
export async function startProject(opts: { name?: string; from?: string }, campRoot = process.cwd()): Promise<Started> {
  const camp = canon(campRoot);
  const from = opts.from?.trim() ? canon(resolve(camp, opts.from.trim().replace(/^['"]|['"]$/g, "").replace(/^~(?=$|[\\/])/, homedir()))) : undefined;
  const name = projectSlug(opts.name || (from ? basename(from) : ""));
  if (!name) throw new Error("Give the project a name: letters or digits (it becomes the folder's name).");
  const home = canon(resolve(projectsHome()));
  if (inside(home, camp) || inside(camp, home)) throw new Error(`New projects would go in ${home}, which overlaps the outpost's own folder. Set OUTPOST_PROJECTS_DIR to a folder outside it.`);
  const dest = join(home, name);

  // Already started (the same project asked for twice, or a follow-up): it's used as it is.
  const linked = existsSync(dest) ? loadLinks().find((l) => l.path === canon(dest)) : undefined;
  // (A folder adopted already, asked for again by a run picked up after a break: it's gone from where it was.)
  if (linked && from && existsSync(from)) throw new Error(`There's already a project called ${name} (links/${linked.name}, at ${linked.path}). Give the adopted folder another name.`);
  if (linked) {
    if (!(await isGitTop(linked.path))) await makeRepo(linked.path);
    const link = linked.access === "write" ? linked : addLink(linked.path, "write", camp);
    return { link: findLink(link.name) ?? link, path: link.path, state: "existing", commit: await must(link.path, ["rev-parse", "HEAD"]) };
  }
  if (existsSync(dest) && readdirSync(dest).length) {
    throw new Error(`${dest} already exists and isn't one of the outpost's linked folders. Pick another name, or link that folder from Files if it's the one you mean.`);
  }

  let state: Started["state"] = "new";
  if (from) {
    const why = await cantAdopt(from, camp);
    if (why) throw new Error(why);
    if (existsSync(dest)) rmSync(dest, { recursive: true }); // (empty: checked above)
    move(from, dest);
    state = "adopted";
  } else {
    mkdirSync(dest, { recursive: true });
  }
  const commit = await makeRepo(dest);
  const link = addLink(dest, "write", camp);
  markCampMade(link.name);
  return { link: findLink(link.name) ?? link, path: link.path, state, ...(from ? { movedFrom: from } : {}), commit };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// A project's checks and setup, as the Quartermaster proposed them, kept only with the user's say-so.
// They're commands the camp runs by itself from then on (checks after each change, setup in each new
// worktree and outside the sandbox), and the crew can edit the code they run, so this is the same
// say-so a shell command needs (bashFor in tools.ts):
// - a command your rules deny is refused, and one they say to ask about is always asked about;
// - otherwise no ask where you've already said such commands run as they are: god mode with you
//   here, or every command on your allow list. (Sandbox mode still asks: a kept check would go on
//   running by itself if you later chose a stricter level, where nothing would hold it in.)
// - with nobody here to ask (a scheduled job), nothing new is kept;
// - else you're asked once, about all of them together.
// The same commands asked for again, already kept, aren't asked about again.
// Returns what the Quartermaster is told about it ("" when no commands were given).
export async function agreeCommands(link: Link, want: { checks?: unknown[]; setup?: unknown[] }): Promise<string> {
  const same = (a: string[], b: string[] = []) => a.length === b.length && a.every((c, i) => c === b[i]);
  const all = [
    { field: "verify" as const, label: "checks", list: cleanCommands(want.checks ?? []) },
    { field: "setup" as const, label: "setup", list: cleanCommands(want.setup ?? []) },
  ].filter((x) => x.list.length);
  if (!all.length) return "";
  const lines: string[] = [];
  const asked = all.filter((x) => {
    if (same(x.list, link[x.field])) { lines.push(`${cap(x.label)}: already set to these, so nothing changed.`); return false; }
    const denied = x.list.map((c) => [c, shellRule(c)] as const).find(([, r]) => r?.verdict === "deny");
    if (denied) { lines.push(`${cap(x.label)}: not set, because the user's rules don't allow \`${denied[0]}\` ("${denied[1]!.rule}"). Don't try another form of it.`); return false; }
    return true;
  });
  if (!asked.length) return lines.join("\n");
  const labels = cap(asked.map((x) => x.label).join(" and "));
  if (campMode.unattended) {
    lines.push(`${labels}: not set, because nobody is here to agree to commands the ${w("camp")} would run by itself. Say in your summary which you'd suggest, so the user can add them on the project's page.`);
    return lines.join("\n");
  }
  const unasked = (x: (typeof asked)[number]) => x.list.every((c) => !shellRule(c)) &&
    (godOn() || x.list.every((c) => autoApproval(c) === "yours"));
  if (!asked.every(unasked)) {
    const body = [`links/${link.name}/ (${link.path})`, ...asked.map((x) => (x.field === "verify"
      ? `\nChecks: run after each change there${sandboxOn() ? ", inside the sandbox" : ""}:`
      : `\nSetup: run in each new worktree made there, before anyone works in it, outside the sandbox (installs need the network):`) +
      x.list.map((c) => `\n  ${c}${shellRule(c) ? `  (your rule "${shellRule(c)!.rule}" says to ask about this)` : ""}`).join("")),
      `\nFrom now on the ${w("camp")} runs these by itself, without asking you each time. You can change them on the project's page.`].join("\n");
    const ok = (await ask({ kind: "shell", title: `📁 The ${CREW.quartermaster.name} wants commands for the new project that the ${w("camp")} will run by itself:`, body })).toLowerCase();
    if (!["y", "yes", "a", "always"].includes(ok)) {
      lines.push(`${labels}: not set, because the user declined them. Say so in your summary; they can add them on the project's page.`);
      return lines.join("\n");
    }
  }
  for (const x of asked) (x.field === "verify" ? setLinkVerify : setLinkSetup)(link.name, x.list);
  lines.push(`${labels}: set, with the user's say-so.`);
  return lines.join("\n");
}
