// The terminal's readline interface, shared by everything that talks to you in the terminal.
import * as readline from "node:readline/promises";
import { CREW, activePack } from "./crew.js";
import { w } from "./words.js";

export const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Ctrl+C: if an expedition is running, the first press stops it; otherwise (or a second press) break camp.
// readline catches Ctrl+C itself (and only pauses input), so we decide here.
let stopRunning: (() => boolean) | null = null;
export function onInterrupt(handler: (() => boolean) | null) {
  stopRunning = handler;
}

rl.on("SIGINT", () => {
  if (stopRunning?.()) {
    console.log(`\n🛑 Stopping the ${w("expedition")}… (Ctrl+C again to ${w("close")})`);
    stopRunning = null;
    return;
  }
  console.log(`\n${activePack().id === "guild" ? "🏕️" : CREW.quartermaster.emoji}  ${w("closing")}.`);
  process.exit(130);
});
