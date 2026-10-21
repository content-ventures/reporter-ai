import 'server-only';
import { z } from 'zod';
import { FUNNEL_STEP_KEYS, PIPELINE_MODELS, PIPELINE_STEP_KEYS, defaultPipelineDefinition, pipelineRevision, validatePipelineTemplates, pipelineTokenLimit, pipelineJobKeys, pipelineModelReasons, pipelineModelEffortOptions } from '../domain/pipeline.ts';
import { EDITORIAL_FORMATS } from '../domain/formats.ts';
import type { PipelineDefinition, PipelineRevision, PipelineView } from '../domain/pipeline.ts';
import type { EditorialCheckpoint, EditorialJob } from '../ports/connected-workspace.ts';
import type { GenerationKind } from '../ports/generation.ts';
import { WRITING_STAGES } from '../domain/writing-orchestration.ts';
import { generationModel } from './groq';
import { providerConfigured } from './config';
import { tavilyConfigured } from './tavily';
import { COMPOSITION_KEYS } from '../domain/editorial-policy.ts';

const policyText = z.string().max(4000);
const policyLabel = z.string().trim().min(1).max(300);
const policyId = z.string().min(1).max(128);
const policyMetadata = { version: z.number().int().min(0).max(1000000), updatedAt: z.iso.datetime(), updatedBy: z.string().max(300) };
const policyUrl = z.string().trim().max(2048).url().refine(value => /^https?:\/\//i.test(value), 'Use um link HTTP ou HTTPS.');
export const editorialPolicySchema = z.object({
  map: z.object({ ...policyMetadata, audience: policyText, regions: z.array(policyLabel).max(30),
    topics: z.array(z.object({ id: policyId, label: policyLabel, weight: z.enum(['core', 'regular', 'occasional']) }).strict()).max(50),
    exclusions: z.array(policyLabel).max(50), trusted: z.array(policyLabel).max(50), blocked: z.array(policyLabel).max(50) }).strict(),
  guide: z.object({ ...policyMetadata, voice: policyText, headline: policyText, dek: policyText.optional(), lead: policyText, attribution: policyText,
    composition: z.partialRecord(z.enum(COMPOSITION_KEYS), policyText).optional(),
    rules: z.array(z.object({ id: policyId, text: z.string().trim().min(1).max(1000) }).strict()).max(50),
    terms: z.array(z.object({ avoid: policyLabel, use: policyLabel }).strict()).max(50),
    examples: z.array(z.object({ id: policyId, title: policyLabel, url: policyUrl, note: z.string().max(2000) }).strict()).max(30) }).strict(),
}).strict().refine(value => JSON.stringify(value).length <= 60000, 'Reduza o mapa e o guia para até 60 mil caracteres.');

const step = z.object({ prompt: z.string().min(1).max(20000),model: z.enum(PIPELINE_MODELS),
  temperature: z.number().min(0).max(2),maxTokens: z.number().int().min(512).max(32768),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional() }).strict();
const funnel = z.object(Object.fromEntries(FUNNEL_STEP_KEYS.map(key => [key,step.optional()])) as Record<typeof FUNNEL_STEP_KEYS[number],ReturnType<typeof step.optional>>).strict();
const writing = z.object({ enabled: z.boolean(), maxCorrections: z.union([z.literal(0), z.literal(1)]),
  research: z.object({ enabled: z.boolean(), instructions: z.string().trim().min(1).max(4000),
    maxQueries: z.number().int().min(1).max(3), maxResults: z.number().int().min(1).max(5), maxSources: z.number().int().min(1).max(10),
    timeoutMs: z.number().int().min(5000).max(30000), failureMode: z.enum(['stop', 'continue_original']),
    excludeDomains: z.array(z.string().trim().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)).max(50),
    excludeUrls: z.array(z.string().trim().max(2048).url().refine(value => /^https:\/\//i.test(value))).max(50),
  }).strict().optional(),
  minimumQuotes: z.number().int().min(0).max(5).nullable().optional(),
  maxSourceCharacters: z.number().int().min(4000).max(200000), systemPrompt: z.string().min(1).max(12000),
  reviewCriteria: z.object({ factual: z.string().trim().min(1).max(4000), editorial: z.string().trim().min(1).max(4000),
    preservation: z.string().trim().min(1).max(4000), correction: z.string().trim().min(1).max(4000) }).strict().optional(),
  stages: z.object({ plan: step, write: step, review: step, correct: step }).strict() }).strict();
export const pipelineDefinitionSchema = z.object({ systemPrompt: z.string().min(1).max(12000),
  articleMode: z.enum(['sequential','single']),curateQuotes: z.boolean(),steps: z.record(z.enum(PIPELINE_STEP_KEYS),step),
  funnels: z.partialRecord(z.enum(EDITORIAL_FORMATS),funnel).optional(), editorial: editorialPolicySchema.optional(), writing: writing.optional() }).strict();

export function activePipeline(checkpoint: EditorialCheckpoint): PipelineRevision {
  if (checkpoint.pipeline) return checkpoint.pipeline;
  const configured = generationModel();
  return pipelineRevision(defaultPipelineDefinition(PIPELINE_MODELS.find(model => model === configured) ?? PIPELINE_MODELS[0]));
}

export function pipelineView(checkpoint: EditorialCheckpoint): PipelineView {
  return { active: activePipeline(checkpoint),history: checkpoint.pipelineHistory ?? [],
    providers: { groq: providerConfigured('groq'), openai: providerConfigured('openai'), anthropic: providerConfigured('anthropic'), gemini: providerConfigured('gemini') },
    researchProviders: { tavily: tavilyConfigured() },
    runs: Object.values(checkpoint.jobs).filter(job => job.pipeline)
      .sort((a,b) => (checkpoint.state.runFolds[b.meta.runId]?.run.createdAt ?? '').localeCompare(checkpoint.state.runFolds[a.meta.runId]?.run.createdAt ?? ''))
      .slice(0,20).map(job => ({
      runId: job.meta.runId,productionId: job.meta.productionId,label: job.meta.label,
      status: checkpoint.state.runFolds[job.meta.runId]?.run.status ?? 'unknown',
      pipelineRevision: job.pipeline!.revision,pipelineHash: job.pipeline!.hash,calls: job.calls ?? [],
      ...(job.kind === 'article.draft' && job.pipeline?.definition.writing?.enabled ? { writing: writingSummary(job) } : {}),
    })) };
}

/** The list view stays small; exact prompts, source content and output are fetched on demand. */
function writingSummary(job: EditorialJob) {
  const lastReview = job.writingTraces?.findLast(trace => trace.stage === 'review' && trace.status === 'completed');
  const output = lastReview?.output;
  const decision = output && typeof output === 'object' && 'decision' in output ? output.decision : undefined;
  return { stages: job.writingTraces?.length ?? 0,
    ...(typeof decision === 'string' && ['ready_for_human', 'revise', 'needs_reporting'].includes(decision) ? { decision } : {}) };
}

/** Validate only the models the selected path can call, including a possible correction. */
export function requiredGenerationModels(definition: PipelineDefinition, kind: GenerationKind, automaticOutline: boolean) {
  if (kind === 'article.draft' && definition.writing?.enabled)
    return WRITING_STAGES.filter(stage => stage !== 'correct' || definition.writing!.maxCorrections > 0).map(stage => definition.writing!.stages[stage].model);
  return pipelineJobKeys(definition, kind, automaticOutline).map(key => definition.steps[key].model);
}

export function parsePipelineDefinition(input: unknown): { definition?: PipelineDefinition; error?: string } {
  const parsed = pipelineDefinitionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues.some(issue => issue.path[0] === 'editorial')
    ? 'Confira o mapa e o guia: preencha os itens adicionados, use links HTTP ou HTTPS e respeite os limites dos campos.'
    : parsed.error.issues.some(issue => issue.path[0] === 'writing' && issue.path[1] === 'reviewCriteria')
    ? 'Preencha os quatro critérios de revisão, com até 4.000 caracteres em cada campo.'
    : parsed.error.issues.some(issue => issue.path[0] === 'writing' && issue.path[1] === 'minimumQuotes')
    ? 'O mínimo de citações diretas deve ser um número inteiro de 0 a 5.'
    : parsed.error.issues.some(issue => issue.path[0] === 'writing' && issue.path[1] === 'research')
    ? 'Confira a pesquisa: instruções preenchidas, limites permitidos, domínios sem caminhos e URLs HTTPS.'
    : 'Confira os campos: prompts não vazios, modelo compatível, temperatura de 0 a 2 e limite de tokens permitido para o modelo.' };
  const steps = [...Object.values(parsed.data.steps),...Object.values(parsed.data.funnels ?? {}).flatMap(funnel => funnel ? Object.values(funnel) : []),
    ...Object.values(parsed.data.writing?.stages ?? {})];
  if (steps.some(step => step.model.startsWith('anthropic/') && !pipelineModelReasons(step.model) && step.temperature > 1))
    return { error: 'Claude aceita temperatura de 0 a 1. Ajuste a etapa antes de ativar.' };
  if (steps.some(step => step.effort !== undefined && !pipelineModelEffortOptions(step.model).includes(step.effort)))
    return { error: 'O nível de raciocínio escolhido não é compatível com o modelo da etapa.' };
  if (steps.some(step => step.maxTokens > pipelineTokenLimit(step.model)))
    return { error: 'O limite de tokens excede o permitido para o modelo da etapa.' };
  const error = validatePipelineTemplates(parsed.data);
  return error ? { error } : { definition: parsed.data };
}
