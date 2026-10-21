import { MAX_MATERIAL_PARTS } from '../../domain/index.ts';
import type { MaterialReadPhase, SourceAnalysis } from '../../ports/index.ts';
import type { NewProductionDraft } from './form.ts';
import type { PartReads } from './use-file-reader.ts';

/** Phases a read can still be called off in ("Cancelar envio"). */
export const CANCELLABLE: readonly MaterialReadPhase[] = ['reading', 'locating', 'uploading'];

/** Where one recording of the material stands: on its way, failed, or read. */
export type PartStatus =
  | { kind: 'reading'; message: string; upload?: { sent: number; total: number; percent: number }; chunks?: { done: number; total: number }; cancellable: boolean }
  | { kind: 'error'; message: string; retry: 'reread' | 'pick' }
  | { kind: 'ready'; segments?: number; durationMs?: number; empty?: true };

export type PartView = { id: string; number: number; name: string; size: number; status: PartStatus };

/** Every part in order with its read; what each adds only when `analysis` is of these same parts. */
export function partViews(draft: Pick<NewProductionDraft, 'parts'>, reads: PartReads, analysis?: Pick<SourceAnalysis, 'parts'>): PartView[] {
  const added = analysis?.parts?.length === draft.parts.length ? analysis.parts : undefined;
  return draft.parts.map((part, index): PartView => {
    const read = reads[part.id];
    const view = { id: part.id, number: index + 1, name: read?.name ?? part.name, size: read?.size ?? part.size };
    if (read?.status === 'error') return { ...view, status: { kind: 'error', message: read.message, retry: read.retry } };
    if (read?.status === 'reading') {
      const upload = read.phase === 'uploading' && read.uploadedBytes !== undefined && read.totalBytes
        ? { sent: read.uploadedBytes, total: read.totalBytes, percent: Math.min(100, Math.round(read.uploadedBytes / read.totalBytes * 100)) } : undefined;
      const chunks = read.phase === 'transcribing' && read.total !== undefined && read.total > 1 ? { done: read.done ?? 0, total: read.total } : undefined;
      return { ...view, status: { kind: 'reading', message: read.message, cancellable: CANCELLABLE.includes(read.phase), ...(upload ? { upload } : {}), ...(chunks ? { chunks } : {}) } };
    }
    if (part.text === undefined) return { ...view, status: { kind: 'reading', message: 'Lendo arquivo', cancellable: false } };
    const stats = added?.[index];
    return { ...view, status: stats ? {
      kind: 'ready',
      segments: stats.segments,
      ...(stats.durationMs !== undefined ? { durationMs: stats.durationMs } : {}),
      ...(stats.segments === 0 ? { empty: true as const } : {}),
    } : { kind: 'ready' } };
  });
}

/** "Adicionar parte": only in "Arquivo", never beside a file the Drive folder brought, up to the limit. */
export function partSlots(draft: Pick<NewProductionDraft, 'mode' | 'parts'>): 'open' | 'full' | 'closed' {
  if (draft.mode !== 'file' || draft.parts.some((part) => part.received)) return 'closed';
  return draft.parts.length >= MAX_MATERIAL_PARTS ? 'full' : 'open';
}
