// Which GitHub account the GitHub CLI (gh) is using, and switching between the ones you're
// signed in to: the same as `gh auth switch --user <name>`, from a button in mission control.
// It changes gh's active account for github.com, which is what `gh pr create` uses, and git too
// if gh is your git credential helper (`gh auth setup-git`).
//
// Only you switch it (from the page, which needs this launch's key). No agent has a tool for it.

import { execFile } from "node:child_process";

const HOST = "github.com";
const TIMEOUT_MS = 15_000;

export type GithubAccount = { login: string; active: boolean; ok: boolean };
export type GithubStatus = { available: true; accounts: GithubAccount[] } | { available: false; reason: string };

// ---------- Running gh ----------
// Every place the camp runs the GitHub CLI goes through here: the same program (CAMP_GH points at
// another gh; the tests use a stand-in), and the same environment (it never stops to ask, pages
// nothing, and prints no colour codes).
const ghPath = () => process.env.CAMP_GH || "gh";
const ghEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GH_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0" });
export type GhOptions = { cwd?: string; timeout?: number; maxBuffer?: number; signal?: AbortSignal; input?: string };
// What gh printed. A failure is the error as node gives it (code "ENOENT" when gh isn't installed),
// with stdout and stderr on it: each caller says what that means where it's shown.
export function gh(args: string[], o: GhOptions = {}): Promise<string> {
  return new Promise((done, fail) => {
    const child = execFile(ghPath(), args, { cwd: o.cwd, timeout: o.timeout ?? 60_000, maxBuffer: o.maxBuffer ?? 8 * 1024 * 1024, signal: o.signal, encoding: "utf8", env: ghEnv() },
      (err, stdout, stderr) => (err ? fail(Object.assign(err, { stdout, stderr })) : done(stdout)));
    child.stdin?.on("error", () => { /* it exited before reading: the callback reports why */ });
    child.stdin?.end(o.input ?? "");
  });
}

// A check on a pull request, as gh or GitHub's API describes it: did it fail, and is it still going?
const checkResult = (c: any) => String(c?.conclusion || c?.state || c?.status || "");
export const checkFailed = (c: any) => /FAIL|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED/i.test(checkResult(c));
export const checkPending = (c: any) => /PENDING|QUEUED|IN_PROGRESS|EXPECTED|WAITING/i.test(checkResult(c));

// ---------- Which account ----------
async function ghAuth(args: string[]): Promise<string> {
  try { return await gh(args, { timeout: TIMEOUT_MS }); }
  catch (e: any) {
    if (e?.code === "ENOENT") throw new Error("The GitHub CLI (gh) isn't installed.");
    // `gh auth status` exits 1 when an account's token has a problem, but still prints its JSON.
    if (!String(e?.stdout ?? "").trim()) throw new Error(String(e?.stderr || e?.message).trim());
    return e.stdout;
  }
}

export async function githubStatus(): Promise<GithubStatus> {
  try {
    const out = JSON.parse(await ghAuth(["auth", "status", "--json", "hosts", "--hostname", HOST]));
    const list: any[] = out?.hosts?.[HOST] ?? [];
    const accounts = list
      .filter((a) => typeof a?.login === "string" && a.login)
      .map((a) => ({ login: String(a.login), active: a.active === true, ok: a.state === "success" }));
    if (!accounts.length) return { available: false, reason: "gh isn't signed in to github.com. Run `gh auth login`." };
    return { available: true, accounts };
  } catch (e: any) {
    return { available: false, reason: e.message };
  }
}

// Switch to `login`, or with no name, to the account that isn't active (when there are two).
export async function switchGithub(login?: string): Promise<GithubStatus> {
  const now = await githubStatus();
  if (!now.available) throw new Error(now.reason);
  const others = now.accounts.filter((a) => !a.active);
  const target = login ? now.accounts.find((a) => a.login === login) : others.length === 1 ? others[0] : undefined;
  if (!target) {
    throw new Error(login
      ? `${login} isn't one of the accounts gh is signed in to (${now.accounts.map((a) => a.login).join(", ")}). Add it with \`gh auth login\`.`
      : "Say which account to switch to.");
  }
  if (!target.active) await ghAuth(["auth", "switch", "--hostname", HOST, "--user", target.login]);
  const after = await githubStatus();
  if (after.available && !after.accounts.find((a) => a.login === target.login)?.active) throw new Error(`gh didn't switch to ${target.login}.`);
  return after;
}
