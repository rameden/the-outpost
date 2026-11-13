---
name: pr-review-triage
description: Use when asked to pull a branch and collect, triage, or address review comments on an open GitHub PR.
---

# PR review triage

## 1. Sync, don't guess
- `git status -sb` first. If the branch has no upstream, plain `git pull` fails: use `git pull --ff-only origin <branch>`.
- Confirm local HEAD equals the PR's `headRefOid` (`gh pr view --json number,url,title,reviewDecision,headRefOid`). If they differ, say so before reading comments.

## 2. Fetch all four sources (always `--paginate`), save raw JSON to /tmp/pr-<repo>-<n>/
1. Inline review comments: `gh api --paginate repos/<o>/<r>/pulls/<n>/comments`
2. Review bodies: `.../pulls/<n>/reviews`
3. Conversation comments: `repos/<o>/<r>/issues/<n>/comments`
4. Thread state via GraphQL: `pullRequest { reviewThreads(first:100) { nodes { isResolved isOutdated comments(first:20) { nodes { databaseId body path line author { login } } } } } }`

Skip resolved threads and pure noise (deploy tables, "comment @claude review" prompts, review-summary bodies that only repeat inline comments). Keep real review content from bots (Copilot etc.). List every skip in one line.

## 3. Triage each comment
For each: link, author (human/bot), file:line, a one-line paraphrase, category (bug/security/style/test/nit/question), **valid or not and why** (read the code it points at, and the real cause if it's elsewhere), proposed fix (files + what changes), and whether it conflicts with a decision recorded in the wiki or the brief. Never silently "fix" a recorded product decision. Flag it instead.

## 4. Fixing
- Smallest change in the file's style. Fix in priority order (security, then bugs, then contract, then nits). Note PR size limits if the repo has one.
- One spec per fix. Prove it: break the fix on purpose, see only that spec fail, restore the file and `cmp` it.
- If a suggested approach turns out wrong for the code (different ownership rules, unsupported option), stop on that comment and report why.
- Compare lint per rule against HEAD (`git show HEAD:<path> | npx eslint -f json --stdin --stdin-filename <path>`), never with a repo-wide `--fix` script.

## 5. Never
Commit, push, reply on or resolve PR threads unless the request says to.

## Pitfalls
- Under @swc/jest, `jest.spyOn(crypto, ...)` doesn't reach the module under test. Use a pass-through `jest.mock("crypto", ...)` factory.
- Mongoose indexes added in a schema only exist if autoIndex is on. Check, and warn that a failed unique-index build (because duplicates already exist) is silent.
