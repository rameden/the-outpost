// Short titles for conversations, written by the smallest model, when you've turned that on
// (Settings → General → "Name conversations automatically"). Off by default: each title costs a
// little of your plan's usage (or a fraction of a cent on the API). Without it a conversation is
// named after its first request, and you can rename any of them yourself.

import { autoTitle, hasTitle, projectOf } from "./conversations.js";
import { autoTitlesOn } from "./settings.js";
import { askSmall } from "./small.js";

const SYSTEM = "You name conversations for a sidebar. Reply with a title of 3 to 6 words that says what the conversation is about. " +
  "No quotes, no trailing punctuation, nothing but the title.";

export function cleanTitle(raw: string): string {
  const line = raw.trim().split("\n")[0].replace(/^["'“”‘’\s]+|["'“”‘’\s.!]+$/g, "").replace(/^title:\s*/i, "");
  return line.split(/\s+/).length > 9 ? "" : line.slice(0, 60); // a rambling reply isn't a title
}

// Name a new conversation after its first exchange. Never throws: a missing title is no loss.
export async function titleConversation(thread: string, task: string, reply: string): Promise<string | null> {
  try {
    if (!autoTitlesOn() || hasTitle(thread)) return null;
    const prompt = `The user asked:\n${task.slice(0, 1200)}\n\nThe answer began:\n${reply.slice(0, 600)}`;
    const text = await askSmall(SYSTEM, prompt, 40, { project: projectOf(thread).id });
    const title = cleanTitle(text);
    return title && autoTitle(thread, title) ? title : null;
  } catch {
    return null;
  }
}
