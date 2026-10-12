import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { joinPilotAsGuest } from "../src/lib/supabase/guest.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";

// Explicit integration command only. Creates two temporary Auth guests and a
// labeled fixture room, then removes those exact records. Never calls a model.
const url = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const expectedProject = process.env.FORK_NIGHT_TEST_PROJECT_REF;
if (!url || !publicKey || !secretKey || !expectedProject ||
    !/^[a-z]{20}$/.test(expectedProject) || new URL(url).origin !== `https://${expectedProject}.supabase.co`)
  throw new Error("Set the four integration-test variables and explicitly select the hosted test project.");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient<Database>(url, secretKey, options);
const publicReader = createClient<Database>(url, publicKey, options);
const alice = createClient<Database>(url, publicKey, options);
const bob = createClient<Database>(url, publicKey, options);
const restored = createClient<Database>(url, publicKey, options);
const roomId = `verification-${randomUUID()}`;
const seedId = randomUUID();
const makers = new Set<string>();
let failure: unknown;
const panels = [
  { imageUrl: "/art/midnight-story.webp#frame=0", caption: "Verification fixture: first panel." },
  { imageUrl: "/art/midnight-story.webp#frame=1", caption: "Verification fixture: second panel." },
];

function checked<T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (error) throw new Error(error.message);
  assert(data !== null && data !== undefined);
  return data;
}

try {
  const roomInsert = await admin.from("pilot_rooms").insert({ id: roomId, title: "Temporary verification room", description: "Synthetic integration test, removed after completion.", is_open: true });
  assert.equal(roomInsert.error, null);
  assert.equal((await admin.from("pilot_moments").insert({ id: seedId, room_id: roomId, maker_label: "Verification fixture", title: "Fixture starter", source_kind: "fixture", panels })).error, null);

  for (const client of [alice, bob]) {
    const data = checked(await client.auth.signInAnonymously());
    assert(data.user?.is_anonymous);
    makers.add(data.user.id);
  }
  const [a, duplicateJoin, b] = await Promise.all([
    joinPilotAsGuest(alice, "Verification Alice"),
    joinPilotAsGuest(alice, "Verification Alice"),
    joinPilotAsGuest(bob, "Verification Bob"),
  ]);
  assert.equal(a.id, duplicateJoin.id);
  assert.notEqual(a.id, b.id);
  assert.equal((await joinPilotAsGuest(alice, "Verification Alice")).id, a.id);
  assert.equal(checked(await publicReader.from("pilot_moments").select("id").eq("room_id", roomId)).length, 1);

  const input = { p_request_id: randomUUID(), p_room_id: roomId, p_parent_id: seedId, p_title: "Verification continuation", p_prompt: "An original fixture continuation used only to verify persistence." };
  const draft = checked(await alice.rpc("pilot_save_draft", input));
  assert.equal(checked(await alice.rpc("pilot_save_draft", input)).id, draft.id);
  assert((await alice.rpc("pilot_save_draft", { ...input, p_prompt: "Different input under the same request ID." })).error);
  assert.deepEqual(checked(await bob.from("pilot_operations").select("id").eq("id", draft.id)), []);
  assert((await alice.from("pilot_operations").update({ status: "delivered", panels, source_kind: "fixture" }).eq("id", draft.id)).error);
  assert((await alice.rpc("pilot_publish", { p_operation_id: draft.id })).error);
  assert((await bob.rpc("pilot_publish", { p_operation_id: draft.id })).error);
  assert((await publicReader.rpc("pilot_set_display_name", { p_name: "Forged guest" })).error);

  // Service-side fixture delivery verifies publication only, never AI delivery.
  assert.equal((await admin.from("pilot_operations").update({ status: "delivered", panels, source_kind: "fixture" }).eq("id", draft.id)).error, null);
  const publicationResults = await Promise.all([
    alice.rpc("pilot_publish", { p_operation_id: draft.id }),
    alice.rpc("pilot_publish", { p_operation_id: draft.id }),
  ]);
  const first = checked(publicationResults[0]!);
  assert.equal(checked(publicationResults[1]!).id, first.id);
  assert.equal(first.maker_id, a.id);
  assert.equal(first.maker_label, "Verification Alice");
  await joinPilotAsGuest(alice, "Verification Alice renamed");
  const peerView = checked(await bob.from("pilot_moments").select("id,maker_label").eq("id", first.id).single());
  assert.equal(peerView.maker_label, "Verification Alice");
  assert.equal(checked(await bob.rpc("pilot_save_draft", { ...input, p_request_id: randomUUID(), p_parent_id: first.id })).parent_id, first.id);

  const savedSession = await alice.auth.getSession();
  assert.equal(savedSession.error, null);
  const session = savedSession.data.session;
  assert(session);
  checked(await restored.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }));
  const verifiedUser = await restored.auth.getUser();
  assert.equal(verifiedUser.error, null);
  assert.equal(verifiedUser.data.user?.id, a.id);
  const recovered = checked(await restored.from("pilot_operations").select("id,status,published_moment_id").eq("id", draft.id).single());
  assert.equal(recovered.status, "published");
  assert.equal(recovered.published_moment_id, first.id);

  const tokenParts = session.access_token.split(".");
  const forgedClaims = JSON.parse(Buffer.from(tokenParts[1]!, "base64url").toString());
  forgedClaims.sub = b.id;
  tokenParts[1] = Buffer.from(JSON.stringify(forgedClaims)).toString("base64url");
  const forged = await fetch(`${url}/rest/v1/pilot_profiles?select=id`, { headers: { apikey: publicKey, Authorization: `Bearer ${tokenParts.join(".")}` } });
  assert([401, 403].includes(forged.status), "Forged JWT must be denied by the hosted service");
  console.log("Hosted pilot proof passed: distinct real Auth guests, session recovery, private drafts, forged-identity denial, once-only concurrent publication, stable credit and peer continuation. Delivery used labeled fixtures; no AI call or email was sent.");
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors: string[] = [];
  // Include a guest whose Auth request succeeded before profile setup failed.
  for (const client of [alice, bob]) {
    const session = await client.auth.getSession();
    if (session.data.session) makers.add(session.data.session.user.id);
  }
  for (const table of ["pilot_operations", "pilot_moments"] as const) {
    const result = await admin.from(table).delete().eq("room_id", roomId);
    if (result.error) cleanupErrors.push(`${table} in ${roomId}: ${result.error.message}`);
  }
  const roomDeletion = await admin.from("pilot_rooms").delete().eq("id", roomId);
  if (roomDeletion.error) cleanupErrors.push(`Room ${roomId}: ${roomDeletion.error.message}`);
  for (const maker of makers) {
    const profileDeletion = await admin.from("pilot_profiles").delete().eq("id", maker);
    if (profileDeletion.error) cleanupErrors.push(`Profile ${maker}: ${profileDeletion.error.message}`);
    const deletion = await admin.auth.admin.deleteUser(maker);
    if (deletion.error) cleanupErrors.push(`Auth user ${maker}: ${deletion.error.message}`);
  }
  if (cleanupErrors.length) {
    console.error("Verification cleanup needs attention:", cleanupErrors.join("; "));
    failure ??= new Error("Verification cleanup was incomplete.");
  } else {
    console.log("Removed the temporary verification room, operations, moments, profiles and Auth users.");
  }
}
if (failure) throw failure;
