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

/** A word as compared: lowercase, letters and digits only. */
const bare = (word: string) => word.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
/** A word as the failure writes it: cut at its first accented letter ("Então" -> "ent", "é" -> ""). */
function cutAtAccent(word: string): string {
  const plain = bare(word), at = plain.search(ACCENTED);
  return at < 0 ? plain : plain.slice(0, at);
}

/** Share of the garbled words the new transcription must confirm, in order, for the repair to be used. */
export const REPAIR_AGREEMENT = 0.7;

/**
 * The garbled segment with its cut words completed, or undefined when nothing can be completed safely.
 * The repair completes and never rewrites: every token of the first transcription stays as it was
 * (case, punctuation, "&", "%"), and a word cut at its accent ("Ent", "ra", "evolu") takes the rest of
 * the new word that starts with exactly that piece ("Então", "ração", "evolução"), its letters only. The only words added
 * are those that start with an accent ("é", "à", "há"), which the failure drops whole, and only between
 * two confirmed words with no first-pass word between them. Only new words spoken
 * inside the segment count, so a neighbour's "né" or "nós" never stands in for this segment's "não".
 * A new transcription that confirms less than REPAIR_AGREEMENT of the words (another stretch, a
 * translation) changes nothing.
 */
export function repairedText(segment: Segment, words: readonly TimedWord[], windowStartSeconds: number): string | undefined {
  // Every first-pass token is kept in the output; only those with letters or digits take part in the match.
  const tokens = segment.text.trim().split(/\s+/u).filter(Boolean);
  const order = tokens.flatMap((token, at) => bare(token) ? [at] : []);
  const target = order.map(at => bare(tokens[at]));
  const offset = windowStartSeconds * 1000;
  const inside = words.filter(word => {
    const middle = offset + (word.start_ms + word.end_ms) / 2;
    return middle >= segment.start_ms && middle <= segment.end_ms && word.word.trim();
  });
  const cut = inside.map(word => cutAtAccent(word.word));
  const m = target.length, n = inside.length;
  if (!m || !n) return undefined;
  // Longest common subsequence of the garbled words and the new words cut at their accents.
  const lcs = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    lcs[i][j] = cut[j] && target[i] === cut[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const total = lcs[0][0];
  if (total < Math.ceil(m * REPAIR_AGREEMENT)) return undefined;
  // The same alignment from the start, to tell whether a pairing is the only one that reaches the best.
  const head = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    head[i][j] = cut[j - 1] && target[i - 1] === cut[j - 1] ? head[i - 1][j - 1] + 1 : Math.max(head[i - 1][j], head[i][j - 1]);
  }
  /**
   * A pairing is used only when every best alignment makes it: this first-pass word can be neither left
   * unpaired nor paired with another new word of the same cut. Otherwise nothing tells which is right.
   */
  const ambiguous = (i: number, j: number) => {
    for (let k = 0; k <= n; k++) if (head[i][k] + lcs[i + 1][k] === total) return true;
    for (let k = 0; k < n; k++) if (k !== j && cut[k] === target[i] && head[i][k] + 1 + lcs[i + 1][k + 1] === total) return true;
    return false;
  };
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < m && j < n;) {
    if (cut[j] && target[i] === cut[j]) { pairs.push([i, j]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const matched = new Map(pairs);
  const completed = new Map<number, string>(), added = new Map<number, string[]>();
  for (const [p, [i, j]] of pairs.entries()) {
    const token = tokens[order[i]], word = inside[j].word.trim();
    if (ambiguous(i, j)) continue;
    // A cut word keeps what the first pass wrote (case, marks after it) and takes only the letters it lost,
    // placed before its own trailing marks ("Ent," + "ão" gives "Então,"). Only plain words on both sides:
    // a hyphen or an apostrophe ("pré-sal", "d'água") could bring in another word's letters.
    const own = /^(\p{L}+)([.,;:!?]*)$/u.exec(token.normalize('NFC')), core = word.normalize('NFC').replace(/[.,;:!?]+$/u, '');
    if (bare(word) !== target[i] && own && /^[\p{L}\p{M}]+$/u.test(core) && core.length > own[1].length) {
      completed.set(order[i], own[1] + core.slice(own[1].length) + own[2]);
    }
    // Words that start with an accent, dropped whole, only when no first-pass word stands between the two confirmed words.
    const next = pairs[p + 1];
    // Never after the end of a sentence: the word would move into the next one.
    if (next && next[0] === i + 1 && order[next[0]] === order[i] + 1 && !ambiguous(next[0], next[1]) && !/[.!?:;]$/u.test(token)) {
      const between = inside.slice(j + 1, next[1]);
      if (between.length && between.every((_, k) => !cut[j + 1 + k])) added.set(order[i], between.map(item => item.word.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '')).filter(Boolean));
    }
  }
  if (!completed.size && !added.size) return undefined;
  const out = tokens.flatMap((token, at) => [completed.get(at) ?? token, ...(added.get(at) ?? [])]);
  const text = out.join(' ');
  return ACCENTED.test(text) && matched.size ? text : undefined;
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
