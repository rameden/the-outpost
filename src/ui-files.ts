// Mission control's page, as built files. The page is a React app in ui/ that Vite builds into
// ui/dist (`npm run ui` builds it when it's missing or out of date): one index.html plus hashed
// scripts and styles under assets/. The camp server serves those and nothing else from disk.
//
// The page runs under a Content-Security-Policy with no inline scripts or styles, so the launch
// token goes into a <meta> tag, and each asset link gets ?t=<token> so the browser can fetch it
// (assets need the token like every other request).

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const UI_DIST = join(fileURLToPath(new URL("..", import.meta.url)), "ui", "dist");

export const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const UI_NOT_BUILT = "Mission control's page hasn't been built yet. Start it with `npm run ui` (which builds it first), or run `npm run ui:build`.";

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

// The page with this launch's token filled in, or null when ui/dist hasn't been built.
export function uiPage(token: string, dist = UI_DIST): string | null {
  const file = join(dist, "index.html");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8")
    .replace("__CAMP_TOKEN__", token)
    .replace(/\b(src|href)="(\/assets\/[^"?#]+)"/g, (_m, attr, path) => `${attr}="${path}?t=${token}"`);
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
