---
name: pr-description
description: Use when asked to write a PR title and description for code changes in a linked repo.
---

# PR title and description

1. **Find the repo's rules first.** Look for `.github/PULL_REQUEST_TEMPLATE.md` (or a `PULL_REQUEST_TEMPLATE/` folder), plus CONTRIB.md, CONTRIBUTING.md or AGENTS.md for title format and size limits. Keep the template's headings in order, and add your own sections after them.
   - mi-web-app: `feat(scope): subject (TICKET)`.
   - meltwater-chatbot: `MIRA-####: Imperative subject (PR#)`, with a 400 LoC limit. If the ticket is in another project (for example MP-123), use that key and leave `(PR#)` as written.
2. **Read the real diff** with read-only git: `status --short` (for new files), `diff --stat HEAD`, then `diff HEAD`. Check every claim in your brief against the code. Report anything that disagrees, or anything the brief left out (side effects, limits, extra fixes).
3. **Body:** a 2–3 line summary of what it does for users, then changes grouped by area with file names, then testing (the commands run and their results, and what was *not* tested), then notes for reviewers (sign-offs needed, behavior changes, known limits).
4. **Pairs of PRs across repos:** name the other PR, say which one deploys first, and leave an `<!-- add PR link -->` placeholder.
5. **Size:** if the PR is over the repo's LoC limit, say so with the line counts and suggest one split point.
6. Write for senior reviewers: keep it terse, use bullets, and keep each body under about 60 lines so it can be pasted as is. Never commit, push or open the PR.
   - **A PR that's already open:** read it first (`pull_request` view, then diff) and keep what its author put there on purpose (linked issues, checklists, screenshots). When the user asks you to update it, call `describe_pull_request` with the whole new description (and a title only if it should change). They see the exact text and approve it, or send it back with changes. Never update one unasked.
7. **Return:** the file paths, the final titles, the endpoints or public APIs touched, and any differences from the brief.
