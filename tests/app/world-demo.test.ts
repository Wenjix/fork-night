import assert from "node:assert/strict";
import test from "node:test";
import { recognition, parsePending, parseState, invitationLink, type WorldState, type Work, type Release } from "../../src/lib/world-demo/model.ts";
import { acknowledgeContributionDraft, addDraftPanel, canonicalDraft, contributionDraftKey, moveDraftPanel, preserveSelectionDraft, readContributionDraft, readSelectionDraft, rememberContributionDraft, rememberSelectionDraft, sameDraft, selectionDraftKey, type EditableDraft } from "../../src/lib/world-demo/drafts.ts";
import { completeMakerEntry, enterAsMaker, MAKER_ENTRY_KEY, makerJourney } from "../../src/lib/world-demo/journey.ts";
import { enterPresenterRole, roleDestination } from "../../src/lib/world-demo/roles.ts";

const id = (n: number) => `b6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const work: Work = { id: id(2), parent_id: null, maker_id: id(3), maker_label: "Mira", role: "maker", title: "Names We Keep", panels: [{ asset: "source-ledger", caption: "A paper memory." }], source_kind: "prepared-art-edited-caption", created_at: "2026-10-04T00:00:00Z" };
const base: WorldState = { id: id(1), revision: 2, termsVersion: "concept-2026-10-04", me: { id: id(3), role: "maker", label: "Mira" }, members: [], works: [work], draft: null, selections: [], releases: [], invitations: [] };

test("inline role entry joins with the target seat and reopens a claimed seat through its own read", async () => {
  const host: WorldState = { ...base, me: { id: id(9), role: "curator", label: "Demo curator" }, invitations: [{ role: "continuing", claimed: false, token: "a".repeat(64) }] };
  const kai: WorldState = { ...base, me: { id: id(10), role: "continuing", label: "Kai" } };
  const calls: string[] = [];
  const ports = { read: async (seat: string, run: string) => { calls.push(`read:${seat}:${run}`); return kai; }, join: async (seat: string, run: string, token: string) => { calls.push(`join:${seat}:${run}`); assert.equal(token, "a".repeat(64)); return kai; } };
  assert.equal((await enterPresenterRole(host, "continuing", ports)).me.id, kai.me.id);
  assert.equal((await enterPresenterRole({ ...host, invitations: [{ role: "continuing", claimed: true, token: null }] }, "continuing", ports)).me.id, kai.me.id);
  assert.deepEqual(calls, [`join:continuing:${host.id}`, `read:continuing:${host.id}`]);
  assert.equal(await enterPresenterRole(host, "curator", ports), host);
});

test("inline role entry cannot substitute the host for a guest or enter a different room", async () => {
  const host: WorldState = { ...base, me: { id: id(9), role: "curator", label: "Demo curator" }, invitations: [{ role: "continuing", claimed: true, token: null }] };
  await assert.rejects(enterPresenterRole(base, "continuing", { read: async () => host, join: async () => host }), /room host/);
  await assert.rejects(enterPresenterRole(host, "continuing", { read: async () => host, join: async () => host }), /could not be opened here/);
  await assert.rejects(enterPresenterRole(host, "continuing", { read: async () => ({ ...host, id: id(999), me: { id: id(10), role: "continuing", label: "Kai" } }), join: async () => host }), /could not be opened here/);
});

test("recognition separates a peer continuation, selection, withdrawal and actual inclusion", () => {
  const continued = { ...work, id: id(4), parent_id: work.id, maker_label: "Kai", role: "continuing" as const };
  const peer = { ...base, works: [work, continued] };
  assert.equal(recognition(peer, work.id).continuations.length, 1);
  assert.equal(recognition(peer, work.id).release, undefined);
  const selection = { id: id(5), source_id: work.id, curator_id: id(6), reason: "A useful memory", selected_at: "2026-10-04", withdrawn_at: null };
  const selected = { ...peer, selections: [selection] };
  assert.equal(recognition(selected, work.id).selection?.id, id(5));
  assert.equal(recognition(selected, work.id).release, undefined);
  assert.equal(recognition({ ...selected, selections: [{ ...selection, withdrawn_at: "2026-10-05" }] }, work.id).selection, undefined);
  const release: Release = { id: id(7), source_id: work.id, tip_id: continued.id, digest: "test", created_at: "2026-10-04", snapshot: { title: "Chapter 2", termsVersion: base.termsVersion, works: [work, continued], sourceId: work.id, tipId: continued.id, curator: { id: id(6), label: "Demo curator", imaginedRole: "Imagined role" }, selectionReason: selection.reason, publishedAt: "2026-10-04" } };
  assert.equal(recognition({ ...peer, releases: [release] }, work.id).release?.id, id(7));
  assert.equal(recognition({ ...peer, releases: [release] }, id(8)).release, undefined);
});

test("restored pending requests cannot silently move into a different rehearsal", () => {
  const pending = { runId: id(1), requestId: id(10), revision: 3, kind: "publish_work", payload: {} };
  assert.deepEqual(parsePending(JSON.stringify(pending), id(1)), pending);
  assert.throws(() => parsePending(JSON.stringify(pending), id(9)), /could not be restored/);
  assert.throws(() => parsePending(JSON.stringify({ ...pending, requestId: "" }), id(1)), /could not be restored/);
});

test("API projection rejects an arbitrary image source before rendering", () => {
  assert.deepEqual(parseState(base), base);
  assert.throws(() => parseState({ ...base, works: [{ ...work, panels: [{ asset: "https://elsewhere.invalid/track", caption: "Unknown art" }] }] }), /could not be read/);
  const link = invitationLink(id(1), "maker", "a&b");
  const url = new URL(link, "https://example.com");
  assert.equal(url.searchParams.get("invite"), "a&b");
  assert.equal(url.searchParams.get("seat"), "maker");
});

function browserStorage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
const captions: EditableDraft = { title: "Names We Keep", panels: [{ asset: "source-writing", caption: "  A caption whose whitespace belongs to its maker.  " }] };

test("a title with edge whitespace remains publishable after the server acknowledges its canonical copy", () => {
  const typed = { ...captions, title: " \tNames We Keep \n" };
  const submitted = canonicalDraft(typed);
  assert.equal(submitted.title, "Names We Keep");
  assert.equal(submitted.panels[0].caption, captions.panels[0].caption);
  assert(sameDraft(typed, submitted));
  assert.equal(typed.title, " \tNames We Keep \n", "Typing is not normalized in place");
  assert(!sameDraft(typed, { ...submitted, panels: [{ asset: "source-writing", caption: "Different words" }] }));
});

test("unsent legacy captions restore regardless of their browser timestamp", () => {
  const storage = browserStorage(), key = contributionDraftKey(id(1), id(3));
  for (const editedAt of [0, 1, Date.now() + 86400000]) {
    storage.setItem(key, JSON.stringify({ ...captions, editedAt }));
    assert.deepEqual(readContributionDraft(storage, key), captions);
  }
  rememberContributionDraft(storage, key, { ...captions, title: "A later edit" });
  assert.equal(readContributionDraft(storage, key)?.title, "A later edit");
  assert(!storage.getItem(key)!.includes("editedAt"));
});

test("a save receipt clears only its acknowledged draft and preserves newer text from another tab", () => {
  const storage = browserStorage(), key = contributionDraftKey(id(1), id(3));
  rememberContributionDraft(storage, key, captions);
  const newer = { ...captions, panels: [{ asset: "source-ledger" as const, caption: "A later unsent idea." }] };
  rememberContributionDraft(storage, key, newer);
  acknowledgeContributionDraft(storage, key, captions);
  assert.deepEqual(readContributionDraft(storage, key), newer);
  acknowledgeContributionDraft(storage, key, newer);
  assert.equal(readContributionDraft(storage, key), null);
});

test("acknowledging a normalized title clears the saved browser version", () => {
  const storage = browserStorage(), key = contributionDraftKey(id(1), id(3));
  rememberContributionDraft(storage, key, { ...captions, title: " Names We Keep " });
  acknowledgeContributionDraft(storage, key, captions);
  assert.equal(storage.getItem(key), null);
});

test("a selection explanation survives rejection and deletion of its pending request", () => {
  const storage = browserStorage(), key = selectionDraftKey(id(1), id(6));
  const pending = { runId: id(1), requestId: id(10), revision: 3, kind: "select" as const, payload: { sourceId: id(2), reason: "Keep the missing customer unnamed." } };
  storage.setItem("pending", JSON.stringify(pending));
  const restored = parsePending(storage.getItem("pending")!, id(1));
  assert.equal(restored.kind, "select");
  if (restored.kind !== "select") throw new Error("Expected selection request");
  preserveSelectionDraft(storage, key, restored.payload.reason);
  storage.removeItem("pending");
  assert.equal(readSelectionDraft(storage, key), pending.payload.reason);
  rememberSelectionDraft(storage, key, "A newer explanation from another tab.");
  preserveSelectionDraft(storage, key, pending.payload.reason);
  assert.equal(readSelectionDraft(storage, key), "A newer explanation from another tab.");
  rememberSelectionDraft(storage, key, "");
  preserveSelectionDraft(storage, key, pending.payload.reason);
  assert.equal(readSelectionDraft(storage, key), "", "An intentionally cleared field is still an unsent draft");
});

test("restoring browser drafts validates content before presenting it", () => {
  const storage = browserStorage();
  storage.setItem("contribution", JSON.stringify({ ...captions, panels: [{ asset: "https://elsewhere.invalid/track", caption: "Unknown art" }] }));
  assert.throws(() => readContributionDraft(storage, "contribution"), /could not be restored/);
  storage.setItem("selection", JSON.stringify({ reason: { nested: "Not text" } }));
  assert.throws(() => readSelectionDraft(storage, "selection"), /could not restore/);
});

const host = { ...base, me: { id: id(6), role: "curator" as const, label: "Demo curator" }, invitations: [{ role: "maker" as const, token: "a".repeat(64), claimed: false }] };

test("presenter role navigation preserves the room and requires the real host projection", () => {
  const seats = { ...host, invitations: [...host.invitations, { role: "continuing" as const, token: "b".repeat(64), claimed: false }] };
  const invitation = new URL(roleDestination(seats, base.id, "continuing"), "https://example.com");
  assert.equal(invitation.searchParams.get("run"), base.id);
  assert.equal(invitation.searchParams.get("seat"), "continuing");
  assert.equal(invitation.searchParams.get("invite"), "b".repeat(64), "A new guest must claim its invitation explicitly");
  const claimed = { ...seats, invitations: [{ role: "continuing" as const, token: null, claimed: true }] };
  const returning = new URL(roleDestination(claimed, base.id, "continuing"), "https://example.com");
  assert.equal(returning.searchParams.get("seat"), "continuing");
  assert.equal(returning.searchParams.get("view"), "my-work");
  assert(!returning.searchParams.has("invite"), "Claimed guests reopen using their own authenticated client");
  assert.equal(new URL(roleDestination(seats, base.id, "curator"), "https://example.com").searchParams.get("seat"), "curator");
  assert.throws(() => roleDestination(base, base.id, "continuing"), /confirm the room host/);
  assert.throws(() => roleDestination(seats, id(99), "continuing"), /confirm the room host/);
  assert.throws(() => roleDestination(host, base.id, "continuing"), /invitation is not ready/);
});

test("Kai can add and reorder panels, restore his sequence, and acknowledge it without changing Mira’s draft", () => {
  const storage = browserStorage();
  const miraKey = contributionDraftKey(base.id, id(3));
  const kaiKey = contributionDraftKey(base.id, id(4));
  rememberContributionDraft(storage, miraKey, captions);
  const initial: EditableDraft = { title: " A name to call ", panels: [{ asset: "outcome", caption: "The terminal goes dark." }] };
  const twoPanels = addDraftPanel(initial, "continuing");
  assert.equal(initial.panels.length, 1, "Adding must not mutate the original sequence");
  assert.equal(twoPanels.panels[1].asset, "outcome", "Kai keeps the backend’s permitted prepared art");
  assert.equal(twoPanels.panels[1].caption, "", "The extra panel waits for the maker’s words");
  twoPanels.panels[1] = { ...twoPanels.panels[1], caption: "The ledger still remembers her name." };
  const reordered = moveDraftPanel(twoPanels, 1, -1);
  rememberContributionDraft(storage, kaiKey, reordered);
  const restored = readContributionDraft(storage, kaiKey)!;
  assert.deepEqual(restored.panels.map(p => p.caption), ["The ledger still remembers her name.", "The terminal goes dark."]);
  assert(!sameDraft(initial, restored), "A reordered or extended scene requires a new save before publication");
  acknowledgeContributionDraft(storage, kaiKey, canonicalDraft(restored));
  assert.equal(readContributionDraft(storage, kaiKey), null);
  assert.deepEqual(readContributionDraft(storage, miraKey), captions);
  assert.equal(moveDraftPanel(restored, 0, -1), restored);
  assert.equal(moveDraftPanel(restored, 1, 1), restored);
  const full = addDraftPanel(restored, "continuing");
  assert.equal(addDraftPanel(full, "continuing"), full, "No fourth panel can be added");
  assert.equal(addDraftPanel(initial, "curator"), initial, "Curation is not contribution editing");
});

test("maker entry preserves the room id when the create response is lost", async () => {
  const storage = browserStorage();
  let creates = 0, ids = 0;
  const ports = {
    newId: () => { ids++; return id(1); },
    create: async (runId: string) => { assert.equal(runId, id(1)); if (++creates === 1) throw new Error("Lost response"); return host; },
    join: async () => base,
    read: async () => { throw new Error("Unexpected read"); },
  };
  await assert.rejects(enterAsMaker(storage, ports), /Lost response/);
  assert.equal((await enterAsMaker(storage, ports)).me.role, "maker");
  assert.equal(ids, 1);
  assert.equal(storage.getItem("world-demo:last:curator"), id(1));
  completeMakerEntry(storage, id(1));
  assert.equal(storage.getItem(MAKER_ENTRY_KEY), null);
});

test("a claimed maker invitation survives a lost join response without creating another room", async () => {
  const storage = browserStorage();
  let creates = 0, joins = 0;
  const ports = {
    newId: () => id(1),
    create: async () => { creates++; return host; },
    join: async (runId: string, token: string) => {
      assert.equal(runId, id(1)); assert.equal(token, host.invitations[0].token);
      assert.equal(JSON.parse(storage.getItem(MAKER_ENTRY_KEY)!).token, token);
      if (++joins === 1) throw new Error("Lost join response");
      return base;
    },
    read: async () => { throw new Error("Unexpected read"); },
  };
  await assert.rejects(enterAsMaker(storage, ports), /Lost join response/);
  assert.equal((await enterAsMaker(storage, ports)).id, id(1));
  assert.equal(creates, 1);
  assert.equal(joins, 2);
});

test("maker entry sends nothing if the durable retry key cannot be stored", async () => {
  let calls = 0;
  const storage = { ...browserStorage(), setItem: () => { throw new Error("Storage unavailable"); } };
  const call = async () => { calls++; return base; };
  await assert.rejects(enterAsMaker(storage, { newId: () => id(1), create: call, join: call, read: call }), /Storage unavailable/);
  assert.equal(calls, 0);
});

test("an already claimed invitation is read using the maker session and never presented as a curator", async () => {
  const storage = browserStorage();
  const claimed = { ...host, invitations: [{ role: "maker" as const, token: null, claimed: true }] };
  let reads = 0;
  const ports = { newId: () => id(1), create: async () => claimed, join: async () => { throw new Error("Unexpected join"); }, read: async () => { reads++; return base; } };
  assert.equal((await enterAsMaker(storage, ports)).me.role, "maker");
  assert.equal(reads, 1);
  await assert.rejects(enterAsMaker(storage, { ...ports, read: async () => host }), /Mira's seat could not be confirmed/);
  completeMakerEntry(storage, id(9));
  assert(storage.getItem(MAKER_ENTRY_KEY), "Completing another room must not discard this recovery key");
});

test("tampered entry storage cannot send a request to an arbitrary room", async () => {
  const storage = browserStorage();
  storage.setItem(MAKER_ENTRY_KEY, JSON.stringify({ runId: "not-a-room", token: "invalid" }));
  const call = async () => { throw new Error("Must not reach transport"); };
  await assert.rejects(enterAsMaker(storage, { newId: () => id(1), create: call, join: call, read: call }), /could not be restored/);
});

test("journey milestones follow exact published relationships, including selection withdrawal", () => {
  assert.equal(makerJourney({ ...base, works: [] }).step, 0);
  assert.equal(makerJourney(base).step, 1);
  const continuation = { ...work, id: id(4), role: "continuing" as const, parent_id: work.id, maker_label: "Kai" };
  assert.equal(makerJourney({ ...base, works: [work, { ...continuation, parent_id: id(99) }] }).step, 1);
  const continued = { ...base, works: [work, continuation] };
  assert.equal(makerJourney(continued).step, 2);
  const selection = { id: id(5), source_id: work.id, curator_id: id(6), reason: "Carry the ledger forward", selected_at: "2026-10-05", withdrawn_at: null };
  const earlySelection = makerJourney({ ...base, selections: [selection] });
  assert.equal(earlySelection.step, 3);
  assert.equal(earlySelection.completed[2], false, "Selecting a source before Kai acts must not mark continuation complete");
  assert.equal(earlySelection.completed[3], true);
  assert.equal(makerJourney({ ...continued, selections: [selection] }).step, 3);
  assert.equal(makerJourney({ ...continued, selections: [{ ...selection, withdrawn_at: "2026-10-06" }] }).step, 2);
  assert.equal(makerJourney({ ...continued, selections: [{ ...selection, source_id: id(99) }] }).step, 2);
  const release: Release = { id: id(7), source_id: work.id, tip_id: continuation.id, digest: "test", created_at: "2026-10-05", snapshot: { title: "Chapter 2", termsVersion: base.termsVersion, works: [work, continuation], sourceId: work.id, tipId: continuation.id, curator: { id: id(6), label: "Demo curator", imaginedRole: "Imagined role" }, selectionReason: selection.reason, publishedAt: "2026-10-05" } };
  assert.equal(makerJourney({ ...continued, releases: [release] }).step, 4);
  assert.equal(makerJourney({ ...continued, releases: [{ ...release, snapshot: { ...release.snapshot, works: [continuation] } }] }).step, 2);
});
