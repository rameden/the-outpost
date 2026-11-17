// Put the films into the tour: the two motion graphics in docs/films/ → the "On film" section of
// docs/index.html, drawn live in the page.
//   npm run tour:films            write them into docs/index.html
//   tsx scripts/tour-films.ts --check   say whether docs/index.html is in step, and change nothing
//
// Each film is a page of its own (open it in a browser to watch or work on it). The tour can't load
// another file: the camp serves it as one page under a policy that fetches nothing. So this copies
// each film whole into the tour: its styles once (the audit film's are the other's plus a few), its
// stage as a <template>, and the code that draws it. In the tour a film is mounted in a shadow root,
// so its styles and the tour's never meet, and it takes its colours from the page: the tour's light
// or dark mode and its palettes. Edit a film in docs/films/, then run this. Running it again replaces
// what it wrote before (everything between the "films" markers).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOUR = join(ROOT, "docs", "index.html");
const FILMS_DIR = join(ROOT, "docs", "films");

const FILMS = [
  {
    key: "ticket", file: "one-ticket.html", tab: "One ticket, start to finish", length: "0:54",
    note: "One example Jira ticket, from picking it up to a reviewed pull request. Every click in it is yours: starting the work, approving the plan, the commit, opening the pull request and posting the review.",
  },
  {
    key: "audit", file: "three-audit-findings.html", tab: "Three audit findings", length: "1:03",
    note: "Three findings from a SOC 2 Type I and ISO 27001 readiness review, as they are in the demo (<code>npm run demo</code>). The first goes from ticket to reviewed pull request step by step; the other two follow the same route.",
  },
];
// The film whose styles serve both.
const STYLES_FROM = "three-audit-findings.html";

// Colours the tour already has, which the films take from it.
const TOUR_TOKENS = ["bg", "surface", "surface-2", "border", "border-strong", "text", "muted", "faint", "accent", "accent-soft", "accent-ink", "good", "good-soft",
  "c-qm", "c-scout", "c-scribe", "c-art", "c-warden", "ink", "night", "night-text", "night-muted", "night-line", "shadow", "display", "body", "mono", "radius", "logo-ink", "logo-dot"];
// The few the films use that the tour has no other need of, light and dark.
const EXTRA: Record<"light" | "dark", Record<string, string>> = {
  light: { bad: "#a94630", "bad-soft": "#f5dfd8", "night-good": "#93c47d", shade: "rgba(60, 40, 20, .13)", "logo-stroke": "4", "on-light": "1", "on-dark": "0" },
  dark: { bad: "#e88468", "bad-soft": "#33201a", "night-good": "#93c47d", shade: "rgba(0, 0, 0, .5)", "logo-stroke": "3", "on-light": "0", "on-dark": "1" },
};
// Set by the films' own classes, not by the page.
const OWN = ["tone", "sw"];

function cut(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  if (i < 0) throw new Error(`Not found: ${from}`);
  const j = text.indexOf(to, i + from.length);
  if (j < 0) throw new Error(`Not found after "${from}": ${to}`);
  return text.slice(i + from.length, j);
}
function swap(text: string, from: string, to: string): string {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`Expected one "${from.slice(0, 80)}", found ${n}`);
  return text.replace(from, () => to);
}

/** The tour with the films in it. `film` reads a film's page by its file name (docs/films/ unless told otherwise). */
export function withFilms(tour: string, read: (file: string) => string = (file) => readFileSync(join(FILMS_DIR, file), "utf8")): string {
  // A film saved with Windows line endings is cut up the same as any other.
  const film = (file: string) => read(file).replace(/\r\n/g, "\n");
  // The films' styles, without the page around the stage and without their own copy of the colours.
  let css = cut(film(STYLES_FROM), "<style>", "</style>");
  css = css.slice(css.indexOf("* { box-sizing: border-box; }"));
  css = css.split("\n").filter((line) => !/^(body|\.wrap|\.note) \{/.test(line)).join("\n");
  css = swap(css, "box-shadow: 0 16px 40px var(--shade);", "box-shadow: var(--shadow);");
  css = ":host { display: grid; gap: 14px; }\n" + css.trim();

  const parts = FILMS.map((f) => {
    const page = film(f.file);
    const svg = '<svg id="stage"' + cut(page, '<svg id="stage"', "</svg>") + "</svg>";
    const controls = page.match(/<div class="controls">[\s\S]*?<\/div>/)?.[0];
    if (!controls) throw new Error(`${f.file} has no controls`);
    // The film's code, looking for its stage and controls in its own shadow root, and running only while the tour says it can be seen.
    let js = cut(page, "<script>\n(() => {\n", "})();\n</script>");
    js = js.split("document.getElementById(").join("root.getElementById(");
    js = swap(js, "playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;", "playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, shown = false;");
    js = swap(js, "if (playing && last != null) {", "if (playing && shown && last != null) {");
    js += "// the page says when this film can be seen: it only runs then\nreturn { show: v => { shown = !!v; } };\n";
    if (/<\/script/i.test(js)) throw new Error(`${f.file}: its code would end the tour's script early`);
    for (const [, name] of (css + js + svg).matchAll(/var\(--([a-z0-9-]+)/g)) {
      if (!TOUR_TOKENS.includes(name) && !(name in EXTRA.light) && !OWN.includes(name)) throw new Error(`${f.file} uses --${name}, which the tour doesn't have`);
    }
    return { ...f, svg, controls, js };
  });

  const declare = (set: Record<string, string>) => Object.entries(set).map(([name, value]) => `--${name}: ${value};`).join(" ");
  const styles = `/* films:start */
/* The films: two tabs over one stage. The tab that's showing has a solid 2px line under it. */
.film-tabs { display: flex; flex-wrap: wrap; gap: 0 28px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.film-tabs button { font: 600 15px var(--body); color: var(--muted); background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 10px 0; cursor: pointer; }
.film-tabs button span { font: 400 12px var(--mono); color: var(--faint); margin-left: 8px; }
.film-tabs button:hover { color: var(--text); }
.film-tabs button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.film-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.film-stage { display: block; color: var(--muted); font-size: 15px; }
.film-note { margin: 14px 0 0; color: var(--muted); font-size: 15px; max-width: 72ch; }
.film-note code { font-family: var(--mono); font-size: .92em; white-space: nowrap; }
/* The few colours the films use that the page has no other need of. */
:root { ${declare(EXTRA.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${declare(EXTRA.dark)} } }
:root[data-theme="dark"] { ${declare(EXTRA.dark)} }
/* films:end */
`;
  const section = `<!-- films:start -->
<section id="films">
  <div class="wrap">
    <div class="sec-head">
      <div class="eyebrow">On film</div>
      <h2>Watch the work go round the crew.</h2>
      <p class="lede">Two short films, drawn live in this page. The Quartermaster is the sun, the crew are its planets, and the view goes close on each one as the work reaches it.</p>
    </div>
    <div class="film-tabs" role="tablist" aria-label="Films">
${parts.map((f, i) => `      <button type="button" role="tab" id="film-tab-${f.key}" aria-controls="film-${f.key}" aria-selected="${i ? "false" : "true"}" data-film="${f.key}">${f.tab} <span>${f.length}</span></button>`).join("\n")}
    </div>
${parts.map((f, i) => `    <div class="film" id="film-${f.key}" role="tabpanel" aria-labelledby="film-tab-${f.key}"${i ? " hidden" : ""}>
      <div class="film-stage">This film is drawn by the page itself, and needs a newer browser than this one.</div>
      <p class="film-note">${f.note} It loops. Click the stage to pause.</p>
    </div>`).join("\n")}
  </div>
</section>
<!-- films:end -->

`;
  const code = `<!-- films-code:start -->
<!-- The two films in the "On film" section, written here by \`npm run tour:films\` (scripts/tour-films.ts)
     from the pages in docs/films/. Edit those and run it again, rather than changing anything between
     these markers. What follows is the films' styles, each one's stage, then the code that draws it.
     Each is mounted in a shadow root, so nothing here meets the page's own styles, and takes its
     colours from the page. -->
<template id="film-css"><style>
${css}
</style></template>
${parts.map((f) => `<template id="film-${f.key}-stage">
  <div class="stage" id="frame">
    ${f.svg}
  </div>
  ${f.controls}
</template>`).join("\n")}
<script>
(function () {
  if (!Element.prototype.attachShadow || !('content' in document.createElement('template'))) return;
  // The code that draws each film, given the shadow root its stage is in. It answers with show(yes or no).
  var DRAW = {
${parts.map((f) => `${f.key}: function (root) {\n${f.js}}`).join(",\n")}
  };
  var keys = [${parts.map((f) => `'${f.key}'`).join(", ")}], film = {}, active = keys[0], inView = false;
  keys.forEach(function (key) {
    film[key] = { panel: document.getElementById('film-' + key), tab: document.getElementById('film-tab-' + key), ctl: null };
    film[key].tab.addEventListener('click', function () { active = key; update(); });
  });
  // A film is built the first time it is on screen, and only moves while it is.
  function mount(key) {
    var f = film[key], root = f.panel.querySelector('.film-stage').attachShadow({ mode: 'open' });
    root.appendChild(document.getElementById('film-css').content.cloneNode(true));
    root.appendChild(document.getElementById('film-' + key + '-stage').content.cloneNode(true));
    f.ctl = DRAW[key](root);
  }
  function update() {
    keys.forEach(function (key) {
      var f = film[key], on = key === active;
      f.panel.hidden = !on; f.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && inView && !f.ctl) mount(key);
      if (f.ctl) f.ctl.show(on && inView);
    });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[entries.length - 1].isIntersecting; update(); }, { threshold: .2 }).observe(document.getElementById('films'));
  } else { inView = true; }
  update();
})();
</script>
<!-- films-code:end -->
`;

  // Out with what was written last time, then in with this.
  let page = tour;
  const strip = (from: string, to: string) => {
    const i = page.indexOf(from);
    if (i < 0) return;
    const j = page.indexOf(to, i);
    if (j < 0) throw new Error(`"${from}" is in the tour without its "${to}"`);
    page = page.slice(0, i) + page.slice(j + to.length).replace(/^\n+/, "");
  };
  strip("/* films:start */", "/* films:end */\n");
  strip("<!-- films:start -->", "<!-- films:end -->");
  strip("<!-- films-code:start -->", "<!-- films-code:end -->");
  const link = '        <a href="#films">On film</a>\n';
  page = page.replace(link, "");
  const before = (marker: string, text: string) => { page = swap(page, marker, text + marker); };
  before("@media (max-width: 960px) {", styles);
  before('<section id="orbit">', section); // the films come just ahead of Orbit, the same sky live
  before('        <a href="#orbit">Orbit</a>', link);
  before("</body>", code);
  return page;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = readFileSync(TOUR, "utf8"), next = withFilms(now);
  if (process.argv.includes("--check")) {
    if (next !== now) { console.error("docs/index.html is out of step with docs/films/. Run `npm run tour:films`."); process.exit(1); }
    console.log("docs/index.html has the films as they are in docs/films/.");
  } else if (next === now) {
    console.log("docs/index.html already has the films as they are in docs/films/.");
  } else {
    writeFileSync(TOUR, next);
    console.log(`Wrote the films into docs/index.html (${next.length.toLocaleString("en-US")} bytes).`);
  }
}
