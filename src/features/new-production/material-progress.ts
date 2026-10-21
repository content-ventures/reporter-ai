import { formatTimestamp } from '../../domain/index.ts';
import { mediaOf } from '../../domain/reporter.ts';
import { parseSourceLink } from '../../domain/source-link.ts';
import type { MaterialReadPhase } from '../../ports/index.ts';
import { MATERIAL_TOO_LONG, materialTooLong, type NewProductionDraft } from './form.ts';
import { CANCELLABLE, partViews, type PartView } from './material-parts.ts';
import type { MaterialAnalysis } from './use-material-analysis.ts';
import type { FileReadState, PartReads } from './use-file-reader.ts';
import type { LinkReadState } from './use-link-reader.ts';

type StepState = 'done' | 'current' | 'upcoming' | 'error';

/** One line of the dialog; `file`: the part's file, which the dialog shows under the label. */
export type MaterialProgressStep = { id: string; label: string; state: StepState; detail?: string; meta?: string; file?: string };

export type MaterialProgress = {
  status: 'running' | 'error' | 'ready';
  phase: MaterialReadPhase | 'analysis' | 'parts';
  name: string;
  size: number | undefined;
  steps: MaterialProgressStep[];
  upload: { sent: number; total: number; percent: number } | undefined;
  /** What "Tentar novamente" does; absent when nothing can be retried (a material too long). */
  retry?: 'pick' | 'file' | 'link' | 'analysis' | 'parts';
  canCancel: boolean;
  /** Reads "Cancelar envio" stops (a material in parts). */
  cancelCount?: number;
  largeUpload: boolean;
  /** The recordings of a material in parts, in the order of their steps. */
  parts?: PartView[];
};

const ANALYZING = 'Identificando o tema e os participantes.';
const LARGE_UPLOAD = 100 * 1024 ** 2;

/** `file`: the read of the one part; without it, the first part still being read or that failed. */
export function materialProgress(draft: NewProductionDraft, analysis: MaterialAnalysis, file: FileReadState | null, link: LinkReadState | null, reads: PartReads = {}): MaterialProgress | null {
  if (draft.mode === 'file' && draft.parts.length > 1) return partsProgress(draft, analysis, reads);
  const fileRead = file ?? draft.parts.map((part) => reads[part.id]).find(Boolean) ?? null;
  const read = draft.mode === 'file' ? fileRead : draft.mode === 'link' ? link : null;
  if (!read && analysis.status === 'idle') return null;
  const name = draft.mode === 'file' ? fileRead?.name ?? draft.parts[0]?.name ?? 'Arquivo'
    : draft.mode === 'link' ? (parseSourceLink(draft.sourceUrl ?? '')?.provider === 'youtube' ? 'Vídeo do YouTube' : 'Episódio do Spotify') : 'Texto colado';
  const size = draft.mode === 'file' ? fileRead?.size ?? draft.parts[0]?.size : undefined;
  const audio = draft.mode === 'file' ? mediaOf(name) !== undefined
    : draft.mode === 'link' && parseSourceLink(draft.sourceUrl ?? '')?.provider === 'spotify';
  const phase = read ? (read.phase === 'ready' ? 'analysis' : read.phase) : 'analysis';
  const failed = read?.status === 'error' || !read && analysis.status === 'error';
  const error = read?.status === 'error' ? read.message : !read && analysis.status === 'error' ? analysis.message ?? 'Tente analisar o material novamente.' : undefined;
  const status = failed ? 'error' as const : !read && analysis.status === 'ready' ? 'ready' as const : 'running' as const;
  const labels = [draft.mode === 'paste' ? 'Ler transcrição' : draft.mode === 'link' ? 'Importar link' : audio ? 'Enviar arquivo' : 'Ler arquivo',
    ...(audio ? ['Transcrever áudio'] : []), 'Analisar material'];
  const index = phase === 'analysis' ? labels.length - 1 : audio && (phase === 'preparing' || phase === 'transcribing') ? 1 : 0;
  const upload = read?.status === 'reading' && phase === 'uploading' && read.uploadedBytes !== undefined && read.totalBytes
    ? { sent: read.uploadedBytes,total: read.totalBytes,percent: Math.min(100,Math.round(read.uploadedBytes / read.totalBytes * 100)) } : undefined;
  const chunks = read?.status === 'reading' && phase === 'transcribing' && read.total && read.total > 1
    ? `${read.done ?? 0} de ${read.total} trechos concluídos` : undefined;
  const message = error ?? (phase === 'analysis' ? ANALYZING
    : read?.status === 'reading' ? read.message : undefined);
  const steps = labels.map((label,i) => ({ id: String(i),label,
    state: status === 'ready' || i < index ? 'done' as const : i > index ? 'upcoming' as const : status === 'error' ? 'error' as const : 'current' as const,
    ...(i === index && status !== 'ready' ? { detail: chunks ?? message } : {}) }));
  const retry = read?.status === 'error' ? (draft.mode === 'file' && fileRead?.status === 'error' && fileRead.retry === 'pick' ? 'pick' as const : draft.mode === 'file' ? 'file' as const : 'link' as const) : 'analysis' as const;
  return { status,phase,name,size,steps,upload,retry,canCancel: read?.status === 'reading' && CANCELLABLE.includes(read.phase),
    largeUpload: status === 'running' && phase === 'uploading' && size !== undefined && size >= LARGE_UPLOAD };
}

/** Several parts: one step per part, each with its own read, then the analysis once every part is in. */
function partsProgress(draft: NewProductionDraft, analysis: MaterialAnalysis, reads: PartReads): MaterialProgress {
  const parts = partViews(draft, reads, analysis.status === 'ready' ? analysis.analysis : undefined);
  const reading = parts.filter((part) => part.status.kind === 'reading');
  const failed = parts.flatMap((part) => (part.status.kind === 'error' ? [part.status] : []));
  const allRead = parts.every((part) => part.status.kind === 'ready');
  const tooLong = allRead && materialTooLong(draft);
  const analysisState: StepState = !allRead ? 'upcoming' : tooLong || analysis.status === 'error' ? 'error' : analysis.status === 'ready' ? 'done' : 'current';
  const steps: MaterialProgressStep[] = parts.map((part) => ({
    id: part.id,
    label: `Parte ${part.number}`,
    file: part.name,
    state: part.status.kind === 'ready' ? 'done' : part.status.kind === 'error' ? 'error' : 'current',
    ...(part.status.kind === 'ready' && part.status.durationMs !== undefined ? { meta: formatTimestamp(part.status.durationMs) } : {}),
  }));
  steps.push({ id: 'analysis', label: 'Analisar material', state: analysisState, ...(analysisState === 'current' ? { detail: ANALYZING }
    : analysisState === 'error' ? { detail: tooLong ? MATERIAL_TOO_LONG : analysis.message ?? 'Tente analisar o material novamente.' } : {}) });
  const cancellable = reading.filter((part) => part.status.kind === 'reading' && part.status.cancellable).length;
  const status = reading.length > 0 ? 'running' : failed.length > 0 || analysisState === 'error' ? 'error' : analysisState === 'done' ? 'ready' : 'running';
  const retry = failed.some((part) => part.retry === 'reread') ? 'parts' : failed.length > 0 ? 'pick' : tooLong ? undefined : 'analysis';
  return {
    status,
    phase: 'parts',
    name: `${parts.length} partes`,
    size: parts.reduce((sum, part) => sum + part.size, 0),
    steps,
    upload: undefined,
    ...(retry ? { retry } : {}),
    canCancel: cancellable > 0,
    cancelCount: cancellable,
    largeUpload: draft.parts.some((part) => {
      const read = reads[part.id];
      return read?.status === 'reading' && read.phase === 'uploading' && read.size >= LARGE_UPLOAD;
    }),
    parts,
  };
}
