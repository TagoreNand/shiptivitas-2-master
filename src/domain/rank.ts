/**
 * Fractional indexing — LexoRank-style ordering keys.
 *
 * A port of the well-tested `fractional-indexing` algorithm (David Greenspan /
 * rocicorp, MIT). It produces compact, lexicographically-sortable string keys
 * such that a new key can ALWAYS be generated strictly between any two existing
 * keys. That is what turns a reorder from an O(N) whole-lane rewrite into an
 * O(1) single-row update: to move a card, we only compute one new key between
 * its two new neighbours.
 *
 * IMPORTANT — collation. Keys are compared as raw byte/UTF-16 strings here, so
 * the Postgres `rank` column MUST use `COLLATE "C"` (binary) for ORDER BY and
 * the unique index to agree with this code. A locale collation (e.g. en_US)
 * would order 'A' vs 'a' differently and silently corrupt the sequence.
 */

const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function getIntegerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function smallestInteger(digits: string): string {
  return 'A' + digits[0]!.repeat(getIntegerLength('A') - 1);
}

function midpoint(a: string, b: string | null, digits: string): string {
  const zero = digits[0]!;
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === zero || (b !== null && b.slice(-1) === zero)) {
    throw new Error('trailing zero');
  }
  if (b !== null) {
    // Strip the longest common prefix, padding `a` with zeros as needed.
    let n = 0;
    while ((a[n] ?? zero) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits);
  }
  const digitA = a.length > 0 ? digits.indexOf(a[0]!) : 0;
  const digitB = b !== null ? digits.indexOf(b[0]!) : digits.length;
  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB));
    return digits[midDigit]!;
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  // `b` is null or a single digit; recurse on the fractional tail of `a`.
  return digits[digitA]! + midpoint(a.slice(1), null, digits);
}

function validateInteger(int: string): void {
  if (int.length !== getIntegerLength(int[0]!)) {
    throw new Error(`invalid integer part of order key: ${int}`);
  }
}

function getIntegerPart(key: string): string {
  const len = getIntegerLength(key[0]!);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

function validateOrderKey(key: string, digits: string): void {
  if (key === smallestInteger(digits)) throw new Error(`invalid order key: ${key}`);
  const i = getIntegerPart(key);
  const f = key.slice(i.length);
  if (f.slice(-1) === digits[0]) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string, digits: string): string | null {
  validateInteger(x);
  const [head, ...digs] = x.split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digits.indexOf(digs[i]!) + 1;
    if (d === digits.length) {
      digs[i] = digits[0]!;
    } else {
      digs[i] = digits[d]!;
      carry = false;
    }
  }
  if (carry) {
    if (head === 'Z') return 'a' + digits[0]!;
    if (head === 'z') return null;
    const h = String.fromCharCode(head!.charCodeAt(0) + 1);
    if (h > 'a') digs.push(digits[0]!);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

function decrementInteger(x: string, digits: string): string | null {
  validateInteger(x);
  const [head, ...digs] = x.split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digits.indexOf(digs[i]!) - 1;
    if (d === -1) {
      digs[i] = digits[digits.length - 1]!;
    } else {
      digs[i] = digits[d]!;
      borrow = false;
    }
  }
  if (borrow) {
    if (head === 'a') return 'Z' + digits[digits.length - 1]!;
    if (head === 'A') return null;
    const h = String.fromCharCode(head!.charCodeAt(0) - 1);
    if (h < 'Z') digs.push(digits[digits.length - 1]!);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

/**
 * Returns a key strictly between `a` and `b`. Pass `null` for an open bound:
 * `generateKeyBetween(null, null)` = first ever key; `(a, null)` = after `a`;
 * `(null, b)` = before `b`.
 */
export function generateKeyBetween(
  a: string | null,
  b: string | null,
  digits: string = BASE_62_DIGITS,
): string {
  if (a !== null) validateOrderKey(a, digits);
  if (b !== null) validateOrderKey(b, digits);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return 'a' + digits[0]!;
    const ib = getIntegerPart(b);
    const fb = b.slice(ib.length);
    if (ib === smallestInteger(digits)) return ib + midpoint('', fb, digits);
    if (ib < b) return ib;
    const res = decrementInteger(ib, digits);
    if (res === null) throw new Error('cannot decrement any more');
    return res;
  }

  if (b === null) {
    const ia = getIntegerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia, digits);
    return i === null ? ia + midpoint(fa, null, digits) : i;
  }

  const ia = getIntegerPart(a);
  const fa = a.slice(ia.length);
  const ib = getIntegerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb, digits);
  const i = incrementInteger(ia, digits);
  if (i === null) throw new Error('cannot increment any more');
  if (i < b) return i;
  return ia + midpoint(fa, null, digits);
}

/** Generates `n` evenly distributed keys strictly between `a` and `b`. */
export function generateNKeysBetween(
  a: string | null,
  b: string | null,
  n: number,
  digits: string = BASE_62_DIGITS,
): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b, digits)];

  if (b === null) {
    let c = generateKeyBetween(a, b, digits);
    const result = [c];
    for (let i = 1; i < n; i++) {
      c = generateKeyBetween(c, b, digits);
      result.push(c);
    }
    return result;
  }
  if (a === null) {
    let c = generateKeyBetween(a, b, digits);
    const result = [c];
    for (let i = 1; i < n; i++) {
      c = generateKeyBetween(a, c, digits);
      result.push(c);
    }
    result.reverse();
    return result;
  }

  const mid = Math.floor(n / 2);
  const c = generateKeyBetween(a, b, digits);
  return [
    ...generateNKeysBetween(a, c, mid, digits),
    c,
    ...generateNKeysBetween(c, b, n - mid - 1, digits),
  ];
}
