# Evals

Evidence that the crew does what it should: single answers, the orchestration loop, and Auto's choice of model.

| What | Command | Calls a paid model? |
| --- | --- | --- |
| Check the cases and rehearse the loop rules | `npm run eval -- --dry` | No (part of `npm test`) |
| Score Auto routing against labelled tasks | `npm run eval:routing` | No (part of `npm test`) |
| Summarise the routing log | `npm run routing:report` | No |
| Run the cases | `npm run eval` | **Yes** |
| Compare a saved run with the baseline | `npm run eval -- --compare-only evals/results/<time>.json` | No |

## Running the cases

```bash
npm run eval                                # every case, with your current model settings
npm run eval -- loop-plan-order             # just these cases
npm run eval -- --set scout=auto:economy    # try other models without changing your settings
npm run eval -- --trials 3                  # each case three times: a pass rate, not one coin toss
npm run eval -- --list                      # what the cases are
```

Each case runs in its own process and a throwaway camp, capped at $2 (`EVAL_CASE_BUDGET`). One pass over all 19 cases cost about $0.60 when the baseline was recorded (most cases a few cents, the loop cases $0.02 to $0.08 each). The run is printed and saved to `evals/results/<time>.json` (local, not committed).

A case passes when every **required** check passes. Checks are plain rules over what happened (the files, the tool calls, the order of events); the judge (a Claude model reading the answer) is used only where a rule can't decide. `--no-judge` skips it.

### The loop cases

The `loop-*` cases (`evals/loop.ts`) are about the orchestration loop, not one answer. There is one for each part:

| Case | What it holds the loop to |
| --- | --- |
| `loop-plan-order` | The plan marks what can run together and what must wait, and the waiting step goes out only once the others are back |
| `loop-right-crew` | Code goes to the Artificer, writing to the Scribe, and nobody else touches the code |
| `loop-review-after-change` | After files change in a linked folder, the Warden reviews, and changes nothing |
| `loop-ask-before-plan` | A request missing one fact gets a question before a plan or a dispatch |
| `loop-resume-no-repeat` | A task picked up after being cut off doesn't send its notification twice (`src/oplog.ts`) |
| `loop-fix-after-check` | A failing check in the folder sends the work back, and the run ends with the checks passing |
| `loop-budget-stop` | A budget stops the run, the answer says so, and the remaining steps never start |

Their rules are all deterministic: none goes to the judge. Each case carries a **rehearsal**: a made-up good run its rules must pass, and made-up bad runs, each of which must fail the rule it names. `--dry` runs the rehearsals, so a rule that can't fail (or can't pass) is caught without calling a model. `tests/evals-loop.test.ts` goes further and runs the cases end to end against a scripted stand-in for the API.

To add one: write the case in `evals/loop.ts` with its `covers` part and rehearsal, and run `npm run eval -- --dry`.

## The baseline, and comparing with it

`evals/baseline.json` is committed. Per case it holds the pass rate over N trials, the middle (median) cost, tokens and seconds of those trials, and the models the crew ran on:

```json
"scout-local-lookup": { "trials": 3, "passRate": 1, "cost": 0.03, "tokens": { "in": 30000, "out": 400 }, "models": ["Scout: haiku-5-5 · low"], "seconds": 12 }
```

```bash
npm run eval -- --compare                    # run, then compare with evals/baseline.json
npm run eval -- --compare other.json         # ...or with another baseline file
npm run eval -- --compare-only evals/results/<time>.json   # compare a run you already have; runs nothing
```

What the comparison says about each case:

- **Clear regression**: the pass rate is down by half or more, over at least two failed trials. This is the only thing that fails the run (exit 1).
- **Slipped**: the pass rate is down, but not that far. Shown, never fails.
- **Costs more**: the cost or tokens are more than 1.5× the baseline's. Shown, never fails.
- **Better**, **new** (not in the baseline), and how many were unchanged or not run.

One bad run is not a regression. With `--compare`, a case that fails and passes in the baseline is run again, up to three trials in all, before anything is said about it. So a weekly run can use one trial per case and pay for more only where something failed.

With no baseline recorded, `--compare` has nothing to compare with and a failed case fails the run, as it does without the flag.

### The recorded baseline

The committed baseline was recorded on 2026-11-26, on the subscription runtime (`claude-code`) with the default models: five trials of each of the 19 cases (about $2.92), then five more of `scribe-summary` and `loop-plan-order` after those two cases were changed (about $0.41). Eighteen cases pass all five times.

`scribe-summary` passed 2 of 5, and that was the Scribe, not the case. In the three failed trials the summary ended with a "Next steps" line saying Lee will "report back" on the waitlist numbers; the notes only say "Lee to check numbers". The line comes from the Scribe's house style (`skills/scribe/house-style/SKILL.md`: end with "Next steps" only if there genuinely are next steps). The house style now says that line states only what the source says. That change has not been run yet, so the baseline line (0.4) is from before it: record it again with `npm run eval -- --trials 5 --write-baseline scribe-summary`. Under 0.5 the comparison can't call a clear regression on a case.

What the first five-trial run found, and what was changed for it:

- `scribe-summary` also failed on "Nov 25 is today": the run happened on a date in the notes. The notes now count in sprints, so no date in them can be the day of the run. The judge's rule is spelled out: other words and shorter are fine, anything added is not (a name, a date, a reason, what day it is, a task nobody took on).
- `loop-plan-order` failed once when the stand-in for the user said no to a command the Artificer asked to run. The stand-in now says yes to an approved command said another of the usual ways: `./` before a path, quotes round a plain word, ` 2>&1` on the end, the sandbox's own folder spelled out, or stepping into a folder first (`cd tools && node count-teams.mjs` for `node tools/count-teams.mjs`). Anything added to the command is still a no (`approvesShell` in `cases.ts`). It has passed 5 of 5 since.
- A failed trial now lists what the stand-in said no to (`said no to (shell): …`), and the results file keeps it under `declined`, so a run that stopped because something was refused shows what it was.

To record one or two cases again and leave the other lines as they are, name them: `npm run eval -- --trials 5 --write-baseline scribe-summary`.

The baseline says which runtime and models it was recorded with. If CI is given an `ANTHROPIC_API_KEY`, record it again the way CI runs (the API, default models), or the weekly comparison is against a different setup:

- In GitHub: Actions → Evals → Run workflow, tick **baseline**. It runs every case three times. Download `baseline.json` from the run's artifact and commit it as `evals/baseline.json`.
- Or on your machine, with the key in `.env`: `CAMP_RUNTIME=api npm run eval -- --trials 3 --write-baseline`, then commit the file.

### Re-baselining

When a change is meant to move the numbers (a new model, a prompt you rewrote, a case you changed):

```bash
npm run eval -- --trials 3 --write-baseline                    # everything
npm run eval -- --trials 3 --write-baseline loop-plan-order    # just these; the other cases keep their lines
```

Commit `evals/baseline.json` with the change that caused it, and say why in the pull request. If a case is removed or renamed, take its line out of the baseline: `--dry` (and so `npm test`) fails on a line for a case that no longer exists. No baseline is written if a case crashed.

## Auto routing

`npm run eval:routing` scores Auto's decisions (`src/routing.ts`) against `evals/routing-cases.ts`: realistic tasks, each labelled with the model a careful person would expect. It prints accuracy overall and by kind of work, stakes and preference, every miss (too weak or stronger than needed), and the expected spend against always using the biggest model. Nothing is called: the decision is pure.

`evals/routing-floor.json` is the committed floor. `npm test` (and `npm run eval:routing -- --check`) fails if accuracy, any kind of work, or the saving falls below it, or if more picks than allowed are too weak. The misses known when the floor was set are listed in `accepted`; a new one is named in the failure. When routing gets better, raise the floor and trim `accepted` in the same change.

## Routing in practice

`npm run routing:report` reads the routing log the camp keeps (`camp/routing.jsonl`; or pass a path) and prints how often each model was picked, how often a pick was followed by a failure, a retry on another model or an escalation, and an estimate of the spend saved against always using the biggest model. `--json` gives the numbers; `--fixtures` counts scripted runs too. The report has no task text in it. The logic is `src/routing-summary.ts`; its tests use a made-up log (`tests/fixtures/routing-log.jsonl`).

## In CI

`.github/workflows/evals.yml` runs the cases weekly and by hand (only when the repository has an `ANTHROPIC_API_KEY` secret), compares with the baseline, puts the comparison table in the job summary, and fails only on a clear regression. The offline parts (`--dry`, the routing floor, the comparison's own tests) run on every pull request as part of `npm test`.
