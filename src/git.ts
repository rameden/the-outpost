// Read-only git for the whole crew: status, diff, log, show, and blame, in the camp or a linked
// repository (and the worktree an expedition works in, which links/<name> follows).
//
// Only the Artificer has a shell, so without this the others can read a file as it is now but
// can't tell what a change added: a Scribe writing up a change would have to guess.
//
// It never asks for approval, so it's narrow on purpose:
//   - git runs directly (no shell), only these five subcommands, never a pager or an editor
//   - flags that run programs or read files outside the repository are refused
//     (--ext-diff, --textconv, --no-index, --output, blame --contents, -O<file>…), and the
//     repository's own config can't switch them back on. That config may have been written by a
//     sandboxed command, and this git runs outside the sandbox, so everything in it that names a
//     program is overridden: external diff, textconv, fsmonitor, hooks, clean/smudge filters
//     (see gitSafeEnv in sandbox.ts). A submodule's working tree isn't examined, because git
//     would do that by running itself inside the submodule, under the submodule's config.
//   - secret files (.env, keys, credentials…) are left out of every result, by the same names
//     the file tools refuse, and can't be named as a path or rev:path

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { SECRET_NAME } from "./links.js";
import { campPath, clipOutput, type Tool } from "./tools.js";
import { currentSignal } from "./context.js";
import { gitFilterOverrides, gitSafeEnv } from "./sandbox.js";

export const GIT_SUBCOMMANDS = ["status", "diff", "log", "show", "blame"] as const;
type Sub = (typeof GIT_SUBCOMMANDS)[number];

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 4_000_000;

// Flags that run another program, read a file from outside the repository, or write a file.
const REFUSED_FLAG = /^(--output|--no-index|--ext-diff|--textconv|--contents|--ignore-revs-file|-O|--orderfile|--exec|--upload-pack|--open-files-in-pager|--show-signature|--git-dir|--work-tree|--config-env|--paginate|--ignore-submodules|--submodule)/;
// "status -v" prints a diff, and that diff applies the repository's textconv programs.
const STATUS_VERBOSE = /^(--verbose|-[a-zA-Z]*v)/;

// Left out of every diff, log, status, and show: the secret names the file tools refuse.
const SECRET_EXCLUDES = [
  "**/.env*", "**/*.pem", "**/*.key", "**/id_rsa*", "**/id_ed25519*", "**/id_ecdsa*", "**/.netrc", "**/.npmrc", "**/.pypirc",
  "**/.git-credentials", "**/credentials", "**/credentials.json", "**/*.p12", "**/*.pfx", "**/.ssh/**", "**/.aws/**", "**/.gnupg/**",
  "camp/**", // the camp's own records: agents' memory and sessions, your settings (gitignored, but just in case)
].map((g) => `:(exclude,glob,icase)${g}`);

// Why an argument isn't allowed, or null when it's fine.
export function refusedArg(arg: string, sub?: string): string | null {
  if (sub === "status" && STATUS_VERBOSE.test(arg)) return `status ${arg} isn't available here (its diff can run programs). Use diff for what changed.`;
  if (REFUSED_FLAG.test(arg)) return `${arg.split("=")[0]} isn't available here (it can run programs or read files outside the repository).`;
  if (/%G/.test(arg)) return "Signature checks (%G… formats) aren't available here.";
  if (arg.startsWith("-")) return null;
  // A path, a revision, or rev:path. Stay inside the repository and away from secrets.
  const path = arg.includes(":") ? arg.slice(arg.indexOf(":") + 1) : arg;
  if (path.startsWith("/") || path.startsWith("~") || /(^|\/)\.\.(\/|$)/.test(path)) return `${arg} points outside the repository.`;
  if (path.split("/").some((seg) => SECRET_NAME.test(seg))) return `${arg} looks like a secret (keys, .env, credentials) and is off limits.`;
  if (/^camp(\/|$)/.test(path)) return `${arg} is the camp's private record, not part of the project's history.`;
  return null;
}

// The command line for one request: fixed safety settings, the subcommand, its flags, and the
// secret excludes after "--" (blame takes exactly one file, so it gets no excludes).
export function gitArgs(dir: string, sub: Sub, args: string[]): string[] {
  const safety = [
    "-C", dir, "--no-pager",
    "-c", "core.pager=cat", "-c", "core.fsmonitor=false", "-c", "log.showSignature=false", "-c", "color.ui=false",
  ];
  if (sub === "blame") return [...safety, sub, "--no-textconv", ...args];
  // status and diff look at the working tree; "dirty" keeps git from running itself inside each
  // submodule to see whether it has uncommitted changes (a moved submodule commit still shows).
  const fixed = sub === "status" ? ["--ignore-submodules=dirty"] : ["--no-ext-diff", "--no-textconv", ...(sub === "diff" ? ["--ignore-submodules=dirty"] : [])];
  const split = args.indexOf("--");
  const flags = split >= 0 ? args.slice(0, split) : args;
  const paths = split >= 0 ? args.slice(split + 1) : [];
  return [...safety, sub, ...fixed, ...flags, "--", ...paths, ...SECRET_EXCLUDES];
}

// env: the camp's environment without its secrets, plus the settings that keep the repository's
// own config from running anything (gitSafeEnv).
function runGit(argv: string[], signal?: AbortSignal, env: NodeJS.ProcessEnv = gitSafeEnv()): Promise<string> {
  return new Promise((done) => {
    execFile("git", argv, {
      timeout: TIMEOUT_MS, maxBuffer: MAX_BYTES, signal, encoding: "utf8", env,
    }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return done("git isn't installed on this machine.");
      if (err && signal?.aborted) return done("Not run: the expedition was stopped.");
      if (err && (err as any).killed) return done(`git took longer than ${TIMEOUT_MS / 1000}s and was stopped. Narrow it (a path, -n 20, a revision range).`);
      if (err) return done(`git failed: ${(stderr || err.message).trim()}`);
      done(stdout.trim() ? stdout : "(no output)");
    });
  });
}

export function gitFor(self: string): Tool {
  return {
    def: {
      name: "git",
      description:
        "Read-only git, for seeing what changed: status, diff, log, show, blame. Runs in the camp, or in a linked repository " +
        "with in: \"links/<name>\" (the worktree your expedition works in, if it has one). Examples: " +
        "{subcommand: \"diff\", args: [\"HEAD\"]} (everything uncommitted), {subcommand: \"log\", args: [\"--oneline\", \"-n\", \"10\"]}, " +
        "{subcommand: \"show\", args: [\"--stat\", \"HEAD\"]}, {subcommand: \"diff\", args: [\"main...HEAD\", \"--\", \"src/app.tsx\"]}, " +
        "{subcommand: \"blame\", args: [\"-L\", \"10,40\", \"src/app.tsx\"]}. Paths are relative to the repository. " +
        "It can't change anything, and secret files (.env, keys) are left out.",
      input_schema: {
        type: "object",
        properties: {
          subcommand: { type: "string", enum: [...GIT_SUBCOMMANDS] },
          args: { type: "array", items: { type: "string" }, description: "Flags, revisions, and paths, one per item." },
          in: { type: "string", description: "The repository: \".\" (the camp, default) or links/<name>, or a folder inside one." },
        },
        required: ["subcommand"],
      },
    },
    run: async ({ subcommand, args = [], in: where = "." }) => {
      if (!GIT_SUBCOMMANDS.includes(subcommand)) return `Only ${GIT_SUBCOMMANDS.join(", ")} are available (git is read-only here).`;
      if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) return "args must be a list of strings, one flag, revision, or path each.";
      if (args.length > 40) return "That's too many arguments; narrow it down.";
      for (const a of args) {
        const why = refusedArg(a, subcommand);
        if (why) return why;
      }
      const dir = campPath(String(where), "read", self);
      if (!statSync(dir).isDirectory()) return `${where} is a file. Put the repository folder in "in" and the file in args.`;
      // status, diff and blame read working files through the repository's clean filters: switch those off.
      const filters = subcommand === "log" || subcommand === "show" ? [] : await gitFilterOverrides(dir);
      return clipOutput(await runGit(gitArgs(dir, subcommand as Sub, args), currentSignal(), gitSafeEnv(filters)));
    },
  };
}
