// The Konami code, listened for all the time while Barnstorm is on: this is in the plugin's
// manifest, so it's in the page's main script, and only when the code is typed is the game itself
// (Barnstorm.tsx, loaded on demand) fetched.
import { konami } from "./flight.ts";

// Calls `start` when the Konami code is typed, wherever the keyboard happens to be; answers how to stop listening.
export function onKonami(start: () => void): () => void {
  const next = konami();
  const onKey = (ev: KeyboardEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || !next(ev.key)) return;
    ev.preventDefault(); // the last letter of the code isn't typed…
    // …and the one before it is taken back out of a text box it landed in.
    const box = document.activeElement;
    if ((box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) && box.selectionStart && box.selectionStart === box.selectionEnd
      && box.value[box.selectionStart - 1]?.toLowerCase() === "b") document.execCommand?.("delete");
    start();
  };
  addEventListener("keydown", onKey, true);
  return () => removeEventListener("keydown", onKey, true);
}
