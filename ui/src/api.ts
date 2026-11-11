// Talking to the camp server. Every request carries this launch's token.

const meta = typeof document === "undefined" ? "" : document.querySelector<HTMLMetaElement>('meta[name="camp-token"]')?.content ?? "";
// The camp server writes the token into the page. Under `npm run ui` Vite serves the page
// as-is, so the token comes from the link (?t=…) instead.
export const TOKEN = meta && meta !== "__CAMP_TOKEN__" ? meta : new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("t") ?? "";

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-camp-token": TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j as T;
}

// Links the browser fetches by itself (images, the event stream) carry the token in the address.
const withToken = (url: string) => `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(TOKEN)}`;
export const eventsUrl = () => withToken("/events");
export const termStreamUrl = (id: string) => withToken(`/api/term/stream?id=${encodeURIComponent(id)}`);
// A place inside a linked folder (root: one of its worktrees), for the Files flyout.
export const treeQuery = (link: string, root: string | undefined, path: string) =>
  `link=${encodeURIComponent(link)}${root ? `&root=${encodeURIComponent(root)}` : ""}&path=${encodeURIComponent(path)}`;
export const treeImageUrl = (link: string, root: string | undefined, path: string) => withToken(`/api/tree/raw?${treeQuery(link, root, path)}`);
export const thumbUrl = (path: string) => withToken(`/api/upload?path=${encodeURIComponent(path)}`);
export const outputUrl = (id: string, path: string) => withToken(`/api/agent/output?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function storeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
export function storeRemove(k: string) { try { localStorage.removeItem(k); } catch { /* nothing was kept */ } }
export function storeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode: nothing is remembered */ } }
