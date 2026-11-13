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

export const UI_DIST = join(fileURLToPath(new URL("..", import.meta.url)), "ui", "dist");

export const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// The same policy, plus one exception for styles: a <style> element carrying this launch's
// nonce. The terminal pane needs it (xterm.js writes its colours and cell sizes into style
// elements it creates); the page's own script gives those elements the nonce. Inline styles
// without it, and all inline scripts, stay blocked.
export const uiCsp = (styleNonce: string) =>
  /^[A-Za-z0-9+/=_-]{16,}$/.test(styleNonce) ? UI_CSP.replace("style-src 'self'", `style-src 'self' 'nonce-${styleNonce}'`) : UI_CSP;

export const UI_NOT_BUILT = "Mission control's page hasn't been built yet. Open the link `npm run ui` prints (it serves the page as you edit it), or build it with `npm run ui:build`.";

// The tour: Satchel's one-page introduction (docs/index.html), served at /splash. It's the same
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

// The page, or null when ui/dist hasn't been built. The only thing filled in is this launch's
// style nonce: the camp's key is never written into the page or onto a link.
export function uiPage(dist = UI_DIST, styleNonce = ""): string | null {
  const file = join(dist, "index.html");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").replace("__CAMP_NONCE__", styleNonce);
}

// One built file from ui/dist/assets, by request path ("/assets/index-abc123.js"). Only files
// of a known type that really are inside that folder; anything else is null.
export function uiAsset(pathname: string, dist = UI_DIST): { type: string; body: Buffer } | null {
  if (!pathname.startsWith("/assets/")) return null;
  let rel: string;
  try { rel = decodeURIComponent(pathname.slice("/assets/".length)); } catch { return null; }
  if (!rel || rel.includes("\0")) return null;
  const root = resolve(dist, "assets");
  const abs = resolve(root, rel);
  const type = ASSET_TYPES[extname(abs).toLowerCase()];
  if (!type || !abs.startsWith(root + sep) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  return { type, body: readFileSync(abs) };
}
