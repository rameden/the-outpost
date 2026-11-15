// What the game remembers (its best scores), for the extension. In the app this is the page's
// own localStorage (ui/src/api.ts); here that would be whichever site you happened to be on,
// so the bests are kept in the extension's storage instead: one best, wherever you play.
//
// The game reads these as it starts, without waiting, so they're read into memory first
// (loadStore) and written through as they change.

declare const chrome: { storage: { local: { get(keys: null): Promise<Record<string, unknown>>; set(items: Record<string, string>): Promise<void>; remove(key: string): Promise<void> } } };

const kept = new Map<string, string>();

export async function loadStore(): Promise<void> {
  try { for (const [k, v] of Object.entries(await chrome.storage.local.get(null))) if (typeof v === "string") kept.set(k, v); }
  catch { /* no extension storage (the script is being tried on a plain page): nothing is remembered */ }
}
export function storeGet(k: string): string | null { return kept.get(k) ?? null; }
export function storeSet(k: string, v: string) { kept.set(k, v); try { void chrome.storage.local.set({ [k]: v }).catch(() => {}); } catch { /* as above */ } }
export function storeRemove(k: string) { kept.delete(k); try { void chrome.storage.local.remove(k).catch(() => {}); } catch { /* as above */ } }
