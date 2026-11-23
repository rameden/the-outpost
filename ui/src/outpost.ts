// The outpost this page belongs to (src/outpost.ts): the camp server writes its name into the
// page as it serves it, so the name is there before the page has signed in. The page as built,
// or with nothing filled in, is Mae's.

export const DEFAULT_OUTPOST = "Mae";

export function outpostName(doc: Document = document): string {
  return doc.querySelector('meta[name="outpost"]')?.getAttribute("content")?.trim() || DEFAULT_OUTPOST;
}

// After the outpost is renamed (Settings, General), the page carries the new name from then on.
export function setOutpostName(name: string, doc: Document = document) {
  let meta = doc.querySelector('meta[name="outpost"]');
  if (!meta) { meta = doc.createElement("meta"); meta.setAttribute("name", "outpost"); doc.head.append(meta); }
  if (meta.getAttribute("content") !== name) meta.setAttribute("content", name);
}
