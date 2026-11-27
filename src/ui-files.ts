// Mission control's page, as built files. The page is a React app in ui/ that Vite builds into
// ui/dist (`npm run ui:serve` builds it when it's missing or out of date): one index.html plus hashed
// scripts and styles under assets/. The camp server serves those and nothing else from disk.
//
// The page runs under a Content-Security-Policy with no inline scripts or styles. It holds
// nothing of the camp (it's the same built files for everyone), so it and its assets are served
// without the key; the page signs in for itself (ui/src/api.ts) before it asks for anything.

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withOutpost } from "./outpost.js";

export const UI_DIST = join(fileURLToPath(new URL("..", import.meta.url)), "ui", "dist");

export const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// The same policy, plus one exception for styles: a <style> element carrying this launch's
// nonce. The terminal pane needs it (xterm.js writes its colours and cell sizes into style
// elements it creates); the page's own script gives those elements the nonce. Inline styles
// without it, and all inline scripts, stay blocked.
export const uiCsp = (styleNonce: string) =>
  /^[A-Za-z0-9+/=_-]{16,}$/.test(styleNonce) ? UI_CSP.replace("style-src 'self'", `style-src 'self' 'nonce-${styleNonce}'`) : UI_CSP;

// hq: what the active pack calls mission control ("The bridge"). It's handed in, since this file is
// also the star chart's (scripts/launch.ts), which runs outside any one outpost and its pack.
export const uiNotBuilt = (hq = "Mission control") => `${hq}'s page hasn't been built yet. Open the link \`npm run ui\` prints (it serves the page as you edit it), or build it with \`npm run ui:build\`.`;
export const UI_NOT_BUILT = uiNotBuilt();

// The tour: Outpost's one-page introduction (docs/index.html), served at /splash. It's the same
// static page that's in the repo, so it needs no token and reads nothing of the camp. Its own
// policy allows its inline style and script and its Google fonts, and nothing else: no requests
// back to the camp, no forms, no frames.
export const SPLASH_FILE = join(fileURLToPath(new URL("..", import.meta.url)), "docs", "index.html");

export const SPLASH_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function splashPage(file = SPLASH_FILE): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

// The page, or null when ui/dist hasn't been built. The only things filled in are this launch's
// style nonce and the outpost's name (outpost.ts): the camp's key is never written into the page
// or onto a link.
export function uiPage(dist = UI_DIST, styleNonce = "", outpost?: string): string | null {
  const file = join(dist, "index.html");
  if (!existsSync(file)) return null;
  return withOutpost(readFileSync(file, "utf8").replace("__CAMP_NONCE__", styleNonce), outpost);
}

// Built files are named by what's in them (index-abc123.js), so a browser can keep them for good:
// a new build gives them new names, and the page (never kept: its nonce is new each launch)
// names the new ones.
export const ASSET_CACHE = "public, max-age=31536000, immutable";

// Does an Accept-Encoding header take this encoding? ("gzip, deflate, br", "br;q=0" says no.)
function accepts(header: string, encoding: string): boolean {
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    return name.trim() === encoding && !params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p));
  });
}

// One built file from ui/dist/assets, by request path ("/assets/index-abc123.js"). Only files
// of a known type that really are inside that folder; anything else is null. When the build left
// a compressed copy beside it (index-abc123.js.br, .gz: scripts/ui-build.ts makes them) and the
// browser takes that encoding, that copy is sent instead, brotli first.
export function uiAsset(pathname: string, dist = UI_DIST, acceptEncoding = ""): { type: string; body: Buffer; encoding?: "br" | "gzip" } | null {
  if (!pathname.startsWith("/assets/")) return null;
  let rel: string;
  try { rel = decodeURIComponent(pathname.slice("/assets/".length)); } catch { return null; }
  if (!rel || rel.includes("\0")) return null;
  const root = resolve(dist, "assets");
  const abs = resolve(root, rel);
  const type = ASSET_TYPES[extname(abs).toLowerCase()];
  if (!type || !abs.startsWith(root + sep) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  for (const [encoding, ext] of [["br", ".br"], ["gzip", ".gz"]] as const) {
    if (accepts(acceptEncoding, encoding) && existsSync(abs + ext)) return { type, body: readFileSync(abs + ext), encoding };
  }
  return { type, body: readFileSync(abs) };
}
