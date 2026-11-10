// Work on mission control's page with live reload:  npm run ui:dev
//
// Starts the camp server as usual, then Vite's dev server in front of it. Vite serves the page
// from ui/src (changes show up as you save) and passes /api and /events through to the camp
// server. Open the link this prints: it carries the camp's launch token, which the page sends
// with every request, exactly as the built page does. Vite adds nothing to the requests, so
// the dev server is no way around the token.

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The camp server, with the environment this was started with (.env included).
const camp = spawn(process.execPath, ["--import", "tsx", join(ROOT, "src", "server.ts")], { env: process.env, stdio: ["inherit", "pipe", "inherit"] });
let vite: ViteDevServer | null = null;
let found = false;
let printed = "";

camp.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (found) return;
  printed += chunk.toString("utf8");
  const token = printed.match(/\/\?t=([0-9a-f]+)/)?.[1];
  if (!token) return;
  found = true;
  void startVite(token);
});

async function startVite(token: string) {
  vite = await createServer({ configFile: join(ROOT, "ui", "vite.config.ts") });
  await vite.listen();
  console.log(`\n🛠️  The page with live reload: http://127.0.0.1:${vite.config.server.port}/?t=${token}`);
  console.log("   Use this link while you edit ui/src. (The one above serves the last build.)\n");
}

async function shutDown(code: number) {
  await vite?.close();
  process.exit(code);
}
camp.on("exit", (code) => void shutDown(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { if (camp.exitCode === null) camp.kill(sig); else void shutDown(0); });
