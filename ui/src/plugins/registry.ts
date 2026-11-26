// The plugins this Outpost ships with (each a package under plugins/, see types.ts), and whether
// each is on. Their manifests are here, small, in the page's main script; the plugins themselves
// are fetched only once they're on and wanted. A plugin with nothing saved for it is on: turning
// one off (Settings → Plugins) is what's kept, as { plugins: { [id]: false } } in the settings.

import { lazy, useEffect, useState, type ComponentType } from "react";
import barnstorm from "@outpost/barnstorm/manifest";
import orbitHd from "@outpost/orbit-hd/manifest";
import type { CampState } from "../types.ts";
import type { GameProps, OutpostPlugin, PluginManifest } from "./types.ts";

export type PluginId = "orbit-hd" | "barnstorm";

export const PLUGINS: (PluginManifest & { id: PluginId })[] = [
  { ...orbitHd, id: "orbit-hd" },
  { ...barnstorm, id: "barnstorm" },
];

const LOAD: Record<PluginId, () => Promise<{ default: OutpostPlugin }>> = {
  "orbit-hd": () => import("@outpost/orbit-hd"),
  barnstorm: () => import("@outpost/barnstorm"),
};

export const pluginOn = (S: CampState | null | undefined, id: PluginId): boolean => S?.settings?.plugins?.[id] ?? true;
export const manifestOf = (id: PluginId) => PLUGINS.find((p) => p.id === id)!;

// A plugin, once it's loaded (null until then, and while it's off: nothing of it is fetched until it's wanted).
const loaded = new Map<PluginId, OutpostPlugin>();
export function usePlugin(id: PluginId, wanted: boolean): OutpostPlugin | null {
  const [plugin, setPlugin] = useState<OutpostPlugin | null>(() => loaded.get(id) ?? null);
  useEffect(() => {
    if (!wanted || plugin) return;
    let live = true;
    LOAD[id]().then((m) => { loaded.set(id, m.default); if (live) setPlugin(m.default); }, (err) => console.error(`The ${id} plugin wouldn't load`, err));
    return () => { live = false; };
  }, [id, wanted, plugin]);
  return wanted ? plugin : null;
}

// A plugin's game, as a component to put in a Suspense (it's fetched the first time it's shown).
const NO_GAME: ComponentType<GameProps> = () => null;
export const gameOf = (id: PluginId) => lazy(() => LOAD[id]().then((m) => { loaded.set(id, m.default); return { default: m.default.Game ?? NO_GAME }; }));
