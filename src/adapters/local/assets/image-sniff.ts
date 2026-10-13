import type { ImageMime } from '../../../domain/asset.ts';

/**
 * Reads the type and size of an image from its first bytes (magic numbers and headers), so a
 * renamed file is refused for what it is and its size is known without decoding the whole image
 * (a 40 MP photo would take ~160 MB decoded). Covers the four types the picker accepts: JPEG, PNG,
 * GIF and WebP; a JPEG's EXIF orientation is applied (a portrait phone photo is stored landscape
 * and turned on display), so the size is the one people see.
 */

export type SniffedImage = { mime: ImageMime; width?: number; height?: number };

/** Enough bytes to reach the JPEG frame header after a large EXIF block. */
export const SNIFF_BYTES = 256 * 1024;

const be16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const be32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const le16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const le24 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let index = at; index < at + length && index < bytes.length; index += 1) out += String.fromCharCode(bytes[index]);
  return out;
}

function sized(mime: ImageMime, width: number, height: number): SniffedImage {
  return width > 0 && height > 0 ? { mime, width, height } : { mime };
}

function png(bytes: Uint8Array): SniffedImage | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return undefined;
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return { mime: 'image/png' };
  return sized('image/png', be32(bytes, 16), be32(bytes, 20));
}

function gif(bytes: Uint8Array): SniffedImage | undefined {
  const header = ascii(bytes, 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return undefined;
  return bytes.length >= 10 ? sized('image/gif', le16(bytes, 6), le16(bytes, 8)) : { mime: 'image/gif' };
}

/** Start-of-frame markers carry the size (C4 DHT, C8 JPG and CC DAC are not frames). */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** EXIF orientation (1–8) of an APP1 segment starting at `at` (after its length), when present. */
function exifOrientation(bytes: Uint8Array, at: number, end: number): number | undefined {
  if (ascii(bytes, at, 6) !== 'Exif\u0000\u0000') return undefined;
  const tiff = at + 6;
  const order = ascii(bytes, tiff, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const little = order === 'II';
  const u16 = (offset: number) => (little ? le16(bytes, offset) : be16(bytes, offset));
  const u32 = (offset: number) => (little ? (le16(bytes, offset) | (le16(bytes, offset + 2) << 16)) >>> 0 : be32(bytes, offset));
  if (tiff + 8 > end || u16(tiff + 2) !== 0x2a) return undefined;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return undefined;
  const entries = u16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

function jpeg(bytes: Uint8Array): SniffedImage | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return undefined;
  let offset = 2;
  let orientation: number | undefined;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    if (isFrameMarker(marker)) {
      if (offset + 8 >= bytes.length) break;
      const [width, height] = [be16(bytes, offset + 7), be16(bytes, offset + 5)];
      // Orientations 5–8 turn the picture a quarter: what people see is the other way round.
      return orientation !== undefined && orientation >= 5 ? sized('image/jpeg', height, width) : sized('image/jpeg', width, height);
    }
    const length = be16(bytes, offset + 2);
    if (marker === 0xe1 && orientation === undefined) orientation = exifOrientation(bytes, offset + 4, Math.min(bytes.length, offset + 2 + length));
    offset += 2 + length;
  }
  return { mime: 'image/jpeg' };
}

function webp(bytes: Uint8Array): SniffedImage | undefined {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ' && bytes.length >= 30) return sized('image/webp', le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff);
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
    return sized('image/webp', 1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
  }
  if (chunk === 'VP8X' && bytes.length >= 30) return sized('image/webp', 1 + le24(bytes, 24), 1 + le24(bytes, 27));
  return { mime: 'image/webp' };
}

/** Type and (when the header has it) size of an image, or undefined when the bytes are no image we accept. */
export function sniffImage(bytes: Uint8Array): SniffedImage | undefined {
  return png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes);
}
