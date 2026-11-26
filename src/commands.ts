// Every /command, in one list: the terminal (camp.ts) runs its slash commands and writes /help
// from it, and the page (ui/src/bus.ts) takes its commands, the message box's / menu and the
// command palette (⌘K) from it. A chat gateway, when there is one, reads it too.
//
// A command says where it can be typed (its surfaces), what it takes, and whether it may run while
// a run is going (its busy policy). What it does lives with each surface: camp.ts for the terminal,
// App.tsx's command() for the page. Each surface's handlers are typed Handlers<surface>, so a
// command added here for the terminal or the page doesn't typecheck until that surface does it.
//
// Descriptions are written with {tokens} for the theme pack's words ({crew}, {an expedition},
// {log}…), filled where they're shown: say() in src/words.ts, fillWords() in ui/src/words.ts.
//
// No imports, and nothing that needs Node: the page bundles this file as it is.
// (Like Hermes Agent's hermes_cli/commands.py COMMAND_REGISTRY.)

// Where a command can be typed: the terminal (npm run cli), the page, a chat gateway (none yet:
// marked on the ones that need nothing but text back, so one can start from them).
export type Surface = "cli" | "ui" | "gateway";
// While a run is going: "dispatch" runs it anyway; "reject" says to wait (it would change what the
// run is working on, or asks you something in the middle of it).
export type BusyPolicy = "dispatch" | "reject";
export type Category = "Requests" | "Getting about" | "Panes" | "Records" | "Folders & work" | "Models & spend" | "Info";

// What's different about a command on one surface.
type Variant = { args?: string; description?: string; hidden?: boolean };
export type CommandDef = {
  name: string;                    // without the slash: "budget"
  aliases?: readonly string[];     // other names that run it: ["projects"]
  args?: string;                   // what it takes, as /help shows it: "<path> [--edit]" (<required>, [optional])
  description: string;             // with {tokens} for the pack's words
  category: Category;
  surfaces: readonly Surface[];
  busy: BusyPolicy;
  hidden?: boolean;                // runs, but isn't offered (in /help, the / menu or the palette)
  per?: Partial<Record<Surface, Variant>>;
};

export const COMMAND_REGISTRY = [
  // ---- Requests: about what was asked, and what came back
  { name: "reply", args: "<message>", description: "Follow up on the last {expedition} or chat, with that whole conversation carried over", category: "Requests", surfaces: ["cli", "gateway"], busy: "reject" },
  { name: "good", args: "[note]", description: "Rate the last answer 👍. A note is kept as a standing note, so the next runs start with it", category: "Requests", surfaces: ["cli", "ui", "gateway"], busy: "dispatch" },
  { name: "bad", args: "[note]", description: "Rate the last answer 👎. A note is kept as a standing note, so the next runs start with it", category: "Requests", surfaces: ["cli", "ui", "gateway"], busy: "dispatch" },
  { name: "diff", description: "What the last {expedition}'s file tools changed", category: "Requests", surfaces: ["cli", "gateway"], busy: "dispatch" },
  { name: "undo", description: "Put back the files the last {expedition}'s file tools changed", category: "Requests", surfaces: ["cli"], busy: "reject" },
  { name: "new", description: "Start a new conversation", category: "Requests", surfaces: ["ui"], busy: "dispatch" },
  { name: "next", description: "Go to the next decision waiting on you", category: "Requests", surfaces: ["ui"], busy: "dispatch" },
  { name: "review", description: "Approve or reject skills the Quartermaster proposed", category: "Requests", surfaces: ["cli"], busy: "reject" },
  { name: "goal", args: "[rounds] <goal>", description: "Work towards a goal: after each run a small model judges whether it's met, and the {crew} carries on until it is (10 rounds unless you say)", category: "Requests", surfaces: ["cli", "ui"], busy: "dispatch",
    per: { ui: { args: "[rounds] <goal> | clear | resume", description: "Set a goal for this conversation: after each run a small model checks whether it's met, and the work carries on until it is" } } },
  { name: "pause", args: "[why]", description: "Pause everything: no job, trigger, queued or new request starts (what's running finishes) until /resume", category: "Requests", surfaces: ["cli", "ui"], busy: "dispatch" },
  { name: "resume", description: "Carry on after /pause: jobs, triggers and queued work start again", category: "Requests", surfaces: ["cli", "ui"], busy: "dispatch" },

  // ---- Getting about: pages and full-screen views
  { name: "today", description: "Open Today: your brief, and where things stand (the logo goes there too)", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "find", args: "[name]", description: "Find a file, a conversation, a setting or a command", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "orbit", args: "[demo]", description: "Watch the {crew} at work as a solar system, full screen (/orbit demo plays a pretend {camp})", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "trail", description: "See the plan as a trail: each step, who's on it, and what it waits for, full screen", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "constellation", description: "See everything the {crew} remembers as a map of stars, full screen", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "tickets", description: "Open Tickets: the Outpost's own and Jira's, and which Jira ones show", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "ticket", description: "Start a ticket: pick it, check it, say where and who", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "settings", args: "[section]", description: "Open Settings (on a section, if you name one: /settings models)", category: "Getting about", surfaces: ["ui"], busy: "dispatch" },
  { name: "connectors", description: "Open Settings → Connectors", category: "Getting about", surfaces: ["ui"], busy: "dispatch", hidden: true },

  // ---- Panes: the page's zones
  { name: "focus", description: "Close the workspace, files, notes and terminal (again brings them back)", category: "Panes", surfaces: ["ui"], busy: "dispatch" },
  { name: "files", description: "Show or hide the files", category: "Panes", surfaces: ["ui"], busy: "dispatch" },
  { name: "terminal", description: "Show or hide the terminal", category: "Panes", surfaces: ["ui"], busy: "dispatch" },
  { name: "history", description: "Show or hide the workspace", category: "Panes", surfaces: ["ui"], busy: "dispatch" },
  { name: "notes", description: "Show or hide your notes", category: "Panes", surfaces: ["ui"], busy: "dispatch" },
  { name: "note", args: "[text]", description: "Jot down a new note", category: "Panes", surfaces: ["ui"], busy: "dispatch" },
  { name: "layout", description: "Arrange the page's zones", category: "Panes", surfaces: ["ui"], busy: "dispatch" },

  // ---- Records: what the camp keeps
  { name: "memory", args: "[name]", description: "Open Memory: what the {crew} remembers, and the wiki", category: "Records", surfaces: ["cli", "ui", "gateway"], busy: "dispatch",
    per: { cli: { args: "<name>", description: "What that {crew} member remembers, and how many sessions they've had" }, gateway: { args: "<name>", description: "What that {crew} member remembers, and how many sessions they've had" } } },
  { name: "wiki", description: "The {camp} wiki's index (pages live in camp/wiki/)", category: "Records", surfaces: ["cli", "ui", "gateway"], busy: "dispatch", per: { ui: { description: "Open Memory, where the wiki is", hidden: true } } },
  { name: "log", description: "The {log}: recent runs ({expeditions}, {quests} and jobs), with who went, how it ended, time, tokens, and cost", category: "Records", surfaces: ["cli", "gateway"], busy: "dispatch" },
  { name: "jobs", description: "Scheduled jobs (they run while {hq} is open; npm run watch:install for always)", category: "Records", surfaces: ["cli", "gateway"], busy: "dispatch" },

  // ---- Folders & work: where the crew works
  { name: "link", args: "<path> [--edit]", description: "Let the {crew} read a folder on your disk as links/<name>/ (no upload)", category: "Folders & work", surfaces: ["cli"], busy: "dispatch" },
  { name: "links", description: "The folders linked so far", category: "Folders & work", surfaces: ["cli"], busy: "dispatch" },
  { name: "unlink", args: "<name>", description: "Stop linking a folder (the folder itself is untouched)", category: "Folders & work", surfaces: ["cli"], busy: "reject" },
  { name: "project", aliases: ["projects"], args: "[name | off]", description: "List your projects, or work in one: its folders, notes, and defaults apply to what you send", category: "Folders & work", surfaces: ["cli"], busy: "dispatch" },
  { name: "worktree", args: "[<link> new [branch] | <link> <path> | <link> off]", description: "Work in a git worktree of a linked repo: a new one per request, or one you already have", category: "Folders & work", surfaces: ["cli"], busy: "dispatch" },

  // ---- Models & spend
  { name: "runtime", args: "[claude-code | api]", description: "Show or switch what runs the {crew}: your Claude subscription (default) or the API", category: "Models & spend", surfaces: ["cli"], busy: "dispatch" },
  { name: "model", args: "[name model [effort] | name reset]", description: "Show or change which model each {crew} member runs on", category: "Models & spend", surfaces: ["cli"], busy: "dispatch" },
  { name: "turns", args: "<name> <number | reset>", description: "How many turns one run of that {crew} member may take before it stops", category: "Models & spend", surfaces: ["cli"], busy: "dispatch" },
  { name: "budget", args: "[dollars | off]", description: "Stop each {expedition} once it has spent this much (all agents together)", category: "Models & spend", surfaces: ["cli"], busy: "dispatch" },

  // ---- Info
  { name: "help", description: "This list", category: "Info", surfaces: ["cli", "ui", "gateway"], busy: "dispatch", per: { ui: { description: "Every command, in the palette" } } },
  { name: "exit", aliases: ["quit"], description: "{Close}", category: "Info", surfaces: ["cli"], busy: "dispatch" },
] as const satisfies readonly CommandDef[];

type Registered = (typeof COMMAND_REGISTRY)[number];
// The names of the commands on one surface: CommandName<"cli"> is "reply" | "good" | … | "exit".
export type CommandName<S extends Surface = Surface> = Registered extends infer C
  ? C extends { name: infer N; surfaces: readonly (infer On)[] } ? (S extends On ? N : never) : never
  : never;

const ALL: readonly CommandDef[] = COMMAND_REGISTRY;
export const CATEGORIES: readonly Category[] = ["Requests", "Getting about", "Panes", "Records", "Folders & work", "Models & spend", "Info"];

// A command as one surface has it: its args, description and hiddenness there.
export type SurfaceCommand = { name: string; aliases: readonly string[]; args?: string; description: string; category: Category; busy: BusyPolicy; hidden: boolean };
export function onSurface(def: CommandDef, surface: Surface): SurfaceCommand {
  const v = def.per?.[surface] ?? {};
  return { name: def.name, aliases: def.aliases ?? [], args: v.args ?? def.args, description: v.description ?? def.description, category: def.category, busy: def.busy, hidden: v.hidden ?? def.hidden ?? false };
}

// The commands on a surface, in the registry's order. Hidden ones only when asked for.
export function commandsOn(surface: Surface, opts: { hidden?: boolean } = {}): SurfaceCommand[] {
  return ALL.filter((d) => d.surfaces.includes(surface)).map((d) => onSurface(d, surface)).filter((c) => opts.hidden || !c.hidden);
}

// A name or an alias ("projects", "Quit") → that command on the surface; undefined if it isn't one there.
export function findCommand(name: string, surface: Surface): SurfaceCommand | undefined {
  const n = name.toLowerCase();
  const def = ALL.find((d) => d.surfaces.includes(surface) && (d.name === n || (d.aliases ?? []).includes(n)));
  return def && onSurface(def, surface);
}

// What was typed, read as a command: "/good  nice work" → { name: "good", arg: "nice work" }.
// Not a slash command at all (a request, "/etc/hosts is…") → null. A slash and a word that isn't a
// command on this surface → { unknown }, with the nearest one to suggest when there's a close one.
export type Parsed = { command: SurfaceCommand; arg: string } | { unknown: string; suggest?: string };
export function parseSlash(text: string, surface: Surface): Parsed | null {
  const m = text.trim().match(/^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const command = findCommand(m[1], surface);
  if (command) return { command, arg: (m[2] ?? "").trim() };
  return { unknown: m[1].toLowerCase(), suggest: nearest(m[1].toLowerCase(), surface) };
}

// The closest name on the surface to a mistyped one, if it's close: /mdoel → model.
function nearest(typed: string, surface: Surface): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const c of commandsOn(surface)) {
    for (const n of [c.name, ...c.aliases]) {
      const d = distance(typed, n);
      if (d <= (n.length > 4 ? 2 : 1) && (!best || d < best.d)) best = { name: c.name, d };
    }
  }
  return best?.name;
}
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]++;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}

// A command's required args (<like this>) missing → the usage line to show instead; else null.
export function usageProblem(c: Pick<SurfaceCommand, "name" | "args">, arg: string): string | null {
  return c.args?.startsWith("<") && !arg ? `Usage: /${c.name} ${c.args}` : null;
}

// May it run now? A "reject" command waits while a run is going.
export function busyProblem(c: Pick<SurfaceCommand, "name" | "busy">, busy: boolean, fill: (text: string) => string = (t) => t): string | null {
  return busy && c.busy === "reject" ? fill(`/${c.name} waits until the {expedition} that's going has finished.`) : null;
}

// /help for a surface, grouped: "  /link <path> [--edit]  Let the crew read…". fill puts the pack's words in.
export function helpText(surface: Surface, fill: (text: string) => string = (t) => t): string {
  const shown = commandsOn(surface);
  const out: string[] = [];
  for (const cat of CATEGORIES) {
    const here = shown.filter((c) => c.category === cat);
    if (!here.length) continue;
    out.push(`${cat}:`);
    for (const c of here) {
      const head = `  ${c.name === "exit" && surface === "cli" ? "exit" : `/${c.name}`}${c.args ? ` ${c.args}` : ""}${c.aliases.length ? ` (also /${c.aliases.join(", /")})` : ""}`;
      const text = fill(c.description);
      out.push(head.length < 21 ? `${head.padEnd(21)}${text}` : `${head}\n${" ".repeat(21)}${text}`);
    }
  }
  return out.join("\n");
}

// Run what was typed on a surface with that surface's handlers. "none": it isn't a slash command
// (send it on as a request). Otherwise the command's handler ran, or what was wrong was told.
export type Handlers<S extends Surface, Ctx = void> = { [K in CommandName<S>]: (arg: string, ctx: Ctx) => unknown };
export type Dispatched = { ran: "none" } | { ran: "command"; name: string; result: unknown } | { ran: "refused"; message: string };
export async function dispatch<S extends Surface, Ctx = void>(text: string, surface: S, handlers: Handlers<S, Ctx>, opts: { busy?: boolean; fill?: (t: string) => string; ctx?: Ctx } = {}): Promise<Dispatched> {
  const parsed = parseSlash(text, surface);
  if (!parsed) return { ran: "none" };
  if ("unknown" in parsed) return { ran: "refused", message: `There's no /${parsed.unknown}.${parsed.suggest ? ` Did you mean /${parsed.suggest}?` : ""} Type /help for the list.` };
  const { command, arg } = parsed;
  const problem = busyProblem(command, !!opts.busy, opts.fill) ?? usageProblem(command, arg);
  if (problem) return { ran: "refused", message: problem };
  const run = (handlers as Record<string, (arg: string, ctx: Ctx) => unknown>)[command.name];
  if (!run) return { ran: "refused", message: `/${command.name} isn't something this can do yet.` };
  return { ran: "command", name: command.name, result: await run(arg, opts.ctx as Ctx) };
}
