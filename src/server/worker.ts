import "server-only";
import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { audioChunks, mergeSegments, type Segment } from "../domain/reporter";
import { assertLocalMode, groqKey } from "./config";
import { pool, transaction } from "./database";
import { FlowError, logEvent, safeCode } from "./errors";
import { generateEditorial, transcribeChunk, transcriptionModel, type ProviderResult } from "./groq";
import { inspectMedia, prepareChunk } from "./media";
import { cacheRead, cacheWrite, storageRoot, verifySource, workDirectory } from "./storage";
import { runEditorialJob } from './editorial-worker';
import { reporterDeploymentMode } from './deployment.ts';

type Job = { id: string; attempts: number; processed_at: string | null; payload: {
  entity_type: "transcript" | "article" | "carousel"; generation_id: string;
} };
const owner = "reporter-" + randomUUID();
let stopping = false, active: AbortController | undefined;
for (const signal of ["SIGINT","SIGTERM"] as const) process.on(signal, () => { stopping = true; active?.abort(); });

async function jobCommand(name: string, values: unknown[]) {
  const allowed = new Set(["reporter_claim","reporter_start","reporter_renew","reporter_complete","reporter_worker_input","reporter_progress","reporter_defer"]);
  if (!allowed.has(name)) throw new Error("UNKNOWN_JOB_COMMAND");
  return transaction("worker", async client => (await client.query("SELECT * FROM public." + name + "(" +
    values.map((_, i) => "$" + (i + 1)).join(",") + ")", values)).rows);
}

async function processJob(job: Job, signal: AbortSignal): Promise<ProviderResult> {
  const [row] = await jobCommand("reporter_worker_input", [job.id, owner, job.attempts]);
  const input = row.reporter_worker_input;
  const directory = await workDirectory(job.payload.generation_id);
  const progress = (phase: string, done: number, total: number) => jobCommand("reporter_progress", [job.id, owner, job.attempts, phase, done, total]).then(() => {});
  if (job.payload.entity_type !== "transcript") {
    const source = z.object({ content: z.string().min(1).max(1048576), title: z.string().optional() }).parse(input);
    return generateEditorial(job.payload.entity_type, (source.title ? source.title + "\n\n" : "") + source.content,
      directory, signal, (done, total) => progress(job.payload.entity_type === "article" ? "writing" : "slides", done, total));
  }
  const media = z.object({ key: z.string(), size: z.union([z.string(),z.number()]), checksum_sha256: z.string(),
    content_type: z.string(), provider: z.literal("local"), language: z.string() }).parse(input);
  await progress("preparing", 0, 1);
  const source = await verifySource(media.key, Number(media.size), media.checksum_sha256);
  const { duration } = await inspectMedia(source, signal);
  const chunks = audioChunks(duration);
  let segments: Segment[] = [], allTimed = true, units: number | null = 0;
  const textParts: string[] = [];
  let requestId: string | null = null;
  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) throw new FlowError("JOB_INTERRUPTED", 503, true);
    await progress("transcribing", i, chunks.length);
    let result = await cacheRead<ProviderResult>(directory, "chunk-" + i);
    if (!result || result.model !== transcriptionModel()) {
      const chunkPath = join(directory, "chunk-" + i + ".flac");
      try {
        await prepareChunk(source, chunkPath, chunks[i].start, chunks[i].duration, signal);
        if (!(await stat(chunkPath)).size) throw new FlowError("EMPTY_AUDIO", 422);
        result = await transcribeChunk(chunkPath, media.language, signal);
        await cacheWrite(directory, "chunk-" + i, result);
      } finally { await rm(chunkPath, { force: true }).catch(() => {}); }
    }
    requestId = result.provider_request_id;
    units = units === null || result.input_units === null ? null : units + result.input_units;
    textParts.push(result.content ?? "");
    if (!result.segments) allTimed = false;
    else segments = mergeSegments(segments, result.segments, chunks[i].start);
    await progress("transcribing", i + 1, chunks.length);
  }
  const content = allTimed && segments.length ? segments.map(item => item.text).join(" ") : textParts.join("\n\n").trim();
  if (!content.trim()) throw new FlowError("NO_SPEECH_DETECTED", 422);
  if (Buffer.byteLength(content) > 1048576 || Buffer.byteLength(JSON.stringify(segments)) > 2097152) throw new FlowError("TRANSCRIPT_TOO_LARGE", 422);
  return { content, segments: allTimed ? segments : null, provider: "groq", model: transcriptionModel(),
    provider_request_id: requestId, usage_unit: "audio_ms", input_units: units, output_units: null };
}

async function runOne() {
  const [claimed] = await jobCommand("reporter_claim", [owner]);
  if (!claimed) return false;
  const [job] = await jobCommand("reporter_start", [claimed.id, owner]) as Job[];
  if (!job || job.processed_at) return true;
  active = new AbortController();
  const controller = active;
  let renewal: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = jobCommand("reporter_renew", [job.id, owner]).catch(() => controller.abort()).finally(() => { renewal = null; });
  }, 15000);
  const started = Date.now();
  logEvent("worker", "job_started", { job_id: job.id, generation_id: job.payload.generation_id });
  try {
    const result = await processJob(job, controller.signal);
    if (controller.signal.aborted) throw new FlowError("JOB_INTERRUPTED", 503, true);
    await jobCommand("reporter_complete", [job.id, owner, job.attempts, { ...result, duration_ms: Date.now() - started }]);
    logEvent("worker", "job_completed", { job_id: job.id, duration_ms: Date.now() - started });
  } catch (error) {
    const code = safeCode(error);
    const terminal = error instanceof FlowError && !error.retryable || error instanceof z.ZodError;
    try {
      if (terminal) await jobCommand("reporter_complete", [job.id, owner, job.attempts, {
        error_code: error instanceof z.ZodError ? "INVALID_JOB_INPUT" : code, duration_ms: Date.now() - started,
      }]);
      else await jobCommand("reporter_defer", [job.id, owner, job.attempts, code === "40001" ? "LEASE_LOST" : code,
        error instanceof FlowError ? error.waitSeconds : 5]);
    } catch { /* Lost leases are recovered by the durable queue, never forced. */ }
    logEvent("worker", "job_failed", { job_id: job.id, error_code: code });
  } finally {
    clearInterval(timer); await renewal; active = undefined;
  }
  return true;
}

async function main() {
  const local = reporterDeploymentMode() === 'local';
  if (local) assertLocalMode();
  groqKey();
  const root = await storageRoot();
  const heartbeat = () => (local
    ? cacheWrite(root, "worker", { timestamp: Date.now(), owner })
    : transaction('worker',async client => { await client.query('SELECT public.reporter_worker_heartbeat($1)',[owner]); })).catch(() => {});
  await heartbeat(); const timer = setInterval(heartbeat, 5000);
  logEvent("worker", "worker_started");
  try {
    while (!stopping) {
      try {
        if (!await runOne()) {
          active = new AbortController();
          if (!await runEditorialJob(owner,active.signal)) await delay(1000);
          active = undefined;
        }
      }
      catch (error) { logEvent("worker", "queue_unavailable", { error_code: safeCode(error) }); await delay(5000); }
    }
  } finally { clearInterval(timer); await pool("worker").end(); logEvent("worker", "worker_stopped"); }
}
main().catch(error => { logEvent("worker", "startup_failed", { error_code: safeCode(error) }); process.exitCode = 1; });
