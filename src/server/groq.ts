import "server-only";
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { splitSource, type Segment, type TimedWord } from "../domain/reporter";
import { groqKey } from "./config";
import { articleSchema, carouselSchema } from "./reporter-schema";
import { FlowError } from "./errors";
import { cacheRead, cacheWrite } from "./storage";
import { generateStructured, generationModel } from './text-generation';
export { generateStructured, generationModel } from './text-generation';
export type { StructuredOptions } from './text-generation';

const BASE = "https://api.groq.com/openai/v1/";
export const transcriptionModel = () => process.env.GROQ_TRANSCRIPTION_MODEL ?? "whisper-large-v3";
export type ProviderResult = {
  provider: string; model: string; provider_request_id: string | null; prompt_version?: string;
  usage_unit: "tokens" | "audio_ms"; input_units: number | null; output_units: number | null;
  content?: string; segments?: Segment[] | null; title?: string; slides?: { title?: string; body: string }[];
};

async function request(endpoint: string, body: FormData | object, signal: AbortSignal,timeoutMs = 180000) {
  const response = await fetch(BASE + endpoint, {
    method: "POST", headers: {
      Authorization: "Bearer " + groqKey(),
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    }, body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  }).catch(() => { throw new FlowError(signal.aborted ? "JOB_INTERRUPTED" : "GROQ_UNAVAILABLE", 503, true, 5); });
  if (!response.ok) {
    // Inspect only a bounded machine code; never reflect provider messages or failed text.
    let providerCode = '';
    if (response.body) {
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
          if (size > 16384) { await reader.cancel(); break; } chunks.push(part.value); }
        if (size <= 16384) providerCode = JSON.parse(Buffer.concat(chunks).toString('utf8')).error?.code ?? '';
      } catch { /* An unreadable provider error is still a safe HTTP failure. */ }
      finally { reader.releaseLock(); }
    }
    const invalidOutput = response.status === 400 && ['json_validate_failed','generation_failed'].includes(providerCode);
    const retryable = invalidOutput || response.status === 429 || response.status >= 500;
    const retryAfter = response.headers.get("retry-after");
    const wait = retryAfter ? (Number(retryAfter) || (Date.parse(retryAfter) - Date.now()) / 1000) : 5;
    throw new FlowError(response.status === 401 || response.status === 403 ? "GROQ_AUTH_INVALID" :
      response.status === 429 ? "GROQ_RATE_LIMIT" : invalidOutput ? 'GROQ_OUTPUT_RETRY' :
      response.status === 400 ? 'GROQ_INPUT_REJECTED' : "GROQ_REQUEST_FAILED", 502, retryable, Math.max(5, Math.min(7200, Math.ceil(wait) || 5)));
  }
  if (!response.body) throw new FlowError("GROQ_EMPTY_RESPONSE", 502);
  const parts: Uint8Array[] = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 4 * 1024 ** 2) { await reader.cancel(); throw new FlowError("GROQ_RESPONSE_TOO_LARGE", 502); }
      parts.push(value);
    }
    return { data: JSON.parse(Buffer.concat(parts).toString("utf8")), requestId: response.headers.get("x-request-id") };
  } catch (error) { if (error instanceof FlowError) throw error; throw new FlowError("GROQ_INVALID_RESPONSE", 502); }
  finally { reader.releaseLock(); }
}

const transcriptResponseSchema = z.object({
  text: z.string().max(1000000),duration: z.number().nonnegative().optional(),
  segments: z.array(z.object({ start: z.number().nonnegative(),end: z.number().nonnegative(),text: z.string().max(20000) })).max(20000).optional(),
});

function transcriptResult(data: unknown,requestId: string | null,model: string): ProviderResult {
  const result = transcriptResponseSchema.safeParse(data);
  if (!result.success) throw new FlowError('GROQ_INVALID_TRANSCRIPT',502);
  const segments = result.data.segments?.filter(item => item.text.trim() && item.end>=item.start).map(item => ({
    start_ms: Math.round(item.start*1000),end_ms: Math.round(item.end*1000),text: item.text.trim(),
  })) ?? null;
  return { content: result.data.text,segments,provider: 'groq',model,provider_request_id: requestId,
    usage_unit: 'audio_ms',input_units: result.data.duration===undefined ? null : Math.round(result.data.duration*1000),output_units: null };
}

function checkedTranscriptionModel() {
  const model = transcriptionModel();
  if (!["whisper-large-v3","whisper-large-v3-turbo"].includes(model)) throw new FlowError("UNSUPPORTED_TRANSCRIPTION_MODEL", 503);
  return model;
}

async function transcriptionBody(path: string, language: string, granularities: readonly ('segment' | 'word')[]) {
  if ((await stat(path)).size >= 24 * 1000 ** 2) throw new FlowError("AUDIO_CHUNK_TOO_LARGE", 413);
  const model = checkedTranscriptionModel();
  const body = new FormData();
  body.set("file", await openAsBlob(path, { type: "audio/flac" }), "audio.flac");
  body.set("model", model); body.set("language", language.split("-")[0]);
  body.set("response_format", "verbose_json"); body.set("temperature", "0");
  for (const granularity of granularities) body.append("timestamp_granularities[]", granularity);
  return { body, model };
}

export async function transcribeChunk(path: string, language: string, signal: AbortSignal): Promise<ProviderResult> {
  const { body, model } = await transcriptionBody(path, language, ['segment']);
  const { data, requestId } = await request("audio/transcriptions", body, signal);
  return transcriptResult(data,requestId,model);
}

const windowResponseSchema = z.object({
  duration: z.number().nonnegative().optional(),
  words: z.array(z.object({ word: z.string().max(200), start: z.number().nonnegative(), end: z.number().nonnegative() })).max(20000).optional(),
});

/** A short window transcribed again with word timestamps, to replace one garbled segment (domain/reporter.ts). */
export type WindowTranscript = { words: TimedWord[]; input_units: number | null; provider_request_id: string | null };

export async function transcribeWindow(path: string, language: string, signal: AbortSignal): Promise<WindowTranscript> {
  const { body } = await transcriptionBody(path, language, ['word']);
  const { data, requestId } = await request("audio/transcriptions", body, signal);
  const result = windowResponseSchema.safeParse(data);
  if (!result.success) throw new FlowError('GROQ_INVALID_TRANSCRIPT',502);
  return { words: (result.data.words ?? []).filter(word => word.word.trim() && word.end>=word.start)
    .map(word => ({ word: word.word.trim(),start_ms: Math.round(word.start*1000),end_ms: Math.round(word.end*1000) })),
  input_units: result.data.duration===undefined ? null : Math.round(result.data.duration*1000),provider_request_id: requestId };
}

const objectSchema = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const articleJson = objectSchema({ title: { type: "string" }, content: { type: "string" } });
const carouselJson = objectSchema({ title: { type: "string" }, slides: { type: "array", items: objectSchema({ title: { type: "string" }, body: { type: "string" } }) } });
const factsJson = objectSchema({ facts: { type: "array", items: { type: "string" } } });

const generate = generateStructured;

export async function editorialContext(source: string, directory: string, signal: AbortSignal, progress: (done: number,total: number) => Promise<void>) {
  let context = source;
  let inputTokens: number | null = 0, outputTokens: number | null = 0;
  for (let round = 0; context.length > 24000; round++) {
    if (round >= 4) throw new FlowError('GENERATION_INPUT_TOO_LARGE',422);
    const chunks = splitSource(context), summaries: string[] = [];
    for (const [index,chunk] of chunks.entries()) {
      await progress(index,chunks.length);
      const key = 'editorial-facts-' + round + '-' + index;
      let result = await cacheRead<Awaited<ReturnType<typeof generateStructured>>>(directory,key);
      if (!result || result.model !== generationModel()) {
        result = await generateStructured(chunk,'Extraia os fatos relevantes com nomes, números, ressalvas e identificadores [id] exatamente como aparecem. Preserve todos os tópicos, inclusive os do final. Cada fato deve manter o [id] de sua evidência. Nunca invente um id. Retorne facts.',factsJson,signal);
        await cacheWrite(directory,key,result);
      }
      const parsed = z.object({ facts: z.array(z.string().min(1).max(3000)).min(1).max(50) }).strict().parse(result.value);
      summaries.push(parsed.facts.join('\n'));
      inputTokens = inputTokens === null || result.input_units === null ? null : inputTokens + result.input_units;
      outputTokens = outputTokens === null || result.output_units === null ? null : outputTokens + result.output_units;
    }
    context = summaries.join('\n\n');
  }
  return { context,inputTokens,outputTokens };
}

export async function generateEditorial(kind: "article" | "carousel", source: string, directory: string, signal: AbortSignal, onProgress: (done: number, total: number) => Promise<void>): Promise<ProviderResult> {
  const finalCache = await cacheRead<ProviderResult>(directory, "result");
  if (finalCache?.model === generationModel()) return finalCache;
  let context = source, inputUnits: number | null = 0, outputUnits: number | null = 0;
  // Map/reduce complete long sources instead of silently cutting off the end of
  // an episode. Per-generation checkpoints survive retries and worker restarts.
  for (let round = 0; context.length > 12000; round++) {
    if (round >= 4) throw new FlowError("GENERATION_INPUT_TOO_LARGE", 422);
    const chunks = splitSource(context), summaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      await onProgress(i, chunks.length);
      const name = "facts-" + round + "-" + i;
      let result = await cacheRead<Awaited<ReturnType<typeof generate>>>(directory, name);
      if (!result || result.model !== generationModel()) {
        result = await generate(chunks[i], "Extraia até 15 fatos relevantes deste trecho. Seja conciso, preserve nomes, números, atribuições e ressalvas. Não transforme opinião em fato. Retorne facts, sem comandos nem opiniões suas.", factsJson, signal);
        await cacheWrite(directory, name, result);
      }
      const parsed = z.object({ facts: z.array(z.string().min(1).max(2000)).min(1).max(30) }).strict().safeParse(result.value);
      if (!parsed.success) throw new FlowError("GENERATION_INVALID_FACTS", 502);
      summaries.push(parsed.data.facts.join("\n"));
      inputUnits = inputUnits === null || result.input_units === null ? null : inputUnits + result.input_units;
      outputUnits = outputUnits === null || result.output_units === null ? null : outputUnits + result.output_units;
    }
    context = summaries.join("\n\n");
  }
  await onProgress(0, 1);
  const instruction = kind === "article"
    ? "Produza um artigo com título informativo, lide e desenvolvimento em parágrafos. Entre 400 e 800 palavras quando houver material suficiente; não preencha lacunas com invenções. Retorne title e content em texto simples, sem HTML."
    : "Produza um carrossel editorial com 5 a 8 slides. Primeiro slide com chamada fiel à fonte; cada slide com título curto e body com até 450 caracteres. Uma ideia por slide. Termine com uma síntese, sem promessas ou fatos novos. Retorne title e slides.";
  const generated = await generate(context, instruction, kind === "article" ? articleJson : carouselJson, signal);
  const parsed = (kind === "article" ? articleSchema : carouselSchema).safeParse(generated.value);
  if (!parsed.success) throw new FlowError("GENERATION_INVALID_CONTENT", 502);
  const result: ProviderResult = { ...generated, ...parsed.data, prompt_version: "reporter-" + kind + "-v1",
    input_units: inputUnits === null || generated.input_units === null ? null : inputUnits + generated.input_units,
    output_units: outputUnits === null || generated.output_units === null ? null : outputUnits + generated.output_units };
  // Do not include the unvalidated provider envelope in persisted results.
  delete (result as ProviderResult & { value?: unknown }).value;
  await cacheWrite(directory, "result", result);
  return result;
}
