/**
 * Tests for the fractional-indexing rank-key generator, including a randomized
 * property test that proves the core invariant — keys stay strictly ordered and
 * unique no matter where you insert — over thousands of operations.
 *   node --test --experimental-transform-types test/rank.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyBetween, generateNKeysBetween } from '../src/domain/rank.ts';

test('known anchor keys', () => {
  assert.equal(generateKeyBetween(null, null), 'a0');
  assert.equal(generateKeyBetween('a0', null), 'a1');
  assert.equal(generateKeyBetween(null, 'a0'), 'Zz');
  const mid = generateKeyBetween('a0', 'a1');
  assert.ok('a0' < mid && mid < 'a1', `expected a0 < ${mid} < a1`);
});

test('rejects inverted bounds', () => {
  assert.throws(() => generateKeyBetween('a1', 'a0'));
});

test('generateNKeysBetween returns n sorted, unique keys', () => {
  const keys = generateNKeysBetween(null, null, 20);
  assert.equal(keys.length, 20);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, 20);
});

test('randomized: 3000 inserts at random positions stay strictly ordered & unique', () => {
  const keys: string[] = [];
  let rng = 123456789;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let i = 0; i < 3000; i++) {
    const idx = Math.floor(rand() * (keys.length + 1));
    const a = idx > 0 ? keys[idx - 1]! : null;
    const b = idx < keys.length ? keys[idx]! : null;
    keys.splice(idx, 0, generateKeyBetween(a, b));
  }

  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1]! < keys[i]!, `order broken at ${i}: ${keys[i - 1]} !< ${keys[i]}`);
  }
  assert.equal(new Set(keys).size, keys.length);
});

test('worst case: repeatedly inserting into the same shrinking gap stays ordered', () => {
  const lo = generateKeyBetween(null, null);
  let hi = generateKeyBetween(lo, null);
  for (let i = 0; i < 500; i++) {
    const m = generateKeyBetween(lo, hi);
    assert.ok(lo < m && m < hi, `gap insert ${i} broke order`);
    hi = m;
  }
});

test('always-prepend and always-append remain ordered', () => {
  let head = generateKeyBetween(null, null);
  let tail = head;
  for (let i = 0; i < 300; i++) {
    const newHead = generateKeyBetween(null, head);
    const newTail = generateKeyBetween(tail, null);
    assert.ok(newHead < head, 'prepend not smaller');
    assert.ok(newTail > tail, 'append not larger');
    head = newHead;
    tail = newTail;
  }
});
