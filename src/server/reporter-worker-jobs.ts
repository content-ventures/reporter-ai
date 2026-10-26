import 'server-only';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { bindWorkerJob } from './worker-context.ts';
import { withRegisteredWorkerContext } from './worker-job-context.ts';
import type { WorkerContext } from './worker-context.ts';
import { rm,stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { audioChunks,garbledSegment,MAX_REPAIRS,mergeSegments,repairedText,repairWindow,type Segment } from '../domain/reporter.ts';
import { signedSourceUrl } from './cloud-storage.ts';
import { withCloudMediaSource } from './cloud-media-source.ts';
import { transaction } from './database.ts';
import { FlowError,logEvent,safeCode } from './errors.ts';
import { generateEditorial,transcribeChunk,transcribeWindow,transcriptionModel,type ProviderResult } from './groq.ts';
import { inspectMedia,prepareChunk } from './media.ts';
import { cacheRead,cacheWrite,verifySource,workDirectory } from './storage.ts';

type Job = { id: string;aggregate_id: string;attempts: number;processed_at: string | null;payload: {
  entity_type: 'transcript' | 'article' | 'carousel';generation_id: string;
} };

// Stop starting new audio this long before the invocation budget ends: one chunk can
// spend its 3-minute conversion limit plus the provider call.
const YIELD_MARGIN_MS = 4*60*1000;
type StoredChunk = { start_ms: number;duration_ms: number;result: ProviderResult };
/** Validated provider results per audio chunk, so a later invocation resumes the recording. */
export type ChunkStore = {
  read(): Promise<Map<number,StoredChunk>>;
  save(index: number,startMs: number,durationMs: number,result: ProviderResult): Promise<void>;
};

/** Per-directory store for callers without a fenced job, such as tests and local tools. */
export function directoryChunkStore(directory: string): ChunkStore {
  return {
    async read() {
      const chunks = new Map<number,StoredChunk>();
      for (let index=0; index<1000; index++) {
        const chunk = await cacheRead<StoredChunk>(directory,'chunk-'+index);
        if (!chunk) break;
        chunks.set(index,chunk);
      }
      return chunks;
    },
    save: (index,startMs,durationMs,result) => cacheWrite(directory,'chunk-'+index,{ start_ms: startMs,duration_ms: durationMs,result }),
  };
}

async function jobCommand(name: string,values: unknown[]) {
  const allowed = new Set(['reporter_claim','reporter_start','reporter_renew','reporter_complete','reporter_worker_input','reporter_worker_job_context','reporter_progress','reporter_defer',
    'reporter_transcript_chunks_read','reporter_transcript_chunk_save','reporter_transcript_chunks_clear','reporter_yield']);
  if (!allowed.has(name)) throw new Error('UNKNOWN_JOB_COMMAND');
  return transaction('worker',async client => (await client.query('SELECT * FROM public.'+name+'('+values.map((_,i) => '$'+(i+1)).join(',')+')',values)).rows);
}

/** Fenced by the job lease: a stale invocation can neither read nor write another's chunks. */
function databaseChunkStore(job: Job,owner: string): ChunkStore {
  const model = transcriptionModel();
  return {
    async read() {
      const [row] = await jobCommand('reporter_transcript_chunks_read',[job.id,owner,job.attempts,model]);
      const chunks = row.reporter_transcript_chunks_read as (StoredChunk & { index: number })[];
      return new Map(chunks.map(({ index,...chunk }) => [index,chunk]));
    },
    async save(index,startMs,durationMs,result) {
      await jobCommand('reporter_transcript_chunk_save',[job.id,owner,job.attempts,model,index,startMs,durationMs,result]);
    },
  };
}

const wait = async (ms: number,signal: AbortSignal): Promise<void> => { await sleep(ms,undefined,{ signal }); };
const transcriptServices = { signedSourceUrl, verifySource, inspectMedia, prepareChunk, transcribeChunk, transcribeWindow, withCloudMediaSource, wait };
type TranscriptServices = Omit<typeof transcriptServices,'transcribeWindow' | 'wait'> & Partial<Pick<typeof transcriptServices,'transcribeWindow' | 'wait'>>;
/** Longest rate-limit pause a repair waits for, once; past it the remaining repairs are left out. */
const REPAIR_MAX_WAIT_MS = 30_000;

export async function processTranscript(input: unknown,directory: string,signal: AbortSignal,progress: (phase: string,done: number,total: number) => Promise<void>,
  services: TranscriptServices = transcriptServices, options: { store?: ChunkStore; deadline?: number; now?: () => number } = {}) {
  const store = options.store ?? directoryChunkStore(directory);
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY, now = options.now ?? Date.now;
  const media = z.discriminatedUnion('provider',[
    z.object({ key: z.string(),size: z.union([z.string(),z.number()]),checksum_sha256: z.string(),content_type: z.string(),provider: z.literal('local'),language: z.string() }),
    z.object({ key: z.string(),bucket: z.string(),size: z.union([z.string(),z.number()]),content_type: z.string(),provider: z.literal('s3'),language: z.string() }),
  ]).parse(input);
  await progress('preparing',0,1);
  const remote = media.provider === 's3';
  const transcribe = async (source: string) => {
  const { duration } = await services.inspectMedia(source,signal,remote);
  const chunks = audioChunks(duration);
  const stored = await store.read();
  let segments: Segment[] = [],allTimed = true,units: number | null = 0;
  const textParts: string[] = [];
  let requestId: string | null = null;
  for (let i=0;i<chunks.length;i++) {
    if (signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true);
    await progress('transcribing',i,chunks.length);
    const startMs = Math.round(chunks[i].start*1000),durationMs = Math.round(chunks[i].duration*1000);
    const saved = stored.get(i);
    // Reuse only a result for exactly this audio window and transcription model.
    let result = saved && saved.start_ms===startMs && saved.duration_ms===durationMs
      && saved.result.model===transcriptionModel() ? saved.result : undefined;
    if (!result) {
      if (now()>deadline-YIELD_MARGIN_MS) throw new FlowError('BUDGET_YIELD',503,true);
      const chunkPath = join(directory,'chunk-'+i+'.flac');
      try {
        await services.prepareChunk(source,chunkPath,chunks[i].start,chunks[i].duration,signal,remote);
        if (!(await stat(chunkPath)).size) throw new FlowError('EMPTY_AUDIO',422);
        result = await services.transcribeChunk(chunkPath,media.language,signal);
        await store.save(i,startMs,durationMs,result);
      } finally { await rm(chunkPath,{ force: true }).catch(() => {}); }
    }
    requestId = result.provider_request_id;
    units = units===null || result.input_units===null ? null : units+result.input_units;
    textParts.push(result.content ?? '');
    if (!result.segments) allTimed = false;
    else segments = mergeSegments(segments,result.segments,chunks[i].start);
    await progress('transcribing',i+1,chunks.length);
  }
  // A garbled stretch (domain/reporter.ts) is transcribed again on its own, with word timestamps, and
  // its cut words are completed from the new words spoken inside it; every other word stays as Whisper
  // wrote it the first time, and anything doubtful leaves the segment unchanged. Repairs go one by one: a rate limit is waited out
  // once, then the remaining repairs are left out rather than throttling the next recording.
  if (allTimed) {
    const window = services.transcribeWindow ?? transcribeWindow, pause = services.wait ?? wait;
    let waited = false;
    repairs: for (const index of segments.flatMap((segment,at) => garbledSegment(segment,media.language) ? [at] : []).slice(0,MAX_REPAIRS)) {
      const segment = segments[index],range = repairWindow(segment,duration),windowPath = join(directory,'repair-'+index+'.flac');
      try {
        if (signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true);
        if (now()>deadline-YIELD_MARGIN_MS) break;
        await services.prepareChunk(source,windowPath,range.start,range.duration,signal,remote);
        let repair;
        try { repair = await window(windowPath,media.language,signal); }
        catch (error) {
          const limited = error instanceof FlowError && error.code === 'GROQ_RATE_LIMIT';
          const delay = limited ? Math.max(1,error.waitSeconds)*1000 : 0;
          if (!limited || waited || delay>REPAIR_MAX_WAIT_MS || now()+delay>deadline-YIELD_MARGIN_MS) throw error;
          waited = true;
          await pause(delay,signal);
          repair = await window(windowPath,media.language,signal);
        }
        units = units===null || repair.input_units===null ? null : units+repair.input_units;
        const text = repairedText(segment,repair.words,range.start);
        if (text) segments[index] = { ...segment,text };
        else logEvent('worker','transcript_repair_rejected');
      } catch (error) {
        if (signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true);
        logEvent('worker','transcript_repair_failed',{ error_code: safeCode(error) });
        if (error instanceof FlowError && error.code === 'GROQ_RATE_LIMIT') break repairs;
      } finally { await rm(windowPath,{ force: true }).catch(() => {}); }
    }
  }
  const content = allTimed && segments.length ? segments.map(item => item.text).join(' ') : textParts.join('\n\n').trim();
  if (!content.trim()) throw new FlowError('NO_SPEECH_DETECTED',422);
  if (Buffer.byteLength(content)>1048576 || Buffer.byteLength(JSON.stringify(segments))>2097152) throw new FlowError('TRANSCRIPT_TOO_LARGE',422);
  return { content,segments: allTimed ? segments : null,provider: 'groq',model: transcriptionModel(),
    provider_request_id: requestId,usage_unit: 'audio_ms' as const,input_units: units,output_units: null };
  };
  return media.provider === 's3'
    ? services.withCloudMediaSource(await services.signedSourceUrl(media.bucket, media.key), signal, transcribe)
    : transcribe(await services.verifySource(media.key, Number(media.size), media.checksum_sha256));
}

async function processJob(job: Job,owner: string,signal: AbortSignal,deadline: number): Promise<ProviderResult> {
  const [row] = await jobCommand('reporter_worker_input',[job.id,owner,job.attempts]);
  const input = row.reporter_worker_input;
  const directory = await workDirectory(job.payload.generation_id);
  const progress = (phase: string,done: number,total: number) => jobCommand('reporter_progress',[job.id,owner,job.attempts,phase,done,total]).then(() => {});
  if (job.payload.entity_type==='transcript') return processTranscript(input,directory,signal,progress,undefined,
    { store: databaseChunkStore(job,owner),deadline });
  const source = z.object({ content: z.string().min(1).max(1048576),title: z.string().optional() }).parse(input);
  return generateEditorial(job.payload.entity_type,(source.title ? source.title+'\n\n' : '')+source.content,
    directory,signal,(done,total) => progress(job.payload.entity_type==='article' ? 'writing' : 'slides',done,total));
}

/** Claims and settles one durable Reporter ingestion job. Returns false when
 * the queue is empty, allowing the caller to try the editorial queue, and 'yield'
 * when a long recording handed its job back to continue in a fresh invocation. */
export async function runReporterJob(owner: string,outerSignal: AbortSignal,deadline = Number.POSITIVE_INFINITY): Promise<boolean | 'yield'> {
  return withWorkspaceWork('outbox',owner,outerSignal, scoped => runScoped(owner, scoped, deadline));
}

async function runScoped(owner: string,outerSignal: AbortSignal,deadline = Number.POSITIVE_INFINITY): Promise<boolean | 'yield'> {
  const [claimed] = await jobCommand('reporter_claim',[owner]);
  if (!claimed) return false;
  const [job] = await jobCommand('reporter_start',[claimed.id,owner]) as Job[];
  if (!job || job.processed_at) return true;
  const [context]=await jobCommand('reporter_worker_job_context',[job.id,owner,job.attempts]);
  withRegisteredWorkerContext(context.reporter_worker_job_context as WorkerContext,()=>bindWorkerJob((context.reporter_worker_job_context as WorkerContext).actor!,'outbox',job.id));
  const controller = new AbortController();
  const abort = () => controller.abort(outerSignal.reason);
  outerSignal.addEventListener('abort',abort,{ once: true });
  let renewal: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = jobCommand('reporter_renew',[job.id,owner]).catch(() => controller.abort('lease_lost')).finally(() => { renewal = null; });
  },15000);
  timer.unref?.();
  const started = Date.now();
  logEvent('worker','job_started',{ job_id: job.id,generation_id: job.payload.generation_id });
  try {
    const result = await processJob(job,owner,controller.signal,deadline);
    if (controller.signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true);
    await jobCommand('reporter_complete',[job.id,owner,job.attempts,{ ...result,duration_ms: Date.now()-started }]);
    logEvent('worker','job_completed',{ job_id: job.id,duration_ms: Date.now()-started });
    if (job.payload.entity_type==='transcript') await jobCommand('reporter_transcript_chunks_clear',[job.aggregate_id]).catch(() => {});
  } catch (error) {
    const code = safeCode(error);
    if (code==='BUDGET_YIELD') {
      const [row] = await jobCommand('reporter_yield',[job.id,owner,job.attempts]).catch(() => []);
      if (row?.reporter_yield===true) { logEvent('worker','job_yielded',{ job_id: job.id }); return 'yield'; }
    }
    const terminal = error instanceof FlowError && !error.retryable || error instanceof z.ZodError;
    try {
      if (terminal) await jobCommand('reporter_complete',[job.id,owner,job.attempts,{ error_code: error instanceof z.ZodError ? 'INVALID_JOB_INPUT' : code,duration_ms: Date.now()-started }]);
      else await jobCommand('reporter_defer',[job.id,owner,job.attempts,code==='40001' ? 'LEASE_LOST' : code,error instanceof FlowError ? error.waitSeconds : 5]);
    } catch { /* Durable leases recover interrupted work. */ }
    logEvent('worker','job_failed',{ job_id: job.id,error_code: code });
  } finally {
    clearInterval(timer);await renewal;outerSignal.removeEventListener('abort',abort);
  }
  return true;
}
