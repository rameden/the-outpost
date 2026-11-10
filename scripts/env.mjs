// Loads a .env file from the camp folder, if there is one, before anything else starts.
// (An API key in .env is only needed for the API runtime; on a Claude subscription there's
// usually no .env at all, and that's fine: nothing is printed about it either way.)
// Values already set in your shell are kept as they are.
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); }
  catch (e) { console.error(`Couldn't read .env: ${e.message}`); }
}
