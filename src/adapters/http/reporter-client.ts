import { applyRunEvent, foldRun } from '../../domain/run-events.ts';
import { isRunActive } from '../../domain/run.ts';
import { ok, refuse } from '../../domain/result.ts';
import type { RunEvent } from '../../domain/run-events.ts';
import type { ConnectedWorkspace, WorkspaceRefresh } from '../../ports/connected-workspace.ts';
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

/** A role refusal from the server (FORBIDDEN, or SQL 42501 from an older server); other 403s are access errors. */
export function isForbidden(error: unknown): error is ReporterHttpError {
  return error instanceof ReporterHttpError && FORBIDDEN_CODES.has(error.code);
}

const FORBIDDEN_CODES = new Set(['FORBIDDEN', '42501']);
const forbiddenBody = (value: Record<string,unknown>) => typeof value.error === 'string' && FORBIDDEN_CODES.has(value.error);
const messageOf = (value: Record<string,unknown>, fallback: string) => typeof value.message === 'string' ? value.message : fallback;

async function responseValue(response: Response): Promise<Record<string,unknown>> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Record<string,unknown>; }
  catch {
    return { message: response.status===413
      ? 'Este arquivo não pode passar pelo servidor. Tente novamente pelo upload direto.'
      : 'O servidor respondeu em um formato inesperado. Tente novamente.' };
  }
}

export async function reporterRequest<T>(path = '/workspace', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/reporter'+path,{ method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-reporter-client': 'local',...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    cache: 'no-store',...(body === undefined ? {} : { body: JSON.stringify(body) }),signal: signal ?? AbortSignal.timeout(30000),
  });
  const value = await responseValue(response);
  if (!response.ok) {
    const code = typeof value.error==='string' ? value.error : 'REQUEST_FAILED';
    if (typeof window !== 'undefined') {
      if (code === 'AUTH_REQUIRED') window.location.replace('/auth/sign-in');
      else if (code === 'ACCESS_PENDING' || code === 'EMAIL_NOT_VERIFIED') window.location.replace('/auth/pending');
    }
    throw new ReporterHttpError(typeof value.message === 'string' ? value.message : 'O servidor do Reporter AI não respondeu.',code,response.status);
  }
  return value as T;
}

/** `active` asks the server to also report whether a running generation is stalled. */
export function requestWorkspace(syncToken?: string, active = false): Promise<WorkspaceRefresh> {
  const query = [syncToken ? 'since='+encodeURIComponent(syncToken) : '', active ? 'active=1' : ''].filter(Boolean).join('&');
  return reporterRequest('/workspace'+(query ? '?'+query : ''));
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

function uploadToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

type CloudUpload = { id: string;source_id: string;upload_endpoint: string };
async function functionRequest(endpoint: string,path: string,sourceId: string,token: string,signal?: AbortSignal) {
  const response = await fetch(new URL(path,endpoint.endsWith('/') ? endpoint : endpoint+'/'),{
    method: 'POST',headers: { 'content-type': 'application/json' },body: JSON.stringify({ sourceId,token }),signal,
  });
  const value = await responseValue(response);
  if (!response.ok) throw new ReporterHttpError(typeof value.message==='string' ? value.message : 'Não foi possível preparar o armazenamento do arquivo.',
    typeof value.error==='string' ? value.error : 'UPLOAD_FAILED',response.status);
  return value;
}

async function uploadParts(file: Blob,session: Record<string,unknown>,onProgress?: (progress: number,label?: string,uploadedBytes?: number) => void,signal?: AbortSignal) {
  const partSize = Number(session.partSize);
  const parts = Array.isArray(session.parts) ? session.parts.map(part => part as { number: number;url: string }) : [];
  if (!Number.isSafeInteger(partSize) || partSize<5*1024**2 || !parts.length) throw new ReporterHttpError('A sessão de upload retornou dados inválidos.','UPLOAD_SESSION_INVALID',502);
  let cursor = 0,uploaded = 0;
  const controller = new AbortController(),combined = signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index>=parts.length) return;
      const part = parts[index],start = (part.number-1)*partSize,end = Math.min(file.size,start+partSize);
      if (part.number!==index+1 || typeof part.url!=='string' || end<=start) throw new ReporterHttpError('A sessão de upload retornou partes inválidas.','UPLOAD_SESSION_INVALID',502);
      let response: Response | undefined;
      for (let attempt=0;attempt<3;attempt++) {
        combined.throwIfAborted();
        response = await fetch(part.url,{ method: 'PUT',body: file.slice(start,end),signal: combined }).catch(() => undefined);
        if (response?.ok) break;
        if (attempt<2) await new Promise(resolve => setTimeout(resolve,500*2**attempt));
      }
      if (!response?.ok) throw new ReporterHttpError('Uma parte do arquivo não chegou ao armazenamento. Tente novamente.','UPLOAD_PART_FAILED',503);
      uploaded += end-start;
      onProgress?.(Math.min(84,4+Math.round(uploaded/file.size*80)),`Enviando arquivo · ${Math.round(uploaded/file.size*100)}%`,uploaded);
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(3,parts.length) },worker)); }
  catch (error) { controller.abort('part_failed');throw error; }
}

export function createHttpIngest(local: SourceIngest): SourceIngest {
  const uploads = new WeakMap<object,{ key: string;id?: string;sourceId?: string;token?: string;uploaded?: boolean }>();
  const links = new Map<string,{ key: string; id?: string; provider?: 'youtube' | 'spotify'; title?: string; programName?: string; fileName?: string; bytes?: number; sourceUrl?: string }>();
  return {
    limits: { ...local.limits,extensions: [...local.limits.extensions,'.mp3','.m4a','.mp4','.wav','.ogg','.flac','.webm'],maxBytes: MAX_UPLOAD_BYTES },
    async readLink(url,options = {}) {
      const known = links.get(url) ?? { key: crypto.randomUUID() };
      links.set(url,known);
      let retried = false;
      try {
        options.onProgress?.(4,'Localizando episódio');
        options.onStatus?.({ phase: 'locating',message: 'Localizando episódio' });
        if (!known.id) {
          const response = await fetch('/api/reporter/links',{ method: 'POST',headers: { 'content-type': 'application/json','x-reporter-client': 'local','idempotency-key': known.key },
            body: JSON.stringify({ url }),signal: options.signal });
          const result = await responseValue(response);
          if (!response.ok) return refuse(forbiddenBody(result) ? 'forbidden' : 'read_failed',messageOf(result,'Não foi possível importar este link.'));
          known.provider = result.provider as typeof known.provider;known.title = result.title as string;known.programName = result.programName as string;
          known.fileName = result.fileName as string;known.bytes = result.bytes as number;known.sourceUrl = result.sourceUrl as string;
          if (result.kind==='ready') {
            options.onProgress?.(100,'Legendas importadas');
            options.onStatus?.({ phase: 'ready',message: 'Legendas importadas' });
            return ok({ text: result.text as string,fileName: result.fileName as string,format: detectTranscriptFormat(result.text as string,result.fileName as string),bytes: result.bytes as number,
              sourceUrl: result.sourceUrl as string,provider: result.provider as 'youtube' | 'spotify',title: result.title as string,programName: result.programName as string });
          }
          known.id = result.id as string;
        }
        for (;;) {
          options.signal?.throwIfAborted();
          const state = await reporterRequest<{ transcript: Transcript; worker_online: boolean; stalled?: boolean }>('/transcripts/'+known.id,undefined,options.signal);
          const transcript = state.transcript;
          if (!transcript) return refuse('read_failed','Transcrição não encontrada.');
          if (transcript.status==='ready') {
            const text = transcriptFileText(transcript);
            options.onProgress?.(100,'Transcrição concluída');
            options.onStatus?.({ phase: 'ready',message: 'Transcrição concluída' });
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
          if (state.stalled) options.onStatus?.({ phase: 'preparing',message: 'Aguardando processamento' });
          else options.onStatus?.({ phase: progress?.phase==='transcribing' ? 'transcribing' : 'preparing',
            message: progress?.phase==='transcribing' ? 'Transcrevendo áudio' : 'Importando áudio do episódio',
            ...(progress?.phase==='transcribing' ? { done: progress.done,total: progress.total } : {}) });
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
      } catch (error) {
        if (isForbidden(error)) return refuse('forbidden', error.message);
        return refuse('analysis_failed', error instanceof Error ? error.message : 'Não foi possível analisar o tema e os participantes. Tente novamente.');
      }
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
        if (textFile) {
          options.signal?.throwIfAborted();
          options.onProgress?.(0,'Lendo arquivo');
          options.onStatus?.({ phase: 'reading',message: 'Lendo arquivo' });
          const bytes = await file.arrayBuffer();
          options.signal?.throwIfAborted();
          let text: string;
          try { text = new TextDecoder('utf-8',{ fatal: true }).decode(bytes); }
          catch { return refuse('read_failed','Salve a transcrição em UTF-8.'); }
          if (!text.trim()) return refuse('empty','O arquivo está vazio.');
          if (text.includes('\0')) return refuse('read_failed','A transcrição está inválida.');
          options.onProgress?.(100,'Arquivo lido');
          options.onStatus?.({ phase: 'ready',message: 'Arquivo lido' });
          return ok({ text,fileName: file.name,format: detectTranscriptFormat(text,file.name),bytes: file.size });
        }
        options.onProgress?.(0,'Enviando arquivo');
        options.onStatus?.({ phase: upload.uploaded ? 'preparing' : 'uploading',message: upload.uploaded ? 'Preparando áudio' : 'Enviando arquivo',totalBytes: file.size });
        if (!upload.uploaded) {
          let direct: CloudUpload | undefined;
          if (!textFile) {
            upload.sourceId ??= crypto.randomUUID();
            upload.token ??= uploadToken();
            const prepared = await fetch('/api/reporter/uploads',{ method: 'POST',headers: { 'content-type': 'application/json',
              'x-reporter-client': 'local','idempotency-key': upload.key },body: JSON.stringify({ sourceId: upload.sourceId,token: upload.token,
                name: file.name,size: file.size }),signal: options.signal });
            const value = await responseValue(prepared);
            if (!prepared.ok) return refuse(forbiddenBody(value) ? 'forbidden' : 'read_failed',messageOf(value,'Não foi possível preparar o envio do arquivo.'));
            if (value.mode==='cloud') direct = value as CloudUpload & Record<string,unknown>;
          }
          if (direct) {
            upload.id = direct.id;
            options.onProgress?.(2,'Preparando envio seguro');
            options.onStatus?.({ phase: 'uploading',message: 'Preparando envio seguro',uploadedBytes: 0,totalBytes: file.size });
            const session = await functionRequest(direct.upload_endpoint,'/uploads/start',direct.source_id,upload.token!,options.signal);
            await uploadParts(file,session,(progress,label,uploadedBytes) => {
              options.onProgress?.(progress,label ?? 'Enviando arquivo');
              options.onStatus?.({ phase: 'uploading',message: 'Enviando arquivo',uploadedBytes,totalBytes: file.size });
            },options.signal);
            options.onProgress?.(88,'Confirmando arquivo');
            options.onStatus?.({ phase: 'preparing',message: 'Confirmando arquivo no servidor' });
            await functionRequest(direct.upload_endpoint,'/uploads/complete',direct.source_id,upload.token!,options.signal);
            upload.uploaded = true;
          } else {
            const data = new FormData();data.set('file',file,file.name);
            const response = await fetch('/api/reporter/files',{ method: 'POST',headers: { 'x-reporter-client': 'local','idempotency-key': upload.key },body: data,signal: options.signal });
            const result = await responseValue(response);
            if (!response.ok) return refuse(forbiddenBody(result) ? 'forbidden' : 'read_failed',messageOf(result,'Não foi possível enviar o arquivo.'));
            upload.id = result.id as string;
            upload.uploaded = true;
          }
        }
        for (;;) {
          options.signal?.throwIfAborted();
          const state = await reporterRequest<{ transcript: Transcript; worker_online: boolean; stalled?: boolean }>('/transcripts/'+upload.id,undefined,options.signal);
          const transcript = state.transcript;
          if (!transcript) return refuse('read_failed','Transcrição não encontrada.');
          if (transcript.status === 'ready') {
            const text = transcriptFileText(transcript);
            options.onProgress?.(100,'Transcrição concluída');
            options.onStatus?.({ phase: 'ready',message: 'Transcrição concluída' });
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
          if (state.stalled) options.onStatus?.({ phase: 'preparing',message: 'Aguardando processamento' });
          else options.onStatus?.({ phase: progress?.phase==='transcribing' ? 'transcribing' : 'preparing',
            message: progress?.phase==='transcribing' ? 'Transcrevendo áudio' : 'Preparando áudio para transcrição',
            ...(progress?.phase==='transcribing' ? { done: progress.done,total: progress.total } : {}) });
          options.onProgress?.(progress?.total ? 90+Math.round(progress.done/progress.total*9) : 89,
            progress?.phase === 'transcribing' ? (progress.total===1 ? 'Transcrevendo podcast' : `Transcrevendo trechos ${Math.min((progress.done ?? 0)+1,progress.total)} de ${progress.total}`) : 'Preparando áudio para transcrição');
          await new Promise<void>((resolve,reject) => { const timer = setTimeout(() => { options.signal?.removeEventListener('abort',abort); resolve(); },1000); const abort = () => { clearTimeout(timer); reject(new Error('Leitura cancelada.')); }; options.signal?.addEventListener('abort',abort,{ once: true }); });
        }
      } catch (error) { return refuse('read_failed',error instanceof Error ? error.message : 'Não foi possível processar o arquivo.'); }
    },
  };
}
