// The page's plugins: each is on until it's turned off, only what's off is kept, and a name that isn't one is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("plugins");
const { pluginsSet, setPlugin } = await import("../src/settings.ts");

test("plugins are on until turned off, and only what's off is kept", () => {
  assert.deepEqual(pluginsSet(), {});
  setPlugin("barnstorm", false);
  setPlugin("orbit-hd", true);
  assert.deepEqual(pluginsSet(), { barnstorm: false });
  setPlugin("barnstorm", true);
  assert.deepEqual(pluginsSet(), {});
});

test("a name that isn't a plugin's is refused", () => {
  assert.throws(() => setPlugin("../camp", false), /isn't a plugin's name/);
  assert.throws(() => setPlugin("Barnstorm", false), /isn't a plugin's name/);
});
