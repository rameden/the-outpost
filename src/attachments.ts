// Attachments: files, folders, images, PDFs, and URLs you hand the camp with a request.
// Uploads are stored in camp/uploads/<batch>/. Project files can be referenced in place with @path.
// Images and PDFs go to the model as real image/document blocks (it can see them); everything
// else is listed by path so the crew can open it with read_file or view_file.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { campPath, CAMP_ROOT, type Tool } from "./tools.js";

export const UPLOADS_DIR = join("camp", "uploads");
export type Attachment = { kind: "file" | "folder" | "url"; name: string; path?: string; url?: string };
export type RequestContent = string | Anthropic.ContentBlockParam[];

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // the API's per-image limit
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_VISUAL_BLOCKS = 8;               // images + PDFs shown inline per request
const SKIP_DIRS = new Set(["node_modules", ".git", "sessions"]);

export function imageType(path: string) {
  return IMAGE_TYPES[extname(path).toLowerCase()];
}
const isPdf = (path: string) => extname(path).toLowerCase() === ".pdf";

function kb(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- Uploads ----------
function cleanSegment(s: string) {
  return s.replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 120);
}

export function newBatch() {
  return `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
}

// Save one uploaded file. relPath keeps a folder's structure (from the browser's folder picker).
export function saveUpload(u: { name: string; data: string; batch?: string; relPath?: string }) {
  const batch = u.batch && /^[\w-]{6,40}$/.test(u.batch) ? u.batch : newBatch();
  const segments = String(u.relPath || u.name).split(/[\\/]+/).map(cleanSegment).filter(Boolean);
  if (segments.length === 0) throw new Error("Bad file name");
  const path = join(UPLOADS_DIR, batch, ...segments);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.from(u.data, "base64");
  writeFileSync(path, bytes);
  return { path, name: segments[segments.length - 1], size: bytes.length, batch, image: !!imageType(path) };
}

// ---------- Finding project files (for @ autocomplete) ----------
export function searchFiles(query: string, limit = 20): string[] {
  const q = query.toLowerCase();
  const hits: { path: string; score: number }[] = [];
  let seen = 0;
  const walk = (dir: string) => {
    if (seen > 6000) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++seen > 6000) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relative(CAMP_ROOT, abs).split(sep).join("/");
      try { campPath(rel, "read"); } catch { continue; } // secrets and private memory stay hidden
      if (entry.isDirectory()) {
        if (!q || rel.toLowerCase().includes(q)) hits.push({ path: rel + "/", score: score(rel, q) + 1 });
        walk(abs);
      } else if (!q || rel.toLowerCase().includes(q)) {
        hits.push({ path: rel, score: score(rel, q) });
      }
    }
  };
  walk(CAMP_ROOT);
  return hits.sort((a, b) => a.score - b.score || a.path.length - b.path.length).slice(0, limit).map((h) => h.path);
}

function score(rel: string, q: string) {
  const base = rel.split("/").pop()!.toLowerCase();
  if (!q) return rel.split("/").length;
  return base.startsWith(q) ? 0 : base.includes(q) ? 1 : 2;
}

// @path references in a message: anything after @ that looks like a path and exists in the project.
export function findFileRefs(text: string): Attachment[] {
  const out: Attachment[] = [];
  for (const m of text.matchAll(/(?:^|\s)@([\w][\w./-]*[\w/])(?=$|[\s,;:!?)])/g)) {
    const ref = m[1];
    if (!/[./]/.test(ref)) continue; // @scout is a crew mention, not a file
    try {
      const abs = campPath(ref, "read");
      if (!existsSync(abs)) continue;
      const kind = statSync(abs).isDirectory() ? "folder" : "file";
      out.push({ kind, name: ref.replace(/\/$/, "").split("/").pop()!, path: relative(CAMP_ROOT, abs).split(sep).join("/") });
    } catch { /* not readable: leave it as plain text */ }
  }
  return out;
}

// ---------- Building the request ----------
function listFolder(path: string, max = 60): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= max) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.push(`${relative(CAMP_ROOT, abs).split(sep).join("/")} (${kb(statSync(abs).size)})`);
    }
  };
  walk(campPath(path, "read"));
  return files;
}

// Turn text + attachments into what the agent receives: visual blocks first, then the text with
// an attachment list it can act on. Returns the content and a tidy summary for the feed.
export function buildRequest(text: string, attachments: Attachment[] = []): { content: RequestContent; attached: Attachment[] } {
  const all = [...attachments, ...findFileRefs(text)];
  const unique = all.filter((a, i) => all.findIndex((b) => (b.path ?? b.url) === (a.path ?? a.url)) === i);
  const blocks: Anthropic.ContentBlockParam[] = [];
  const lines: string[] = [];
  const attached: Attachment[] = [];

  for (const a of unique) {
    if (a.kind === "url") {
      if (!a.url || !/^https?:\/\//i.test(a.url)) continue;
      lines.push(`- Link: ${a.url} (the Scout can fetch it with web_fetch)`);
      attached.push(a);
      continue;
    }
    if (!a.path) continue;
    let abs: string;
    try { abs = campPath(a.path, "read"); } catch { continue; }
    if (!existsSync(abs)) continue;
    attached.push(a);
    if (a.kind === "folder" || statSync(abs).isDirectory()) {
      const files = listFolder(a.path);
      lines.push(`- Folder: ${a.path} (${files.length}${files.length >= 60 ? "+" : ""} files)\n${files.map((f) => `    - ${f}`).join("\n")}`);
      continue;
    }
    const size = statSync(abs).size;
    const media = imageType(abs);
    if (media && size <= MAX_IMAGE_BYTES && blocks.length < MAX_VISUAL_BLOCKS) {
      blocks.push({ type: "image", source: { type: "base64", media_type: media, data: readFileSync(abs).toString("base64") } });
      lines.push(`- Image: ${a.path} (${kb(size)}, shown above)`);
    } else if (isPdf(abs) && size <= MAX_PDF_BYTES && blocks.length < MAX_VISUAL_BLOCKS) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: readFileSync(abs).toString("base64") }, title: a.name });
      lines.push(`- PDF: ${a.path} (${kb(size)}, shown above)`);
    } else if (media || isPdf(abs)) {
      lines.push(`- ${media ? "Image" : "PDF"}: ${a.path} (${kb(size)}; too large to show inline, open with view_file)`);
    } else {
      lines.push(`- File: ${a.path} (${kb(size)}; open with read_file)`);
    }
  }

  if (lines.length === 0) return { content: text, attached };
  const full =
    `${text}\n\nAttachments from the user:\n${lines.join("\n")}\n` +
    `(When you brief a teammate, pass along the paths or links they need. Anyone can open images ` +
    `and PDFs with view_file and text with read_file.)`;
  return { content: blocks.length ? [...blocks, { type: "text", text: full }] : full, attached };
}

// What the user typed, without attachment blocks or the attachment list: for the feed and quest log.
export function requestDisplay(content: RequestContent): string {
  const text = typeof content === "string" ? content : content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  return text.split("\n\nAttachments from the user:")[0];
}

// Plain text of a request, for session history and logs.
export function requestText(content: RequestContent): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
}

// ---------- Letting agents look at images and PDFs ----------
export function viewFileFor(self: string): Tool {
  return {
    def: {
      name: "view_file",
      description:
        "Look at an image (png, jpg, gif, webp) or a PDF inside the camp folder, such as one the user " +
        "attached. Text files are returned as text. For plain text, read_file is fine too.",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    run: async ({ path }) => {
      const abs = campPath(path, "read", self);
      const size = statSync(abs).size;
      const media = imageType(abs);
      if (media) {
        if (size > MAX_IMAGE_BYTES) return `That image is ${kb(size)}; the limit is 5 MB.`;
        return [{ type: "image", source: { type: "base64", media_type: media, data: readFileSync(abs).toString("base64") } }];
      }
      if (isPdf(abs)) {
        if (size > MAX_PDF_BYTES) return `That PDF is ${kb(size)}; the limit is 20 MB.`;
        return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: readFileSync(abs).toString("base64") } }];
      }
      return readFileSync(abs, "utf8");
    },
  };
}
