// Run scheduled jobs in the background on macOS, even when no terminal or dashboard is open.
//   npm run watch:install     install and start it (checks for due jobs every minute)
//   npm run watch:uninstall   stop and remove it
//
// It adds a launchd agent for your user (~/Library/LaunchAgents/app.mae.watch.plist) that runs
// `npm run watch -- --once` in this folder. Output goes to camp/watch.log. If mission control or
// `npm run watch` is open, the background run stands by (they share camp/scheduler.lock).
// Jobs use your Claude login, so Claude Code needs to be signed in for your user.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "app.mae.watch";
// What earlier versions installed, under the app's old names: replaced on install, removed on uninstall.
const OLD_PLISTS = ["camp.guild.watch", "app.satchel.watch"].map((l) => join(homedir(), "Library", "LaunchAgents", `${l}.plist`));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = `gui/${process.getuid?.() ?? 501}`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function launchctl(...args: string[]): boolean {
  try { execFileSync("launchctl", args, { stdio: "pipe" }); return true; } catch { return false; }
}

function install() {
  mkdirSync(dirname(PLIST), { recursive: true });
  mkdirSync(join(ROOT, "camp"), { recursive: true });
  const log = join(ROOT, "camp", "watch.log");
  // A login shell, so npm, node, and claude are found the same way they are in your terminal.
  const command = `cd ${sh(ROOT)} && npm run --silent watch -- --once`;
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>${xml(command)}</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`);
  for (const old of OLD_PLISTS) if (existsSync(old)) { launchctl("bootout", domain, old); rmSync(old, { force: true }); }
  launchctl("bootout", domain, PLIST); // replace an earlier install
  if (!launchctl("bootstrap", domain, PLIST)) {
    console.log(`Wrote ${PLIST}, but couldn't start it. Try: launchctl bootstrap ${domain} ${sh(PLIST)}`);
    process.exit(1);
  }
  console.log(`⏰ Installed. Due jobs now run in the background every minute.\n   Log: ${log}\n   Remove it with: npm run watch:uninstall`);
}

function uninstall() {
  const installed = [PLIST, ...OLD_PLISTS].filter((p) => existsSync(p));
  if (!installed.length) return console.log("The background watcher isn't installed.");
  for (const p of installed) { launchctl("bootout", domain, p); rmSync(p, { force: true }); }
  console.log("Removed the background watcher. Jobs run only while mission control or `npm run watch` is open.");
}

if (process.platform !== "darwin") {
  console.log(process.platform === "win32"
    ? `This installer is for macOS. On Windows, have Task Scheduler run the jobs every few minutes:\n  schtasks /Create /SC MINUTE /MO 5 /TN MaeWatch /TR "cmd /c cd /d \"${process.cwd()}\" && npm run watch -- --once"\n(Remove it with: schtasks /Delete /TN MaeWatch /F)`
    : "This installer is for macOS. On Linux, run `npm run watch -- --once` from cron or a systemd timer.");
  process.exit(1);
}
if (process.argv.includes("--uninstall")) uninstall();
else install();
