// The Forge: how the camp learns new skills.
// The Quartermaster proposes a skill after a good expedition; it waits in skills/_pending/
// until you approve it with /review. Nothing in _pending is ever shown to a character.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Interface } from "node:readline/promises";
import { ROSTER } from "./roster.js";
import type { Tool } from "./tools.js";
import { emit } from "./events.js";

const SKILLS_DIR = "skills";
const PENDING_DIR = join(SKILLS_DIR, "_pending");
const OWNERS = ["shared", "quartermaster", ...Object.keys(ROSTER)];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const livePath = (owner: string, name: string) => join(SKILLS_DIR, owner, name, "SKILL.md");
const pendingPath = (owner: string, name: string) => join(PENDING_DIR, owner, name, "SKILL.md");

function frontmatter(text: string, key: string): string {
  return text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

// Every live skill in camp, so the Quartermaster can avoid proposing duplicates.
export function skillCatalog(): string {
  const lines: string[] = [];
  for (const owner of OWNERS) {
    const dir = join(SKILLS_DIR, owner);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = livePath(owner, name);
      if (!existsSync(path)) continue;
      lines.push(`- ${owner}/${name}: ${frontmatter(readFileSync(path, "utf8"), "description")}`);
    }
  }
  return lines.join("\n") || "(none yet)";
}

export const proposeSkill: Tool = {
  def: {
    name: "propose_skill",
    description:
      "Propose a new skill (or a replacement for an existing one) for a character. It does NOT go " +
      "live until the user approves it with /review. A skill is reusable how-to instructions the " +
      "character reads before a matching task: concrete steps, formats, and pitfalls, written for " +
      "any future task of that kind, not a story about this expedition.",
    input_schema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          enum: OWNERS,
          description: "Who gets it: an adventurer id, 'quartermaster', or 'shared' for everyone.",
        },
        name: { type: "string", description: "kebab-case, e.g. 'research-brief'" },
        description: {
          type: "string",
          description: "One line saying when to use it. This is all the character sees until they open it.",
        },
        instructions: { type: "string", description: "The SKILL.md body in Markdown." },
        reason: { type: "string", description: "One or two sentences for the user: what this captures and why." },
      },
      required: ["owner", "name", "description", "instructions", "reason"],
    },
  },
  run: async ({ owner, name, description, instructions, reason }) => {
    if (!OWNERS.includes(owner)) return `Unknown owner '${owner}'. Use one of: ${OWNERS.join(", ")}.`;
    if (!NAME_RE.test(name)) return `Skill names must be kebab-case (got '${name}').`;
    const desc = String(description).replace(/\s+/g, " ").trim();
    const why = String(reason).replace(/\s+/g, " ").trim();
    const body =
      `---\nname: ${name}\ndescription: ${desc}\nproposed: ${new Date().toISOString().slice(0, 10)}\n` +
      `reason: ${why}\n---\n\n${String(instructions).trim()}\n`;
    const path = pendingPath(owner, name);
    mkdirSync(join(PENDING_DIR, owner, name), { recursive: true });
    writeFileSync(path, body);
    const replaces = existsSync(livePath(owner, name)) ? " It would replace the current version." : "";
    emit({ type: "notice", who: "Forge", emoji: "📥", depth: 0, text: `📥 Skill proposed: ${owner}/${name}.${replaces} Review it to approve.` });
    emit({ type: "changed", what: "skills" });
    return `Proposed ${owner}/${name}.${replaces} It is NOT active until the user approves it with /review.`;
  },
};

type Pending = { owner: string; name: string; path: string };

export function pendingSkills(): Pending[] {
  if (!existsSync(PENDING_DIR)) return [];
  const out: Pending[] = [];
  for (const owner of readdirSync(PENDING_DIR)) {
    const ownerDir = join(PENDING_DIR, owner);
    if (!existsSync(ownerDir) || !OWNERS.includes(owner)) continue;
    for (const name of readdirSync(ownerDir)) {
      const path = pendingPath(owner, name);
      if (existsSync(path)) out.push({ owner, name, path });
    }
  }
  return out;
}

function clearPending(p: Pending) {
  rmSync(join(PENDING_DIR, p.owner, p.name), { recursive: true, force: true });
  const ownerDir = join(PENDING_DIR, p.owner);
  if (existsSync(ownerDir) && readdirSync(ownerDir).length === 0) rmSync(ownerDir, { recursive: true });
  if (existsSync(PENDING_DIR) && readdirSync(PENDING_DIR).length === 0) rmSync(PENDING_DIR, { recursive: true });
}

export type PendingDetail = { owner: string; name: string; reason: string; proposed: string; current: string | null };

// Everything a reviewer needs: the proposal, why, and what it would replace.
export function pendingDetails(): PendingDetail[] {
  return pendingSkills().map((p) => {
    const text = readFileSync(p.path, "utf8");
    const live = livePath(p.owner, p.name);
    return {
      owner: p.owner,
      name: p.name,
      reason: frontmatter(text, "reason"),
      proposed: text,
      current: existsSync(live) ? readFileSync(live, "utf8") : null,
    };
  });
}

function findPending(owner: string, name: string): Pending | undefined {
  return pendingSkills().find((p) => p.owner === owner && p.name === name);
}

export function approveSkill(owner: string, name: string): boolean {
  const p = findPending(owner, name);
  if (!p) return false;
  // The review metadata was for you; the character only needs name, description, and body.
  const clean = readFileSync(p.path, "utf8").replace(/^proposed:.*\n/m, "").replace(/^reason:.*\n/m, "");
  mkdirSync(join(SKILLS_DIR, p.owner, p.name), { recursive: true });
  writeFileSync(livePath(p.owner, p.name), clean);
  clearPending(p);
  emit({ type: "changed", what: "skills" });
  return true;
}

export function rejectSkill(owner: string, name: string): boolean {
  const p = findPending(owner, name);
  if (!p) return false;
  clearPending(p);
  emit({ type: "changed", what: "skills" });
  return true;
}

// Terminal review: walk through each pending skill and approve, reject, or skip it.
export async function reviewPending(rl: Interface): Promise<void> {
  const pending = pendingDetails();
  if (pending.length === 0) {
    console.log("\n📥 No skill proposals waiting.");
    return;
  }
  for (const p of pending) {
    console.log(`\n${"─".repeat(60)}\n📜 ${p.owner}/${p.name}${p.current ? "  (replaces the current version)" : "  (new)"}`);
    console.log(`Why: ${p.reason || "(no reason given)"}\n`);
    if (p.current) console.log(`--- current version ---\n${p.current}\n--- proposed version ---`);
    console.log(p.proposed);
    const answer = (await rl.question(`Approve ${p.owner}/${p.name}? [a]pprove / [r]eject / [s]kip `))
      .trim()
      .toLowerCase();
    if (answer === "a" || answer === "approve") {
      approveSkill(p.owner, p.name);
      console.log(`✅ ${p.owner}/${p.name} is live.`);
    } else if (answer === "r" || answer === "reject") {
      rejectSkill(p.owner, p.name);
      console.log(`🗑️  Rejected ${p.owner}/${p.name}.`);
    } else {
      console.log(`⏭️  Kept ${p.owner}/${p.name} for later.`);
    }
  }
}
