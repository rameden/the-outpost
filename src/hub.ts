// The star chart (`npm start`, scripts/launch.ts): one page that shows every outpost on this
// machine and starts the one you pick. These are the parts of it that decide things without
// running anything: what the chart may say about an outpost, which requests it answers, and how
// it reads an outpost's sign-in link out of what that outpost prints.
//
// The chart is a launcher, not a way in. It never holds an outpost's key: it starts the outpost's
// own server and passes on the one-time sign-in link that server prints (src/server.ts, "Signing
// in"), exactly as you'd have copied it from the terminal.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN } from "./builtin.js";
import { OUTPOST_FILE } from "./outpost.js";

export const HUB_PORT = 4700;

// The chart answers only to its own address on this machine: a page elsewhere that has the
// browser look up a name pointing at 127.0.0.1 arrives with that name as its Host.
export function hubHostOk(host: string | undefined, port: number): boolean {
  const h = (host ?? "").toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

// An outpost the chart starts is told where the chart is (CAMP_CHART), so its header can offer the
// way back. Only the chart's own shape of address is taken: this machine, a port, nothing after.
export function chartAddress(said: string | undefined): string | null {
  const m = (said ?? "").match(/^http:\/\/(?:127\.0\.0\.1|localhost):(\d{4,5})\/$/);
  return m && Number(m[1]) >= 1024 && Number(m[1]) <= 65535 ? m[0] : null;
}

// The sign-in link in a line an outpost printed ("…is up: http://localhost:4748/#k=…"), if any.
export function signInLinkIn(line: string): string | null {
  return line.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\/#k=[0-9a-f]+/)?.[0] ?? null;
}

export type OutpostFacts = { crew: number | null; lastActive: number | null; since: number | null };

const mtime = (file: string) => { try { return statSync(file).mtimeMs; } catch { return null; } };

// What the chart says about an outpost before you enter it: how many are in its crew, when it
// last did anything, and when it was made. Counts and dates only, never what its records say.
// The crew is the six built in (src/builtin.ts) plus the ones you added, which are all that
// camp/crew.json holds; an entry there with a built-in's handle goes on as that one (crew.ts).
export function outpostFacts(dir: string): OutpostFacts {
  let crew: number | null = null;
  const file = join(dir, "camp", "crew.json");
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(j?.crew)) {
        const added = new Set(j.crew.map((m: { id?: unknown }) => String(m?.id ?? "")).filter((id: string) => id && !(BUILT_IN as readonly string[]).includes(id)));
        crew = BUILT_IN.length + added.size;
      }
    } catch { /* unreadable: say nothing */ }
  } else if (existsSync(join(dir, "camp"))) crew = BUILT_IN.length; // set up, nobody added yet

  const active = ["feed.jsonl", "quest-log.jsonl", "threads.jsonl"].map((f) => mtime(join(dir, "camp", f))).filter((t): t is number => t !== null);
  let since: number | null = null;
  try { since = statSync(join(dir, OUTPOST_FILE)).birthtimeMs || null; } catch { /* Mae has no outpost.json until it's renamed */ }
  return { crew, lastActive: active.length ? Math.max(...active) : null, since };
}

// The page, with this launch's token in it. null when ui/dist hasn't been built.
export function hubPage(dist: string, token: string): string | null {
  const file = join(dist, "hub.html");
  return existsSync(file) ? readFileSync(file, "utf8").replace("__HUB_TOKEN__", token) : null;
}
