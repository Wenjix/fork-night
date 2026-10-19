import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";
import sharp from "sharp";
import { isLocalRasterUrl } from "../../src/lib/art.ts";
import { KESSLER_FILMS, type RoomFilmShot } from "../../src/lib/room-film.ts";
import { storyboardImage } from "../../src/lib/room-film-image.ts";

const large = await sharp(randomBytes(1024 * 512 * 3), { raw: { width: 1024, height: 512, channels: 3 } }).webp({ lossless: true }).toBuffer();
const small = await sharp(large).resize(640).webp({ quality: 82 }).toBuffer();
const dataUrl = (bytes: Uint8Array) => `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;

function source(bytes: Uint8Array) {
  const shot: RoomFilmShot = { ...KESSLER_FILMS[0].shots[3], image: undefined,
    panel: { caption: "A saved scene", imagePath: "fixture/1.webp", sha256: createHash("sha256").update(bytes).digest("hex") } };
  const client = { storage: { from: () => ({ download: async () => ({ error: null, data: new Blob([Uint8Array.from(bytes)], { type: "image/webp" }) }) }) } };
  return { shot, client: client as unknown as Parameters<typeof storyboardImage>[0] };
}

function browserCodec(t: TestContext, onDecode = () => {}) {
  const calls = { decoded: 0, closed: 0 };
  const globals = {
    FileReader: class {
      result = "";
      onload?: () => void;
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = dataUrl(new Uint8Array(bytes)); this.onload?.(); }); }
    },
    createImageBitmap: async () => {
      calls.decoded++; onDecode();
      return { width: 1024, height: 512, close: () => { calls.closed++; } };
    },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => dataUrl(small) }) },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  return calls;
}

test("a verified saved panel over 1 MB is normalized for a storyboard without relaxing local raster limits", async t => {
  const calls = browserCodec(t);
  assert(large.length > 1_000_000 && large.length < 4_194_304);
  assert.equal(isLocalRasterUrl(dataUrl(large)), false);
  const { client, shot } = source(large);
  const result = await storyboardImage(client, shot, new AbortController().signal);
  assert(isLocalRasterUrl(result));
  assert.equal(result, dataUrl(small));
  assert.deepEqual(calls, { decoded: 1, closed: 1 });
});

test("a small verified panel keeps its original bytes", async t => {
  const calls = browserCodec(t);
  const { client, shot } = source(small);
  assert.equal(await storyboardImage(client, shot, new AbortController().signal), dataUrl(small));
  assert.equal(calls.decoded, 0);
});

test("a changed saved image is refused before decoding or normalization", async t => {
  const calls = browserCodec(t);
  const { client, shot } = source(large);
  shot.panel.sha256 = "0".repeat(64);
  await assert.rejects(storyboardImage(client, shot, new AbortController().signal), /could not be verified/);
  assert.equal(calls.decoded, 0);
});

test("an image beyond the storage limit is refused without decoding", async t => {
  const calls = browserCodec(t);
  const { client, shot } = source(new Uint8Array(4_194_305));
  await assert.rejects(storyboardImage(client, shot, new AbortController().signal), /too large/);
  assert.equal(calls.decoded, 0);
});

test("cancellation during image decoding releases the bitmap and produces no storyboard image", async t => {
  const controller = new AbortController();
  const calls = browserCodec(t, () => controller.abort());
  const { client, shot } = source(large);
  await assert.rejects(storyboardImage(client, shot, controller.signal), { name: "AbortError" });
  assert.deepEqual(calls, { decoded: 1, closed: 1 });
});
