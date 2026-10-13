/**
 * Stable, synchronous content hash: FNV-1a 64-bit over the UTF-8 bytes of a canonical JSON
 * serialisation (sorted keys, `undefined` dropped). Not cryptographic; it identifies the exact
 * content a decision was made on (REQ-T.6) and detects duplicate material.
 */

/** Canonical JSON: object keys sorted, `undefined` members dropped, arrays kept in order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return 'null';
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

const encoder = new TextEncoder();

/** FNV-1a 64-bit of a string, as 16 lowercase hex characters. */
export function fnv1a64(text: string): string {
  const bytes = encoder.encode(text);
  // 64-bit state kept as two unsigned 32-bit halves; prime = 0x00000100_000001b3.
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let index = 0; index < bytes.length; index += 1) {
    lo = (lo ^ bytes[index]) >>> 0;
    const product = lo * 0x1b3;
    const carry = Math.floor(product / 0x100000000);
    const nextLo = product >>> 0;
    hi = (Math.imul(hi, 0x1b3) + Math.imul(lo, 0x100) + carry) >>> 0;
    lo = nextLo;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

export function contentHash(value: unknown): string {
  return fnv1a64(stableStringify(value));
}

/** First 7 characters, for display ("material · 3f9a0c1"). */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}
