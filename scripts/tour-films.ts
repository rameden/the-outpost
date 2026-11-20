// Put the films into the tour: the motion graphics in docs/films/ → the "On film" and "Videos"
// sections of docs/index.html, drawn live in the page.
//   npm run tour:films            write them into docs/index.html
//   tsx scripts/tour-films.ts --check   say whether docs/index.html is in step, and change nothing
//
// Each film is a page of its own (open it in a browser to watch or work on it). The tour can't load
// another file: the camp serves it as one page under a policy that fetches nothing. So this copies
// each film whole into the tour: the styles they share once (the audit film's), the few rules a film
// adds of its own, its stage as a <template>, and the code that draws it. In the tour a film is mounted in a shadow root,
// so its styles and the tour's never meet, and it takes its colours from the page: the tour's light
// or dark mode and its palettes. Edit a film in docs/films/, then run this. Running it again replaces
// what it wrote before (everything between the "films" and "videos" markers).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOUR = join(ROOT, "docs", "index.html");
const FILMS_DIR = join(ROOT, "docs", "films");

const FILMS = [
  {
    key: "sky", section: "films", file: "ground-to-sky.html", tab: "Ground to sky", length: "1:15",
    note: "Mae in one shot, from the ground to the sky. Your ask walks the trail to the outpost, the outpost lifts into orbit, the crew's missions go round, what they learn becomes stars that link up, a router fits a model to each task, and the stars settle into the mark.",
  },
  {
    key: "ticket", section: "films", file: "one-ticket.html", tab: "One ticket, start to finish", length: "0:54",
    note: "One example Jira ticket, from picking it up to a reviewed pull request. Every click in it is yours: starting the work, approving the plan, the commit, opening the pull request and posting the review.",
  },
  {
    key: "audit", section: "films", file: "three-audit-findings.html", tab: "Three audit findings", length: "1:03",
    note: "Three findings from a SOC 2 Type I and ISO 27001 readiness review, as they are in the demo (<code>npm run demo</code>). The first goes from ticket to reviewed pull request step by step; the other two follow the same route.",
  },
  {
    key: "trail", section: "videos", file: "trail-map.html", tab: "The trail map", length: "0:36",
    note: "The trail map: one plan as waypoints, lit as the crew reaches each one, then every plan of the day on one map, as rings or as a tree. Open it with <code>/trail</code>.",
  },
  {
    key: "stars", section: "videos", file: "constellation.html", tab: "The constellation", length: "0:39",
    note: "The constellation: every line the crew remembers, as a star in its place that grows each time it is used. Pick one to pin it, merge it with another or forget it. Open it from the Arcade menu in the top bar or with <code>/constellation</code>.",
  },
  {
    key: "night", section: "videos", file: "night-shift.html", tab: "The night shift", length: "0:35",
    note: "The night shift: off until you switch it on, then it drafts and reports while the camp is idle. Nothing is applied, deleted or changed until you approve it.",
  },
];
// The sections the films are shown in: where each goes in the tour, and its link in the top bar.
const SECTIONS = [
  {
    id: "films", name: "On film", label: "Films", title: "Watch the work go round the crew.",
    lede: "Three short films, drawn live in this page. The first is Mae in one shot, from the ground to the sky. In the other two the Commander is the sun, the crew are its planets, and the view goes close on each one as the work reaches it.",
    before: '<section id="orbit">', linkBefore: '        <a href="#orbit">Orbit</a>', // just ahead of Orbit, the same sky live
  },
  {
    id: "videos", name: "Videos", label: "Videos", title: "Three newer parts of the outpost, in motion.",
    lede: "Three more short films, drawn live in this page. Each shows one newer part of the outpost: the trail map, the constellation and the night shift.",
    before: '<section id="kit">', linkBefore: '        <a href="#kit">The kit</a>', // after Orbit, ahead of the kit they belong to
  },
];
// The film whose styles the others share. What a film has beyond them goes in with that film alone.
const STYLES_FROM = "three-audit-findings.html";

// Colours the tour already has, which the films take from it.
const TOUR_TOKENS = ["bg", "surface", "surface-2", "border", "border-strong", "text", "muted", "faint", "accent", "accent-soft", "accent-ink", "good", "good-soft",
  "c-qm", "c-scout", "c-scribe", "c-art", "c-warden", "ink", "night", "night-text", "night-muted", "night-line", "shadow", "display", "body", "mono", "radius", "logo-ink", "logo-dot"];
// The few the films use that the tour has no other need of, light and dark.
const EXTRA: Record<"light" | "dark", Record<string, string>> = {
  light: { bad: "#a94630", "bad-soft": "#f5dfd8", "night-good": "#93c47d", shade: "rgba(60, 40, 20, .13)", "logo-stroke": "4", "on-light": "1", "on-dark": "0", sky: "#1d2b4c",
    deep: "#e0d2ba", zenith: "#eadcc4", line: "#c2b196", hot: "#fff3d9", "c-pilot": "#2c8486" },
  dark: { bad: "#e88468", "bad-soft": "#33201a", "night-good": "#93c47d", shade: "rgba(0, 0, 0, .5)", "logo-stroke": "3", "on-light": "0", "on-dark": "1", sky: "#111c38",
    deep: "#070605", zenith: "#14233f", line: "#574c40", hot: "#fff1cf", "c-pilot": "#7ccfcf" },
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
  const stageCss = (file: string) => {
    const all = cut(film(file), "<style>", "</style>");
    return all.slice(all.indexOf("* { box-sizing: border-box; }")).split("\n").filter((line) => !/^(body|\.wrap|\.note) \{/.test(line));
  };
  const shared = stageCss(STYLES_FROM);
  let css = swap(shared.join("\n"), "box-shadow: 0 16px 40px var(--shade);", "box-shadow: var(--shadow);");
  css = ":host { display: grid; gap: 14px; }\n" + css.trim();

  const parts = FILMS.map((f) => {
    const page = film(f.file);
    // Its stage: drawn as SVG, or painted on a canvas.
    const [open, close] = page.includes('<canvas id="stage"') ? ['<canvas id="stage"', "</canvas>"] : ['<svg id="stage"', "</svg>"];
    const stage = open + cut(page, open, close) + close;
    const controls = page.match(/<div class="controls">[\s\S]*?<\/div>/)?.[0];
    if (!controls) throw new Error(`${f.file} has no controls`);
    // The film's code, looking for its stage and controls in its own shadow root, and running only while the tour says it can be seen.
    let js = cut(page, "<script>\n(() => {\n", "})();\n</script>");
    js = js.split("document.getElementById(").join("root.getElementById(");
    js = swap(js, "playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;", "playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, shown = false;");
    js = swap(js, "if (playing && last != null) {", "if (playing && shown && last != null) {");
    js += "// the page says when this film can be seen: it only runs then\nreturn { show: v => { shown = !!v; } };\n";
    if (/<\/script/i.test(js)) throw new Error(`${f.file}: its code would end the tour's script early`);
    // The rules this film has that the shared styles don't.
    const own = f.file === STYLES_FROM ? "" : stageCss(f.file).filter((line) => line.trim() && !shared.includes(line)).join("\n");
    // Every colour it asks the page for is one the tour has: var(--name) in its styles and stage, and '--name' where its code reads one to paint with.
    for (const [, name] of [...(css + own + js + stage).matchAll(/var\(--([a-z0-9-]+)/g), ...js.matchAll(/'--([a-z0-9-]+)'/g)]) {
      if (!TOUR_TOKENS.includes(name) && !(name in EXTRA.light) && !OWN.includes(name)) throw new Error(`${f.file} uses --${name}, which the tour doesn't have`);
    }
    return { ...f, stage, controls, js, own };
  });

  const declare = (set: Record<string, string>) => Object.entries(set).map(([name, value]) => `--${name}: ${value};`).join(" ");
  const styles = `/* films:start */
/* The films: in each section, a tab each over one stage. The tab that's showing has a solid 2px line under it. */
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
  const sections = SECTIONS.map((s) => {
    const shown = parts.filter((f) => f.section === s.id);
    return `<!-- ${s.id}:start -->
<section id="${s.id}">
  <div class="wrap">
    <div class="sec-head">
      <div class="eyebrow">${s.name}</div>
      <h2>${s.title}</h2>
      <p class="lede">${s.lede}</p>
    </div>
    <div class="film-tabs" role="tablist" aria-label="${s.label}">
${shown.map((f, i) => `      <button type="button" role="tab" id="film-tab-${f.key}" aria-controls="film-${f.key}" aria-selected="${i ? "false" : "true"}" data-film="${f.key}">${f.tab} <span>${f.length}</span></button>`).join("\n")}
    </div>
${shown.map((f, i) => `    <div class="film" id="film-${f.key}" role="tabpanel" aria-labelledby="film-tab-${f.key}"${i ? " hidden" : ""}>
      <div class="film-stage">This film is drawn by the page itself, and needs a newer browser than this one.</div>
      <p class="film-note">${f.note} It loops. Click the stage to pause.</p>
    </div>`).join("\n")}
  </div>
</section>
<!-- ${s.id}:end -->

`;
  });
  const code = `<!-- films-code:start -->
<!-- The films in the "On film" and "Videos" sections, written here by \`npm run tour:films\` (scripts/tour-films.ts)
     from the pages in docs/films/. Edit those and run it again, rather than changing anything between
     these markers. What follows is the styles the films share, each one's own rules and stage, then the code that draws it.
     Each is mounted in a shadow root, so nothing here meets the page's own styles, and takes its
     colours from the page. -->
<template id="film-css"><style>
${css}
</style></template>
${parts.map((f) => `${f.own ? `<template id="film-${f.key}-css"><style>\n${f.own}\n</style></template>\n` : ""}<template id="film-${f.key}-stage">
  <div class="stage" id="frame">
    ${f.stage}
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
  var film = {};
  // A film is built the first time it is on screen, and only moves while it is.
  function mount(key) {
    var f = film[key], root = f.panel.querySelector('.film-stage').attachShadow({ mode: 'open' });
    root.appendChild(document.getElementById('film-css').content.cloneNode(true));
    var own = document.getElementById('film-' + key + '-css');
    if (own) root.appendChild(own.content.cloneNode(true));
    root.appendChild(document.getElementById('film-' + key + '-stage').content.cloneNode(true));
    f.ctl = DRAW[key](root);
  }
  // Each section has its own tabs, and its films move only while that section is on screen.
  [${SECTIONS.map((s) => `{ id: '${s.id}', keys: [${parts.filter((f) => f.section === s.id).map((f) => `'${f.key}'`).join(", ")}] }`).join(", ")}].forEach(function (sec) {
    var keys = sec.keys, active = keys[0], inView = false;
    function update() {
      keys.forEach(function (key) {
        var f = film[key], on = key === active;
        f.panel.hidden = !on; f.tab.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && inView && !f.ctl) mount(key);
        if (f.ctl) f.ctl.show(on && inView);
      });
    }
    keys.forEach(function (key) {
      film[key] = { panel: document.getElementById('film-' + key), tab: document.getElementById('film-tab-' + key), ctl: null };
      film[key].tab.addEventListener('click', function () { active = key; update(); });
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { inView = entries[entries.length - 1].isIntersecting; update(); }, { threshold: .2 }).observe(document.getElementById(sec.id));
    } else { inView = true; }
    update();
  });
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
  for (const s of SECTIONS) strip(`<!-- ${s.id}:start -->`, `<!-- ${s.id}:end -->`);
  strip("<!-- films-code:start -->", "<!-- films-code:end -->");
  const link = (s: (typeof SECTIONS)[number]) => `        <a href="#${s.id}">${s.name}</a>\n`;
  for (const s of SECTIONS) page = page.replace(link(s), "");
  const before = (marker: string, text: string) => { page = swap(page, marker, text + marker); };
  before("@media (max-width: 960px) {", styles);
  SECTIONS.forEach((s, i) => { before(s.before, sections[i]); before(s.linkBefore, link(s)); });
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
