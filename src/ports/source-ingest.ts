import type { ProductionId, SourceId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';
import type { ParsedSegment, TranscriptFormat, TranscriptWarning } from '../domain/text/transcript-parse.ts';

/**
 * "Material" step of Nova produção: read a pasted text or a .txt/.md/.srt/.vtt file and show
 * what was understood (speakers, words, reading time, timestamps) before anything is saved.
 * Parsing stays local even with a backend; `upload` arrives in R4 (audio/video, F1.1 storage).
 */

/** Structural subset of the browser `File` (and of a test double). */
export type IngestFile = {
  name: string;
  size: number;
  type?: string;
  text(): Promise<string>;
};

export type IngestLimits = {
  /** Accepted extensions, lower case with the dot: `.txt`, `.md`, `.srt`, `.vtt`. */
  extensions: string[];
  maxBytes: number;
  /** Below this many words the material is flagged "material curto" (a warning, not a block). */
  shortWords: number;
};

export type ReadRefusal = 'unsupported_type' | 'too_large' | 'empty' | 'read_failed';

export type ReadFile = { text: string; fileName: string; format: TranscriptFormat; bytes: number };

export type AnalyzeOptions = {
  fileName?: string;
  format?: TranscriptFormat | 'auto';
  /** Brief's angle: the outlook's headline follows it, as the draft's does. */
  angle?: string;
  /** Person name of each speaker label ("Falantes"), for the headline's attribution. */
  speakerNames?: Readonly<Record<string, string>>;
};

export type SpeakerStats = { label: string; segments: number; words: number };

/** A saved source whose content hash equals the analysed material ("material duplicado"). */
export type DuplicateMatch = {
  sourceId: SourceId;
  title: string;
  productions: { id: ProductionId; title: string }[];
};

export type SourceAnalysis = {
  format: TranscriptFormat;
  fileName?: string;
  /** Content hash of the transcript this text would create (same rule as saved sources). */
  hash: string;
  segments: ParsedSegment[];
  speakers: SpeakerStats[];
  stats: {
    words: number;
    characters: number;
    readingMinutes: number;
    segments: number;
    hasTimestamps: boolean;
    durationMs?: number;
  };
  /** First few segments for the compact TranscriptViewer preview. */
  preview: ParsedSegment[];
  warnings: TranscriptWarning[];
  short: boolean;
  duplicate?: DuplicateMatch;
  /** How the article would be born from this material (simulated adapters; absent elsewhere). */
  outlook?: MaterialOutlook;
};

/** Proposed headline, sections the material supports and the key lines a draft would quote. */
export type MaterialOutlook = {
  headline?: string;
  /** Questions (or passages) that can become sections. */
  sections: number;
  /** Words of the longest article this material supports (the simulation never invents more). */
  wordsAvailable: number;
  keyLines: { segmentId: string; speaker?: string; text: string }[];
};

export type AnalyzeRefusal = 'empty';

export interface SourceIngest {
  readonly limits: IngestLimits;
  read(file: IngestFile): Promise<Result<ReadFile, ReadRefusal>>;
  analyze(text: string, options?: AnalyzeOptions): Promise<Result<SourceAnalysis, AnalyzeRefusal>>;
}
