// Barnstorm, as the Outpost lists it (Settings → Plugins). Small on purpose: it's in the page's
// main script. The game itself is index.tsx, fetched only when it's first played.
import type { PluginManifest } from "@outpost/sdk";
import { onKonami } from "./konami.ts";

const manifest: PluginManifest = {
  id: "barnstorm",
  name: "Barnstorm",
  about: "Fly a plane over the page: wreck it, pop the gremlins, or take on a sortie. It pauses to give the page back, and comes back where you left it.",
  adds: ["A row at the end of the ··· menu", "The Konami code, from anywhere"],
  summon: onKonami,
};
export default manifest;
