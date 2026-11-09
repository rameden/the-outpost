// The terminal's readline interface, shared by everything that talks to you in the terminal.
import * as readline from "node:readline/promises";

export const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Ctrl+C: if an expedition is running, the first press stops it; otherwise (or a second press) break camp.
// readline catches Ctrl+C itself (and only pauses input), so we decide here.
let stopRunning: (() => boolean) | null = null;
export function onInterrupt(handler: (() => boolean) | null) {
  stopRunning = handler;
}

rl.on("SIGINT", () => {
  if (stopRunning?.()) {
    console.log("\n🛑 Stopping the expedition… (Ctrl+C again to break camp)");
    stopRunning = null;
    return;
  }
  console.log("\n🏕️  Breaking camp.");
  process.exit(130);
});
