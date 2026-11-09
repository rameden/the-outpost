---
name: commit-message
description: Use when the user asks to write, suggest, or create a git commit message for their changes.
---

# Writing commit messages

1. Run `git diff --staged` to see what is staged. If nothing is staged, run `git diff` and tell the user nothing is staged yet.
2. Write the message in Conventional Commits form: `type(scope): summary`
   - type is one of: feat, fix, refactor, docs, test, chore
   - summary is imperative ("add", not "added"), under 60 characters, no trailing period
3. If the change needs explaining, add a blank line and a short body saying *why*, not *what*.
4. Show the message to the user. Only run `git commit` if they explicitly asked you to commit.
