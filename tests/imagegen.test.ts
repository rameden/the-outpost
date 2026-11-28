import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateImageFor, imagePath, imageRequest, IMAGE_MODEL } from "../src/imagegen.ts";
import { JOURNALED } from "../src/oplog.ts";
import { memberFrom } from "../src/crew.ts";

const root = () => mkdtempSync(join(tmpdir(), "imagegen-"));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test("pictures go only into the member's own outputs folder, as png or webp", () => {
  const r = root();
  const ok = imagePath("designer", "hero.png", r);
  assert.equal(typeof ok, "object");
  assert.equal((ok as any).abs, join(r, "camp/agents/designer/outputs/hero.png"));
  assert.equal((imagePath("designer", "camp/agents/designer/outputs/a/b.WEBP", r) as any).format, "webp");
  assert.match(imagePath("designer", "camp/agents/scout/outputs/x.png", r) as string, /only be saved inside/);
  assert.match(imagePath("designer", "../../../../ui/public/x.png", r) as string, /only be saved inside/);
  assert.match(imagePath("designer", "hero.jpg", r) as string, /\.png or \.webp/);
});

test("the request keeps to sizes and qualities the API takes", () => {
  const b = imageRequest({ prompt: " a fox ", size: "999x1", quality: "max", background: "transparent" }, "png");
  assert.deepEqual(b, { model: IMAGE_MODEL, prompt: "a fox", n: 1, size: "1024x1024", quality: "medium", background: "transparent", output_format: "png" });
  assert.equal(IMAGE_MODEL, process.env.OUTPOST_IMAGE_MODEL?.trim() || "gpt-image-2.6-sunburst");
});

test("generate_image saves the picture it's sent, and reconcile sees it", async () => {
  const r = root();
  process.env.OPENAI_API_KEY = "test-key";
  let sent: any;
  const fake = (async (url: string, init: any) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const tool = generateImageFor("designer", { fetch: fake, root: r });
  assert.equal((await tool.reconcile({ path: "fox.png" })).state, "not_done");
  const out = await tool.run!({ prompt: "a fox", path: "fox.png", quality: "low" });
  assert.match(String(out), /Saved a 1024x1024 low-quality PNG .* to camp\/agents\/designer\/outputs\/fox\.png/);
  assert.match(sent.url, /\/images\/generations$/);
  assert.equal(sent.auth, "Bearer test-key");
  assert.deepEqual(readFileSync(join(r, "camp/agents/designer/outputs/fox.png")), PNG);
  assert.equal((await tool.reconcile({ path: "fox.png" })).state, "done");
});

test("an API refusal is an error, and nothing is written", async () => {
  const r = root();
  process.env.OPENAI_API_KEY = "test-key";
  const fake = (async () => new Response(JSON.stringify({ error: { message: "Your request was rejected by the safety system." } }), { status: 400 })) as unknown as typeof fetch;
  const tool = generateImageFor("designer", { fetch: fake, root: r });
  await assert.rejects(() => tool.run!({ prompt: "x", path: "no.png" }), /said no \(400\): Your request was rejected/);
  assert.equal(existsSync(join(r, "camp/agents/designer/outputs/no.png")), false);
});

test("paid calls are journaled, and the images ability survives being saved", () => {
  assert.ok(JOURNALED.has("generate_image"));
  const m = memberFrom({ name: "Painter", role: "Draws.", abilities: { images: true, write: "outputs" } });
  assert.deepEqual(m.abilities, { write: "outputs", images: true });
  assert.deepEqual(memberFrom({ name: "Plain", role: "Draws." }).abilities, {});
});
