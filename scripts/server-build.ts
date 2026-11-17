// Build the camp server for production: src/ → dist/server.js, one plain-JS file that `node`
// runs directly, with no TypeScript loader in the way (about half the startup time of tsx, and
// less memory). `npm run prod` runs this, then the file.
//
// Packages stay outside the bundle and load from node_modules as usual: node-pty is native, and
// the Agent SDK finds its own files by its own path. The output sits one folder down from the
// repo, like src/, so the paths src/ works out from import.meta.url (ui/dist, docs/) still hold.
// It isn't minified, so a stack trace names real functions; dist/server.js.map is there for
// `node --enable-source-maps` when you want src/ line numbers too.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

console.log("🔨 Building the camp server (src/ → dist/server.js)…");
await build({
  entryPoints: [join(ROOT, "src", "server.ts")],
  outfile: join(ROOT, "dist", "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});
