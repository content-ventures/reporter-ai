import { ok, refuse } from '../../../domain/result.ts';
import { findDuplicateSource, sourceContentHash } from '../../../domain/source.ts';
import type { TranscriptContent } from '../../../domain/source.ts';
import { analyzeTranscript, detectTranscriptFormat, parseTranscript } from '../../../domain/text/transcript-parse.ts';
import type { IngestLimits, SourceAnalysis, SourceIngest } from '../../../ports/source-ingest.ts';
import { materialOutlook } from '../generation/outlook.ts';
import type { LocalStore } from './local-store.ts';
import { detach } from './queries.ts';
import { productionsUsingSource } from './state.ts';

/** Local reading and analysis of pasted or uploaded transcripts (no upload in R1). */

export const INGEST_LIMITS: IngestLimits = {
  extensions: ['.txt', '.md', '.srt', '.vtt'],
  maxBytes: 2 * 1024 * 1024,
  shortWords: 300,
};

const PREVIEW_SEGMENTS = 6;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function createLocalIngest(store: LocalStore, limits: IngestLimits = INGEST_LIMITS): SourceIngest {
  return {
    limits,
    async read(file) {
      if (!limits.extensions.includes(extensionOf(file.name))) {
        return refuse('unsupported_type', `Envie um arquivo ${limits.extensions.join(', ')}.`);
      }
      if (file.size > limits.maxBytes) {
        return refuse('too_large', `O arquivo passa de ${Math.round(limits.maxBytes / (1024 * 1024))} MB.`);
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        return refuse('read_failed', 'Não foi possível ler o arquivo. Tente de novo.');
      }
      if (!text.trim()) return refuse('empty', 'O arquivo está vazio.');
      return ok({ text, fileName: file.name, format: detectTranscriptFormat(text, file.name), bytes: file.size });
    },

    async analyze(text, options = {}) {
      const parsed = parseTranscript(text, {
        ...(options.format ? { format: options.format } : {}),
        ...(options.fileName ? { fileName: options.fileName } : {}),
      });
      if (parsed.segments.length === 0) return refuse('empty', 'Cole ou envie o material para continuar.');
      const content: TranscriptContent = { type: 'transcript', format: parsed.format, segments: parsed.segments };
      const hash = sourceContentHash(content);
      const analysis = analyzeTranscript(parsed.segments);
      const result: SourceAnalysis = {
        format: parsed.format,
        hash,
        segments: parsed.segments,
        speakers: analysis.speakers,
        stats: {
          words: analysis.words,
          characters: text.length,
          readingMinutes: analysis.readingMinutes,
          segments: analysis.segments,
          hasTimestamps: analysis.hasTimestamps,
          ...(analysis.durationMs !== undefined ? { durationMs: analysis.durationMs } : {}),
        },
        preview: parsed.segments.slice(0, PREVIEW_SEGMENTS),
        warnings: parsed.warnings,
        short: analysis.words < limits.shortWords,
      };
      if (options.fileName) result.fileName = options.fileName;
      result.outlook = materialOutlook(parsed.segments, {
        ...(options.angle?.trim() ? { angle: options.angle.trim() } : {}),
        ...(options.speakerNames ? { speakerNames: options.speakerNames } : {}),
      });
      const duplicate = findDuplicateSource(store.state.sources, hash);
      if (duplicate) {
        result.duplicate = {
          sourceId: duplicate.id,
          title: duplicate.title,
          productions: productionsUsingSource(store.state, duplicate.id).map((entry) => ({ id: entry.production.id, title: entry.production.title })),
        };
      }
      return ok(detach(result));
    },
  };
}
