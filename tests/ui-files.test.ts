// Serving mission control's built page: the camp's key is never written into it, only real built
// files of known types are served, and the page's policy allows no inline code. And the tour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiPage, uiAsset, uiCsp, UI_CSP, splashPage, SPLASH_CSP, SPLASH_FILE } from "../src/ui-files.ts";

const dist = mkdtempSync(join(tmpdir(), "mae-ui-"));
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
  assert.match(page, /<title>Mae, My Alter Ego<\/title>/);
  // It wears the theme picked in mission control (the same saved choice), set before anything is drawn,
  // and carries both of mission control's palettes.
  assert.ok(page.indexOf("localStorage.getItem('camp-theme')") < page.indexOf("<style>"), "the saved theme is applied in the head, ahead of the styles");
  assert.match(page, /:root\[data-theme="dark"\]/);
  assert.match(page, /:root:not\(\[data-theme="light"\]\)/);
  const css = readFileSync(new URL("../ui/src/styles.css", import.meta.url), "utf8");
  for (const token of ["--bg: #f5efe4", "--accent: #9e5c0c", "--bg: #13110f", "--accent: #f0a640"]) {
    assert.ok(page.includes(token) && css.includes(token), `${token} is the same in the tour and in mission control`);
  }
  // The other palettes too, light side and dark: the paper, the ink and the accent are the same in both.
  assert.ok(page.indexOf("localStorage.getItem('camp-palette')") < page.indexOf("<style>"));
  const shared = ["--bg", "--surface", "--surface-2", "--border", "--border-strong", "--text", "--muted", "--faint", "--accent", "--accent-soft", "--accent-ink"];
  const blocks = (text: string, selector: string) => text.split(selector).slice(1).map((rest) => rest.slice(0, rest.indexOf("}")));
  const value = (block: string, name: string) => block.match(new RegExp(`${name}: (#[0-9a-f]{6});`))?.[1];
  for (const palette of ["harbor", "moss", "heather", "ochre"]) {
    assert.match(page, new RegExp(`<option value="${palette}">`), `the tour offers ${palette}`);
    for (const selector of [`:root[data-palette="${palette}"] {`, `:root[data-palette="${palette}"]:not([data-theme="light"]) {`, `:root[data-palette="${palette}"][data-theme="dark"] {`]) {
      const [inTour] = blocks(page, selector), [inCamp] = blocks(css, selector);
      assert.ok(inTour && inCamp, `${selector} is in both`);
      for (const name of shared) {
        assert.ok(value(inCamp, name), `${selector} sets ${name}`);
        assert.equal(value(inTour, name), value(inCamp, name), `${name} in ${selector}`);
      }
    }
  }
  assert.equal(splashPage(join(dist, "missing.html")), null);
  assert.doesNotMatch(SPLASH_CSP, /connect-src|'self'/, "no requests back to the camp");
  assert.match(SPLASH_CSP, /default-src 'none'/);
  assert.match(SPLASH_CSP, /form-action 'none'/);
  assert.match(SPLASH_CSP, /frame-ancestors 'none'/);
});
