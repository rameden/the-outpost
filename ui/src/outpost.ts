// The outpost this page belongs to (src/outpost.ts): the camp server writes its name into the
// page as it serves it, so the name is there before the page has signed in. The page as built,
// or with nothing filled in, is Mae's.

export const DEFAULT_OUTPOST = "Mae";

export function outpostName(doc: Document = document): string {
  return doc.querySelector('meta[name="outpost"]')?.getAttribute("content")?.trim() || DEFAULT_OUTPOST;
}

// Mae's name is drawn (the logo kit's letters); any other outpost's is set in type.
export const isMae = (name: string) => name === DEFAULT_OUTPOST;
