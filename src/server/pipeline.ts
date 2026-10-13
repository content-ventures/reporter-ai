import 'server-only';
import { z } from 'zod';
import { PIPELINE_MODELS, PIPELINE_STEP_KEYS, defaultPipelineDefinition, pipelineRevision, validatePipelineTemplates, pipelineTokenLimit } from '../domain/pipeline.ts';
import type { PipelineDefinition, PipelineRevision, PipelineView } from '../domain/pipeline.ts';
import type { EditorialCheckpoint } from '../ports/connected-workspace.ts';
import { generationModel } from './groq';
import { providerConfigured } from './config';

const step = z.object({ prompt: z.string().min(1).max(20000),model: z.enum(PIPELINE_MODELS),
  temperature: z.number().min(0).max(2),maxTokens: z.number().int().min(512).max(32768) }).strict();
export const pipelineDefinitionSchema = z.object({ systemPrompt: z.string().min(1).max(12000),
  articleMode: z.enum(['sequential','single']),curateQuotes: z.boolean(),steps: z.record(z.enum(PIPELINE_STEP_KEYS),step) }).strict();

export function activePipeline(checkpoint: EditorialCheckpoint): PipelineRevision {
  if (checkpoint.pipeline) return checkpoint.pipeline;
  const configured = generationModel();
  return pipelineRevision(defaultPipelineDefinition(PIPELINE_MODELS.find(model => model === configured) ?? PIPELINE_MODELS[0]));
}

export function pipelineView(checkpoint: EditorialCheckpoint): PipelineView {
  return { active: activePipeline(checkpoint),history: checkpoint.pipelineHistory ?? [],
    providers: { groq: providerConfigured('groq'), openai: providerConfigured('openai'), anthropic: providerConfigured('anthropic') },
    runs: Object.values(checkpoint.jobs).filter(job => job.pipeline)
      .sort((a,b) => (checkpoint.state.runFolds[b.meta.runId]?.run.createdAt ?? '').localeCompare(checkpoint.state.runFolds[a.meta.runId]?.run.createdAt ?? ''))
      .slice(0,20).map(job => ({
      runId: job.meta.runId,productionId: job.meta.productionId,label: job.meta.label,
      status: checkpoint.state.runFolds[job.meta.runId]?.run.status ?? 'unknown',
      pipelineRevision: job.pipeline!.revision,pipelineHash: job.pipeline!.hash,calls: job.calls ?? [],
    })) };
}

export function parsePipelineDefinition(input: unknown): { definition?: PipelineDefinition; error?: string } {
  const parsed = pipelineDefinitionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Confira os campos: prompts não vazios, modelo compatível, temperatura de 0 a 2 e limite de tokens permitido para o modelo.' };
  if (Object.values(parsed.data.steps).some(step => step.model.startsWith('anthropic/') && step.temperature > 1))
    return { error: 'Claude aceita temperatura de 0 a 1. Ajuste a etapa antes de ativar.' };
  if (Object.values(parsed.data.steps).some(step => step.maxTokens > pipelineTokenLimit(step.model)))
    return { error: 'O limite de tokens excede o permitido para o modelo da etapa.' };
  const error = validatePipelineTemplates(parsed.data);
  return error ? { error } : { definition: parsed.data };
}
