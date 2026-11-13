// Talking to the camp server. Every request carries the camp's key.
//
// The key is never in a link. The link the camp prints carries a one-time sign-in code
// (…/#k=<code>); the page trades it for the key and keeps the key in this browser's storage for
// this address and port, where no other site or local server can read it. After that the plain
// address opens by itself, and a tab left open carries on when the camp restarts.

const KEY_NAME = "camp-key";
const kept = (): string => { try { return localStorage.getItem(KEY_NAME) ?? ""; } catch { return ""; } };
const keep = (key: string) => { try { if (key) localStorage.setItem(KEY_NAME, key); else localStorage.removeItem(KEY_NAME); } catch { /* private mode: it lasts until the page is closed */ } };
export let TOKEN = kept();

// Sign this browser in, as the page opens. True when it holds a key the camp accepts (or the camp
// can't be reached just now, in which case the page opens and waits for it); false when there's
// no key, or the camp says the one kept here is no longer good.
export async function signIn(): Promise<boolean> {
  const url = new URL(location.href);
  const code = new URLSearchParams(url.hash.replace(/^#/, "")).get("k");
  const inLink = url.searchParams.get("t"); // a link from before sign-in codes: taken once, then out of the address
  if (code || inLink) {
    url.hash = "";
    url.searchParams.delete("t");
    history.replaceState(null, "", url.pathname + url.search); // neither stays in the address bar
  }
  if (code) {
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && typeof j.token === "string") { TOKEN = j.token; keep(TOKEN); }
    } catch { /* the camp isn't answering: fall back on a key already kept here */ }
  } else if (inLink) { TOKEN = inLink; keep(TOKEN); }
  if (!TOKEN) return false;
  try {
    const r = await fetch("/api/ping", { headers: { "x-camp-token": TOKEN } });
    if (r.status === 401) { signOut(); return false; }
  } catch { /* not reachable right now: the page says so and keeps trying */ }
  return true;
}
// The key kept here is no good any more (the camp was given a new one): forget it and say so.
export function signOut() {
  TOKEN = "";
  keep("");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("camp:signed-out"));
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-camp-token": TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && TOKEN) signOut();
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
