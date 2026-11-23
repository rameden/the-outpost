// Mission control, reloading as you edit:  npm run ui
//
// Starts the camp server as usual, then Vite's dev server in front of it. Vite serves the page
// from ui/src (a saved change shows up in the open page without a refresh) and passes /api and
// /events through to the camp server. Open the link this prints: it carries a one-time sign-in
// code, which the page trades for the camp's key exactly as the built page does (and keeps for
// this address, so the next start needs no link). Vite adds nothing to the requests, so the dev
// server is no way around the key.
//
// Only the page reloads. The camp server itself (src/) keeps running until you restart this, so
// an edit there doesn't cut off an expedition that's under way.
//
// `npm run ui:serve` is the other way to run it: the camp alone, serving the last build of the
// page (ui/dist) under its strict Content-Security-Policy, with no second server.

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { OUTPOST, readOutpost, withOutpost } from "../src/outpost.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The camp server, with the environment this was started with (.env included). tsx is named by
// where it's installed, not by name: an outpost runs in a folder of its own, with no node_modules.
const camp = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(ROOT, "src", "server.ts")], { env: process.env, stdio: ["inherit", "pipe", "inherit"] });
let vite: ViteDevServer | null = null;
let starting = false;
let pending = "";
let held: string[] | null = null; // what the camp says between its link and ours, kept so ours comes first
// The camp's links name its own port, where the last build is served: ours name Vite's.
const ours = (line: string) => (vite ? line.replace(/http:\/\/127\.0\.0\.1:\d+\//g, `http://127.0.0.1:${vite.config.server.port}/`) : line);

// Pass the camp's output through a line at a time, except its own link: that one serves the
// last build, and two links are one too many. The live link is printed in its place.
camp.stdout.on("data", (chunk: Buffer) => {
  pending += chunk.toString("utf8");
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    const code = line.match(/\/#k=([0-9a-f]+)/)?.[1];
    if (!code || starting) { if (held) held.push(line); else process.stdout.write(ours(line) + "\n"); continue; }
    starting = true; held = []; void startVite(code);
  }
});
camp.stdout.on("end", () => { if (pending) process.stdout.write(pending); });

async function startVite(code: string) {
  try {
    vite = await createServer({
      configFile: join(ROOT, "ui", "vite.config.ts"),
      // The outpost's name in the page, as the camp server puts it there (src/outpost.ts).
      plugins: [{ name: "outpost-name", transformIndexHtml: (html) => withOutpost(html, readOutpost().name) }],
    });
    await vite.listen();
    console.log(`🏕️  Outpost ${OUTPOST.name} is up: http://127.0.0.1:${vite.config.server.port}/#k=${code}`);
    console.log("   The page reloads as you edit ui/src.");
    for (const line of held ?? []) console.log(ours(line));
    held = null;
  } catch (e) {
    // Most often the port is taken (another `npm run ui`, or CAMP_UI_PORT pointing at something).
    for (const line of held ?? []) console.log(line);
    held = null;
    console.error(`\nCouldn't start the page's dev server: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Set CAMP_UI_PORT to a free port, or run `npm run ui:serve` for the camp without live reload.\n");
    camp.kill("SIGTERM");
  }
}

async function shutDown(code: number) {
  await vite?.close();
  process.exit(code);
}
camp.on("exit", (code) => void shutDown(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { if (camp.exitCode === null) camp.kill(sig); else void shutDown(0); });
