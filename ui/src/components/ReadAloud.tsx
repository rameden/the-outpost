import { createContext, useContext, useId, useSyncExternalStore } from "react";
import { SPEEDS, onReading, player, readAloud, reading, spoken } from "../readaloud.ts";
import { Icon } from "./bits.tsx";

// Whether a voice is connected (Settings, Voice). Without one there's nothing to read with, so the
// Read aloud buttons stay away. (On by default, for a piece shown on its own.)
export const VoiceOn = createContext(true);
export const useReading = () => useSyncExternalStore(onReading, reading);

// A button that reads some text aloud in your ElevenLabs voice. The reading itself is run from the
// player (below), which stays in the top bar wherever you go; this button turns into Stop while its own text
// is the one being read. what: a few words naming the text, for the player. markdown: the text is
// Markdown, to be said without its marks.
export function ReadAloud({ text, what, label = "Read aloud", markdown }: { text: string; what: string; label?: string; markdown?: boolean }) {
  const id = useId();
  const r = useReading();
  if (!useContext(VoiceOn)) return null;
  const mine = r.from === id && r.state !== "idle";
  return mine
    ? <button type="button" className="btn small" onClick={player.stop}>Stop reading</button>
    : <button type="button" className="btn small" disabled={!text.trim()} title="Read this aloud. Its text goes to ElevenLabs to be spoken." onClick={() => readAloud(markdown ? spoken(text) : text, { what, from: id })}>{label}</button>;
}

// The one player: it sits in the top bar, left of the status chip, while something is being read
// (and when a read failed, to say why), with back, pause, on, speed and stop. It's the same
// wherever the reading was started.
export function ReadingPlayer() {
  const r = useReading();
  if (r.state === "idle" && !r.error) return null;
  if (r.state === "idle") {
    return (
      <div className="player" role="region" aria-label="Reading aloud">
        <span className="form-error" role="alert" title={r.error}>{r.error}</span>
        <button type="button" className="player-btn" aria-label="Dismiss" title="Dismiss" onClick={player.dismiss}><Icon name="x" /></button>
      </div>
    );
  }
  const next = SPEEDS[(SPEEDS.indexOf(r.speed) + 1) % SPEEDS.length];
  const loading = r.state === "loading";
  return (
    <div className="player" role="region" aria-label="Reading aloud">
      <span className="player-what">
        <b title={r.what}>{r.what || "Reading aloud"}</b>
        <span role="status">{loading ? "Fetching the voice…" : r.parts > 1 ? `Part ${r.part} of ${r.parts}` : r.state === "paused" ? "Paused" : "Playing"}</span>
      </span>
      <button type="button" className="player-btn" aria-label="Back a part" title="Back a part" disabled={r.part <= 1} onClick={() => player.skip(-1)}><Icon name="back" /></button>
      {r.state === "paused"
        ? <button type="button" className="player-btn main" aria-label="Resume" title="Resume" onClick={player.resume}><Icon name="play" /></button>
        : <button type="button" className="player-btn main" aria-label="Pause" title="Pause" disabled={loading} onClick={player.pause}><Icon name="pause" /></button>}
      <button type="button" className="player-btn" aria-label="On a part" title="On a part" disabled={r.part >= r.parts} onClick={() => player.skip(1)}><Icon name="forward" /></button>
      <button type="button" className="player-btn speed" aria-label={`Reading speed ${r.speed}×. Change to ${next}×`} title="Reading speed" onClick={() => player.setSpeed(next)}>{r.speed}×</button>
      <button type="button" className="player-btn" aria-label="Stop reading" title="Stop reading" onClick={player.stop}><Icon name="x" /></button>
    </div>
  );
}
