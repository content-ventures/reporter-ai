import type { PipelineDefinition, PipelineView } from '../domain/pipeline.ts';
import type { Result } from '../domain/result.ts';

export type PipelineSettings = {
  get(): Promise<PipelineView>;
  save(definition: PipelineDefinition, baseRevision: number): Promise<Result<PipelineView, 'conflict' | 'invalid_config' | 'unavailable'>>;
};
