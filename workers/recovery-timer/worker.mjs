const TRIGGER_URL = "https://api.trigger.dev/api/v1/tasks/fork-night-reconcile/trigger";
const MINUTE = 60_000;

/** @param {Response} response */
async function acceptedRun(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid-acknowledgement");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) throw new Error("invalid-acknowledgement");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (typeof body.id !== "string" || !/^run_[a-zA-Z0-9]{1,100}$/.test(body.id))
      throw new Error("invalid-acknowledgement");
    return /** @type {string} */ (body.id);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * A clock notification only. The durable dispatch table owns recoverable work.
 * @param {Pick<ScheduledController, "scheduledTime" | "cron">} controller
 * @param {Env} env
 * @param {{fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>}} dependencies
 */
export async function enqueueRecovery(controller, env, dependencies = {}) {
  if (env.PILOT_TIMER_ENABLED !== "1") return { state: "disabled" };
  if (env.PILOT_EXECUTION_ENV !== "PRODUCTION") throw new Error("wrong-environment");
  if (controller.cron !== "* * * * *" || !Number.isSafeInteger(controller.scheduledTime) || controller.scheduledTime <= 0)
    throw new Error("invalid-tick");
  const now = (dependencies.now ?? Date.now)();
  if (controller.scheduledTime < now - 5 * MINUTE || controller.scheduledTime > now + MINUTE)
    return { state: "skipped", reason: "stale-tick" };
  if (typeof env.TRIGGER_SECRET_KEY !== "string" || !/^tr_prod_sk_[a-zA-Z0-9_-]{1,500}$/.test(env.TRIGGER_SECRET_KEY))
    throw new Error("missing-production-key");

  const scheduledAt = new Date(Math.floor(controller.scheduledTime / MINUTE) * MINUTE).toISOString();
  const key = `fork-night-reconcile:PRODUCTION:cloudflare:${scheduledAt}`;
  // Match the SDK's global SHA-256 key without importing its Node task runtime.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const idempotencyKey = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  const body = JSON.stringify({
    payload: { source: "cloudflare-cron", environment: "PRODUCTION", scheduledAt },
    options: {
      idempotencyKey, idempotencyKeyOptions: { key, scope: "global" }, idempotencyKeyTTL: "1h",
      ttl: "5m", maxAttempts: 1, tags: ["cloudflare-recovery-timer"],
    },
  });
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try {
      response = await fetchImpl(TRIGGER_URL, {
        // workerd supports manual/follow only; the status check below refuses redirects.
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.TRIGGER_SECRET_KEY}`, "Content-Type": "application/json" }, body,
      });
    } catch {
      if (attempt === 2) throw new Error("enqueue-unavailable");
      await sleep(1000);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // Authentication, rate limiting and other refusals wait for the next tick.
      if (response.status >= 500 && attempt === 1) { await sleep(1000); continue; }
      throw new Error(`enqueue-http-${response.status}`);
    }
    try {
      return { state: "accepted", scheduledAt, runId: await acceptedRun(response), attempts: attempt };
    } catch {
      // Acceptance may have happened. Reuse the exact identity and body.
      if (attempt === 2) throw new Error("invalid-acknowledgement");
      await sleep(1000);
    }
  }
  throw new Error("enqueue-unavailable");
}

/** @satisfies {ExportedHandler<Env>} */
const worker = {
  async fetch() { return new Response("Not found", { status: 404 }); },
  async scheduled(controller, env) {
    try {
      const result = await enqueueRecovery(controller, env);
      console.log(JSON.stringify({ event: "recovery-timer", ...result }));
    } catch (error) {
      // Only our fixed error codes may enter logs; upstream bodies/keys never do.
      const code = error instanceof Error && /^(wrong-environment|invalid-tick|missing-production-key|enqueue-unavailable|invalid-acknowledgement|enqueue-http-[0-9]{3})$/.test(error.message)
        ? error.message : "enqueue-unavailable";
      console.error(JSON.stringify({ event: "recovery-timer", state: "failed", code }));
      throw new Error(code);
    }
  },
};

export default worker;
