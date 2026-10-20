import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseTranscript } from '../domain/text/transcript-parse.ts';
import type { ParsedSegment, ParseTranscriptOptions } from '../domain/text/transcript-parse.ts';
import { PIPELINE_SCHEMAS, renderPipelinePrompt } from '../domain/pipeline.ts';
import type { PipelineRevision, PipelineVariables } from '../domain/pipeline.ts';
import type { MaterialInsights } from '../ports/source-ingest.ts';
import { editorialTransaction } from './editorial';
import { activePipeline } from './pipeline';
import { generateStructured } from './groq';
import { cacheRead, cacheWrite, storageRoot } from './storage';
import { FlowError } from './errors';

const insightSchema = z.object({ title: z.string().trim().min(1).max(120), participants: z.array(z.object({
  name: z.string().trim().min(1).max(80), title: z.string().trim().max(80), organization: z.string().trim().max(80),
  segmentId: z.string().min(1).max(128), excerpt: z.string().trim().min(1).max(500),
}).strict()).max(12) }).strict();

/** Metadata only: keep the opening, ending and distributed passages, never reassign voices. */
export function materialSample(segments: readonly ParsedSegment[], budget = 10000): ParsedSegment[] {
  const selected = new Map<string, ParsedSegment>(); let used = 0;
  const take = (segment: ParsedSegment | undefined, ceiling = budget) => {
    if (!segment || selected.has(segment.id)) return;
    const size = segment.text.length + segment.id.length + 16;
    if (used + size > ceiling) return;
    selected.set(segment.id, segment); used += size;
  };
  for (const segment of segments) { take(segment, budget * 0.4); if (used >= budget * 0.35) break; }
  const openingSize = used;
  for (const segment of [...segments].reverse()) { take(segment, openingSize + budget * 0.2); if (used - openingSize >= budget * 0.15) break; }
  for (let anchor = 1; anchor < 9; anchor++) {
    const center = Math.floor(segments.length * anchor / 9);
    for (let offset = 0; offset < 3; offset++) take(segments[center + offset]);
  }
  for (const segment of segments) take(segment);
  return segments.filter(segment => selected.has(segment.id));
}

export function validateMaterialInsights(value: unknown, segments: readonly ParsedSegment[]) {
  const parsed = insightSchema.safeParse(value);
  if (!parsed.success) throw new FlowError('MATERIAL_ANALYSIS_INVALID', 502);
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  const seen = new Set<string>();
  const participants = parsed.data.participants.filter(person => {
    const key = person.name.normalize('NFC').toLocaleLowerCase('pt-BR');
    if (seen.has(key) || !person.excerpt.includes(person.name) || !byId.get(person.segmentId)?.text.includes(person.excerpt)) return false;
    seen.add(key); return true;
  }).map(person => ({ ...person, title: person.excerpt.includes(person.title) ? person.title : '',
    organization: person.excerpt.includes(person.organization) ? person.organization : '' }));
  return { title: parsed.data.title, participants };
}

const pending = new Map<string, Promise<MaterialInsights>>();
export async function runMaterialAnalysis(text: string, options: ParseTranscriptOptions, pipeline: PipelineRevision, directory: string): Promise<MaterialInsights> {
  const segments = parseTranscript(text, options).segments;
  if (!segments.length) throw new FlowError('EMPTY_EDITORIAL_SOURCE', 422);
  const sample = materialSample(segments), step = pipeline.definition.steps.material;
  if (!step) throw new FlowError('PIPELINE_STAGE_MISSING', 503);
  const hash = createHash('sha256').update(JSON.stringify({ version: 1, text, segments, pipeline: pipeline.hash })).digest('hex');
  const key = 'material-' + hash;
  const cached = await cacheRead<MaterialInsights>(directory, key);
  if (cached) return { ...validateMaterialInsights({ title: cached.title, participants: cached.participants }, sample), pipelineRevision: pipeline.revision };
  if (pending.has(directory + key)) return pending.get(directory + key)!;
  const execute = async () => {
    const variables: PipelineVariables = { source: sample.map(segment => `[${segment.id}] ${segment.text}`).join('\n'),
      brief: '', sizing: '', outline: '', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '', people: '' };
    const result = await generateStructured('', '', PIPELINE_SCHEMAS.material, AbortSignal.timeout(180000), {
      ...step, systemPrompt: pipeline.definition.systemPrompt, userPrompt: renderPipelinePrompt(step.prompt, variables),
    });
    const insights = { ...validateMaterialInsights(result.value, sample), pipelineRevision: pipeline.revision };
    await cacheWrite(directory, key, insights);
    return insights;
  };
  const promise = execute(); pending.set(directory + key, promise);
  try { return await promise; } finally { pending.delete(directory + key); }
}

export async function analyzeMaterial(text: string, options: ParseTranscriptOptions) {
  // Only the workspace and its active pipeline: no production is read.
  const pipeline = (await editorialTransaction('runtime', async checkpoint => structuredClone(activePipeline(checkpoint)), false, 'reporter.edit', {})).value;
  return runMaterialAnalysis(text, options, pipeline, await storageRoot());
}
