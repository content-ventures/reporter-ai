import type { PipelineDefinition, PipelineRevision, PipelineView } from '../domain/pipeline.ts';
import type { WritingTrace } from '../domain/writing-orchestration.ts';
import type { Result } from '../domain/result.ts';

export type PipelineSettings = {
  get(): Promise<PipelineView>;
  getWritingRun?(runId: string): Promise<WritingRunDetails>;
  save(definition: PipelineDefinition, baseRevision: number): Promise<Result<PipelineView, 'conflict' | 'invalid_config' | 'unavailable'>>;
};

export type WritingRunDetails = {
  runId: string; productionId: string; status: string;
  pipeline: PipelineRevision; traces: WritingTrace[]; error?: string;
};
