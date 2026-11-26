// HD Orbit, as the Outpost lists it (Settings → Plugins). Small on purpose: it's in the page's
// main script. The lens itself (index.tsx, with its WebGL renderer) is fetched only when it's on.
import type { PluginManifest } from "@outpost/sdk";

const manifest: PluginManifest = {
  id: "orbit-hd",
  name: "HD Orbit",
  about: "Orbit in three dimensions: lit worlds round a sun of plasma, made up from a number you can reroll, and each one yours to remake.",
  adds: ["An HD button (and H) in Orbit's top bar", "Reroll and Spiral while it's on", "A world maker in each planet's panel"],
};
export default manifest;
