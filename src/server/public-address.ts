import 'server-only';
import { isIP } from 'node:net';

/** Loopback, private, link-local, multicast and reserved addresses: never fetched for a remote source. */
export function privateAddress(value: string): boolean {
  const address = value.toLowerCase().split('%')[0];
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) === 6) {
    if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(address)) return true;
    if (address.startsWith('::ffff:') && !/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(address)) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? privateAddress(mapped) : false;
  }
  return true;
}
