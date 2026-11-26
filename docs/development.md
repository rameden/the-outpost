# Development

[← Back to the README](../README.md)

The page is a React app in `ui/` (React 19, TypeScript, plain CSS, Vite).

```bash
npm start -- --dev  # the star chart, with each outpost's page reloading as you edit
npm run ui          # Mae alone, plus Vite: page edits reload live (restart it for edits under src/)
npm run ui:serve    # the outpost alone, serving the built page
npm run prod        # production: typecheck, build the page and the server (dist/server.js), run it with plain node
npm run prod:start  # run the last prod build again, without rebuilding (a restart in ~0.3 s)
npm test            # the outpost's tests, then the page's; no API key or Claude login needed
npm run typecheck   # source, tests, evals, scripts, the page, and the extension
npm run eval        # standard tasks against the real API (spends tokens)
npm run tour:films  # rebuild the Tour's films after the app changes
npm run extension:build   # Barnstorm, the plane game, as a Chrome extension (extension:pack zips it)
```

- The feed is a pure function of the outpost's events (`ui/src/feed/reducer.ts`), so that's where to look first when the feed shows something wrong.
- The page's types come from the server's code (`ui/src/types.ts`), so `npm run typecheck` fails if the two disagree.
- Tests run each file in a throwaway outpost against a fake streaming API. CI (`.github/workflows/ci.yml`) runs the types and the whole suite on every pull request.
- The built-in crew is defined in `src/crew.ts` and `src/roster.ts`, with skills in `skills/<id>/`. Crew members you add from the page live in `camp/crew.json`.
- The Barnstorm extension (`extension/`) puts the plane game over any web page; [`extension/README.md`](../extension/README.md) covers loading it in Chrome and handing it to someone.
