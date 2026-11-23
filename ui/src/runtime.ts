// Switching what runs the crew (the Claude subscription through Claude Code, or the API): ask
// first, since the bill changes, then tell the camp. Used by the status chip and Settings.

import { api, errorText } from "./api.ts";
import { ask } from "./components/Confirm.tsx";
import { complain } from "./components/StatusLine.tsx";

import { w } from "./words.ts";
export async function switchRuntime(next: "api" | "claude-code" | string, refresh: () => void): Promise<void> {
  const question = next === "api"
    ? { title: `Switch the ${w("crew")} to the API?`, body: "Usage will be billed to your API key.", action: "Switch to the API" }
    : { title: `Switch the ${w("crew")} to your Claude subscription (through Claude Code)?`, body: "Usage will count against your plan's limits.", action: "Switch to my subscription" };
  if (!await ask(question)) return;
  try { await api("/api/runtime", { runtime: next }); refresh(); } catch (e) { complain(errorText(e)); }
}
