// Loads a .env file from the camp folder, if there is one, before anything else starts.
// (An API key in .env is only needed for the API runtime; on a Claude subscription there's
// usually no .env at all, and that's fine: nothing is printed about it either way.)
// Values already set in your shell are kept as they are.
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); }
  catch (e) { console.error(`Couldn't read .env: ${e.message}`); }
}

// Every setting read from the environment has an Outpost name too: OUTPOST_PORT is CAMP_PORT,
// OUTPOST_LAN is CAMP_LAN, and so on. The code reads the CAMP_ name, so an OUTPOST_ one is copied
// across here (and so reaches whatever this starts). A CAMP_ name that's set already wins: the star
// chart sets CAMP_PORT for each outpost it starts, and that has to hold.
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith("OUTPOST_") || value === undefined) continue;
  const old = "CAMP_" + name.slice("OUTPOST_".length);
  if (process.env[old] === undefined) process.env[old] = value;
}
