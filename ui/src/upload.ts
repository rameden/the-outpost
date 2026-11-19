// Sending a file of yours to the camp, for a message or a ticket's brief. Files that go together
// (one message, one kickoff) share a batch: the first upload starts it, the rest name it.

import { api } from "./api.ts";
import type { Uploaded, UploadedZip } from "./types.ts";

export const MAX_FILE = 25 * 1024 * 1024;

export function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function uploadFile(file: File, batch?: string, relPath?: string): Promise<Uploaded> {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is over 25 MB`);
  return api<Uploaded>("/api/upload", { name: file.name, data: await toBase64(file), batch, relPath });
}

// A folder sent as a .zip: the camp unpacks it into the batch and it's attached as that folder.
export const isZip = (file: File) => /\.zip$/i.test(file.name);
export async function uploadZip(file: File, batch?: string): Promise<UploadedZip> {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is over 25 MB`);
  return api<UploadedZip>("/api/upload/zip", { name: file.name, data: await toBase64(file), batch });
}

// A link someone pasted or typed, as an attachment (https:// is assumed). Null if it isn't one.
export function linkAttachment(raw: string): { kind: "url"; url: string; name: string } | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try { if (!new URL(url).hostname.includes(".")) return null; } catch { return null; }
  return { kind: "url", url, name: url.replace(/^https?:\/\//i, "").slice(0, 70) };
}
