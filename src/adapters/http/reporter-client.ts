import { applyRunEvent, foldRun } from '../../domain/run-events.ts';
import { isRunActive } from '../../domain/run.ts';
import { ok, refuse } from '../../domain/result.ts';
import type { RunEvent } from '../../domain/run-events.ts';
import type { ConnectedWorkspace } from '../../ports/connected-workspace.ts';
import type { GenerationService, RunListener, RunSnapshot } from '../../ports/generation.ts';
import type { SourceIngest, MaterialInsights } from '../../ports/source-ingest.ts';
import { MAX_TEXT_BYTES, MAX_UPLOAD_BYTES } from '../../domain/reporter.ts';
import type { Transcript } from '../../domain/reporter.ts';
import { detectTranscriptFormat } from '../../domain/text/transcript-parse.ts';
import { pipelineModelLabel } from '../../domain/pipeline.ts';

export class ReporterHttpError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string,code: string,status: number) { super(message);this.code = code;this.status = status; }
}

export async function reporterRequest<T>(path = '/workspace', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/reporter'+path,{ method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-reporter-client': 'local',...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    cache: 'no-store',...(body === undefined ? {} : { body: JSON.stringify(body) }),signal: signal ?? AbortSignal.timeout(30000),
  });
  const value = await response.json();
  if (!response.ok) {
    const code = value.error ?? 'REQUEST_FAILED';
    if (typeof window !== 'undefined') {
      if (code === 'AUTH_REQUIRED') window.location.replace('/auth/sign-in');
      else if (code === 'ACCESS_PENDING' || code === 'EMAIL_NOT_VERIFIED') window.location.replace('/auth/pending');
    }
    throw new ReporterHttpError(typeof value.message === 'string' ? value.message : 'O servidor do Reporter AI não respondeu.',code,response.status);
  }
  return value as T;
}

export function createHttpGeneration(deps: { current(): ConnectedWorkspace; refresh(): Promise<void>; rpc<T>(method: string,args: unknown[]): Promise<T> }) {
  const listeners = new Set<RunListener>();
  const seen = new Map<string,number>();
  const accept = (workspace: ConnectedWorkspace) => {
    for (const job of Object.values(workspace.jobs)) {
      const previous = seen.get(job.meta.runId) ?? job.events.length;
      seen.set(job.meta.runId,job.events.length);
      let fold = previous < job.events.length ? foldRun(job.events.slice(0,previous)) : undefined;
      for (let i=previous; i<job.events.length; i++) {
        fold = fold ? applyRunEvent(fold,job.events[i]) : foldRun([job.events[i]]);
        if (fold) for (const listener of [...listeners]) listener({ meta: job.meta,fold,event: job.events[i] });
      }
    }
  };
  const snapshots = (filter?: { productionId?: string; activeOnly?: boolean }): RunSnapshot[] => Object.values(deps.current().jobs)
    .map(job => ({ meta: job.meta,fold: deps.current().state.runFolds[job.meta.runId] }))
    .filter(s => s.fold && (!filter?.productionId || s.meta.productionId === filter.productionId) && (!filter?.activeOnly || isRunActive(s.fold.run)))
    .sort((a,b) => b.fold.run.createdAt.localeCompare(a.fold.run.createdAt));
  const service: GenerationService = {
    models: async () => { await deps.refresh(); return [{ alias: deps.current().model,label: pipelineModelLabel(deps.current().model),engine: 'provider' }]; },
    scenarios: () => [],snapshots,
    start: (kind,input) => deps.rpc('generation.start',[kind,input]),
    cancel: id => deps.rpc('generation.cancel',[id]),
    retry: id => deps.rpc('generation.retry',[id]),
    resume: async () => refuse('not_awaiting','Revise a estrutura e use Redigir artigo.'),
    watch(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async attach(id) {
      await deps.refresh();
      const job = deps.current().jobs[id],snapshot = deps.current().state.runFolds[id];
      if (!job || !snapshot) return refuse('unknown_run','Geração não encontrada.');
      const subscribe = (listener: RunListener) => {
        let seq = snapshot.seq;
        return service.watch(update => { if (update.meta.runId === id && update.event.seq>seq) { seq = update.event.seq; listener(update); } });
      };
      const events: AsyncIterable<RunEvent> = { async *[Symbol.asyncIterator]() {
        if (!isRunActive(snapshot.run)) return;
        const queue: RunEvent[] = []; let wake: (() => void) | undefined; let ended = false;
        const off = subscribe(update => { queue.push(update.event); if (!isRunActive(update.fold.run)) ended = true; wake?.(); });
        try { while (!ended || queue.length) { if (!queue.length) await new Promise<void>(resolve => { wake = resolve; }); while (queue.length) yield queue.shift()!; } }
        finally { off(); }
      } };
      return ok({ meta: job.meta,snapshot,subscribe,events });
    },
  };
  return { service,accept,dispose: () => listeners.clear() };
}

function timestamp(ms: number) {
  const value = Math.max(0,Math.round(ms));
  return [Math.floor(value/3600000),Math.floor(value/60000)%60,Math.floor(value/1000)%60].map(n => String(n).padStart(2,'0')).join(':')+','+String(value%1000).padStart(3,'0');
}
export function transcriptFileText(transcript: Transcript & { segments?: { start_ms: number; end_ms: number; text: string }[] | null }) {
  return transcript.segments?.length ? transcript.segments.map((s,i) => `${i+1}\n${timestamp(s.start_ms)} --> ${timestamp(s.end_ms)}\n${s.text}`).join('\n\n') : transcript.content ?? '';
}

export function createHttpIngest(local: SourceIngest): SourceIngest {
  const uploads = new WeakMap<object,{ key: string; id?: string }>();
  const links = new Map<string,{ key: string; id?: string; provider?: 'youtube' | 'spotify'; title?: string; programName?: string; fileName?: string; bytes?: number; sourceUrl?: string }>();
  return {
    limits: { ...local.limits,extensions: [...local.limits.extensions,'.mp3','.m4a','.mp4','.wav','.ogg','.flac','.webm'],maxBytes: MAX_UPLOAD_BYTES },
    async readLink(url,options = {}) {
      const known = links.get(url) ?? { key: crypto.randomUUID() };
      links.set(url,known);
      let retried = false;
      try {
        options.onProgress?.(4,'Localizando episódio');
        if (!known.id) {
          const response = await fetch('/api/reporter/links',{ method: 'POST',headers: { 'content-type': 'application/json','x-reporter-client': 'local','idempotency-key': known.key },
            body: JSON.stringify({ url }),signal: options.signal });
          const result = await response.json();
          if (!response.ok) return refuse('read_failed',result.message ?? 'Não foi possível importar este link.');
          known.provider = result.provider;known.title = result.title;known.programName = result.programName;known.fileName = result.fileName;known.bytes = result.bytes;known.sourceUrl = result.sourceUrl;
          if (result.kind==='ready') {
            options.onProgress?.(100,'Legendas importadas');
            return ok({ text: result.text,fileName: result.fileName,format: detectTranscriptFormat(result.text,result.fileName),bytes: result.bytes,
              sourceUrl: result.sourceUrl,provider: result.provider,title: result.title,programName: result.programName });
          }
          known.id = result.id;
        }
        for (;;) {
          options.signal?.throwIfAborted();
          const state = await reporterRequest<{ transcript: Transcript; worker_online: boolean }>('/transcripts/'+known.id,undefined,options.signal);
          const transcript = state.transcript;
          if (!transcript) return refuse('read_failed','Transcrição não encontrada.');
          if (transcript.status==='ready') {
            const text = transcriptFileText(transcript);
            options.onProgress?.(100,'Transcrição concluída');
            return ok({ text,fileName: known.fileName ?? transcript.file_name ?? 'episodio.mp3',format: detectTranscriptFormat(text,'transcript.srt'),
              bytes: known.bytes ?? 0,transcriptId: transcript.id,sourceUrl: known.sourceUrl ?? url,provider: known.provider ?? 'spotify',title: known.title,programName: known.programName });
          }
          if (transcript.status==='failed') {
            if (!retried && state.worker_online) {
              retried = true;
              const response = await fetch('/api/reporter/transcripts/'+transcript.id+'/retry',{ method: 'POST',headers: { 'content-type': 'application/json','x-reporter-client': 'local','idempotency-key': known.key+'-retry-'+transcript.revision },body: JSON.stringify({ revision: transcript.revision }),signal: options.signal });
              if (response.ok) continue;
            }
            return refuse('read_failed','Não foi possível transcrever. Código: '+(transcript.error_code ?? 'TRANSCRIPTION_FAILED'));
          }
          if (!state.worker_online) return refuse('read_failed','O worker está desligado. Inicie pnpm worker e tente de novo; o episódio já está salvo.');
          const progress = transcript.job?.progress;
          options.onProgress?.(progress?.total ? Math.round(progress.done/progress.total*90) : 8,
            progress?.phase==='transcribing' ? `Transcrevendo trechos ${Math.min((progress.done ?? 0)+1,progress.total)} de ${progress.total}` : 'Importando áudio do feed público');
          await new Promise<void>((resolve,reject) => { const timer = setTimeout(() => { options.signal?.removeEventListener('abort',abort);resolve(); },1000);const abort = () => { clearTimeout(timer);reject(new Error('Importação cancelada.')); };options.signal?.addEventListener('abort',abort,{ once: true }); });
        }
      } catch (error) { return refuse('read_failed',error instanceof Error ? error.message : 'Não foi possível importar este link.'); }
    },
    analyze: async (text,options) => {
      const result = await local.analyze(text,options);
      if (!result.ok) return result;
      delete result.value.outlook;
      try {
        const insights = await reporterRequest<MaterialInsights>('/material/analysis', { text,
          ...(options?.fileName ? { fileName: options.fileName } : {}), ...(options?.format ? { format: options.format } : {}) }, AbortSignal.timeout(180000));
        result.value.topicTitle = insights.title;
        for (const { name, ...presentation } of insights.participants) {
          const speaker = result.value.speakers.find(item => item.label === name);
          if (speaker) speaker.presentation = presentation;
          else result.value.speakers.push({ label: name, segments: 0, words: 0, presentation });
        }
        return result;
      } catch (error) { return refuse('analysis_failed', error instanceof Error ? error.message : 'Não foi possível analisar o tema e os participantes. Tente novamente.'); }
    },
    async read(file,options = {}) {
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const textFile = local.limits.extensions.includes(extension);
      if (!textFile && !['.mp3','.m4a','.mp4','.wav','.ogg','.flac','.webm'].includes(extension)) return refuse('unsupported_type','Formato de arquivo não suportado.');
      if (file.size>(textFile ? MAX_TEXT_BYTES : MAX_UPLOAD_BYTES)) return refuse('too_large',textFile ? 'A transcrição deve ter até 1 MB.' : 'O arquivo deve ter até 2 GB.');
      if (!(file instanceof Blob)) return refuse('read_failed','Escolha um arquivo deste computador.');
      const upload = uploads.get(file) ?? { key: crypto.randomUUID() };
      uploads.set(file,upload);
      let retried = false;
      try {
        options.onProgress?.(0,'Enviando arquivo');
        if (!upload.id) {
          const data = new FormData(); data.set('file',file,file.name);
          const response = await fetch('/api/reporter/files',{ method: 'POST',headers: { 'x-reporter-client': 'local','idempotency-key': upload.key },body: data,signal: options.signal });
          const result = await response.json();
          if (!response.ok) return refuse('read_failed',result.message ?? 'Não foi possível enviar o arquivo.');
          upload.id = result.id;
        }
        for (;;) {
          options.signal?.throwIfAborted();
          const state = await reporterRequest<{ transcript: Transcript; worker_online: boolean }>('/transcripts/'+upload.id,undefined,options.signal);
          const transcript = state.transcript;
          if (!transcript) return refuse('read_failed','Transcrição não encontrada.');
          if (transcript.status === 'ready') {
            const text = transcriptFileText(transcript);
            options.onProgress?.(100,'Transcrição concluída');
            return ok({ text,fileName: file.name,format: detectTranscriptFormat(text,textFile ? file.name : 'transcript.srt'),bytes: file.size,transcriptId: transcript.id });
          }
          if (transcript.status === 'failed') {
            if (!retried && state.worker_online) {
              retried = true;
              const response = await fetch('/api/reporter/transcripts/'+transcript.id+'/retry',{ method: 'POST',headers: { 'content-type': 'application/json','x-reporter-client': 'local','idempotency-key': upload.key+'-retry-'+transcript.revision },body: JSON.stringify({ revision: transcript.revision }),signal: options.signal });
              if (response.ok) continue;
            }
            return refuse('read_failed','Não foi possível transcrever. Código: '+(transcript.error_code ?? 'TRANSCRIPTION_FAILED'));
          }
          if (!state.worker_online) return refuse('read_failed','O worker está desligado. Inicie pnpm worker e tente de novo; o arquivo já está salvo.');
          const progress = transcript.job?.progress;
          options.onProgress?.(progress?.total ? Math.round(progress.done/progress.total*90) : 0,
            progress?.phase === 'transcribing' ? `Transcrevendo trechos ${Math.min((progress.done ?? 0)+1,progress.total)} de ${progress.total}` : 'Preparando áudio para transcrição');
          await new Promise<void>((resolve,reject) => { const timer = setTimeout(() => { options.signal?.removeEventListener('abort',abort); resolve(); },1000); const abort = () => { clearTimeout(timer); reject(new Error('Leitura cancelada.')); }; options.signal?.addEventListener('abort',abort,{ once: true }); });
        }
      } catch (error) { return refuse('read_failed',error instanceof Error ? error.message : 'Não foi possível processar o arquivo.'); }
    },
  };
}
