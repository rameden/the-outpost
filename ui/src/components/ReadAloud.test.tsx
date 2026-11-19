// Reading aloud: text split at sentences, fetched a part at a time and played in order; the one
// player with pause, back, on, speed and stop; Markdown said without its marks; and what's said
// when the voice can't be fetched.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { chunkText, player, spoken, spokenLines } from "../readaloud.ts";
import type { Debrief } from "../tickets.ts";
import { ReadAloud, ReadingPlayer, VoiceOn } from "./ReadAloud.tsx";
import { debriefSpeech } from "./TicketDebrief.tsx";

// A stand-in for the browser's player: it "plays" until the test says the sound has ended.
class FakeAudio {
  static all: FakeAudio[] = [];
  src = ""; playbackRate = 1; paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeAudio.all.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ""; }
}
const asked: string[] = [];
let answer: (text: string) => Response = () => new Response(new Blob(["mp3"]));
beforeEach(() => {
  asked.length = 0; FakeAudio.all.length = 0; localStorage.clear();
  answer = () => new Response(new Blob(["mp3"]));
  vi.stubGlobal("Audio", FakeAudio);
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:part-${++n}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    const { text } = JSON.parse(String(init?.body));
    asked.push(text);
    return answer(text);
  }));
});
afterEach(() => { player.stop(); player.dismiss(); cleanup(); vi.unstubAllGlobals(); });

test("text is split at sentences, with a short first part so the voice starts soon", () => {
  expect(chunkText("  ")).toEqual([]);
  expect(chunkText("One.  Two!\nThree?")).toEqual(["One. Two! Three?"]);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says a little something.`).join(" ");
  const parts = chunkText(long);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts[0].length).toBeLessThanOrEqual(500);
  expect(parts.every((p) => p.length <= 1800 && /\.$/.test(p))).toBe(true);
  expect(parts.join(" ")).toBe(long);
  // One endless sentence is cut at a space rather than sent whole.
  expect(chunkText("word ".repeat(800)).every((p) => p.length <= 1800)).toBe(true);
});

test("a debrief is read in the page's order, each item as a sentence", () => {
  const d = { runs: 3, asks: 1, quests: 1, cost: 1.5, well: ["Tests passed first time"], better: ["The plan was vague."], proposed: [{ name: "Plan first", text: "Write the plan before code" }] } as unknown as Debrief;
  expect(debriefSpeech(d)).toBe("How the crew did. 3 runs and 1 quest, costing $1.50. Went well: Tests passed first time. Could have gone better: The plan was vague. Lessons proposed: Plan first: Write the plan before code.");
  expect(debriefSpeech({ ...d, well: [], better: [], proposed: [] })).toMatch(/Nothing stood out either way\.$/);
});

test("Markdown is said without its marks, and each heading, item and row ends like a sentence", () => {
  const md = ["## What I found", "", "The **login** page was _slow_ because of `fetchUser`", "being called twice.", "", "- [x] Fixed the double call", "- See [the pull request](https://github.com/acme/web/pull/12)", "1. Docs at https://www.example.com/docs/setup?x=1", "",
    "```ts", "const secret = 1;", "```", "", "| File | Lines |", "| --- | --- |", "| app.ts | 12 |", "", "---", "> Done!"].join("\n");
  expect(spoken(md)).toBe("What I found. The login page was slow because of fetchUser being called twice. Fixed the double call. See the pull request. Docs at a link to example.com. There's a code block here. File, Lines. app.ts, 12. Done!");
  expect(spoken("")).toBe("");
  // Text picked off the page: each line is its own sentence.
  expect(spokenLines("Went well\nTests passed first time.\n\n  Lessons  ")).toBe("Went well. Tests passed first time. Lessons.");
});

test("Read aloud plays the parts in order, run from the player: pause, speed, back, on and stop", async () => {
  const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says a little something.`).join(" ");
  const parts = chunkText(text);
  expect(parts.length).toBeGreaterThan(2);
  render(<><ReadAloud text={text} what="Scout's answer" /><ReadingPlayer /></>);
  expect(screen.queryByRole("region", { name: "Reading aloud" })).toBeNull(); // no player until something is read
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  await screen.findByRole("button", { name: "Pause" });
  const audio = FakeAudio.all[0];
  expect(audio.src).toBe("blob:part-1");
  expect(screen.getByRole("region", { name: "Reading aloud" }).textContent).toContain("Scout's answer");
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`Part 1 of ${parts.length}`));
  await waitFor(() => expect(asked).toEqual(parts.slice(0, 2))); // the next part is fetched while this one plays
  expect((screen.getByRole("button", { name: "Back a part" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(audio.paused).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
  await screen.findByRole("button", { name: "Pause" });

  fireEvent.click(screen.getByRole("button", { name: /Reading speed 1×/ }));
  expect(audio.playbackRate).toBe(1.25);
  expect(localStorage.getItem("camp-voice-speed")).toBe("1.25");

  audio.onended?.();
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`Part 2 of ${parts.length}`));
  await waitFor(() => expect(audio.src).toBe("blob:part-2"));
  expect(audio.playbackRate).toBe(1.25);

  // On a part, then back one: each goes to its own sound, and nothing is fetched twice.
  fireEvent.click(screen.getByRole("button", { name: "On a part" }));
  await waitFor(() => expect(audio.src).toBe("blob:part-3"));
  fireEvent.click(screen.getByRole("button", { name: "Back a part" }));
  await waitFor(() => expect(audio.src).toBe("blob:part-2"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`Part 2 of ${parts.length}`));
  expect(asked.filter((t) => t === parts[1]).length).toBe(1);

  // The button that started it is its Stop for as long as it reads.
  fireEvent.click(screen.getAllByRole("button", { name: "Stop reading" })[0]);
  expect(await screen.findByRole("button", { name: "Read aloud" })).toBeTruthy();
  expect(audio.paused).toBe(true);
  expect(screen.queryByRole("region", { name: "Reading aloud" })).toBeNull();
});

test("the last part ending puts the button back and the player away, and a new read takes over from the old", async () => {
  render(<><ReadAloud text="Short and sweet." what="Voice test" label="Test voice" /><ReadAloud text={"## Another\n\n- thing"} markdown what="Job report · Digest" /><ReadingPlayer /></>);
  fireEvent.click(screen.getByRole("button", { name: "Test voice" }));
  await screen.findByRole("button", { name: "Pause" });
  expect(screen.getByRole("status").textContent).toBe("Playing"); // one part: no "Part 1 of 1"
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Reading aloud" }).textContent).toContain("Job report · Digest"));
  expect(asked).toEqual(["Short and sweet.", "Another. thing."]);
  expect(FakeAudio.all[0].paused).toBe(true);
  expect(screen.getByRole("button", { name: "Test voice" })).toBeTruthy();
  await screen.findByRole("button", { name: "Pause" });
  FakeAudio.all[1].onended?.();
  expect(await screen.findByRole("button", { name: "Read aloud" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Reading aloud" })).toBeNull();
});

test("when the voice can't be fetched, the player says why until it's dismissed", async () => {
  answer = () => new Response(JSON.stringify({ error: "ElevenLabs has no characters left on your plan." }), { status: 400 });
  render(<><ReadAloud text="Hello." what="Debrief" /><ReadingPlayer /></>);
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect((await screen.findByRole("alert")).textContent).toBe("ElevenLabs has no characters left on your plan.");
  expect(screen.getByRole("button", { name: "Read aloud" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("region", { name: "Reading aloud" })).toBeNull();
});

test("with no voice connected there's no Read aloud button", () => {
  render(<VoiceOn.Provider value={false}><ReadAloud text="Hello." what="Debrief" /></VoiceOn.Provider>);
  expect(screen.queryByRole("button")).toBeNull();
});
