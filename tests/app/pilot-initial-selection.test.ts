import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { KESSLER_OPENING_ID, KESSLER_ROOM_ID } from '../../src/lib/kessler-room.ts';
import { sharedReadingTip } from '../../src/lib/room-overview.ts';

// React may evaluate functional state updates after the async room sync returns.
// Exercise the actual selection block with that scheduling, without network calls.
const source = readFileSync(new URL('../../src/components/shared-pilot.tsx', import.meta.url), 'utf8');
const start = source.indexOf('        const target =\n');
const end = source.indexOf('        setOperation((current)', start);
assert(start >= 0 && end > start);
const select = new Function('input', 'KESSLER_ROOM_ID', 'KESSLER_OPENING_ID', 'sharedReadingTip', `
  let first = input.first ?? true;
  let selected = input.selected ?? '', tip = input.tip ?? '';
  const roomId = input.roomId ?? 'paper-moon';
  const story = { data: (input.moments ?? ['a', 'b', 'c']).map(id => ({ id })) };
  const sharedTarget = { current: input.target ? { room: roomId, moment: input.target } : null };
  const pending = [], errors = [];
  const own = { data: [] };
  const setView = () => {};
  const setSelectedId = update => pending.push(() => { selected = update(selected); });
  const setTipId = update => pending.push(() => { tip = update(tip); });
  const setError = error => errors.push(error);
  ${source.slice(start, end)}
  pending.forEach(update => update());
  return { selected, tip, errors, first };
`);
const apply = (input: { first?: boolean; selected?: string; tip?: string; target?: string; roomId?: string; moments?: string[] }) =>
  select(input, KESSLER_ROOM_ID, KESSLER_OPENING_ID, sharedReadingTip);

test('a fresh room selects its published story even when React defers the state callbacks', () => {
  assert.deepEqual(apply({}), { selected: 'c', tip: 'c', errors: [], first: false });
});

test('an exact shared moment wins over an older selection during deferred initial loading', () => {
  const result = apply({ target: 'b', selected: 'a', tip: 'c' });
  assert.equal(result.selected, 'b'); assert.equal(result.tip, 'b');
});

test('a returning reader retains valid selection and path while an unavailable link gets a usable fallback', () => {
  assert.equal(apply({ selected: 'a', tip: 'b' }).selected, 'a');
  assert.equal(apply({ selected: 'a', tip: 'b' }).tip, 'b');
  const missing = apply({ target: 'missing' });
  assert.equal(missing.selected, 'c'); assert.equal(missing.tip, 'c'); assert.equal(missing.errors.length, 1);
});

test('later polling preserves the selected story rather than jumping to the newest publication', () => {
  const result = apply({ first: false, selected: 'a', tip: 'b' });
  assert.equal(result.selected, 'a'); assert.equal(result.tip, 'b');
});

test('a fresh Kessler reader starts at its opening rather than the latest prepared ending', () => {
  const result = apply({ roomId: KESSLER_ROOM_ID, moments: [KESSLER_OPENING_ID, 'branch', 'ending'] });
  assert.deepEqual(result, { selected: KESSLER_OPENING_ID, tip: KESSLER_OPENING_ID, errors: [], first: false });
});

test('an explicit Kessler ending link retains its target on first load', () => {
  const result = apply({ roomId: KESSLER_ROOM_ID, moments: [KESSLER_OPENING_ID, 'branch', 'ending'], target: 'ending', selected: KESSLER_OPENING_ID });
  assert.equal(result.selected, 'ending'); assert.equal(result.tip, 'ending');
});

test('a returning Kessler reader retains a saved scene and path', () => {
  const result = apply({ roomId: KESSLER_ROOM_ID, moments: [KESSLER_OPENING_ID, 'branch', 'ending'], selected: 'branch', tip: 'ending' });
  assert.equal(result.selected, 'branch'); assert.equal(result.tip, 'ending');
});
