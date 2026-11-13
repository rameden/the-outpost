// Display choices kept in this browser that one part of the page sets and another reads (Settings
// changes them; the header shows or hides what they name). A change shows at once, here and in
// any other tab of the camp.

import { useSyncExternalStore } from "react";
import { storeGet, storeSet } from "./api.ts";

const CHANGED = "camp:pref";

function subscribe(fn: () => void) {
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", fn); // another tab changed it
  return () => { window.removeEventListener(CHANGED, fn); window.removeEventListener("storage", fn); };
}

// A yes/no choice, `on` until you turn it off.
function flag(key: string) {
  const get = () => storeGet(key) !== "0";
  return {
    get,
    set(on: boolean) { storeSet(key, on ? "1" : "0"); window.dispatchEvent(new Event(CHANGED)); },
    use: () => useSyncExternalStore(subscribe, get),
  };
}

// Today's cost (or, on the subscription, its estimate at API prices) in the top bar.
export const showCost = flag("camp-show-cost");
