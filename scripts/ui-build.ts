// Build mission control's page: the React app in ui/ → ui/dist, which src/server.ts serves.
//   npm run ui:build                      always build
//   tsx scripts/ui-build.ts --if-stale    build only when ui/dist is missing or older than its
//                                         sources (this is what `npm run ui:serve` runs first)

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "ui");
const BUILT = join(UI, "dist", "index.html");

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(path).reduce((m, name) => Math.max(m, newest(join(path, name))), 0);
}

// Stale: no build yet, or a source file (or the installed packages) changed after the last build.
// The page's types come from src/, but types don't change what gets built.
function uiIsStale(): boolean {
  if (!existsSync(BUILT)) return true;
  const built = statSync(BUILT).mtimeMs;
  const sources = [join(UI, "src"), join(UI, "index.html"), join(UI, "hub.html"), join(UI, "vite.config.ts"), join(ROOT, "package-lock.json")];
  return sources.some((s) => newest(s) > built);
}

if (process.argv.includes("--if-stale") && !uiIsStale()) process.exit(0);

console.log("🔨 Building mission control's page (ui/ → ui/dist)…");
await build({ configFile: join(UI, "vite.config.ts"), logLevel: "warn" });

// A compressed copy of each script and stylesheet beside it (.br, .gz), made once here at the
// best settings so the camp server never compresses anything as it serves (src/ui-files.ts picks
// the copy the browser takes). On this machine it changes little; over LAN mode it's ~4x less.
const ASSETS = join(UI, "dist", "assets");
for (const name of readdirSync(ASSETS)) {
  if (!/\.(js|css|svg)$/.test(name)) continue;
  const raw = readFileSync(join(ASSETS, name));
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  const gz = gzipSync(raw, { level: 9 });
  if (br.length < raw.length) writeFileSync(join(ASSETS, name + ".br"), br);
  if (gz.length < raw.length) writeFileSync(join(ASSETS, name + ".gz"), gz);
}
