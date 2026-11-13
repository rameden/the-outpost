// What differs on Windows, checked from any machine: which shell the crew's commands get, which
// shell the terminal opens, where Claude Code is, which folders can't be linked, and replacing
// a file something else has open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentShell, claudeOnWindows, onPath, shellNote, terminalShell, unlinkable } from "../src/platform.ts";
import { replace } from "../src/atomic.ts";

const files = (...list: string[]) => { const set = new Set(list.map((f) => f.toLowerCase())); return (f: string) => set.has(f.toLowerCase()); };
const WIN = { PATH: "C:\\Windows\\System32;C:\\Program Files\\Git\\cmd;C:\\Users\\you\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD",
  ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LocalAppData: "C:\\Users\\you\\AppData\\Local",
  SystemRoot: "C:\\Windows", ProgramData: "C:\\ProgramData", APPDATA: "C:\\Users\\you\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\you\\AppData\\Local" };

test("macOS and Linux keep the system's own shell; the terminal opens your login shell", () => {
  assert.equal(agentShell("darwin", {}, () => true), null);
  assert.equal(agentShell("linux", {}, () => true), null);
  assert.equal(shellNote(null), "");
  assert.deepEqual(terminalShell("darwin", { SHELL: "/bin/zsh" }, files("/bin/zsh")), { file: "/bin/zsh", args: ["-l"] });
  assert.deepEqual(terminalShell("linux", { SHELL: "/usr/bin/fish" }, files("/usr/bin/fish", "/bin/bash")), { file: "/usr/bin/fish", args: ["-l"] });
  assert.deepEqual(terminalShell("linux", {}, files("/bin/bash", "/bin/sh")), { file: "/bin/bash", args: ["-l"] }, "no SHELL: the first shell that's there");
});

test("Windows: the crew's commands go to Git Bash when it's installed, PowerShell when it isn't", () => {
  // Git for Windows in its usual place.
  let sh = agentShell("win32", WIN, files("C:\\Program Files\\Git\\bin\\bash.exe"))!;
  assert.equal(sh.kind, "bash");
  assert.equal(sh.file, "C:\\Program Files\\Git\\bin\\bash.exe");
  assert.deepEqual(sh.args("ls && git status"), ["-c", "ls && git status"]);
  assert.match(shellNote(sh), /Git Bash/);
  // Installed somewhere else: found beside the git that's on the PATH.
  sh = agentShell("win32", { ...WIN, PATH: "D:\\Tools\\Git\\cmd" }, files("D:\\Tools\\Git\\cmd\\git.exe", "D:\\Tools\\Git\\bin\\bash.exe"))!;
  assert.equal(sh.file, "D:\\Tools\\Git\\bin\\bash.exe");
  // No Git Bash: PowerShell 7 if it's there, else the one Windows comes with. The crew is told to write PowerShell.
  sh = agentShell("win32", { ...WIN, PATH: "C:\\Program Files\\PowerShell\\7" }, files("C:\\Program Files\\PowerShell\\7\\pwsh.exe"))!;
  assert.equal(sh.kind, "powershell");
  assert.equal(sh.file, "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  assert.deepEqual(sh.args("npm test").slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.match(sh.args("npm test")[3], /^npm test\nif \(\$LASTEXITCODE\) \{ exit \$LASTEXITCODE \}$/, "a failing command still reads as a failure");
  assert.match(shellNote(sh), /commands run in PowerShell, so write PowerShell[\s\S]*not bash\.$/);
  assert.equal(agentShell("win32", { PATH: "" }, () => false)!.file, "powershell.exe");
  // Your own choice wins, if it's there.
  assert.equal(agentShell("win32", { ...WIN, CAMP_SHELL: "D:\\msys\\bash.exe" }, files("D:\\msys\\bash.exe", "C:\\Program Files\\Git\\bin\\bash.exe"))!.file, "D:\\msys\\bash.exe");
  assert.equal(agentShell("win32", { ...WIN, CAMP_SHELL: "D:\\gone\\bash.exe" }, files("C:\\Program Files\\Git\\bin\\bash.exe"))!.file, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("Windows: the terminal opens PowerShell, whatever SHELL says (Git Bash sets it to a path Windows can't start)", () => {
  assert.deepEqual(terminalShell("win32", { ...WIN, SHELL: "/usr/bin/bash" }, () => false), { file: "powershell.exe", args: [] });
  assert.equal(terminalShell("win32", { PATH: "C:\\Program Files\\PowerShell\\7", PATHEXT: ".EXE" }, files("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).file, "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
});

test("a program on the PATH: Windows tries each extension, and reads Path in any case", () => {
  assert.equal(onPath("git", "win32", { Path: "C:\\Program Files\\Git\\cmd", PATHEXT: ".EXE;.CMD" }, files("C:\\Program Files\\Git\\cmd\\git.exe")), "C:\\Program Files\\Git\\cmd\\git.exe");
  assert.equal(onPath("claude", "win32", WIN, files("C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd")), "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd");
  assert.equal(onPath("nope", "win32", WIN, () => false), null);
  assert.equal(onPath("git", "linux", { PATH: "/usr/local/bin:/usr/bin" }, files("/usr/bin/git")), "/usr/bin/git");
});

test("Windows: Claude Code as a program is started directly; as npm's script, through a shell, and the SDK gets the real file", () => {
  const exe = "C:\\Users\\you\\.local\\bin\\claude.exe";
  assert.deepEqual(claudeOnWindows("claude", { PATH: "C:\\Users\\you\\.local\\bin", PATHEXT: ".EXE;.CMD" }, files(exe)), { run: { file: exe, shell: false }, path: exe });
  const cmd = "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd";
  const cli = "C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js";
  assert.deepEqual(claudeOnWindows("claude", WIN, files(cmd, cli)), { run: { file: `"${cmd}"`, shell: true }, path: cli });
  assert.deepEqual(claudeOnWindows("claude", WIN, files(cmd)), { run: { file: `"${cmd}"`, shell: true }, path: undefined }, "can't tell where it leads: the SDK uses its own copy");
  assert.deepEqual(claudeOnWindows("claude", WIN, () => false), { run: { file: "claude", shell: false }, path: "claude" }, "not found: asked for by name, and the usual 'not installed' follows");
  assert.equal(claudeOnWindows("D:\\tools\\claude.exe", WIN, files("D:\\tools\\claude.exe")).path, "D:\\tools\\claude.exe");
});

test("what can't be linked, on each system: a whole disk, home, system folders, credentials", () => {
  const mac = (p: string) => unlinkable(p, "/Users/you", "darwin", {});
  for (const p of ["/", "/Users", "/Users/you", "/etc", "/usr/local/bin", "/System/Library", "/Users/you/.ssh", "/Users/you/Library/Keychains", "/Users/you/.config/gh"]) assert.equal(mac(p), true, p);
  for (const p of ["/Users/you/Projects/site", "/Users/you/Documents", "/Volumes/Work/site", "/opt/work"]) assert.equal(mac(p), false, p);
  assert.equal(unlinkable("/home", "/home/you", "linux", {}), true);
  assert.equal(unlinkable("/home/you/code/app", "/home/you", "linux", {}), false);

  const win = (p: string) => unlinkable(p, "C:\\Users\\you", "win32", WIN);
  for (const p of ["C:\\", "D:\\", "C:\\Users", "C:\\Users\\you", "c:\\users\\YOU", "C:\\Windows", "C:\\Windows\\System32", "C:\\Program Files\\Git", "C:\\Program Files (x86)\\Steam",
    "C:\\ProgramData\\ssh", "C:\\Users\\you\\AppData", "C:\\Users\\you\\AppData\\Roaming\\npm", "C:\\Users\\you\\.ssh", "C:\\Users\\you\\.aws\\cli"]) assert.equal(win(p), true, p);
  for (const p of ["C:\\Users\\you\\Projects\\site", "C:\\Users\\you\\Documents\\GitHub\\app", "D:\\work\\site", "C:\\dev"]) assert.equal(win(p), false, p);
});

test("replacing a file something else has open (Windows): tried again briefly, then given up on; other errors at once", () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });
  let calls = 0;
  replace("a", "b", () => { if (++calls < 3) throw busy("EPERM"); }, 5);
  assert.equal(calls, 3, "it went through on the third try");
  calls = 0;
  assert.throws(() => replace("a", "b", () => { calls++; throw busy("EBUSY"); }, 3), /EBUSY/);
  assert.equal(calls, 3);
  calls = 0;
  assert.throws(() => replace("a", "b", () => { calls++; throw busy("ENOENT"); }, 5), /ENOENT/);
  assert.equal(calls, 1, "a file that isn't there won't appear by waiting");
  calls = 0;
  assert.throws(() => replace("a", "b", () => { calls++; throw busy("EPERM"); }, 1), /EPERM/);
  assert.equal(calls, 1, "elsewhere there's one try, as before");
});
