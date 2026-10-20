import { createHmac } from 'node:crypto';
import { EDITORIAL_FORMATS, FORMAT_SPECS } from '../domain/formats.ts';
import type { EditorialFormat } from '../domain/formats.ts';
import { analyzeTranscript, parseTranscript } from '../domain/text/transcript-parse.ts';
import type { MaterialParticipant, SourceAnalysis, SpeakerStats } from '../ports/source-ingest.ts';
import type { NewProductionInput } from '../ports/production-commands.ts';
import { EMPTY_DRAFT, toCreateInput, type PersonOption } from '../features/new-production/form.ts';

/**
 * The pure half of the Drive folder intake: stable ids per Drive file, the folder that names a
 * format, the byte ranges of each upload part and the production the new-production form would
 * create from the same material. No I/O, so it is tested without a server.
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
 * Every sync of one Drive file derives the same source, upload token, idempotency key and
 * production request, so a repeated or overlapping sync replays instead of duplicating.
 */
export function driveIds(secret: string, fileId: string) {
  const digest = (purpose: string) => createHmac('sha256', secret).update(`${purpose}:${fileId}`).digest();
  return { sourceId: uuidFrom(digest('source')), token: digest('token').toString('base64url'), key: `drive-${fileId}`,
    productionRequest: uuidFrom(digest('production')) };
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

function timestamp(ms: number) {
  const value = Math.max(0, Math.round(ms));
  return [Math.floor(value / 3600000), Math.floor(value / 60000) % 60, Math.floor(value / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':')
    + ',' + String(value % 1000).padStart(3, '0');
}

export type StoredTranscript = { segments?: { start_ms: number; end_ms: number; text: string }[] | null; content?: string | null };

/** The ready transcript as the form receives it: SRT when it has timed segments. */
export function transcriptText(transcript: StoredTranscript): string {
  return transcript.segments?.length
    ? transcript.segments.map((segment, index) => `${index + 1}\n${timestamp(segment.start_ms)} --> ${timestamp(segment.end_ms)}\n${segment.text}`).join('\n\n')
    : transcript.content ?? '';
}

/** Detected speakers plus the participants the material analysis found, as the form merges them. */
export function materialSpeakers(text: string, participants: readonly MaterialParticipant[]): SpeakerStats[] {
  const parsed = parseTranscript(text, { format: 'auto', fileName: 'transcript.srt' });
  const speakers: SpeakerStats[] = analyzeTranscript(parsed.segments).speakers.map(speaker => ({ ...speaker }));
  for (const { name, ...presentation } of participants) {
    const speaker = speakers.find(item => item.label === name);
    if (speaker) speaker.presentation = presentation;
    else speakers.push({ label: name, segments: 0, words: 0, presentation });
  }
  return speakers;
}

export type DriveProduction = {
  fileName: string;
  size: number;
  text: string;
  transcriptId: string;
  title?: string;
  recordedOn?: string;
  format?: EditorialFormat;
  speakers: SpeakerStats[];
  people: readonly PersonOption[];
};

const stem = (name: string) => name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[\s_]+/g, ' ').trim();

/**
 * The production the form would create from this material, left for a person to confirm: event
 * origin, the form's default pauta and deliveries, the suggested speakers, and no authorization.
 */
export function driveProductionInput(input: DriveProduction): NewProductionInput {
  const title = (input.title?.trim() || stem(input.fileName) || 'Material do Drive').slice(0, 120);
  const draft = { ...EMPTY_DRAFT, mode: 'file' as const, title, origin: 'event' as const, authorized: false,
    file: { name: input.fileName, size: input.size, text: input.text, transcriptId: input.transcriptId },
    ...(input.recordedOn ? { recordedOn: input.recordedOn } : {}), ...(input.format ? { format: input.format } : {}) };
  const analysis = { speakers: input.speakers } as Pick<SourceAnalysis, 'speakers'> as SourceAnalysis;
  return toCreateInput(draft, analysis, input.people);
}
