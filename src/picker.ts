// The system's own "choose a folder" dialog, for linking folders from mission control.
// A browser's file picker never reveals a folder's real path (only its name and files), but
// mission control's server runs on your machine, so it can open the native dialog and hand the
// path back. macOS uses AppleScript; Linux uses zenity or kdialog; Windows uses PowerShell.

import { execFile } from "node:child_process";
import { w } from "./words.js";

const prompt = () => `Choose a folder for the ${w("crew")} to read`; // a pack's word for the crew has no quotes in it (packs.ts cleans them)
const WAIT_MS = 10 * 60_000; // the dialog stays open until you pick or cancel

type Command = { cmd: string; args: string[]; canceled: (code: number | null, stderr: string) => boolean };

function commandFor(platform: NodeJS.Platform): Command[] {
  if (platform === "darwin") {
    // `activate` brings the dialog to the front (it would otherwise open behind the browser).
    return [{
      cmd: "osascript",
      args: ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${prompt()}")`],
      canceled: (_c, err) => /-128|User canceled/i.test(err),
    }];
  }
  if (platform === "win32") {
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      `$d.Description = '${prompt()}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath } else { exit 1 }`;
    return [{ cmd: "powershell", args: ["-NoProfile", "-STA", "-Command", ps], canceled: (c) => c === 1 }];
  }
  return [
    { cmd: "zenity", args: ["--file-selection", "--directory", `--title=${prompt()}`], canceled: (c) => c === 1 },
    { cmd: "kdialog", args: ["--getexistingdirectory", ".", "--title", prompt()], canceled: (c) => c === 1 },
  ];
}

export type PickResult = { path: string } | { canceled: true } | { unsupported: string };

let open: Promise<PickResult> | null = null;

// Opens the dialog and waits for it. Only one at a time: a second request gets the same answer.
export function pickFolder(platform = process.platform): Promise<PickResult> {
  open ??= tryEach(commandFor(platform)).finally(() => { open = null; });
  return open;
}

async function tryEach(cmds: Command[]): Promise<PickResult> {
  for (const c of cmds) {
    const r = await new Promise<PickResult | "missing">((resolve, reject) => {
      execFile(c.cmd, c.args, { timeout: WAIT_MS, encoding: "utf8" }, (err, stdout, stderr) => {
        if (err && (err as any).code === "ENOENT") return resolve("missing");
        if (err) {
          const code = typeof (err as any).code === "number" ? (err as any).code : null;
          return c.canceled(code, stderr) ? resolve({ canceled: true }) : reject(new Error(stderr.trim() || err.message));
        }
        const path = stdout.trim().replace(/(.)\/$/, "$1"); // macOS adds a trailing slash
        resolve(path ? { path } : { canceled: true });
      });
    });
    if (r !== "missing") return r;
  }
  return { unsupported: "No folder dialog is available on this system. Paste the folder's path instead." };
}
