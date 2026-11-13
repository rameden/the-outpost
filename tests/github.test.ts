// The header's GitHub account button: which account gh uses, and swapping between yours.
// A stand-in gh keeps the active account in a file, so your real gh sign-in is never touched.
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, NEEDS_SH } from "./helpers/sandbox.ts";

// Every test here runs against a shell-script stand-in (see NEEDS_SH): on Windows they're left out, and say so.
const test = (name: string, fn: () => void | Promise<void>) => nodeTest(name, { skip: NEEDS_SH }, fn);

const state = join(mkdtempSync(join(tmpdir(), "satchel-gh-")), "active");
process.env.CAMP_GH = join(REPO, "tests/fixtures/fake-gh.sh");
process.env.FAKE_GH_STATE = state;
process.env.FAKE_GH_ACCOUNTS = "rameden rameden-melt";
const { githubStatus, switchGithub } = await import("../src/github.ts");

const activeLogin = async () => { const s = await githubStatus(); return s.available ? s.accounts.find((a) => a.active)?.login : null; };

test("shows the signed-in accounts and which one is active", async () => {
  rmSync(state, { force: true });
  assert.deepEqual(await githubStatus(), {
    available: true,
    accounts: [{ login: "rameden", active: true, ok: true }, { login: "rameden-melt", active: false, ok: true }],
  });
});

test("with two accounts, a click swaps to the other one, and back", async () => {
  rmSync(state, { force: true });
  await switchGithub();
  assert.equal(await activeLogin(), "rameden-melt");
  assert.equal(readFileSync(state, "utf8").trim(), "rameden-melt", "gh auth switch --user rameden-melt ran");
  await switchGithub();
  assert.equal(await activeLogin(), "rameden");
});

test("only accounts gh is signed in to; with three, you name one", async () => {
  rmSync(state, { force: true });
  await assert.rejects(() => switchGithub("someone-else"), /isn't one of the accounts gh is signed in to \(rameden, rameden-melt\)/);
  process.env.FAKE_GH_ACCOUNTS = "rameden rameden-melt rameden-oss";
  try {
    await assert.rejects(() => switchGithub(), /Say which account/);
    await switchGithub("rameden-oss");
    assert.equal(await activeLogin(), "rameden-oss");
  } finally {
    process.env.FAKE_GH_ACCOUNTS = "rameden rameden-melt";
  }
});

test("no gh, or not signed in: the button stays hidden", async () => {
  process.env.CAMP_GH = join(REPO, "tests/fixtures/no-such-gh");
  try {
    assert.deepEqual(await githubStatus(), { available: false, reason: "The GitHub CLI (gh) isn't installed." });
  } finally {
    process.env.CAMP_GH = join(REPO, "tests/fixtures/fake-gh.sh");
  }
  process.env.FAKE_GH_ACCOUNTS = "";
  try {
    assert.match((await githubStatus() as { reason: string }).reason, /isn't signed in to github.com/);
  } finally {
    process.env.FAKE_GH_ACCOUNTS = "rameden rameden-melt";
  }
});
