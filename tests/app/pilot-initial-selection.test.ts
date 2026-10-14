import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// React may evaluate functional state updates after the async room sync returns.
// Exercise the actual selection block with that scheduling, without network calls.
const source = readFileSync(new URL('../../src/components/shared-pilot.tsx', import.meta.url), 'utf8');
const start = source.indexOf('        const target =\n');
const end = source.indexOf('        setOperation((current)', start);
assert(start >= 0 && end > start);
const apply = new Function('input', `
  let first = input.first ?? true;
  let selected = input.selected ?? '', tip = input.tip ?? '';
  const roomId = 'paper-moon';
  const story = { data: ['a', 'b', 'c'].map(id => ({ id })) };
  const sharedTarget = { current: input.target ? { room: roomId, moment: input.target } : null };
  const pending = [], errors = [];
  const setSelectedId = update => pending.push(() => { selected = update(selected); });
  const setTipId = update => pending.push(() => { tip = update(tip); });
  const setError = error => errors.push(error);
  ${source.slice(start, end)}
  pending.forEach(update => update());
  return { selected, tip, errors, first };
`);

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
