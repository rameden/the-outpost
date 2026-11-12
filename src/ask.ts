// Every question the camp asks you goes through ask(): plan approvals, shell commands, new jobs.
// In the terminal it's a readline prompt; mission control swaps in a browser-backed asker.

import { emit, type AskKind } from "./events.js";
import { rl } from "./terminal.js";
import { currentQuestId } from "./context.js";

export type Question = { kind: AskKind; title: string; body: string };
type Asker = (q: Question & { id: string }) => Promise<string>;

const CLI_PROMPTS: Record<AskKind, string> = {
  plan: "\n   Approve? [Enter = go, n = stop, or type changes] ",
  shell: "   Run it? [y/N, a = always allow this exact command] ",
  job: "   Schedule it? [y/N] ",
  tool: "   Allow it? [y/N] ",
  question: "   Your answer: ",
  post: "   Post it as you? [y/N, or type what to change] ",
};

// Parallel quests can ask at the same time; the terminal takes their questions one at a time.
let terminalQueue: Promise<unknown> = Promise.resolve();
const cliAsker: Asker = (q) => {
  const next = terminalQueue.then(async () => {
    console.log(`\n${q.title}\n${q.body.replace(/^/gm, "   ")}`);
    return rl.question(CLI_PROMPTS[q.kind]);
  });
  terminalQueue = next.catch(() => {});
  return next;
};

let asker: Asker = cliAsker;
export function setAsker(a: Asker) {
  asker = a;
}

// Starts from the clock so ids stay unique across restarts (the saved feed holds old ones).
let nextId = Date.now();
export async function ask(q: Question): Promise<string> {
  const id = `ask_${++nextId}`;
  emit({ type: "ask", id, ...q, questId: currentQuestId() });
  const answer = (await asker({ ...q, id })).trim();
  emit({ type: "answered", id, answer });
  return answer;
}
