// A labelled set of realistic tasks for Auto: what was asked, by whom, how big the request is, and
// the model a careful person would expect to see chosen. evals/routing.ts scores Auto against it,
// offline (src/routing.ts is pure, so nothing here calls a model).
//
// How the labels were set. They are written from the task, not from what Auto picks today, so a
// miss is a finding, not a mistake in the set:
//   - Read-only work where a wrong answer costs a re-ask (a lookup, a short recap, small talk): the
//     small model. When it has to hold a lot together, or the answer will be acted on, Sonnet too.
//   - Ordinary changes to code or text: Sonnet. Cosmetic ones: the small model or Sonnet.
//   - Work where a subtle mistake ships (concurrency, retries, sign-in, payments): Opus or better.
//   - Destructive or production changes, and anything with secrets: Opus or the biggest model.
//   - Read-only work about a risky subject: Sonnet or Opus (care, but nothing is changed).
//   - Fixes that keep failing: a step up from the model in use.
//   - Quality asks for the strongest; Economy may not go below what the task needs.
// `expect` lists every tier that would be a sensible choice; anything weaker is under-routed (a
// quality risk), anything stronger is over-routed (money).

import type { AutoPreference, SessionState, Tier } from "../src/routing.ts";

export type RoutingKind = "search" | "explanation" | "summary" | "editing" | "debugging" | "review" | "planning" | "chat";
export type Stakes = "low" | "normal" | "high" | "critical";
export type RoutingCase = {
  id: string;
  kind: RoutingKind;        // the kind of work, as a person would name it
  stakes: Stakes;           // what a mistake would cost
  text: string;             // the request
  role?: string;            // the crew member it went to
  size?: "small" | "medium" | "large"; // the request with its context (default small)
  context?: string;         // the accepted plan or the turn before, for a short follow-up
  mode?: AutoPreference;    // default balanced
  images?: boolean;
  web?: boolean;            // needs Claude's own web tools
  evidence?: string[];      // what failing checks have said while working
  session?: Partial<SessionState>; // mid-task: the model in use, what set off the new decision
  budgetLeftUsd?: number;
  expect: Tier[];
  why: string;              // the label, in a sentence
};

export const SIZE_TOKENS = { small: 6_000, medium: 30_000, large: 110_000 } as const;

const SONNET_MEDIUM = "claude-sonnet-5-5@medium";

export const ROUTING_CASES: RoutingCase[] = [
  // ---------- Search ----------
  { id: "search-symbol", kind: "search", stakes: "low", role: "scout", text: "Where is `planSteps` defined, and which files call it?",
    expect: ["haiku"], why: "A lookup: a miss costs one more question." },
  { id: "search-config", kind: "search", stakes: "low", role: "scout", text: "Find the file that sets the default port for the dev server.",
    expect: ["haiku"], why: "A lookup." },
  { id: "search-todos", kind: "search", stakes: "low", role: "scout", size: "medium", text: "List every TODO comment in the scheduler module.",
    expect: ["haiku"], why: "A mechanical listing." },
  { id: "search-web-prices", kind: "search", stakes: "low", role: "scout", web: true, text: "Look up the current price per million tokens for the three cheapest hosted embedding models and cite the pages.",
    expect: ["haiku", "sonnet"], why: "A web lookup with citations; nothing is changed." },
  { id: "search-old-logger", kind: "search", stakes: "low", role: "scout", size: "large", text: "Which files across the whole repo still import the old logger?",
    expect: ["haiku", "sonnet"], why: "A wide but mechanical search." },
  { id: "search-credentials-use", kind: "search", stakes: "high", role: "scout", size: "medium", text: "Find everywhere we read credentials from the environment so I can check nothing logs them.",
    expect: ["sonnet", "opus"], why: "Read-only, about a risky subject: care, not the biggest model." },
  { id: "search-research", kind: "search", stakes: "normal", role: "scout", web: true, text: "Compare the three most popular open-source vector databases and recommend one for a 10-million-row workload.",
    expect: ["sonnet"], why: "Research that ends in a recommendation someone will act on." },
  { id: "search-page-size", kind: "search", stakes: "low", text: "Which file sets the page size for the orders list?",
    expect: ["haiku"], why: "A lookup." },

  // ---------- Explanation ----------
  { id: "explain-function", kind: "explanation", stakes: "low", text: "Explain what `selectRoute` does when nothing reaches the quality floor.",
    expect: ["haiku", "sonnet"], why: "One function, read and explained." },
  { id: "explain-concept", kind: "explanation", stakes: "low", text: "What is the difference between a debounce and a throttle? Two sentences.",
    expect: ["haiku"], why: "A textbook answer." },
  { id: "explain-request-path", kind: "explanation", stakes: "normal", size: "medium", text: "Walk me through how a request travels from the composer to a crew member and back, across the server, the Quartermaster and the agent loop.",
    expect: ["sonnet"], why: "Several parts to hold together, but nothing is changed." },
  { id: "explain-oauth-expiry", kind: "explanation", stakes: "normal", size: "medium", text: "How does our OAuth sign-in flow decide a session has expired?",
    expect: ["sonnet", "opus"], why: "Read-only, about a risky subject." },
  { id: "explain-error-dialog", kind: "explanation", stakes: "low", images: true, text: "What does this error dialog mean?",
    expect: ["haiku", "sonnet"], why: "Reading a screenshot and saying what it says." },
  { id: "explain-regex", kind: "explanation", stakes: "low", text: "Explain this regular expression piece by piece: ^(?:[a-z0-9]+-)*[a-z0-9]+$",
    expect: ["haiku", "sonnet"], why: "A small, self-contained explanation." },

  // ---------- Summary ----------
  { id: "summary-meeting", kind: "summary", stakes: "low", role: "scribe", text: "Summarise these meeting notes into five bullet points.",
    expect: ["haiku"], why: "A short recap of a short text." },
  { id: "summary-incident-report", kind: "summary", stakes: "normal", role: "scribe", size: "large", text: "Write a one-page digest of this 80-page incident report for the leadership team.",
    expect: ["sonnet"], why: "A long input, and leadership will act on it." },
  { id: "summary-release-notes", kind: "summary", stakes: "low", role: "scribe", size: "medium", text: "Write release notes for the last twelve merged pull requests.",
    expect: ["haiku", "sonnet"], why: "Routine writing from a list." },
  { id: "summary-email-thread", kind: "summary", stakes: "low", text: "TL;DR of this email thread, and what do they need from me?",
    expect: ["haiku"], why: "A short recap." },
  { id: "summary-advisories", kind: "summary", stakes: "high", role: "scribe", size: "medium", text: "Summarise the security advisories that affect our dependencies this month.",
    expect: ["sonnet", "opus"], why: "Read-only, about a risky subject." },
  { id: "summary-tight-budget", kind: "summary", stakes: "low", role: "scribe", size: "medium", budgetLeftUsd: 0.03, text: "Give me a recap of this document.",
    expect: ["haiku"], why: "Three cents left: only the small model fits." },
  { id: "summary-decline-reply", kind: "summary", stakes: "low", role: "scribe", text: "Draft a polite reply declining the vendor's meeting invitation.",
    expect: ["haiku", "sonnet"], why: "A short piece of everyday writing." },

  // ---------- Editing ----------
  { id: "edit-typo", kind: "editing", stakes: "low", role: "artificer", text: "Fix the typo in the README heading.",
    expect: ["haiku"], why: "A one-word change." },
  { id: "edit-rename", kind: "editing", stakes: "low", role: "artificer", text: "Rename the function `loadCfg` to `loadConfig` and update its callers.",
    expect: ["haiku", "sonnet"], why: "Mechanical, and the compiler catches a miss." },
  { id: "edit-spacing", kind: "editing", stakes: "low", role: "artificer", text: "Change the header's spacing so the logo lines up with the nav.",
    expect: ["haiku", "sonnet"], why: "Cosmetic." },
  { id: "edit-health-endpoint", kind: "editing", stakes: "normal", role: "artificer", size: "medium", text: "Add a GET /health endpoint that returns the build version and uptime.",
    expect: ["sonnet"], why: "An ordinary small feature." },
  { id: "edit-dark-mode", kind: "editing", stakes: "normal", role: "artificer", size: "medium", text: "Add a dark-mode toggle to the settings component and remember the choice.",
    expect: ["sonnet"], why: "An ordinary small feature." },
  { id: "edit-shared-dates", kind: "editing", stakes: "normal", role: "artificer", size: "large", text: "Refactor the date handling across the API and the worker to use one shared helper.",
    expect: ["sonnet", "opus"], why: "A change in two places that must agree." },
  { id: "edit-drop-table", kind: "editing", stakes: "critical", role: "artificer", size: "medium", text: "Write a migration that drops the legacy_sessions table and backfills the new one.",
    expect: ["opus", "frontier"], why: "Destructive: a mistake loses data." },
  { id: "edit-idempotency-keys", kind: "editing", stakes: "high", role: "artificer", size: "medium", text: "Add idempotency keys to the payment capture call so a retry never charges twice.",
    expect: ["opus", "frontier"], why: "Payments and retries: a subtle mistake charges someone twice." },
  { id: "edit-contributing", kind: "editing", stakes: "low", role: "scribe", text: "Write a short CONTRIBUTING guide from the notes below.",
    expect: ["haiku", "sonnet"], why: "Everyday writing." },
  { id: "edit-go-ahead-plain", kind: "editing", stakes: "normal", role: "artificer", text: "go ahead",
    context: "Plan:\n1. Add a `lastSeen` column to the crew table.\n2. Show it on the Crew page.\n3. Add a test.",
    expect: ["sonnet"], why: "A short yes to an ordinary plan is the work the plan describes." },
  { id: "edit-go-ahead-secrets", kind: "editing", stakes: "critical", role: "artificer", text: "ok do it",
    context: "Plan:\n1. Rotate the production database credentials.\n2. Update the secrets in the deploy config.\n3. Restart the workers one at a time.",
    expect: ["opus", "frontier"], why: "A short yes to a plan that touches production secrets." },
  { id: "edit-unit-tests", kind: "editing", stakes: "normal", role: "artificer", text: "Write unit tests for the `parseChoice` function.",
    expect: ["haiku", "sonnet"], why: "Tests for one small function." },
  { id: "edit-call-sites", kind: "editing", stakes: "normal", role: "artificer", size: "large", text: "Update every call site of the old fetch wrapper in this module to the new client.",
    expect: ["sonnet"], why: "Many small edits of one kind." },
  { id: "edit-dedupe-totals", kind: "editing", stakes: "normal", role: "artificer", size: "medium", text: "Refactor the report module to remove the duplicated totals code.",
    expect: ["sonnet"], why: "Tidying repeated code: an ordinary refactor, whatever the word 'duplicated' suggests." },
  { id: "edit-lockfile", kind: "editing", stakes: "low", role: "artificer", text: "Update package-lock.json after bumping the React version.",
    expect: ["haiku", "sonnet"], why: "A lockfile, not a lock." },
  { id: "edit-author-field", kind: "editing", stakes: "low", role: "artificer", text: "Add an author field to the blog post front matter.",
    expect: ["haiku", "sonnet"], why: "An author, not auth." },
  { id: "edit-mid-task-follow-up", kind: "editing", stakes: "normal", role: "artificer", size: "medium", text: "Also add a null check where the avatar is read.",
    session: { trigger: "resume", incumbent: SONNET_MEDIUM, historyTokens: 30_000 },
    expect: ["sonnet"], why: "Routine work in the middle of a task stays on the model that has the context." },

  // ---------- Debugging ----------
  { id: "debug-undefined-avatar", kind: "debugging", stakes: "normal", role: "artificer", text: "The profile page crashes with 'cannot read properties of undefined' when the user has no avatar. Fix it.",
    expect: ["sonnet"], why: "A plain bug with a clear cause." },
  { id: "debug-flaky-test", kind: "debugging", stakes: "normal", role: "artificer", size: "medium", text: "The scheduler test is flaky on CI: it fails about one run in ten. Find out why and fix it.",
    expect: ["sonnet", "opus"], why: "Intermittent failures are usually timing: harder than they look." },
  { id: "debug-double-charge", kind: "debugging", stakes: "high", role: "artificer", size: "medium", text: "Orders are sometimes charged twice when the worker retries after a timeout. Find the race and fix it.",
    expect: ["opus", "frontier"], why: "A race in payments." },
  { id: "debug-deadlock", kind: "debugging", stakes: "high", role: "wizard", size: "large", text: "The import job hangs under load; I suspect a deadlock between the queue and the cache.",
    expect: ["opus", "frontier"], why: "Concurrency across two parts." },
  { id: "debug-checkout-500s", kind: "debugging", stakes: "critical", role: "wizard", size: "medium", text: "Production is returning 500s on checkout since the last deploy. Find the root cause.",
    expect: ["opus", "frontier"], why: "A live incident on the money path." },
  { id: "debug-unused-import", kind: "debugging", stakes: "low", role: "artificer", text: "The build fails with an unused import error in utils.ts.",
    expect: ["haiku", "sonnet"], why: "The error names the fix." },
  { id: "debug-same-failure-twice", kind: "debugging", stakes: "normal", role: "artificer", size: "medium", text: "The cache test still fails after the fix.",
    session: { trigger: "repeated_failure", incumbent: SONNET_MEDIUM, historyTokens: 40_000, repeatedFailures: 2 },
    expect: ["opus", "frontier"], why: "Two distinct fixes reproduced one failure: step up." },
  { id: "debug-risk-found", kind: "debugging", stakes: "high", role: "artificer", size: "medium", text: "Fix the failing notification test.",
    evidence: ["FAIL: duplicate notification: worker retry sent 2 notifications for order 42"],
    expect: ["opus", "frontier"], why: "The failing check shows a retry sending twice: a correctness risk the request didn't mention." },
  { id: "debug-off-by-one", kind: "debugging", stakes: "normal", role: "artificer", text: "The last page of results is always empty. Fix the pagination.",
    expect: ["sonnet"], why: "A plain bug." },

  // ---------- Review ----------
  { id: "review-small-diff", kind: "review", stakes: "low", role: "warden", text: "Review this diff: it renames two variables and tidies a comment.",
    expect: ["haiku", "sonnet"], why: "A cosmetic diff." },
  { id: "review-csv-export", kind: "review", stakes: "normal", role: "warden", size: "medium", text: "Review the pull request that adds CSV export to the reports page.",
    expect: ["sonnet"], why: "An ordinary feature." },
  { id: "review-token-refresh", kind: "review", stakes: "high", role: "warden", size: "medium", text: "Review the change to session token refresh before it merges; I'm worried about the authentication edge cases.",
    expect: ["opus", "frontier"], why: "Sign-in: the review is the last check before it ships." },
  { id: "review-migration", kind: "review", stakes: "critical", role: "warden", size: "medium", text: "Audit this migration script before we run it against production.",
    expect: ["opus", "frontier"], why: "The last look before a destructive run." },
  { id: "review-locking", kind: "review", stakes: "high", role: "warden", size: "medium", text: "Second opinion on the new locking in the job queue, please.",
    expect: ["opus", "frontier"], why: "Concurrency." },
  { id: "review-announcement", kind: "review", stakes: "low", role: "scribe", text: "Look over my draft announcement for wording and tone.",
    expect: ["haiku", "sonnet"], why: "Wording." },
  { id: "review-large-pr", kind: "review", stakes: "normal", role: "warden", size: "large", text: "Review this pull request: 40 files changed across several services.",
    expect: ["sonnet", "opus"], why: "Wide, but ordinary stakes." },

  // ---------- Planning ----------
  { id: "plan-copy-link", kind: "planning", stakes: "normal", role: "quartermaster", text: "Plan how to add a 'copy link' button to the share dialog.",
    expect: ["sonnet"], why: "A small feature." },
  { id: "plan-split-billing", kind: "planning", stakes: "high", role: "quartermaster", size: "medium", text: "Design the approach for splitting the monolith's billing code into its own service, including data ownership and the cut-over.",
    expect: ["opus", "frontier"], why: "An architecture decision on the money path that is expensive to undo." },
  { id: "plan-roadmap", kind: "planning", stakes: "normal", role: "quartermaster", text: "Draft a roadmap for the next quarter from these notes.",
    expect: ["sonnet"], why: "Ordinary planning from notes." },
  { id: "plan-db-move", kind: "planning", stakes: "critical", role: "quartermaster", size: "medium", text: "Propose a plan to migrate the production database to the new cluster with no downtime.",
    expect: ["opus", "frontier"], why: "Production data: the plan is where the mistake would be made." },
  { id: "plan-offsite", kind: "planning", stakes: "low", role: "quartermaster", text: "Plan a three-day itinerary for a team offsite in Lisbon.",
    expect: ["haiku", "sonnet"], why: "Nothing breaks if it's imperfect." },
  { id: "plan-screenshot-vs-design", kind: "planning", stakes: "normal", images: true, text: "Does this screenshot match the design? List the differences.",
    expect: ["sonnet"], why: "Careful looking, ordinary stakes." },

  // ---------- Chat ----------
  { id: "chat-thanks", kind: "chat", stakes: "low", text: "Thanks, that's all for today!",
    expect: ["haiku"], why: "Small talk." },
  { id: "chat-thanks-to-scribe", kind: "chat", stakes: "low", role: "scribe", text: "Thanks, that's all for today!",
    expect: ["haiku"], why: "Small talk, whoever it's said to." },
  { id: "chat-go-or-rust", kind: "chat", stakes: "low", text: "Which do you prefer for a small CLI, Go or Rust?",
    expect: ["haiku", "sonnet"], why: "An opinion." },
  { id: "chat-server-name", kind: "chat", stakes: "low", text: "Give me a name for the new staging server.",
    expect: ["haiku"], why: "A bit of fun." },
  { id: "chat-morning", kind: "chat", stakes: "low", role: "quartermaster", text: "Morning! What's on the board today?",
    expect: ["haiku", "sonnet"], why: "A greeting and a glance at the board." },

  // ---------- The preference you set ----------
  { id: "economy-pagination", kind: "editing", stakes: "normal", role: "artificer", size: "medium", mode: "economy", text: "Add pagination to the orders list endpoint.",
    expect: ["sonnet"], why: "Economy is the cheapest model that can do it, not the cheapest model." },
  { id: "economy-delete-rows", kind: "editing", stakes: "critical", role: "artificer", size: "medium", mode: "economy", text: "Delete all rows older than a year from the production events table.",
    expect: ["opus", "frontier"], why: "Economy doesn't cheapen a destructive change." },
  { id: "economy-sidebar-width", kind: "search", stakes: "low", role: "scout", mode: "economy", text: "Find which file defines the sidebar width.",
    expect: ["haiku"], why: "A lookup on Economy." },
  { id: "economy-cache-race", kind: "debugging", stakes: "high", role: "artificer", size: "medium", mode: "economy", text: "Fix the race condition in the cache warm-up.",
    expect: ["opus", "frontier"], why: "Concurrency, whatever the preference." },
  { id: "quality-csv-import", kind: "editing", stakes: "normal", role: "artificer", size: "medium", mode: "quality", text: "Implement the CSV import for contacts.",
    expect: ["opus", "frontier"], why: "Quality asks for the strongest." },
  { id: "quality-lookup", kind: "search", stakes: "low", role: "scout", mode: "quality", text: "Where is the page size for the orders list configured?",
    expect: ["opus", "frontier"], why: "Quality asks for the strongest, even for a lookup." },
];
