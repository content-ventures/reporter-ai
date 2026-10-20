import { createHmac } from 'node:crypto';
import { EDITORIAL_FORMATS, FORMAT_SPECS } from '../domain/formats.ts';
import type { EditorialFormat } from '../domain/formats.ts';

/**
 * The pure half of the Drive folder intake: stable ids per Drive file, the folder that names a
 * format and the byte ranges of each upload part. No I/O, so it is tested without a server.
 */

/** Audio and video the transcription accepts, by extension (the browser upload's list). */
export const DRIVE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', webm: 'video/webm',
};

export function driveMedia(name: string): { extension: string; contentType: string } | undefined {
  const extension = name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  const contentType = extension ? DRIVE_MEDIA_TYPES[extension] : undefined;
  return extension && contentType ? { extension, contentType } : undefined;
}

function uuidFrom(digest: Buffer): string {
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Every sync of one Drive file derives the same source, upload token and idempotency key, so a
 * repeated or overlapping sync replays instead of duplicating.
 */
export function driveIds(secret: string, fileId: string) {
  const digest = (purpose: string) => createHmac('sha256', secret).update(`${purpose}:${fileId}`).digest();
  return { sourceId: uuidFrom(digest('source')), token: digest('token').toString('base64url'), key: `drive-${fileId}` };
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const FOLDER_FORMATS = new Map<string, EditorialFormat>([
  ['estande', 'stand'], ['estandes', 'stand'], ['painel', 'panel'], ['paineis', 'panel'], ['premiacao', 'awards'],
  ['premiacoes', 'awards'], ['abertura', 'opening'], ['nota', 'note'], ['notas', 'note'],
  ...EDITORIAL_FORMATS.flatMap(format => [[fold(format), format], [fold(FORMAT_SPECS[format].label), format]] as [string, EditorialFormat][]),
]);

/** A subfolder of "Entrada" named after a format ("Painel", "Estande", "Premiação"…); else the article. */
export function folderFormat(name: string | undefined): EditorialFormat | undefined {
  return name ? FOLDER_FORMATS.get(fold(name)) : undefined;
}

/** Bytes of one multipart part, inclusive, as an HTTP Range names them. */
export function partRange(number: number, partSize: number, size: number) {
  const start = (number - 1) * partSize, end = Math.min(size, start + partSize) - 1;
  return { start, end, length: end - start + 1 };
}
