export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const MAX_TEXT_BYTES = 1024 ** 2;
export const MAX_DURATION_SECONDS = 3 * 60 * 60;

/**
 * Audio and video the transcription reads, by extension. Opus (WhatsApp audio) is an Ogg file:
 * it is stored as `.ogg`, which every stored-key rule already accepts.
 */
const MEDIA_TYPES: Readonly<Record<string, { contentType: string; stored: string }>> = {
  mp3: { contentType: 'audio/mpeg', stored: 'mp3' }, m4a: { contentType: 'audio/mp4', stored: 'm4a' },
  mp4: { contentType: 'video/mp4', stored: 'mp4' }, wav: { contentType: 'audio/wav', stored: 'wav' },
  ogg: { contentType: 'audio/ogg', stored: 'ogg' }, opus: { contentType: 'audio/ogg', stored: 'ogg' },
  flac: { contentType: 'audio/flac', stored: 'flac' }, webm: { contentType: 'video/webm', stored: 'webm' },
};
/** `.mp3`, `.m4a`…: what a file picker accepts as audio or video. */
export const MEDIA_EXTENSIONS: readonly string[] = Object.keys(MEDIA_TYPES).map(extension => `.${extension}`);

/** The stored extension and content type of an audio or video file name; `undefined` for anything else. */
export function mediaOf(name: string): { extension: string; contentType: string } | undefined {
  const type = MEDIA_TYPES[name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? ''];
  return type ? { extension: type.stored, contentType: type.contentType } : undefined;
}
export const CHUNK_SECONDS = 600;
export const CHUNK_OVERLAP_SECONDS = 2;
export type Slide = { title?: string; body: string };
export type ReporterMutation = (path: string, body: object, idempotent?: boolean) => Promise<boolean>;
export type Segment = { start_ms: number; end_ms: number; text: string };
export type Transcript = {
  id: string; revision: number; status: "queued" | "processing" | "ready" | "failed";
  file_name: string; content: string | null; error_code: string | null; source_object_id: string;
  job?: { progress?: { phase: string; done: number; total: number }; last_error?: string; attempts: number };
};
export type Article = {
  id: string; transcript_id: string; revision: number; approved_revision: number | null;
  title: string | null; content: string | null; error_code: string | null;
  status: "generating" | "draft" | "in_review" | "approved" | "changes_requested" | "failed";
};
export type ReporterCarousel = {
  id: string; article_id: string; revision: number; title: string | null; slides: Slide[];
  error_code: string | null; status: "generating" | "draft" | "ready" | "failed";
};
export type ReporterState = {
  transcripts: Transcript[]; articles: Article[]; carousels: ReporterCarousel[];
  worker_online: boolean; groq_configured: boolean;
};

export function audioChunks(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) throw new Error("MEDIA_DURATION");
  const result: { start: number; duration: number; boundary: number }[] = [];
  for (let boundary = 0; boundary < duration; boundary += CHUNK_SECONDS) {
    const start = Math.max(0, boundary - CHUNK_OVERLAP_SECONDS);
    result.push({ start, boundary, duration: Math.min(boundary + CHUNK_SECONDS, duration) - start });
  }
  return result;
}

// Keep provider timestamps, offset to the original recording, and deduplicate
// the overlap without creating estimated timestamps or invented speaker labels.
export function mergeSegments(previous: Segment[], incoming: Segment[], startSeconds: number): Segment[] {
  const result = [...previous];
  for (const segment of incoming) {
    const start = Math.round(segment.start_ms + startSeconds * 1000);
    const end = Math.round(segment.end_ms + startSeconds * 1000);
    const last = result.at(-1);
    if (last && end <= last.end_ms) continue;
    let text = segment.text.trim();
    if (last && start < last.end_ms) {
      const left = last.text.split(/\s+/), right = text.split(/\s+/);
      for (let n = Math.min(30, left.length, right.length); n > 0; n--) {
        const normalize = (words: string[]) => words.join(" ").toLocaleLowerCase("pt-BR").replace(/[.,!?;:]/g, "");
        if (normalize(left.slice(-n)) === normalize(right.slice(0, n))) { text = right.slice(n).join(" "); break; }
      }
    }
    if (text) result.push({ start_ms: Math.max(start, last?.end_ms ?? 0), end_ms: end, text });
  }
  return result;
}

/**
 * Whisper sometimes returns a stretch of Portuguese with every word cut at its first accented letter
 * ("Então" -> "Ent", "ração" -> "ra", "genética" -> "gen"), at normal confidence. A long Portuguese
 * segment with no accented letter at all is that failure: it is transcribed again on its own.
 */
export const GARBLED_MIN_WORDS = 12;
/** Seconds of audio around a garbled segment, so the new transcription starts and ends on whole words. */
export const REPAIR_MARGIN_SECONDS = 3;
/** Garbled segments transcribed again per recording, at most. */
export const MAX_REPAIRS = 20;
export type TimedWord = { word: string; start_ms: number; end_ms: number };

const ACCENTED = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/u;
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

export function garbledSegment(segment: Segment, language: string): boolean {
  return language.toLowerCase().startsWith('pt') && wordCount(segment.text) >= GARBLED_MIN_WORDS && !ACCENTED.test(segment.text);
}

/** The audio window transcribed again for a segment: the segment plus a margin, inside the recording. */
export function repairWindow(segment: Segment, durationSeconds: number): { start: number; duration: number } {
  const start = Math.max(0, segment.start_ms / 1000 - REPAIR_MARGIN_SECONDS);
  const end = Math.min(durationSeconds, segment.end_ms / 1000 + REPAIR_MARGIN_SECONDS);
  return { start, duration: Math.max(0, end - start) };
}

/** The words of a window's transcription spoken inside the segment, by the middle of each word. */
export function wordsWithin(words: readonly TimedWord[], windowStartSeconds: number, segment: Segment): string {
  const offset = windowStartSeconds * 1000;
  return words.filter(word => {
    const middle = offset + (word.start_ms + word.end_ms) / 2;
    return middle >= segment.start_ms && middle <= segment.end_ms;
  }).map(word => word.word.trim()).filter(Boolean).join(' ');
}

/** A repair replaces the garbled text only when it reads as Portuguese again and keeps about the same length. */
export function acceptedRepair(garbled: string, repaired: string): boolean {
  const before = wordCount(garbled), after = wordCount(repaired);
  return ACCENTED.test(repaired) && after >= Math.ceil(before * 0.6) && after <= Math.floor(before * 1.6) + 1;
}

export function splitSource(text: string, max = 12000): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const candidate = rest.lastIndexOf("\n", max);
    const boundary = candidate > max / 2 ? candidate : rest.lastIndexOf(" ", max);
    const end = boundary > max / 2 ? boundary : max;
    chunks.push(rest.slice(0, end)); rest = rest.slice(end).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
