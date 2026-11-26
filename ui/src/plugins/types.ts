// What a plugin is, to the Outpost. A plugin is a package of its own (plugins/<name>, with a
// package.json) in two parts:
//   - its manifest (the package's "./manifest"): small, and in the page's main script, so
//     Settings → Plugins can list it and the page knows what it adds without loading it;
//   - the plugin itself (the package's "."): fetched only when it's on and first wanted.
// What it can bring is what the Outpost has a place for: a lens for Orbit (orbit/lens.ts), and a
// game over the page (it gets the row at the end of the top bar's ··· menu, and maybe a key sequence).
// Plugins reach the Outpost only through its SDK (@outpost/sdk, plugins/sdk.ts).

import type { ComponentType } from "react";
import type { OrbitLens } from "../orbit/lens.ts";

export type GameProps = { paused?: boolean; onPause?: () => void; onResume?: () => void; onClose: () => void };

export type PluginManifest = {
  id: string;            // as it's kept in settings: lowercase letters, digits and dashes
  name: string;
  about: string;         // a line on what it adds
  adds: string[];        // where it shows, in a few words each ("A view in Orbit", "A row in the ··· menu")
  // A way to start it from anywhere (a key sequence, say): installs a listener, and answers how to take it away.
  summon?: (start: () => void) => () => void;
};

export type OutpostPlugin = {
  orbitLens?: OrbitLens;
  Game?: ComponentType<GameProps>;
};
