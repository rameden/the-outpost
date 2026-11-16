// What each of the crew carries (Orbit.tsx draws one satellite for each, round their planet): the
// skills they've been given, the ones the whole camp shares, and the connectors they may call.
// Each is a real, named thing, read from what the camp reports.

import type { CampState } from "../types.ts";

export type KitItem = {
  id: string; kind: "skill" | "connector"; name: string; about: string;
  shared?: boolean;             // a skill the whole camp has
  state?: "connected" | "error" | "idle"; error?: string; tools?: string[]; write?: boolean; // a connector's: how it stands, and what it offers
};
export const SATS_MAX = 10; // as many satellites as a planet is drawn with (the panel lists every one)

type Kit = Partial<Pick<CampState, "installedSkills" | "connectors">> | null | undefined;
export function kitOf(S: Kit, id: string): KitItem[] {
  const skills: KitItem[] = (S?.installedSkills ?? []).filter((s) => s.owner === id || s.owner === "shared")
    .map((s) => ({ id: `skill:${s.owner}/${s.name}`, kind: "skill", name: s.name, about: s.description || "A skill", ...(s.owner === "shared" ? { shared: true } : {}) }));
  const connectors: KitItem[] = (S?.connectors ?? []).filter((c) => c.agents.includes(id))
    .map((c) => ({
      id: `connector:${c.name}`, kind: "connector", name: c.name, about: c.description || "A connector", state: c.state,
      tools: c.tools.map((t) => t.name), ...(c.error ? { error: c.error } : {}), ...(c.allowWrite ? { write: true } : {}),
    }));
  // Their own first, then what's shared, then connectors: the nearest satellites are the ones most their own.
  return [...skills.filter((s) => !s.shared), ...connectors, ...skills.filter((s) => s.shared)];
}

// How far along they are: a level for every fifty experience, and a quest is worth ten.
export const levelOf = (xp: number) => Math.floor(Math.max(0, xp) / 50) + 1;
export const questsDone = (xp: number) => Math.floor(Math.max(0, xp) / 10);
// How settled their world is (0 to 1): it fills up over the first nine levels.
export const grownOf = (xp: number) => Math.min(1, (levelOf(xp) - 1) / 8);
// The lights of a settled world, round the inside of its disc on the flat view: two more for each level.
export const lightsOf = (xp: number) => Math.min(24, (levelOf(xp) - 1) * 2);
