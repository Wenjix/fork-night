import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { generatePilotContinuation } from "../../src/generation/run.ts";
import { digest } from "../../src/experiments/storage.ts";

const operationId = "10000000-0000-4000-8000-000000000010";
const parentId = "10000000-0000-4000-8000-000000000011";
test("worker delivers exact sequence length and recovers a third image without rebuying it", async (t) => {
  const env = { ...process.env };
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://worker.invalid",
    SUPABASE_SECRET_KEY: "test-secret",
    OPENAI_API_KEY: "test-image-key",
  });
  t.after(() => {
    process.env = env;
  });
  const image = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#524575" },
  })
    .png()
    .toBuffer();
  const parentImage = await sharp(image).webp().toBuffer();
  const originalReference = `data:image/png;base64,${(await sharp(parentImage).png().toBuffer()).toString("base64")}`;
  const usage = {
    input_tokens: 11,
    input_tokens_details: { text_tokens: 1, image_tokens: 10 },
    output_tokens: 100,
    total_tokens: 111,
  };
  let captions = ["One quiet moment."];
  let calls: any[] = [],
    recorded: any[] = [],
    finish: any;
  let failThirdStorage = false;
  const saved = new Map<string, Buffer>();
  const attempts = new Map<
    number,
    { inputDigest: string; responseDigest?: string }
  >();
  const parentPath = `${parentId}/1.webp`;
  function reset(next: string[]) {
    captions = next;
    calls = [];
    recorded = [];
    finish = undefined;
    saved.clear();
    attempts.clear();
    saved.set(`pilot-media/${parentPath}`, parentImage);
  }
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (url.hostname === "api.openai.com") {
        calls.push(body);
        return Response.json({
          data: [{ b64_json: image.toString("base64") }],
          usage,
        });
      }
      assert.equal(url.hostname, "worker.invalid");
      const rpc = url.pathname.split("/rpc/")[1];
      if (rpc === "pilot_claim_job") return Response.json(true);
      if (rpc === "pilot_begin_panel") {
        const old = attempts.get(body.p_panel_number);
        if (old) {
          assert.equal(old.inputDigest, body.p_input_digest);
          return Response.json(false);
        }
        attempts.set(body.p_panel_number, { inputDigest: body.p_input_digest });
        return Response.json(true);
      }
      if (rpc === "pilot_record_panel") {
        attempts.get(body.p_panel_number)!.responseDigest =
          body.p_response_digest;
        recorded.push(body);
        return Response.json(null);
      }
      if (rpc === "pilot_finish_job") {
        finish = body;
        return Response.json(null);
      }
      if (url.pathname === "/rest/v1/pilot_operations")
        return Response.json({
          id: operationId,
          room_id: "room",
          parent_id: parentId,
          requested_captions: captions,
          prompt: captions.join("\n"),
        });
      if (url.pathname === "/rest/v1/pilot_rooms")
        return Response.json({ is_open: true });
      if (url.pathname === "/rest/v1/pilot_moments")
        return Response.json([
          {
            id: parentId,
            parent_id: null,
            room_id: "room",
            title: "The lighthouse",
            panels: [
              {
                caption: "It waits.",
                imagePath: parentPath,
                sha256: digest(parentImage),
              },
            ],
          },
        ]);
      if (url.pathname === "/rest/v1/pilot_panel_attempts") {
        const n = Number(
          url.searchParams.get("panel_number")!.replace("eq.", ""),
        );
        return Response.json({
          response_digest: attempts.get(n)!.responseDigest ?? null,
        });
      }
      if (url.pathname.startsWith("/storage/v1/object/")) {
        const key = decodeURIComponent(
          url.pathname.replace(
            /^\/storage\/v1\/object\/(?:authenticated\/)?/,
            "",
          ),
        );
        if (init?.method === "POST") {
          if (failThirdStorage && key === `pilot-media/${operationId}/3.webp`) {
            failThirdStorage = false;
            return Response.json(
              {
                statusCode: "500",
                error: "fixture",
                message: "fixture storage outage",
              },
              { status: 500 },
            );
          }
          const value = Buffer.from(init.body as Uint8Array);
          if (saved.has(key))
            assert.equal(digest(saved.get(key)!), digest(value));
          saved.set(key, value);
          return Response.json({ Key: key });
        }
        const value = saved.get(key);
        return value
          ? new Response(new Uint8Array(value))
          : Response.json(
              {
                statusCode: "404",
                error: "not_found",
                message: "Object not found",
              },
              { status: 404 },
            );
      }
      throw new Error(`Unexpected test endpoint: ${url.pathname}`);
    },
  );
  await t.test(
    "one-panel continuation from a one-panel parent dispatches once",
    async () => {
      reset(["The lighthouse closes its eyes."]);
      await generatePilotContinuation(operationId);
      assert.equal(finish.p_error, undefined);
      assert.equal(calls.length, 1);
      assert.equal(recorded[0].p_panel_number, 1);
      assert.equal(recorded[0].p_state, "complete");
      assert.deepEqual(calls[0].images, [{ image_url: originalReference }]);
      assert(calls[0].prompt.includes("1-panel"));
    },
  );
  await t.test(
    "three panels use parent plus immediately preceding output, then recover stored receipts",
    async () => {
      reset([
        "The lighthouse waits.",
        "A boat arrives.",
        "They leave together.",
      ]);
      failThirdStorage = true;
      await generatePilotContinuation(operationId);
      assert.equal(calls.length, 3);
      assert(finish.p_error, "storage interruption must be reported");
      assert.deepEqual(
        recorded.map((r) => r.p_state),
        ["complete", "complete", "uncertain"],
      );
      assert.deepEqual(
        calls.map((c) => c.images.length),
        [1, 2, 2],
      );
      assert.equal(calls[2].images[0].image_url, originalReference);
      assert.equal(
        calls[2].images[1].image_url,
        `data:image/png;base64,${image.toString("base64")}`,
      );
      assert(
        calls[2].prompt.includes("Draw this beat only: They leave together."),
      );
      await generatePilotContinuation(operationId);
      assert.equal(calls.length, 3, "recovery must not buy any panel twice");
      assert.equal(finish.p_error, undefined);
      assert.equal(recorded.at(-1).p_state, "complete");
      assert(saved.has(`pilot-media/${operationId}/3.webp`));
    },
  );
  await t.test(
    "legacy pairs retain request wording for receipt identity",
    async () => {
      reset(["It waits.", "A boat arrives."]);
      await generatePilotContinuation(operationId);
      assert.equal(calls.length, 2);
      assert(
        calls[1].prompt.includes(
          "Draw only panel 2 of this two-panel story continuation.",
        ),
      );
      assert(
        calls[1].prompt.includes("Image 2 is this continuation's first panel."),
      );
      assert(
        calls[1].prompt.includes(
          'The two beats, in order: ["It waits.","A boat arrives."]',
        ),
      );
    },
  );
});
