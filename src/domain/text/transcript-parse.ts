import { normalizeNewlines, normalizeSpaces } from './normalize.ts';
import { countWords, readingMinutes } from './stats.ts';

/**
 * Transcript parsing for pasted text and uploaded files (.txt, .md, .srt, .vtt).
 * - "Nome: fala" lines become speakers and segments (with optional [00:12] timestamps);
 * - SRT/VTT cues keep their timings; consecutive cues of one speaker are merged;
 * - nothing is invented: a timestamp exists only when the material has one (REQ-T.7).
 */

export type TranscriptFormat = 'plain' | 'speaker-lines' | 'srt' | 'vtt';

export type ParsedSegment = {
  id: string;
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
};

export type TranscriptWarningCode = 'empty' | 'no_speakers' | 'malformed_cue';

export type TranscriptWarning = { code: TranscriptWarningCode; message: string; line?: number };

export type ParsedTranscript = {
  format: TranscriptFormat;
  segments: ParsedSegment[];
  /** Distinct speaker labels in order of first appearance. */
  speakers: string[];
  warnings: TranscriptWarning[];
};

export type ParseTranscriptOptions = {
  /** Forces a format; `auto` (default) detects from the file name and the content. */
  format?: TranscriptFormat | 'auto';
  fileName?: string;
};

/** Segments longer than this are split at sentence boundaries so citations stay precise. */
export const MAX_SEGMENT_CHARS = 1200;
const SPLIT_TARGET_CHARS = 700;
const CUE_MERGE_GAP_MS = 2000;
const UNLABELED_CUE_MAX_CHARS = 600;

const TIMESTAMP = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
const NAME_WORD = String.raw`[\p{Lu}][\p{L}.'’\-]*`;
const PARTICLE = String.raw`(?:da|de|do|das|dos|e|van|von|del|di)`;
const LABEL = String.raw`${NAME_WORD}(?:\s+(?:${NAME_WORD}|${PARTICLE})){0,4}`;

/** "[00:12] Nome: fala", "00:12 - Nome: fala", "Nome (00:12): fala", "Nome: fala". */
const SPEAKER_LINE = new RegExp(
  String.raw`^(?:[\[(]?(${TIMESTAMP})[\])]?\s*[-–—]?\s*)?(${LABEL})(?:\s*[\[(](${TIMESTAMP})[\])])?\s*:\s+(\S.*)$`,
  'u',
);
/** Header lines: "Nome:" alone, or "Nome  00:12" (Otter-style), text follows on next lines. */
const SPEAKER_HEADER = new RegExp(
  String.raw`^(?:[\[(]?(${TIMESTAMP})[\])]?\s*[-–—]?\s*)?(${LABEL})(?:\s*:|\s+[\[(]?(${TIMESTAMP})[\])]?)\s*$`,
  'u',
);
const TIMING_LINE = new RegExp(String.raw`^\s*(${TIMESTAMP})\s*-->\s*(${TIMESTAMP})(?:\s+.*)?$`);

const MAX_LABEL_LENGTH = 40;

export function parseTimestamp(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match) return undefined;
  const [, first, second, third, fraction] = match;
  const millis = fraction ? Number(fraction.padEnd(3, '0')) : 0;
  const hours = third === undefined ? 0 : Number(first);
  const minutes = third === undefined ? Number(first) : Number(second);
  const seconds = third === undefined ? Number(second) : Number(third);
  if (minutes > 59 || seconds > 59) return undefined;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** "01:02:03" style label for a millisecond offset (used by the UI and exports). */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function segmentIdAt(index: number): string {
  return `seg-${String(index + 1).padStart(3, '0')}`;
}

export function detectTranscriptFormat(text: string, fileName?: string): TranscriptFormat {
  const extension = fileName?.toLowerCase().split('.').pop();
  if (extension === 'vtt') return 'vtt';
  if (extension === 'srt') return 'srt';
  const normalized = normalizeNewlines(text).trimStart();
  if (/^WEBVTT\b/.test(normalized)) return 'vtt';
  if (/^\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/m.test(normalized)) return 'srt';
  return 'plain';
}

type Draft = { speaker?: string; lines: string[]; startMs?: number; endMs?: number };

function cleanLabel(label: string): string {
  return normalizeSpaces(label).trim();
}

function isPlausibleLabel(label: string): boolean {
  return label.length > 0 && label.length <= MAX_LABEL_LENGTH && !/^(https?|www)$/i.test(label);
}

type LabelHit = { label: string; startMs?: number; text?: string };

function matchLabel(line: string): LabelHit | null {
  const full = SPEAKER_LINE.exec(line);
  if (full) {
    const label = cleanLabel(full[2]);
    if (!isPlausibleLabel(label)) return null;
    const stamp = full[1] ?? full[3];
    return { label, startMs: stamp ? parseTimestamp(stamp) : undefined, text: full[4] };
  }
  const header = SPEAKER_HEADER.exec(line);
  if (header) {
    const label = cleanLabel(header[2]);
    if (!isPlausibleLabel(label)) return null;
    const stamp = header[1] ?? header[3];
    return { label, startMs: stamp ? parseTimestamp(stamp) : undefined };
  }
  return null;
}

/** Words that introduce notes, not people ("Observação: …", "Fonte: …"). */
const NON_SPEAKER_LABELS = new Set([
  'nota', 'notas', 'observação', 'observações', 'obs', 'atenção', 'importante', 'resumo', 'exemplo', 'dica',
  'fonte', 'fontes', 'link', 'links', 'tema', 'assunto', 'data', 'local', 'hora', 'horário', 'pauta', 'título',
  'subtítulo', 'legenda', 'referência', 'referências', 'contexto', 'duração', 'participantes', 'transcrição',
]);

/**
 * Speaker labels: a "Nome:" pattern seen at least twice in the material, or once when it is
 * not a note word. A single label line in the whole text is never enough to call it dialogue.
 */
function acceptedLabels(lines: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const hit = matchLabel(line.trim());
    if (hit) counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total < 2) return new Set();
  return new Set(
    [...counts]
      .filter(([label, count]) => count >= 2 || !NON_SPEAKER_LABELS.has(label.toLocaleLowerCase('pt-BR')))
      .map(([label]) => label),
  );
}

/** Lossless sentence split: concatenating the parts restores the input. */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(/[.!?…]+["'”»)]*\s+/g)) {
    const end = (match.index ?? 0) + match[0].length;
    parts.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Splits an over-long text at sentence (or, failing that, word) boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARS) return [text];
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > MAX_SEGMENT_CHARS) {
      pushCurrent();
      for (const word of sentence.split(/(\s+)/)) {
        if ((current + word).length > SPLIT_TARGET_CHARS && current.trim()) pushCurrent();
        current += word;
      }
      continue;
    }
    if ((current + sentence).length > SPLIT_TARGET_CHARS && current.trim()) pushCurrent();
    current += sentence;
  }
  pushCurrent();
  return chunks;
}

function finalize(drafts: Draft[], format: TranscriptFormat, warnings: TranscriptWarning[]): ParsedTranscript {
  const segments: ParsedSegment[] = [];
  const speakers: string[] = [];
  for (const draft of drafts) {
    const text = normalizeSpaces(draft.lines.join(' ')).trim();
    if (!text) continue;
    if (draft.speaker && !speakers.includes(draft.speaker)) speakers.push(draft.speaker);
    const chunks = chunkText(text);
    chunks.forEach((chunk, index) => {
      const segment: ParsedSegment = { id: segmentIdAt(segments.length), text: chunk };
      if (draft.speaker) segment.speaker = draft.speaker;
      // Timings belong to the whole draft: the first chunk keeps the start, the last the end.
      if (index === 0 && draft.startMs !== undefined) segment.startMs = draft.startMs;
      if (index === chunks.length - 1 && draft.endMs !== undefined) segment.endMs = draft.endMs;
      segments.push(segment);
    });
  }
  if (segments.length === 0) warnings.push({ code: 'empty', message: 'Nenhum texto encontrado no material.' });
  else if (speakers.length === 0) {
    warnings.push({ code: 'no_speakers', message: 'Nenhum falante identificado. Use linhas no formato "Nome: fala".' });
  }
  return { format, segments, speakers, warnings };
}

function parseLines(text: string): ParsedTranscript {
  const lines = normalizeNewlines(text).split('\n');
  const labels = acceptedLabels(lines);
  const hasBlankLines = lines.some((line, index) => !line.trim() && index > 0 && index < lines.length - 1);
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  let lastSpeaker: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // A blank line closes the paragraph, unless it follows a bare "Nome:" header.
      if (current && current.lines.length > 0) current = undefined;
      continue;
    }
    const hit = labels.size > 0 ? matchLabel(line) : null;
    if (hit && labels.has(hit.label)) {
      lastSpeaker = hit.label;
      current = { speaker: hit.label, lines: hit.text ? [hit.text] : [], startMs: hit.startMs };
      drafts.push(current);
      continue;
    }
    if (current === undefined || (labels.size === 0 && !hasBlankLines)) {
      // A new paragraph keeps the last speaker; unlabeled material splits per paragraph/line.
      current = { speaker: labels.size > 0 ? lastSpeaker : undefined, lines: [line] };
      drafts.push(current);
      continue;
    }
    current.lines.push(line);
  }
  return finalize(drafts, labels.size > 0 ? 'speaker-lines' : 'plain', []);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

type Cue = { startMs?: number; endMs?: number; speaker?: string; text: string; line: number };

function cueText(lines: string[], format: 'srt' | 'vtt'): { speaker?: string; text: string } {
  let speaker: string | undefined;
  const parts: string[] = [];
  for (const rawLine of lines) {
    let line = rawLine;
    if (format === 'vtt') {
      const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(line);
      if (voice && !speaker) speaker = cleanLabel(voice[1]);
    }
    line = decodeEntities(line.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')).trim();
    if (!line) continue;
    if (!speaker && parts.length === 0) {
      const hit = SPEAKER_LINE.exec(line);
      if (hit && isPlausibleLabel(cleanLabel(hit[2]))) {
        speaker = cleanLabel(hit[2]);
        line = hit[4];
      }
    }
    parts.push(line.replace(/^-\s+/, ''));
  }
  return { speaker, text: normalizeSpaces(parts.join(' ')).trim() };
}

function parseCues(text: string, format: 'srt' | 'vtt', warnings: TranscriptWarning[]): Cue[] {
  const lines = normalizeNewlines(text).split('\n');
  const cues: Cue[] = [];
  let block: { lines: string[]; start: number } = { lines: [], start: 1 };
  const blocks: { lines: string[]; start: number }[] = [];
  lines.forEach((line, index) => {
    if (line.trim()) {
      if (block.lines.length === 0) block.start = index + 1;
      block.lines.push(line);
    } else if (block.lines.length > 0) {
      blocks.push(block);
      block = { lines: [], start: index + 2 };
    }
  });
  if (block.lines.length > 0) blocks.push(block);

  for (const [blockIndex, { lines: blockLines, start }] of blocks.entries()) {
    const first = blockLines[0].trim();
    if (format === 'vtt' && (blockIndex === 0 && /^WEBVTT\b/.test(first))) continue;
    if (format === 'vtt' && /^(NOTE|STYLE|REGION)\b/.test(first)) continue;
    const timingIndex = blockLines.findIndex((line) => TIMING_LINE.test(line));
    if (timingIndex < 0 || timingIndex > 1) {
      warnings.push({ code: 'malformed_cue', message: 'Trecho sem marcação de tempo foi ignorado.', line: start });
      continue;
    }
    const timing = TIMING_LINE.exec(blockLines[timingIndex]);
    const startMs = timing ? parseTimestamp(timing[1]) : undefined;
    const endMs = timing ? parseTimestamp(timing[2]) : undefined;
    const { speaker, text: content } = cueText(blockLines.slice(timingIndex + 1), format);
    if (!content) continue;
    cues.push({ startMs, endMs, speaker, text: content, line: start });
  }
  return cues;
}

function endsSentence(text: string): boolean {
  return /[.!?…]["'”»)]*$/.test(text);
}

function mergeCues(cues: Cue[]): Draft[] {
  const anyLabeled = cues.some((cue) => cue.speaker);
  const drafts: Draft[] = [];
  let lastSpeaker: string | undefined;
  for (const cue of cues) {
    // Interview subtitles usually label only speaker changes: unlabeled cues inherit.
    const speaker = cue.speaker ?? (anyLabeled ? lastSpeaker : undefined);
    lastSpeaker = speaker;
    const previous = drafts[drafts.length - 1];
    const joined = previous ? normalizeSpaces([...previous.lines, cue.text].join(' ')) : '';
    const gapOk =
      previous?.endMs === undefined || cue.startMs === undefined || cue.startMs - previous.endMs <= CUE_MERGE_GAP_MS;
    const canMerge =
      previous !== undefined &&
      previous.speaker === speaker &&
      (speaker
        ? joined.length <= MAX_SEGMENT_CHARS
        : gapOk && !endsSentence(previous.lines[previous.lines.length - 1]) && joined.length <= UNLABELED_CUE_MAX_CHARS);
    if (canMerge && previous) {
      previous.lines.push(cue.text);
      if (cue.endMs !== undefined) previous.endMs = cue.endMs;
    } else {
      drafts.push({ speaker, lines: [cue.text], startMs: cue.startMs, endMs: cue.endMs });
    }
  }
  return drafts;
}

export function parseTranscript(raw: string, options: ParseTranscriptOptions = {}): ParsedTranscript {
  const requested = options.format ?? 'auto';
  const format = requested === 'auto' ? detectTranscriptFormat(raw, options.fileName) : requested;
  if (format === 'srt' || format === 'vtt') {
    const warnings: TranscriptWarning[] = [];
    const cues = parseCues(raw, format, warnings);
    return finalize(mergeCues(cues), format, warnings);
  }
  return parseLines(raw);
}

export type TranscriptAnalysis = {
  words: number;
  readingMinutes: number;
  segments: number;
  speakers: { label: string; segments: number; words: number }[];
  hasTimestamps: boolean;
  /** End of the last timed segment, when the material is timed. */
  durationMs?: number;
};

export function analyzeTranscript(segments: readonly ParsedSegment[]): TranscriptAnalysis {
  const bySpeaker = new Map<string, { label: string; segments: number; words: number }>();
  let total = 0;
  let durationMs: number | undefined;
  for (const segment of segments) {
    const wordCount = countWords(segment.text);
    total += wordCount;
    if (segment.speaker) {
      const entry = bySpeaker.get(segment.speaker) ?? { label: segment.speaker, segments: 0, words: 0 };
      entry.segments += 1;
      entry.words += wordCount;
      bySpeaker.set(segment.speaker, entry);
    }
    const end = segment.endMs ?? segment.startMs;
    if (end !== undefined) durationMs = Math.max(durationMs ?? 0, end);
  }
  const analysis: TranscriptAnalysis = {
    words: total,
    readingMinutes: readingMinutes(total),
    segments: segments.length,
    speakers: [...bySpeaker.values()],
    hasTimestamps: segments.some((segment) => segment.startMs !== undefined),
  };
  if (durationMs !== undefined) analysis.durationMs = durationMs;
  return analysis;
}
