// @outpost/sdk: all a plugin may import from the Outpost itself (the alias is set in
// ui/vite.config.ts and the tsconfigs). Keep it small and steady: a plugin built against it
// shouldn't break when the page's own files move about.

export { storeGet, storeSet } from "../api.ts";
export { cx, nameNow } from "../format.ts";
export { cap, w } from "../words.ts";
export { packNow } from "../themes.ts";
export { motionOK } from "../motion.tsx";
export { ease, lapOf, orbitOf, type Camera, type Point, type Spot } from "../orbit/scene.ts";
export { Slide, type Limit } from "../orbit/Slide.tsx";
export type { LensBody, LensFrame, LensProps, LensRuntime, OrbitLens } from "../orbit/lens.ts";
export type { GameProps, OutpostPlugin, PluginManifest } from "./types.ts";
