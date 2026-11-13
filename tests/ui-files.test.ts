// Serving mission control's built page: the token goes into the page and onto its asset links,
// only real built files of known types are served, and the page's policy allows no inline code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiPage, uiAsset, uiCsp, UI_CSP, splashPage, SPLASH_CSP, SPLASH_FILE } from "../src/ui-files.ts";

const dist = mkdtempSync(join(tmpdir(), "satchel-ui-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), [
  '<meta name="camp-token" content="__CAMP_TOKEN__">',
  '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
  '<link rel="stylesheet" crossorigin href="/assets/style-def456.css">',
  '<a href="https://example.com/assets/elsewhere.js">not ours</a>',
].join("\n"));
writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log('camp')");
writeFileSync(join(dist, "assets", "style-def456.css"), "body{}");
writeFileSync(join(dist, "assets", "notes.txt"), "not a page asset");
writeFileSync(join(dist, "secret.js"), "outside assets/");

test("the page is served as built: the camp's key is never written into it or onto a link", () => {
  const page = uiPage(dist)!;
  assert.match(page, /src="\/assets\/index-abc123\.js"/);
  assert.match(page, /href="\/assets\/style-def456\.css"/);
  assert.match(page, /href="https:\/\/example\.com\/assets\/elsewhere\.js"/);
  assert.doesNotMatch(page, /[?&]t=/);
});

test("no build yet: no page", () => {
  assert.equal(uiPage(join(dist, "missing")), null);
});

test("assets are served with the right type", () => {
  assert.equal(uiAsset("/assets/index-abc123.js", dist)?.type, "text/javascript; charset=utf-8");
  assert.equal(uiAsset("/assets/style-def456.css", dist)?.type, "text/css; charset=utf-8");
  assert.equal(uiAsset("/assets/index-abc123.js", dist)?.body.toString(), "console.log('camp')");
});

test("nothing outside the built assets folder, and nothing of an unknown type", () => {
  for (const path of [
    "/assets/../secret.js", "/assets/%2e%2e/secret.js", "/assets/..%2fsecret.js", "/assets/../index.html",
    "/assets/notes.txt", "/assets/missing.js", "/assets/", "/assets", "/secret.js", "/assets/%zz.js", "/assets/index-abc123.js%00.css",
  ]) assert.equal(uiAsset(path, dist), null, path);
});

test("the page's policy allows only the camp's own scripts and styles", () => {
  assert.ok(!UI_CSP.includes("unsafe-inline") && !UI_CSP.includes("unsafe-eval"));
  assert.match(UI_CSP, /default-src 'none'/);
  assert.match(UI_CSP, /script-src 'self'/);
  assert.match(UI_CSP, /style-src 'self'/);
  assert.match(UI_CSP, /frame-ancestors 'none'/);
});

test("the terminal's style rules get a per-launch nonce, and nothing else is loosened", () => {
  const csp = uiCsp("abcDEF123456_-abcDEF12");
  assert.match(csp, /style-src 'self' 'nonce-abcDEF123456_-abcDEF12';/);
  assert.match(csp, /script-src 'self';/, "scripts are untouched");
  assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
  assert.equal(uiCsp(""), UI_CSP, "no nonce, no exception");
  assert.equal(uiCsp("x'; script-src *"), UI_CSP, "a value that isn't a nonce is never put into the policy");
  writeFileSync(join(dist, "index.html"), '<meta name="camp-style-nonce" content="__CAMP_NONCE__">');
  assert.match(uiPage(dist, "abcDEF123456_-abcDEF12")!, /<meta name="camp-style-nonce" content="abcDEF123456_-abcDEF12">/);
});

test("the tour is the repo's docs page, under a policy that reaches nothing of the camp", () => {
  const page = splashPage()!;
  assert.ok(page, `${SPLASH_FILE} exists`);
  assert.match(page, /<title>Satchel<\/title>/);
  assert.equal(splashPage(join(dist, "missing.html")), null);
  assert.doesNotMatch(SPLASH_CSP, /connect-src|'self'/, "no requests back to the camp");
  assert.match(SPLASH_CSP, /default-src 'none'/);
  assert.match(SPLASH_CSP, /form-action 'none'/);
  assert.match(SPLASH_CSP, /frame-ancestors 'none'/);
});
