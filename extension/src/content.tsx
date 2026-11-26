// Barnstorm, the browser extension: the game, put onto whatever page you're looking at.
//
// This is the same game as in Mae (plugins/barnstorm: both of them, Wreck and the Sortie), not a
// copy of it: the extension is built from those files. All that's here is what a page that
// isn't Mae needs:
//   - somewhere to put it. The game's bar and its sky go in a shadow root on an element of
//     their own, so the page's styles can't reach them and theirs can't reach the page.
//   - its look. The colours and the type Mae's stylesheet would have given it (tokens.css),
//     with the game's own rules from that stylesheet (the build puts them in OVERLAY_CSS).
//   - the button. The extension's button runs this script each time it's clicked: the first
//     time on a page starts the game, and after that it pauses it and resumes it.
//
// What hides a shot piece of the page has to be in the page's own styles, which this script
// isn't allowed to touch on every site: the extension adds that itself (page.css, background.js).

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Barnstorm } from "../../plugins/barnstorm/src/Barnstorm.tsx";
import { loadStore } from "./store.ts";

declare const OVERLAY_CSS: string; // the game's styles, put in by the build (scripts/extension-build.ts)

type Running = { toggle(): void };
const KEY = "__barnstormExtension";
const here = globalThis as unknown as Record<string, Running | undefined>;

if (here[KEY]) here[KEY].toggle(); // already up on this page: the button is pause and resume
else void start();

async function start() {
  const running: Running = { toggle() {} };
  here[KEY] = running; // (claimed before anything is awaited, so a quick second click doesn't start two)
  await loadStore();

  // Over everything on the page, taking no clicks itself: only the game's bar does.
  const host = document.createElement("div");
  host.id = "barnstorm-extension";
  for (const [k, v] of Object.entries({ all: "initial", position: "fixed", inset: "0", "z-index": "2147483647", "pointer-events": "none" })) host.style.setProperty(k, v, "important");
  const shadow = host.attachShadow({ mode: "open" });
  try {
    // (A stylesheet made here, not a <style> element: a strict page can refuse those.)
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(OVERLAY_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.appendChild(document.createElement("style")).textContent = OVERLAY_CSS;
  }
  const mount = shadow.appendChild(document.createElement("div"));
  document.documentElement.appendChild(host);

  const root = createRoot(mount);
  const land = () => { root.unmount(); host.remove(); delete here[KEY]; };

  function Game() {
    const [paused, setPaused] = useState(false);
    useEffect(() => { running.toggle = () => setPaused((was) => !was); }, []);
    return <Barnstorm paused={paused} onPause={() => setPaused(true)} onResume={() => setPaused(false)} onClose={land} />;
  }
  root.render(<Game />);
}
