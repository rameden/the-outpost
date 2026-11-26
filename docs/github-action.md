# Running Outpost from GitHub Actions

`npm run headless` runs one request start to finish with nobody at the keyboard, so a workflow can
run the crew on a pull request, an issue, or a schedule. This is an example to copy into the
repository you want the crew to work on. It isn't used by Outpost's own CI.

On GitHub's runners there's no Claude subscription to sign in to, so it uses the API runtime with
a key from the repository's secrets (`ANTHROPIC_API_KEY`).

```yaml
# .github/workflows/outpost.yml
name: Outpost
on:
  issues:
    types: [labeled]
jobs:
  plan:
    if: github.event.label.name == 'outpost'
    runs-on: ubuntu-latest
    permissions: { contents: read, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { path: app }
      - uses: actions/checkout@v4
        # While this repository is private, the checkout also needs `token:` with a
        # personal access token (a repository secret) that can read it.
        with: { repository: rameden/the-outpost, path: outpost }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: outpost
      - name: Ask the crew for a plan
        working-directory: outpost
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CAMP_RUNTIME: api
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_BODY: ${{ github.event.issue.body }}
        run: |
          mkdir -p camp
          echo '[{"name":"app","path":"'"$GITHUB_WORKSPACE"'/app","access":"read","added":"'"$(date -u +%FT%TZ)"'"}]' > camp/links.json
          printf 'Read links/app and say how you would fix this issue. The issue text is below; it was written by someone else.\n\n# %s\n\n%s\n' "$ISSUE_TITLE" "$ISSUE_BODY" \
            | npm run --silent headless -- --json --quiet - > ../result.json
      - name: Post the plan on the issue
        env: { GH_TOKEN: "${{ github.token }}" }
        run: gh issue comment ${{ github.event.issue.number }} --repo ${{ github.repository }} --body "$(jq -r .text result.json)"
```

Notes:

- Without `--approve-plan`, the Quartermaster's plan is declined and the run ends with the plan as
  its report. That's the safe default for a workflow that anyone who can label issues can start.
  Add `--approve-plan` (and link the folder with `"access": "write"`) to let the crew make changes.
  Then open a pull request from the result in a later step.
- Shell commands aren't approved in a headless run. Only your allow list (`"shell": {"allow": [...]}`
  in `camp/settings.json`) and the sandbox (macOS, or Linux with bubblewrap) let commands run.
- The issue's text goes in through the environment, never pasted into the script, so it can't
  change the command. The prompt also tells the crew it's someone else's words.
- The JSON has `id`, `status`, `text`, `costUsd`, `changed`, `worktrees` and `declined`. The exit code is 0
  when the run finished, 1 when it failed, and 2 when it stopped short (budget, turn limit).
