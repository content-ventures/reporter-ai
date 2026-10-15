import 'server-only';
import { rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { audioChunks,mergeSegments,type Segment } from '../domain/reporter.ts';
import { signedSourceUrl } from './cloud-storage.ts';
import { withCloudMediaSource } from './cloud-media-source.ts';
import { transaction } from './database.ts';
import { FlowError,logEvent,safeCode } from './errors.ts';
import { generateEditorial,transcribeChunk,transcriptionModel,type ProviderResult } from './groq.ts';
import { inspectMedia,prepareChunk } from './media.ts';
import { cacheRead,cacheWrite,verifySource,workDirectory } from './storage.ts';

type Job = { id: string;attempts: number;processed_at: string | null;payload: {
  entity_type: 'transcript' | 'article' | 'carousel';generation_id: string;
} };

async function jobCommand(name: string,values: unknown[]) {
  const allowed = new Set(['reporter_claim','reporter_start','reporter_renew','reporter_complete','reporter_worker_input','reporter_progress','reporter_defer']);
  if (!allowed.has(name)) throw new Error('UNKNOWN_JOB_COMMAND');
  return transaction('worker',async client => (await client.query('SELECT * FROM public.'+name+'('+values.map((_,i) => '$'+(i+1)).join(',')+')',values)).rows);
}

export async function processTranscript(input: unknown,directory: string,signal: AbortSignal,progress: (phase: string,done: number,total: number) => Promise<void>, services = {
  signedSourceUrl, verifySource, inspectMedia, prepareChunk, transcribeChunk, withCloudMediaSource,
}) {
  const media = z.discriminatedUnion('provider',[
    z.object({ key: z.string(),size: z.union([z.string(),z.number()]),checksum_sha256: z.string(),content_type: z.string(),provider: z.literal('local'),language: z.string() }),
    z.object({ key: z.string(),bucket: z.string(),size: z.union([z.string(),z.number()]),content_type: z.string(),provider: z.literal('s3'),language: z.string() }),
  ]).parse(input);
  await progress('preparing',0,1);
  const remote = media.provider === 's3';
  const transcribe = async (source: string) => {
  const { duration } = await services.inspectMedia(source,signal,remote);
  const chunks = audioChunks(duration);
  let segments: Segment[] = [],allTimed = true,units: number | null = 0;
  const textParts: string[] = [];
  let requestId: string | null = null;
  for (let i=0;i<chunks.length;i++) {
    if (signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true);
    await progress('transcribing',i,chunks.length);
    let result = await cacheRead<ProviderResult>(directory,'chunk-'+i);
    if (!result || result.model!==transcriptionModel()) {
      const chunkPath = join(directory,'chunk-'+i+'.flac');
      try {
        await services.prepareChunk(source,chunkPath,chunks[i].start,chunks[i].duration,signal,remote);
        if (!(await stat(chunkPath)).size) throw new FlowError('EMPTY_AUDIO',422);
        result = await services.transcribeChunk(chunkPath,media.language,signal);
        await cacheWrite(directory,'chunk-'+i,result);
      } finally { await rm(chunkPath,{ force: true }).catch(() => {}); }
    }
    requestId = result.provider_request_id;
    units = units===null || result.input_units===null ? null : units+result.input_units;
    textParts.push(result.content ?? '');
    if (!result.segments) allTimed = false;
    else segments = mergeSegments(segments,result.segments,chunks[i].start);
    await progress('transcribing',i+1,chunks.length);
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

async function processJob(job: Job,owner: string,signal: AbortSignal): Promise<ProviderResult> {
  const [row] = await jobCommand('reporter_worker_input',[job.id,owner,job.attempts]);
  const input = row.reporter_worker_input;
  const directory = await workDirectory(job.payload.generation_id);
  const progress = (phase: string,done: number,total: number) => jobCommand('reporter_progress',[job.id,owner,job.attempts,phase,done,total]).then(() => {});
  if (job.payload.entity_type==='transcript') return processTranscript(input,directory,signal,progress);
  const source = z.object({ content: z.string().min(1).max(1048576),title: z.string().optional() }).parse(input);
  return generateEditorial(job.payload.entity_type,(source.title ? source.title+'\n\n' : '')+source.content,
    directory,signal,(done,total) => progress(job.payload.entity_type==='article' ? 'writing' : 'slides',done,total));
}

/** Claims and settles one durable Reporter ingestion job. Returns false when
 * the queue is empty, allowing the caller to try the editorial queue. */
export async function runReporterJob(owner: string,outerSignal: AbortSignal) {
  const [claimed] = await jobCommand('reporter_claim',[owner]);
  if (!claimed) return false;
  const [job] = await jobCommand('reporter_start',[claimed.id,owner]) as Job[];
  if (!job || job.processed_at) return true;
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
    const result = await processJob(job,owner,controller.signal);
    if (controller.signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true);
    await jobCommand('reporter_complete',[job.id,owner,job.attempts,{ ...result,duration_ms: Date.now()-started }]);
    logEvent('worker','job_completed',{ job_id: job.id,duration_ms: Date.now()-started });
  } catch (error) {
    const code = safeCode(error);
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
