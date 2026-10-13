import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { pilotAdmin } from "../../src/generation/client.ts";
import { handleFunding, type FundingDeps } from "../../src/x402/funding.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET, intentId, recordPaths } from "../../src/x402/ids.ts";
import { RefillRefusedError, supabaseFundingLedger } from "../../src/x402/ledger.ts";
import { StoredConflictError, supabaseReceiptStore, type ReceiptStore } from "../../src/x402/store.ts";
import {
  OTHER_REF, REF, STEWARD,
  fakePayments, fundingConfig, fundingRequest, memoryLedger, memoryStore, type TestPayment,
} from "./x402-fakes.ts";

type Row = Record<string, unknown>;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const NOW = new Date("2026-10-12T12:00:00.000Z");

/**
 * The real supabase-js client against an offline Supabase: PostgREST selects over `tables`, the
 * pilot_refill_room RPC, and the pilot-receipts bucket held in `objects`. Any other request throws.
 */
function supabase(t: TestContext, tables: Record<string, Row[]> = {}) {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  t.after(() => {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = saved.key;
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://pilot.test.invalid";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const objects = new Map<string, Buffer>();
  const uploads: { path: string; upsert: string | null }[] = [];
  const listed: Row[] = [];
  const rpcs: Row[] = [];
  const faults = {
    failUpload: false,
    readBack: null as ((bytes: Buffer) => Buffer) | null,
    failSelect: null as string | null,
    refill: (): Response => json({ added: 5, replayed: false, credits: { limit: 5 } }),
  };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (method === "GET" && table) {
      if (table === faults.failSelect) return json({ code: "XX000", message: "unavailable" }, 500);
      let rows = tables[table] ?? [];
      for (const [key, value] of url.searchParams)
        if (value.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === value.slice(3));
      return json(rows);
    }
    if (method === "POST" && url.pathname === "/rest/v1/rpc/pilot_refill_room") {
      rpcs.push(JSON.parse(String(init?.body)));
      return faults.refill();
    }
    if (method === "POST" && url.pathname === "/storage/v1/object/list/pilot-receipts") {
      const { prefix, limit, offset } = JSON.parse(String(init?.body));
      listed.push({ prefix, limit, offset });
      const base = String(prefix).replace(/\/?$/, "/");
      const entries = new Map<string, Row>();
      for (const key of objects.keys()) {
        if (!key.startsWith(base)) continue;
        const [name, ...nested] = key.slice(base.length).split("/");
        // Storage lists a deeper object as a folder placeholder without an id.
        entries.set(name, nested.length ? { name, id: null } : { name, id: `id-${name}` });
      }
      return json([...entries.keys()].sort().slice(offset, offset + limit).map((name) => entries.get(name)));
    }
    const object = url.pathname.match(/^\/storage\/v1\/object\/pilot-receipts\/(.+)$/)?.[1];
    if (object && method === "POST") {
      const path = decodeURIComponent(object), upsert = new Headers(init?.headers).get("x-upsert");
      uploads.push({ path, upsert });
      if (faults.failUpload) return json({ statusCode: "500", error: "internal", message: "Upload failed" }, 500);
      if (objects.has(path) && upsert !== "true")
        return json({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, 409);
      objects.set(path, Buffer.from(init?.body as Uint8Array));
      return json({ Id: "object-id", Key: `pilot-receipts/${path}` });
    }
    if (object && method === "GET") {
      const bytes = objects.get(decodeURIComponent(object));
      if (!bytes) return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 404);
      return new Response(new Uint8Array(faults.readBack ? faults.readBack(bytes) : bytes));
    }
    throw new Error(`An offline test refused ${method} ${url.pathname}`);
  });
  const client = pilotAdmin();
  return { store: supabaseReceiptStore(client), ledger: supabaseFundingLedger(client), objects, uploads, listed, rpcs, faults };
}

const PATH = `x402/intents/${"0".repeat(64)}.json`;
const A = Buffer.from('{"roomId":"lighthouse"}\n'), B = Buffer.from('{"roomId":"paper-moon"}\n');
const plainError = (message: RegExp) => (error: Error) => !(error instanceof StoredConflictError) && message.test(error.message);

test("the Supabase store writes without upsert, and different bytes never replace a record", async (t) => {
  const s = supabase(t);
  assert.equal(await s.store.create(PATH, A), "created");
  assert.deepEqual(s.uploads, [{ path: PATH, upsert: "false" }]);
  assert((await s.store.read(PATH))?.equals(A));
  assert.equal(await s.store.read(`x402/receipts/${"0".repeat(64)}.json`), null);
  // The same bytes again (a lost acknowledgement) are the existing record; different bytes are a conflict.
  assert.equal(await s.store.create(PATH, A), "existing");
  await assert.rejects(s.store.create(PATH, B), StoredConflictError);
  assert(s.objects.get(PATH)?.equals(A));
  assert.deepEqual(s.uploads.map((upload) => upload.upsert), ["false", "false", "false"]);
});

test("a Supabase write that cannot be confirmed is an ordinary error, never a conflict", async (t) => {
  const s = supabase(t);
  s.faults.readBack = (bytes) => Buffer.concat([bytes, Buffer.from(" ")]);
  await assert.rejects(s.store.create(PATH, A), plainError(/verification failed/));
  s.faults.readBack = null;
  s.faults.failUpload = true;
  const other = `x402/rooms/lighthouse/${"1".repeat(64)}.json`;
  await assert.rejects(s.store.create(other, A), plainError(/Could not save/));
  assert.equal(s.objects.has(other), false);
});

test("the Supabase store lists only the records directly under a prefix, across pages of 1000", async (t) => {
  const s = supabase(t);
  const names = Array.from({ length: 1001 }, (_, index) => `${index.toString(16).padStart(64, "0")}.json`);
  for (const name of names) s.objects.set(`x402/rooms/lighthouse/${name}`, A);
  s.objects.set("x402/rooms/lighthouse/.emptyFolderPlaceholder", Buffer.alloc(0));
  s.objects.set("x402/rooms/lighthouse/notes.txt", A);
  s.objects.set("x402/rooms/lighthouse/archive.json/old.json", A);
  assert.deepEqual(await s.store.list("x402/rooms/lighthouse"), names);
  assert.deepEqual(s.listed.map(({ prefix, limit, offset }) => [prefix, limit, offset]), [
    ["x402/rooms/lighthouse", 1000, 0], ["x402/rooms/lighthouse", 1000, 1000],
  ]);
});

const ELIGIBLE = {
  pilot_rooms: [{ id: "lighthouse", is_open: true }],
  pilot_room_capacity: [{ room_id: "lighthouse", delivery_limit: 0 }],
  pilot_profiles: [{ id: STEWARD }],
};
const evm = (nonce = `0x${"7".repeat(64)}`) =>
  ({ network: BASE_SEPOLIA, nonce, payer: "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83" }) as const;

for (const [name, tables, state, status] of [
  ["a room without a capacity row", { ...ELIGIBLE, pilot_room_capacity: [] }, { open: true, deliveryLimit: null, stewardExists: true }, 409],
  ["a steward without a profile", { ...ELIGIBLE, pilot_profiles: [] }, { open: true, deliveryLimit: 0, stewardExists: false }, 409],
  ["a room past the local credit limit", { ...ELIGIBLE, pilot_room_capacity: [{ room_id: "lighthouse", delivery_limit: 996 }] },
    { open: true, deliveryLimit: 996, stewardExists: true }, 409],
  ["an eligible room", ELIGIBLE, { open: true, deliveryLimit: 0, stewardExists: true }, 402],
] as const) {
  test(`the Supabase ledger reads ${name}, and the route ${status === 409 ? "refuses it before settlement" : "credits it"}`, async (t) => {
    const s = supabase(t, structuredClone(tables) as Record<string, Row[]>);
    assert.deepEqual(await s.ledger.state("lighthouse", STEWARD), state);
    const storage = memoryStore(), payments = fakePayments();
    const deps: FundingDeps = { config: fundingConfig(), payments: payments.port, store: storage.store, ledger: s.ledger, now: () => NOW };
    const unpaid = await handleFunding(fundingRequest(), REF, deps);
    assert.equal(unpaid.status, status);
    const paid = await handleFunding(fundingRequest(REF, evm()), REF, deps);
    if (status === 409) {
      assert.equal(unpaid.headers.get("PAYMENT-REQUIRED"), null);
      assert.equal(paid.status, 409);
      assert.deepEqual(payments.calls, ["present", "verify"]);
      assert.deepEqual([storage.objects.size, s.rpcs.length], [0, 0]);
      return;
    }
    // The real refill RPC, parsed: five credits under the request ID the receipt records.
    assert.equal(paid.status, 200);
    assert.deepEqual((await paid.json()).credits, { limit: 5 });
    const id = intentId({ network: BASE_SEPOLIA, payer: evm().payer.toLowerCase(), nonce: evm().nonce });
    const receipt = storage.json(recordPaths(id, "lighthouse").receipt);
    assert.deepEqual(receipt.refill, { added: 5, replayed: false, credits: { limit: 5 } });
    assert.deepEqual(s.rpcs, [{ p_request_id: receipt.refillRequestId, p_room_id: "lighthouse", p_actor: STEWARD }]);
  });
}

test("a Supabase read failure makes the route unavailable, with nothing settled", async (t) => {
  const s = supabase(t, structuredClone(ELIGIBLE));
  s.faults.failSelect = "pilot_room_capacity";
  await assert.rejects(s.ledger.state("lighthouse", STEWARD), /Could not read the room's funding state/);
  const storage = memoryStore(), payments = fakePayments();
  const deps: FundingDeps = { config: fundingConfig(), payments: payments.port, store: storage.store, ledger: s.ledger, now: () => NOW };
  assert.equal((await handleFunding(fundingRequest(), REF, deps)).status, 503);
  assert.equal((await handleFunding(fundingRequest(REF, evm()), REF, deps)).status, 503);
  assert(!payments.calls.includes("settle"));
});

test("refill() turns pilot_refill_room's authored refusals, other errors and malformed results apart", async (t) => {
  const s = supabase(t);
  const refill = () => s.ledger.refill("3e1087c8-e078-5ecc-9147-9bf004b4dda6", "lighthouse", STEWARD);
  s.faults.refill = () => json({ code: "P0001", details: null, hint: null, message: "Room is unavailable" }, 400);
  await assert.rejects(refill(), (error: Error) => error instanceof RefillRefusedError && error.message === "Room is unavailable");
  s.faults.refill = () => json({ code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" }, 500);
  await assert.rejects(refill(), (error: Error) =>
    !(error instanceof RefillRefusedError) && error.message === "The refill could not be confirmed.");
  for (const body of [{ added: 0, replayed: false }, { added: "5", replayed: false }, { added: 5 }, {}, null]) {
    s.faults.refill = () => json(body);
    await assert.rejects(refill(), (error: Error) =>
      !(error instanceof RefillRefusedError) && error.message === "The refill returned an unexpected result.", JSON.stringify(body));
  }
  s.faults.refill = () => json({ added: 5, replayed: true, credits: { limit: 10, available: 5 } });
  assert.deepEqual(await refill(), { added: 5, replayed: true, credits: { limit: 10, available: 5 } });
  s.faults.refill = () => json({ added: 5, replayed: false });
  assert.deepEqual(await refill(), { added: 5, replayed: false, credits: null });
  assert.deepEqual(s.rpcs.at(-1), { p_request_id: "3e1087c8-e078-5ecc-9147-9bf004b4dda6", p_room_id: "lighthouse", p_actor: STEWARD });
});

/** Holds each intent create until two requests have reached one, so both have already found no intent. */
function racing(store: ReceiptStore) {
  let arrived = 0, release!: () => void;
  const both = new Promise<void>((resolve) => { release = resolve; });
  const wrapped: ReceiptStore = {
    ...store,
    async create(path, bytes) {
      if (path.startsWith("x402/intents/")) {
        if (++arrived === 2) release();
        await both;
      }
      return store.create(path, bytes);
    },
  };
  return { store: wrapped, arrived: () => arrived };
}

const memo = "c".repeat(32);
for (const [name, first, second] of [
  ["one EVM authorization", evm(`0x${"2".repeat(64)}`), evm(`0x${"2".repeat(64)}`)],
  ["two Solana payments signed for one memo", { network: SOLANA_DEVNET, memo, payer: "p" }, { network: SOLANA_DEVNET, memo, payer: "p", tag: "re-signed" }],
] as [string, TestPayment, TestPayment][]) {
  for (const backing of ["memory", "Supabase"] as const) {
    test(`${name} raced at two rooms (${backing} store) settles once and credits five`, { timeout: 10_000 }, async (t) => {
      const race = racing(backing === "memory" ? memoryStore().store : supabase(t).store);
      const ledger = memoryLedger(), payments = fakePayments();
      const deps: FundingDeps = { config: fundingConfig(), payments: payments.port, store: race.store, ledger: ledger.ledger, now: () => NOW };
      const responses = await Promise.all([
        handleFunding(fundingRequest(REF, first), REF, deps),
        handleFunding(fundingRequest(OTHER_REF, second), OTHER_REF, deps),
      ]);
      assert.equal(race.arrived(), 2, "both requests found no intent before either created one");
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const refused = responses.findIndex((response) => response.status === 409);
      assert.match((await responses[refused].json()).error, /another room/);
      assert.equal(payments.calls.filter((call) => call === "settle").length, 1);
      assert.equal(ledger.refills.size, 1);
      const added = (ledger.rooms.lighthouse.deliveryLimit ?? 0) + (ledger.rooms["paper-moon"].deliveryLimit ?? 0) - 4;
      assert.equal(added, 5);
      // The refused room holds no ceiling slot for a payment it never received.
      assert.deepEqual(await race.store.list(`x402/rooms/${refused === 0 ? "lighthouse" : "paper-moon"}`), []);
    });
  }
}
