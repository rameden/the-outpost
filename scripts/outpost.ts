// Outposts: make, list and start them (src/outpost.ts says what an outpost is).
//
//   npm run outpost                      list them: Mae (this checkout) and those in ~/Outposts
//   npm run outpost -- new Work          make one, on the next free port (--port 4800 to choose;
//                                        --about "what it's for" to describe it for the crew)
//   npm run outpost -- start Work        run it, serving the last build of the page (like ui:serve)
//   npm run outpost -- start Work --dev  run it with the page reloading as you edit (like npm run ui)
//   npm run outpost -- where Work        name, slug, port, folder and mae|other, tab-separated
//                                        (for scripts/relay/relay.sh and scripts/tailscale.sh)
//
// `npm start` (scripts/launch.ts) is the same from a page: a star chart of them all, where
// you pick the one to enter.
//
// Each outpost keeps its own camp/ (crew, memory, settings, keys, jobs), its own skills/ and its
// own .env, so connect its models and accounts from its own Settings. The crew's built-in skills
// come from this checkout and are brought up to date in each outpost as it starts; skills an
// outpost learns or installs stay in that outpost.

import { spawn, spawnSync, type ChildProcess, type StdioOptions } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_NAME, OUTPOST_FILE, cleanDescription, cleanName, outpostSlug, outpostsHome, readOutpost, type Outpost } from "../src/outpost.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type Place = Outpost & { dir: string };

// Mae first (this checkout), then the rest by name.
export function outposts(home = outpostsHome()): Place[] {
  const others = existsSync(home)
    ? readdirSync(home, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(home, d.name, OUTPOST_FILE)))
      .map((d) => ({ ...readOutpost(join(home, d.name)), dir: join(home, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return [{ ...readOutpost(ROOT), dir: ROOT }, ...others];
}

export const find = (name: string) => {
  const want = cleanName(name).toLowerCase();
  // By its name, or by its folder's (a renamed outpost keeps the folder it was made with).
  return outposts().find((o) => o.name.toLowerCase() === want || outpostSlug(o.name) === outpostSlug(name) || (o.dir !== ROOT && basename(o.dir) === outpostSlug(name)));
};

export const listening = (port: number) => new Promise<boolean>((done) => {
  const s = createConnection({ host: "127.0.0.1", port });
  s.setTimeout(400);
  s.once("connect", () => { s.destroy(); done(true); });
  s.once("error", () => done(false));
  s.once("timeout", () => { s.destroy(); done(false); });
});

// The crew's built-in skills (the ones this checkout tracks), copied over the outpost's own copies.
// Without git, the first copy is the whole folder, and nothing is overwritten after.
function syncSkills(dir: string) {
  if (dir === ROOT) return;
  const tracked = spawnSync("git", ["-C", ROOT, "ls-files", "skills"], { encoding: "utf8" });
  if (tracked.status !== 0) return void cpSync(join(ROOT, "skills"), join(dir, "skills"), { recursive: true, force: false });
  for (const rel of tracked.stdout.split("\n").filter(Boolean)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(dir, rel));
  }
}

export function create(rawName: string, port?: number, rawDescription?: string): Place {
  const name = cleanName(rawName);
  const slug = outpostSlug(name);
  if (!name || !slug) throw new Error("Give the outpost a name with a letter or digit in it: npm run outpost -- new Work");
  if (find(name)) throw new Error(`There's already an outpost called ${find(name)!.name}.`);
  const dir = join(outpostsHome(), slug);
  if (existsSync(dir)) throw new Error(`${dir} is already there. Pick another name, or move it.`);
  const taken = new Set(outposts().map((o) => o.port));
  if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error("--port takes a number from 1024 to 65535.");
  if (port !== undefined && taken.has(port)) throw new Error(`Port ${port} is another outpost's.`);
  let p = port ?? Math.max(...taken) + 1;
  while (taken.has(p)) p++;
  mkdirSync(join(dir, "camp"), { recursive: true });
  const description = cleanDescription(rawDescription);
  writeFileSync(join(dir, OUTPOST_FILE), JSON.stringify({ name, port: p, ...(description ? { description } : {}) }, null, 2) + "\n");
  syncSkills(dir);
  return { name, port: p, ...(description ? { description } : {}), dir };
}

// Bring the page's build up to date (when it's stale), as `npm run ui:serve` does before it serves.
export function buildPage(): number {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), join(ROOT, "scripts", "ui-build.ts"), "--if-stale"], { cwd: ROOT, stdio: "inherit" }).status ?? 1;
}

// The outpost's own server, running in its own folder: the camp alone, or (dev) with Vite in front.
// `more`: anything else to tell it (the star chart says where it is, so the outpost can link back).
export function spawnOutpost(o: Place, dev: boolean, stdio: StdioOptions = "inherit", more: Record<string, string> = {}): ChildProcess {
  syncSkills(o.dir);
  const tsx = import.meta.resolve("tsx");
  const env = pathToFileURL(join(ROOT, "scripts", "env.mjs")).href; // loads the outpost's own .env
  // Each outpost's dev page gets its own port too, so two can be open at once.
  const vars = { ...process.env, ...more, CAMP_PORT: String(o.port), ...(dev && !process.env.CAMP_UI_PORT ? { CAMP_UI_PORT: String(5173 + o.port - 4747) } : {}) };
  const entry = dev ? join(ROOT, "scripts", "ui-dev.ts") : join(ROOT, "src", "server.ts");
  return spawn(process.execPath, ["--import", env, "--import", tsx, entry], { cwd: o.dir, env: vars, stdio });
}

async function start(o: Place, dev: boolean) {
  if (await listening(o.port)) throw new Error(`Something is already on port ${o.port}: is Outpost ${o.name} running?`);
  if (!dev) { const built = buildPage(); if (built !== 0) process.exit(built); }
  const child = spawnOutpost(o, dev);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function list() {
  const all = outposts();
  const up = await Promise.all(all.map((o) => listening(o.port)));
  const width = Math.max(...all.map((o) => o.name.length));
  console.log("Outposts:\n");
  all.forEach((o, i) => console.log(`  ${up[i] ? "●" : "○"} ${o.name.padEnd(width)}  :${o.port}  ${o.dir === ROOT ? `${o.dir} (this checkout)` : o.dir}`));
  console.log(`\n● running  ○ stopped. Start one with: npm run outpost -- start <name>`);
}

async function main(args: string[]) {
  const [cmd = "list", ...rest] = args;
  const flag = (f: string) => rest.indexOf(f);
  const words = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--port" && rest[i - 1] !== "--about");
  if (cmd === "list") return list();
  if (cmd === "new") {
    const at = flag("--port");
    const about = flag("--about");
    const o = create(words.join(" "), at >= 0 ? Number(rest[at + 1]) : undefined, about >= 0 ? rest[about + 1] : undefined);
    console.log(`Made Outpost ${o.name}, at ${o.dir}, on port ${o.port}.`);
    console.log(`It starts empty: its own crew, memory and settings. Start it with: npm run outpost -- start ${o.name.includes(" ") ? `"${o.name}"` : o.name}`);
    return;
  }
  if (cmd === "where") {
    const name = words.join(" ") || DEFAULT_NAME;
    const o = find(name);
    if (!o) throw new Error(`No outpost called ${name}. These are: ${outposts().map((x) => x.name).join(", ")}.`);
    return void process.stdout.write([o.name, outpostSlug(o.name), o.port, o.dir, o.dir === ROOT ? "mae" : "other"].join("\t") + "\n");
  }
  if (cmd === "start") {
    const name = words.join(" ") || DEFAULT_NAME;
    const o = find(name);
    if (!o) throw new Error(`No outpost called ${name}. These are: ${outposts().map((x) => x.name).join(", ")}.`);
    return start(o, rest.includes("--dev"));
  }
  throw new Error(`Unknown: ${cmd}. Try list, new <name>, start <name> [--dev] or where <name>.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
