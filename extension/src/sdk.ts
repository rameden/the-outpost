// @outpost/sdk, as the extension has it: the same few things the game takes from the Outpost
// (ui/src/plugins/sdk.ts), except that what it remembers is kept in the extension's storage.
export { storeGet, storeSet } from "./store.ts";
export { cx } from "../../ui/src/format.ts";
export { cap, w } from "../../ui/src/words.ts";
export { packNow } from "../../ui/src/themes.ts";
export type { GameProps, OutpostPlugin, PluginManifest } from "../../ui/src/plugins/types.ts";
