import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAssist, assistFailure } from "../../src/generation/assist.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const parent = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const shaped = {
  captions: ["The whale remembers."],
  twists: [],
};

test("assist admission, provider protocol and replay stay behind server authentication", async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SUPABASE_SECRET_KEY: "test-secret",
    OPENAI_API_KEY: "test-openai",
    CARTESIA_API_KEY: "test-cartesia",
  });
  t.after(() => {
    process.env = originalEnv;
  });
  let calls: { url: string; body: any }[] = [],
    claimed = true,
    quota = false,
    malformed = false,
    providerFails = false, expired = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input),
        body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      if (url.includes("/auth/v1/user"))
        return Response.json({
          id: actor,
          aud: "authenticated",
          role: "authenticated",
        });
      if (url.includes("/rest/v1/pilot_moments"))
        return Response.json([
          {
            id: parent,
            parent_id: null,
            room_id: "room",
            title: "The whale",
            panels: [
              {
                caption: "A whale listens.",
                imageUrl: "/art/midnight-story.webp#frame=0",
              },
              {
                caption: "A voice answers.",
                imageUrl: "/art/midnight-story.webp#frame=1",
              },
            ],
          },
        ]);
      if (url.includes("/rpc/pilot_claim_assist"))
        return quota
          ? Response.json(
              { code: "P0001", message: "Allowance exhausted" },
              { status: 400 },
            )
          : Response.json({
              claimed,
              request: { id: requestId, state: "complete", result: shaped },
            });
      if (url.includes("/rest/v1/pilot_assist_requests")) {
        assert(url.includes("state=eq.pending"), "a late helper may only complete a pending claim");
        return Response.json(expired ? null : { id: requestId });
      }
      if (url === "https://api.cartesia.ai/access-token")
        return Response.json({ token: "ephemeral-test-token" });
      if (url === "https://api.openai.com/v1/chat/completions")
        return providerFails
          ? Response.json({ error: "fixture failure" }, { status: 500 })
          : Response.json(
              {
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: JSON.stringify(
                        malformed ? { first: "" } : shaped,
                      ),
                    },
                  },
                ],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
              },
              { headers: { "x-request-id": "fixture-request" } },
            );
      throw new Error("Unexpected network destination in test: " + url);
    },
  );
  const request = (
    body: unknown = {
      requestId,
      roomId: "room",
      parentId: parent,
      thought: "The whale remembers.",
    },
    auth = true,
  ) =>
    new Request("https://app.invalid/api/pilot/assist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: "Bearer test-user" } : {}),
      },
      body: JSON.stringify(body),
    });
  async function run(kind: "shape" | "voice", input = request()) {
    try {
      return await handleAssist(input, kind);
    } catch (error) {
      return assistFailure(error);
    }
  }
  await t.test(
    "unauthenticated and oversized bodies never reach a provider",
    async () => {
      assert.equal((await run("shape", request({}, false))).status, 401);
      assert.equal(
        (await run("shape", request({ large: "x".repeat(17000) }))).status,
        413,
      );
      assert.equal(
        calls.filter(
          (c) => c.url.includes("api.openai") || c.url.includes("api.cartesia"),
        ).length,
        0,
      );
    },
  );
  await t.test("quota denial happens before either provider call", async () => {
    calls = [];
    quota = true;
    assert.equal((await run("voice")).status, 409);
    assert.equal(calls.filter((c) => c.url.includes("api.cartesia")).length, 0);
    quota = false;
  });
  await t.test(
    "voice issues only a short-lived STT grant and never stores its token",
    async () => {
      calls = [];
      const response = await run("voice");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(
        calls.find((c) => c.url.includes("access-token"))?.body,
        { grants: { stt: true }, expires_in: 60 },
      );
      assert(
        !JSON.stringify(
          calls.filter((c) => c.url.includes("pilot_assist_requests")),
        ).includes("ephemeral-test-token"),
      );
    },
  );
  await t.test(
    "a completed shape replay returns saved beats without buying another call",
    async () => {
      calls = [];
      claimed = false;
      assert.deepEqual(await (await run("shape")).json(), { draft: shaped });
      assert.equal(calls.filter((c) => c.url.includes("api.openai")).length, 0);
      claimed = true;
    },
  );
  await t.test(
    "structured shaping saves valid output and uses only bounded source ancestry",
    async () => {
      calls = [];
      const response = await run("shape");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { draft: shaped });
      const payload = calls.find((c) => c.url.includes("api.openai"))?.body;
      assert.equal(payload.response_format.json_schema.strict, true);
      assert.equal(payload.max_completion_tokens, 1200);
      assert(payload.messages[1].content.includes("A whale listens."));
      assert(
        calls.some(
          (c) =>
            c.body?.state === "complete" &&
            c.body?.provider_request_id === "fixture-request",
        ),
      );
    },
  );
  await t.test(
    "invalid output and provider failures keep the request consumed, with no automatic retry",
    async () => {
      for (const invalid of [true, false]) {
        calls = [];
        malformed = invalid;
        providerFails = !invalid;
        assert.equal((await run("shape")).status, 503);
        assert.equal(
          calls.filter((c) => c.url.includes("api.openai")).length,
          1,
        );
        assert(calls.some((c) => c.body?.state === "failed"));
      }
    },
  );
  await t.test("a response arriving after claim expiry cannot replace the saved draft", async () => {
    claimed = true; quota = false; malformed = false; providerFails = false; expired = true;
    const result = await handleAssist(request(), "shape");
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /words and existing preview are still here/);
  });

});
