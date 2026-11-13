# Working in Ledgerline

Plain JavaScript (ES modules), Node 20 or later, no dependencies. There is nothing to install, in a fresh checkout or a new worktree: `npm test` works straight away.

## Conventions

- Money is whole cents (integers) everywhere. Text with a currency symbol is made only at the edge, by `formatMoney`.
- Dates are calendar dates as `"YYYY-MM-DD"` strings, worked out in UTC.
- Each file in `src/` has its tests in `test/<same name>.test.js`.
- Keep a change to what its ticket asks for. One ticket, one branch, one pull request.

## How bugs are tracked

A bug report lands on `main` together with tests that reproduce it. Those tests are marked with the ticket's key, like this:

```js
test("…", { todo: "LED-123" }, () => { … });
```

Node runs a `todo` test and shows its failure, but doesn't count it against the build, so `main` stays usable while the ticket is open.

A fix is done when:

1. the code is fixed where the fault is (never by changing what a test expects),
2. the `todo` marker is removed from that ticket's tests, so they count from now on, and
3. `npm test` passes.

Tests marked for other tickets stay as they are: they belong to those tickets.

## Commands

| Command | What it does |
|---|---|
| `npm test` | The whole suite |
| `npm test -- test/money.test.js` | One file |

## Pull requests

Title: `LED-123: What changed, in the imperative`. Fill in `.github/PULL_REQUEST_TEMPLATE.md`.
