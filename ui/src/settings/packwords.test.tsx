// The page reads its nouns from the theme pack: under the Newsroom pack no Settings page may still say
// crew, quest, camp or expedition as a noun (code samples and file paths are the exception).
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PACKS } from "../../../src/packs.ts";
import { setWords } from "../words.ts";
import type { CampState } from "../types.ts";
import { Settings } from "./Settings.tsx";
import { SETTINGS_SECTIONS } from "./sections.ts";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, models: [], live: false }), { status: 200 })));
});
afterEach(() => { cleanup(); setWords(undefined); vi.unstubAllGlobals(); });

const S = {
  characters: [{ id: "scout", name: "Scout", role: "scout", emoji: "x", builtin: true, skills: [], tools: [] }], projects: [], jobs: [], history: { conversations: [], projects: [] }, skills: [], installedSkills: [], wiki: [], connectors: [], links: [], inbox: [], quests: [], limits: [],
  parallel: 3, budgetUsd: null, runtime: "api", login: null, sandbox: { on: false, available: true }, spend: { today: 0, week: 0, total: 0 },
  settings: {
    approval: "safe", allow: [], exact: [], deny: [], askAlways: [], reviewer: false, allowHosts: [], defaultAllow: [],
    questsAtOnce: 4, questsMax: 16, parallelMax: 8, selfEdit: false,
    phone: { topic: "", server: "", approve: null, on: false }, runtimeLocked: null, outpost: "Home",
  },
  pack: "newsroom", packs: PACKS,
} as unknown as CampState;

// File paths, env names and the packs' own blurbs and season texts are data, not the page's nouns.
const OLD = /\b(crew|quests?|camps?|expeditions?)\b/i;
const strip = (t: string) => t.replace(/camp[/-]\S*/g, "").replace(/camp\.\w+/g, "");
const DATA = [/^Camp$/, /^(An adventurer's guild camp|A ship and its bridge crew|A film crew on set|A pirate ship|A lab|A newsroom|A studio)/, /^Lights and a gold orb/];

for (const section of SETTINGS_SECTIONS) {
  test(`Settings, ${section}: no Guild nouns under the Newsroom pack`, () => {
    setWords("newsroom", PACKS);
    const { container } = render(<Settings S={S} section={section} setSection={() => {}} refresh={() => {}} onAttachLink={() => {}} onClose={() => {}} />);
    const text = [...container.querySelectorAll("*")]
      .filter((el) => !el.closest("code, pre, kbd"))
      .flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? ""))
      .concat([...container.querySelectorAll("[title],[placeholder],[aria-label]")].flatMap((el) => ["title", "placeholder", "aria-label"].map((k) => el.getAttribute(k) ?? "")))
      .map(strip).filter((t) => OLD.test(t) && !DATA.some((d) => d.test(t)));
    expect(text).toEqual([]);
  });
}
