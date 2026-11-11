---
name: ts-react-next
description: "Master rules for writing, fixing, reviewing and verifying TypeScript in React and Next.js, built to defer to each repo's own AI guidance (AGENTS.md, CLAUDE.md, .claude/ and .agents/ and .github/ skills, ADRs) and to Meltwater's mi-web-app conventions (Fjord, MUI sx, React Query, Apollo, Zustand, i18n). Use whenever the task touches .ts/.tsx files in a React or Next.js project — building components or pages, typing props or API calls, Server Components, Server Actions, caching, forms, state, effects, hydration or type errors, performance, accessibility, PR review, or \"make sure it works\" — even if the user just says \"fix this\" or \"add a feature\" in a frontend repo."
metadata:
  guild-title: "TypeScript · React · Next.js — master rules"
  guild-version: "1"
  guild-work-types: ""
  guild-pre-approved-commands: "[]"
---

# TypeScript · React · Next.js — master rules

Condensed from two MIT-licensed sources: [leejpsd/typescript-react-nextjs-patterns](https://github.com/leejpsd/typescript-react-nextjs-patterns) (© 2026 Lee Jungpyo) and [laguagu/claude-code-nextjs-skills](https://github.com/laguagu/claude-code-nextjs-skills) (© 2026 laguagu, including Vercel's react-best-practices, also covered in [aitmpl.com's write-up](https://aitmpl.com/blog/react-best-practices-skill/)). Everything you need is on this page.

**Precedence, highest first:**
1. The repo's own guidance: the nearest `AGENTS.md`/`CLAUDE.md`, then the root one, then repo skills, then accepted ADRs.
2. The installed framework version's docs.
3. This page.

This page fills gaps; it never overrides the repo.

Labels:
- **MUST** — breaking it causes bugs or security holes. No exceptions.
- **PREFER** — the default. Deviate only with a reason, and write that reason as a one-line comment at the deviation site so the next session sees it.

---

## 0. Load the repo's guidance first

Repos ship their own AI instructions and skills. They encode decisions this page can't know, so find and use them before anything else.

1. **Discover** what the repo provides. Pass the path you're about to edit:
   ```bash
   bash <this-skill>/scripts/discover_repo_guidance.sh <repo-root> <path/being/edited>
   ```
   It lists:
   - every `AGENTS.md` / `CLAUDE.md`, and the chain that applies to your path
   - the skills under `.claude/`, `.agents/` and `.github/`, grouped by name and with drifted copies flagged
   - commands, subagents and hooks
   - the ADR index with statuses
   - repo memory notes
   - the package manager and check scripts

   Without a shell, list those folders directly.
2. **Read the instruction chain.** Read the root `AGENTS.md`/`CLAUDE.md`, then every nested one between the root and your file. The nearest file wins on conflict.
3. **Load every repo skill whose description matches the task**, and its companion `AGENTS.md` if it has one. Prefer the copy at the path the root `AGENTS.md` cites. If copies differ, read both and mention the drift. If the instructions give "trigger text" for a mode, treat that mode as active.
4. **Read the accepted ADRs** for the area before non-trivial work, and the repo memory note for the feature if one exists.
5. **In `meltwater/mi-web-app`**, also read [`references/mi-web-app.md`](references/mi-web-app.md). It routes each task to the repo's skills and resolves every point where this page and the repo disagree.

Apply the repo's rules wherever they exist, and use this page for what they don't cover. If a repo rule looks wrong or risky (for example, it would skip input validation), follow the repo's escalation path instead of silently overriding it.

---

## 1. Ground truth first: the installed version beats memory

Framework APIs change faster than training data, so this skill (and your memory) may be stale. Before you change framework behaviour:

1. **Read the versions.** Check `package.json` for `next`, `react`, `typescript` and data/form/state libraries; `tsconfig.json` for `strict`; `next.config.*` for `cacheComponents`, `reactCompiler`, images and experimental flags. In a monorepo, read the app's own package.
2. **Read the installed docs and types.** Next 16.2+ ships its docs in `node_modules/next/dist/docs/`; find pages by file name (`find node_modules/next/dist/docs -name proxy.md`). Exact exports are in `node_modules/next/{server,navigation,headers,cache}.d.ts`. When local docs and this page disagree, local docs win.
3. **Keep the project's choices.** Keep its router, caching mode, runtime, package manager and libraries unless migration is requested. Use what's installed before adding anything, and check the repo's banned-library list first (mi-web-app bans SWR, axios, redux, moment and others).
4. **Know where the code runs.** Server Component, Client Component (`"use client"`), Server Action, Route Handler or proxy/middleware each have different rules. If App vs Pages Router is unclear, ask.

Version facts that older examples get wrong (check these against the installed docs):

| Version | What changed |
|---|---|
| Next 15+ | `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are Promises. Await them. |
| Next 16 | Sync request access is removed. `next typegen` (or dev/build) generates global `PageProps<'/route'>`, `LayoutProps`, `RouteContext`. |
| Next 16 | `middleware.ts` is deprecated for `proxy.ts` (exports `proxy`). It runs on **Node.js only** and accepts no `runtime` option; code that needs Edge stays in `middleware.ts`. |
| Next 16 | Turbopack is the default. `next lint` is removed and `next build` no longer lints, so run the linter yourself. Every parallel-route slot needs `default.tsx`. |
| Next 16 | `next/image`: `priority` → `preload`; `images.domains` → `remotePatterns`. `revalidateTag(tag)` needs a profile (`'max'` or `{ expire: 0 }`); `updateTag`/`refresh` work only in Server Actions. |
| React 19 | `ref` is a normal prop (no `forwardRef`). `useActionState` replaces `useFormState`. `<Context>` renders directly. `useEffectEvent` and `<Activity>` need 19.2. |
| TS | `satisfies` needs 5.0+, `NoInfer` 5.4+. |

Never assume:
- that existing `any`, `as` or effect deps are correct;
- that API data matches its type;
- that a server import is safe in client code.

---

## 2. Hard rules

### TypeScript
- **MUST** use `unknown` plus narrowing, never `any`. Narrow with `typeof`, `in`, `instanceof` or equality, not `as`.
- **MUST NOT** silence a type error with `as`, `any`, `@ts-ignore`, `!`, or a blind `| undefined`. Fix the cause (§6).
- **PREFER** `interface` for props and objects, `type` for unions; `as const` / `satisfies` over enums; inference inside functions and annotations at boundaries.
- **PREFER** discriminated unions over boolean flags, so impossible states can't be represented:

```ts
type State<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }
// in a switch on status, add: default: const _x: never = state  // exhaustive check
```

### Trust boundaries and security
- **MUST** validate external data at runtime (Zod or the project's validator). External data includes:
  - API responses
  - URL params and searchParams
  - FormData
  - localStorage
  - postMessage
  - environment variables

  Static types validate nothing. FormData values are `string | File | null`; searchParams values are `string | string[] | undefined`.
- **MUST** validate on both sides: on the client for UX, on the server for security.
- **MUST** treat every Server Action as a **public POST endpoint**. `"use server"` does not make it private, and being passed as a prop doesn't either. Inside each action: authenticate, authorize, validate. A proxy, middleware or layout check is only an optimistic redirect; authorize again where the data is read or written.
- **MUST NOT** store request data (user, session, tenant) in mutable module-level variables on the server. Concurrent renders share the process, and one user's data can leak into another's response. Pass request data as props or arguments.
- **MUST** add `import 'server-only'` to modules with secrets, DB access or server logic. Never return internal diagnostics in public responses.

```ts
const userSchema = z.object({ id: z.string(), name: z.string(), email: z.email() })
type User = z.infer<typeof userSchema>
const user = userSchema.parse(await res.json())   // not: const user: User = await res.json()

export const env = z.object({ DATABASE_URL: z.string().min(1), NEXT_PUBLIC_API_URL: z.url() })
  .parse(process.env)                              // once, at startup

'use server'
export async function createPost(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession()                       // 1. authenticate
  if (!session?.canPost) return { success: false, message: 'Not allowed' } // 2. authorize
  const parsed = postSchema.safeParse({ title: fd.get('title') })          // 3. validate
  if (!parsed.success)
    return { success: false, message: 'Invalid', errors: z.flattenError(parsed.error).fieldErrors }
  await db.post.create({ data: { ...parsed.data, authorId: session.userId } })
  return { success: true, message: 'Created' }
}
```

### React
- **MUST** type `children` as `React.ReactNode`. Wrapper components extend native attributes (`interface Props extends React.ComponentProps<'button'>`). Use `?` only for fields that are truly optional.
- **MUST NOT** copy server data into `useState`. The query or server owns it.
- **MUST NOT** store derived values in state or sync them with an effect. Compute them during render (`const fullName = first + ' ' + last`). To reset state when a prop changes, use `key`.
- **MUST NOT** define components inside components. Each render creates a new type, which remounts and loses state.
- **MUST** use only primitives as effect deps (destructure objects first). Any effect that adds a listener, timer, subscription or fetch must return a cleanup. Logic that runs because the user did something belongs in the event handler, not an effect.
- **MUST NOT** pass newly created objects or callbacks to memoized children.
- **PREFER** `cond ? <X/> : null` over `cond && <X/>` when `cond` can be `0` or `NaN`, which would render as text. Prefer `useState(() => expensive())` for expensive initial values, and functional updates `setX(x => x + 1)`.

### Next.js (App Router)
- **MUST** `await` params and other request APIs. On 16, type pages with the generated helper:

```tsx
export default async function Page({ params, searchParams }: PageProps<'/blog/[slug]'>) {
  const { slug } = await params
  const page = Number((await searchParams).page) || 1   // still parse; never trust
}
```

- **MUST** leave Server Components as the default and push `"use client"` to the leaves. It marks a module boundary, so everything that file imports becomes client code. Client components cannot be async. Server children passed into a client provider can still render on the server.
- **MUST** pass only serializable props server→client.
  - Allowed: `Date`, `Map`, `Set`, Promises, JSX, Server Functions.
  - Not allowed: class instances and ordinary closures.
  - Pages Router `getServerSideProps` is stricter and accepts JSON only.
- **MUST** keep `redirect()` / `notFound()` out of a plain `try/catch`. They work by throwing, so a catch swallows them. Call them outside the try, or call `unstable_rethrow(error)` first in the catch.
- **Errors:** model expected errors as returned values. `error.tsx` is a client boundary and does not catch its own segment's layout. `global-error.tsx` needs its own `<html>`/`<body>` and styles.
- **Data:** read directly in Server Components rather than fetching your own Route Handler. Use Server Actions for UI mutations and Route Handlers for webhooks, downloads and external APIs. After a committed write, invalidate the affected cache.
- **Caching:** keep the project's mode. If `cacheComponents: true`:
  - `'use cache'` functions must not read cookies, headers or searchParams inside. Read those outside and pass values in.
  - Use `cacheLife`/`cacheTag` from `next/cache`.
  - Segment exports `dynamic`/`revalidate`/`fetchCache` become errors.
  - `generateStaticParams` must return at least one item (`[]` fails the build).
  - `new Date()` or `Math.random()` during prerender is an error: move it into `use cache` or behind Suspense.

  Read the installed caching docs before changing any of this.

### Accessibility
- **MUST** give every input a label; errors use `role="alert"`. Status must not be shown by colour alone.
- **MUST** use real `<button>`/`<a>` elements, keyboard-operable and named. Targets are at least 24×24 CSS px. Mobile input font-size is at least 16px (prevents iOS zoom).
- **MUST** meet contrast: 4.5:1 for text, 3:1 for large text and required UI. Images get `alt` (`alt=""` if decorative).
- **MUST** move focus into a modal on open and back to the trigger on close; Escape closes it.

---

## 3. Performance, in priority order

If the repo ships its own copy of Vercel's react-best-practices (mi-web-app: `.github/skills/vercel-react-best-practices`), use that copy and its overrides; this list is the short version. Fix the higher tiers first. Don't apply low tiers without a measurement. If React Compiler is on, check its coverage before adding any manual memo.

**Measure before and after**, and report the numbers with the fix:
- LCP (main content visible)
- INP (responsiveness; it replaced FID as the Core Web Vital in 2024)
- CLS (layout stability)
- TTFB (server response)
- initial JS bundle size

Use Lighthouse or browser DevTools for page metrics and the build output or a bundle analyzer for size.

1. **Waterfalls (critical).** Run independent awaits together with `Promise.all([a(), b(), c()])`. Move each `await` into the branch that actually uses it. Wrap slow sections in `<Suspense>` so the rest streams.
2. **Bundle (critical).** `next/dynamic` heavy client-only components. Load analytics and third-party scripts after hydration. Keep `"use client"` small. Large barrel files cost hundreds of ms per import, but Next 13.5+ already rewrites imports for common libraries (`lucide-react`, `@mui/material`, …). Keep normal imports for those, **unless the repo mandates direct subpaths**. mi-web-app does for MUI: `import Button from "@mui/material/Button"`. Don't hand-write internal deep paths like `lucide-react/dist/esm/icons/check`, which older guides recommend. For other heavy barrels, import from the source file.
3. **Server.** Use `React.cache()` to dedupe the same read within a request. Send client components only the fields they render. Use `after()` for logging and other non-blocking work.
4. **Re-renders.** Derive state instead of syncing it. Subscribe to derived booleans, not whole objects. Use `startTransition` / `useDeferredValue` to keep input responsive. Then memoize: `useMemo` for expensive calculations, `useCallback` for props to memo children, `React.memo` for long lists.
5. **Micro.** Only on profiled hot paths: `Map`/`Set` lookups, early returns, combining multiple `.filter().map()` passes into one.

Two correctness habits that are also cheap:
- Use `toSorted()` / `toReversed()` instead of `.sort()` / `.reverse()` on props or state; the old methods mutate the array in place.
- Hoist RegExp, constant objects and static JSX out of render and loops.

---

## 4. Quick decisions

**Where does state live?**
```
From the server?        → Server Component fetch, or the repo's client data library (TanStack Query). Not useState.
Shareable via URL?      → searchParams / nuqs (filters, page, sort, tabs)
One component?          → useState / useReducer
2–3 nearby components?  → lift state up
App-wide?               → rare changes (theme, auth, locale) → Context
                          frequent changes (cart, notifications) → Zustand, select slices: useStore(s => s.x)
```

**TanStack Query:** one `queryOptions` per resource. Keys come from a key factory. The `queryFn` throws on `!res.ok` and returns `schema.parse(await res.json())`.

**Forms:** react-hook-form + `zodResolver(schema)` on the client; the same schema re-checked in the Server Action; keep the user's input on failure.

**Zustand:** persisted stores need `version` and `migrate`. A selector that returns a new object re-renders every time, so use `useShallow` or select primitives.

---

## 5. Workflow

0. **Repo guidance:** §0 (discovery, instruction chain, matching repo skills, ADRs).
1. **Ground truth:** §1, versions and installed docs.
2. **Plan:** for each piece of data, decide server or client, where its state lives, which trust boundary it crosses, and who is authorized to change it.
3. **Write:** follow §2 and match existing conventions. Keep the change scoped. Don't refactor unrelated code or change product copy or design unless asked.
4. **Verify, in this order.** Report exactly what you exercised and what you didn't.
   1. Run the repo's own scripts, which the discovery script lists: format (in mi-web-app that's `pnpm exec oxfmt --write <paths>`, never prettier), typecheck, lint and tests.
   2. `next build` (production). Dev mode hides prerender and Suspense problems.
   3. Run the changed route under `next start` (or dev for UI-only changes).
   4. **Browser check** with whatever browser tooling is available:
      - **Functional result:** the feature actually does its job. A search for "X" shows X results; a form persists data.
      - **Console and network:** zero new JS errors and no failed 4xx/5xx requests.
      - **Mobile width:** check it if the layout matters.
      - **Logins:** use the project's test credentials. On a real account, check read-only.
   5. If something is broken, fix it and verify again. If the same failure repeats, stop and ask.
5. **Self-review** against §7 and against the checklists in any repo skills you loaded. Give the reason for each PREFER deviation where the repo wants it (in mi-web-app: the PR description, not a code comment).
6. **Record:** if the repo keeps memory notes (`/memories/repo/<feature>-patterns.md`), add any non-obvious pattern or gotcha you found.
7. **Long task or near the context limit?** Write `HANDOFF.md` in the project root:
   - **Goal**
   - **Progress** (link commits)
   - **In flight** (branch, uncommitted paths)
   - **What worked**
   - **What didn't** (so it isn't retried)
   - **Next steps**

   Reference existing PRDs and issues instead of copying them.

---

## 6. Debugging router

| Symptom | Likely cause → fix |
|---|---|
| Type error | Read it **bottom-up**; the last line is the real mismatch. Fix the type at its source. `EventTarget` has no `value`: type the event as `React.ChangeEvent<HTMLInputElement>`. `X \| undefined` not assignable: narrow first. |
| `'Promise<Element>' is not a valid JSX element` | An async component is rendered from client code, or `@types/react` is outdated. Fetch higher up and pass data down, or update the types. |
| Hydration mismatch | Server and client rendered different output. On React 19, read the diff it prints. Fixes by cause: <br>• dates/random → `useEffect` <br>• element ids → `useId` <br>• `window`/`localStorage` → `useSyncExternalStore` <br>• user-specific → `<Suspense>` <br>• theme → inline pre-hydration script plus `suppressHydrationWarning` <br>`typeof window` checks in render do **not** fix it. |
| Infinite re-render / "Maximum update depth" | An object, array or function in effect deps, or `setState` during render. Use primitive deps, move the function into the effect, or set state from a handler. |
| State always shows initial value | Stale closure. Add the dep, use a functional update, or use a ref. |
| Effect runs twice in dev | StrictMode is testing cleanup. Write proper cleanup; don't disable StrictMode. |
| Duplicate listeners / leak | The effect is missing cleanup (`removeEventListener`, `clearTimeout`, `AbortController.abort()`). |
| "X is not serializable" | A class instance or closure is crossing server→client. Pass plain data or a Server Action. |
| Redirect / 404 doesn't happen | `redirect()`/`notFound()` is inside a `try/catch`. Move it out, or `unstable_rethrow`. |
| Works in dev, fails in build | Prerender issue: a dynamic API outside Suspense, `Date`/random during prerender, or `generateStaticParams` returning `[]`. Read the build output; it lists fix options. |
| Builds fine, crashes at runtime | Runtime data doesn't match its type. Validate at the boundary. |
| Stale data after mutation | The cache wasn't invalidated. Tag the read and call `updateTag`/`revalidateTag`/`revalidatePath` after the write. |

---

## 7. Review checklist (own code and PRs)

Start with the repo's own review rules (its `AGENTS.md` and loaded skills). Then apply these.

**Block, because these are risks:**
- `any`, `as`, `!` or `@ts-ignore` without justification
- unvalidated external data
- a Server Action or Route Handler without auth, authorization and validation inside it
- request data in module-level state
- a secret module without `server-only`
- object/array effect deps, or a missing cleanup
- server data in `useState`; derived state synced by an effect
- a component defined inside a component
- `"use client"` on a page or layout
- non-serializable props crossing server→client
- un-awaited request APIs
- `redirect`/`notFound` swallowed by a catch
- sequential independent awaits (a waterfall); `.sort()` mutating props or state
- unlabeled inputs, clickable non-buttons
- missing loading, error or empty states

**Flag as smells:**
- a component over ~250 lines doing several jobs
- props drilled through 3+ levels
- the same data held in two places
- memoization with no measured reason

**Mention, don't block:** `type` vs `interface`, naming, file layout, import order.

Write review comments as: **what** is wrong, **why** it fails (the concrete failure), and **the fix** (a code snippet). For a UI review, write terse `file:line — issue` findings.
