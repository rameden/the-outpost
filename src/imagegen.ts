// generate_image: a crew member with the "images" ability draws raster art (PNG/WebP) with
// OpenAI's image model, through your connected OpenAI key (Settings → Models). Each picture is
// saved in the member's own outputs folder only, never in a project: the Artificer puts it in place.
// It costs money per picture, so its calls are journaled (oplog.ts) and a resumed task never pays twice.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { currentSignal } from "./context.js";
import { providerKey } from "./providers.js";
import type { Tool } from "./tools.js";

export const IMAGE_MODEL = process.env.OUTPOST_IMAGE_MODEL?.trim() || "gpt-image-2.6-sunburst";
const SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;
const QUALITIES = ["low", "medium", "high"] as const;
const BASE = () => (process.env.PROVIDER_BASE_URL_OPENAI ?? "https://api.openai.com/v1").replace(/\/+$/, "");

type Input = { prompt?: unknown; path?: unknown; size?: unknown; background?: unknown; quality?: unknown };

// Where a picture goes: inside camp/agents/<self>/outputs/, with the extension its format needs.
export function imagePath(self: string, path: unknown, root = process.cwd()): { abs: string; format: "png" | "webp" } | string {
  const outputs = resolve(root, "camp", "agents", self, "outputs") + sep;
  const raw = String(path ?? "").trim();
  if (!raw) return "Give a path for the picture, like camp/agents/" + self + "/outputs/hero.png.";
  const rel = raw.startsWith("camp/") ? raw : `camp/agents/${self}/outputs/${raw}`;
  const abs = resolve(root, rel);
  if (!abs.startsWith(outputs)) return `Pictures can only be saved inside camp/agents/${self}/outputs/.`;
  const ext = abs.match(/\.(png|webp)$/i)?.[1]?.toLowerCase();
  if (!ext) return "Save the picture as .png or .webp.";
  return { abs, format: ext as "png" | "webp" };
}

// The request body OpenAI's /images/generations takes, from what the agent asked for.
export function imageRequest(input: Input, format: "png" | "webp") {
  const size = (SIZES as readonly string[]).includes(String(input.size)) ? String(input.size) : "1024x1024";
  const quality = (QUALITIES as readonly string[]).includes(String(input.quality)) ? String(input.quality) : "medium";
  const background = input.background === "transparent" || input.background === "opaque" ? input.background : "auto";
  return { model: IMAGE_MODEL, prompt: String(input.prompt ?? "").trim().slice(0, 8000), n: 1, size, quality, background, output_format: format };
}

export function generateImageFor(self: string, o: { fetch?: typeof fetch; root?: string } = {}): Tool & { reconcile: (input: Input) => Promise<{ state: "done"; result: string } | { state: "not_done" }> } {
  const doFetch = o.fetch ?? fetch;
  return {
    def: {
      name: "generate_image",
      description:
        `Draw a raster picture (illustration, app icon, spot art, background) with OpenAI's image model (${IMAGE_MODEL}) and save it ` +
        `as a PNG or WebP in camp/agents/${self}/outputs/. Each call costs money, so write one careful prompt rather than many tries: ` +
        `subject, style, palette (hex colours), composition, and what to leave out. Use background "transparent" for icons and cutouts. ` +
        `Look at the result with view_file before you report it. For crisp line icons and logos, hand-written SVG (write_file) is often better.`,
      input_schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What to draw, in detail." },
          path: { type: "string", description: `Where to save it, e.g. camp/agents/${self}/outputs/empty-inbox.png (.png or .webp).` },
          size: { type: "string", enum: [...SIZES], description: "Square, landscape, portrait, or auto. Default 1024x1024." },
          background: { type: "string", enum: ["transparent", "opaque", "auto"], description: "Transparent for icons and cutouts. Default auto." },
          quality: { type: "string", enum: [...QUALITIES], description: "low for drafts, medium (default), high for the final version." },
        },
        required: ["prompt", "path"],
      },
    },
    run: async (input: Input) => {
      const where = imagePath(self, input.path, o.root);
      if (typeof where === "string") return where;
      const body = imageRequest(input, where.format);
      if (!body.prompt) return "Say what to draw in the prompt.";
      const key = providerKey("openai");
      if (!key) return "No OpenAI key is connected, so pictures can't be drawn. Connect OpenAI in Settings → Models, or make the asset as SVG with write_file.";
      const res = await doFetch(`${BASE()}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: currentSignal(),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`OpenAI's image model said no (${res.status}): ${String(json?.error?.message ?? res.statusText).slice(0, 400)}`);
      const b64 = json?.data?.[0]?.b64_json;
      if (typeof b64 !== "string") throw new Error("OpenAI's image model sent back no picture.");
      const bytes = Buffer.from(b64, "base64");
      mkdirSync(dirname(where.abs), { recursive: true });
      writeFileSync(where.abs, bytes);
      const shown = where.abs.slice(resolve(o.root ?? process.cwd()).length + 1).split(sep).join("/");
      const revised = typeof json.data[0].revised_prompt === "string" ? `\nThe model read the prompt as: ${json.data[0].revised_prompt.slice(0, 600)}` : "";
      return `Saved a ${body.size} ${body.quality}-quality ${where.format.toUpperCase()} (${Math.round(bytes.length / 1024)} KB) to ${shown}. Look at it with view_file before reporting.${revised}`;
    },
    // A call that started before the task stopped: if the picture is there, it was drawn (and paid for).
    reconcile: async (input: Input) => {
      const where = imagePath(self, input.path, o.root);
      return typeof where !== "string" && existsSync(where.abs) && statSync(where.abs).size > 0
        ? { state: "done", result: `The picture is already saved at ${String(input.path)}.` }
        : { state: "not_done" };
    },
  };
}
