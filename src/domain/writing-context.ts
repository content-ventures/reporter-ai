import type { Source } from './source.ts';

export type WritingTemporalContext = {
  /** Execution calendar day in the newsroom timezone; not a publication or interview date. */
  executionDate: string;
  sources: { sourceId: string; title: string; recordedOn: string | null }[];
};

/** Capture only supplied source dates. Upload/version timestamps do not date a declaration. */
export function writingTemporalContext(sources: readonly Pick<Source, 'id' | 'title' | 'recordedOn'>[], executionDate: string): WritingTemporalContext {
  return { executionDate, sources: sources.map(source => ({
    sourceId: source.id, title: source.title, recordedOn: source.recordedOn?.trim() ? source.recordedOn : null,
  })) };
}

/** The same timezone used by the worker's human-readable execution date. */
export function writingExecutionDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Old or incomplete snapshots have no recorded temporal context; never reconstruct it from today. */
export function readWritingTemporalContext(brief: unknown): WritingTemporalContext | undefined {
  if (!record(brief) || !record(brief.temporalContext)) return undefined;
  const context = brief.temporalContext;
  if (typeof context.executionDate !== 'string' || !context.executionDate.trim() || !Array.isArray(context.sources)) return undefined;
  const sources: WritingTemporalContext['sources'] = [];
  for (const source of context.sources) {
    if (!record(source) || typeof source.sourceId !== 'string' || !source.sourceId.trim() || typeof source.title !== 'string'
      || (source.recordedOn !== null && typeof source.recordedOn !== 'string')) return undefined;
    sources.push({ sourceId: source.sourceId, title: source.title, recordedOn: source.recordedOn?.trim() ? source.recordedOn : null });
  }
  return { executionDate: context.executionDate, sources };
}
