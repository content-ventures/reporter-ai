import { mediaOf } from '../../domain/reporter.ts';
import { parseSourceLink } from '../../domain/source-link.ts';
import type { MaterialReadPhase } from '../../ports/index.ts';
import type { NewProductionDraft } from './form.ts';
import type { MaterialAnalysis } from './use-material-analysis.ts';
import type { FileReadState, PartReads } from './use-file-reader.ts';
import type { LinkReadState } from './use-link-reader.ts';

/** Phases a read can still be called off in ("Cancelar envio"). */
export const CANCELLABLE: readonly MaterialReadPhase[] = ['reading', 'locating', 'uploading'];

/** `file`: the read of the one part; without it, the first part still being read or that failed. */
export function materialProgress(draft: NewProductionDraft, analysis: MaterialAnalysis, file: FileReadState | null, link: LinkReadState | null, reads: PartReads = {}) {
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
  const message = error ?? (phase === 'analysis' ? 'Identificando o tema e os participantes.'
    : read?.status === 'reading' ? read.message : undefined);
  const steps = labels.map((label,i) => ({ id: String(i),label,
    state: status === 'ready' || i < index ? 'done' as const : i > index ? 'upcoming' as const : status === 'error' ? 'error' as const : 'current' as const,
    ...(i === index && status !== 'ready' ? { detail: chunks ?? message } : {}) }));
  const retry = read?.status === 'error' ? (draft.mode === 'file' && fileRead?.status === 'error' && fileRead.retry === 'pick' ? 'pick' as const : draft.mode === 'file' ? 'file' as const : 'link' as const) : 'analysis' as const;
  return { status,phase,name,size,steps,upload,retry,canCancel: read?.status === 'reading' && CANCELLABLE.includes(read.phase),
    largeUpload: status === 'running' && phase === 'uploading' && size !== undefined && size >= 100 * 1024 ** 2 };
}
