import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPipelineDefinition } from './pipeline.ts';
import { pipelineWorkerFlow } from './pipeline-workers.ts';

test('article diagram follows the complete writer and optional quote selection', () => {
  const definition = { ...defaultPipelineDefinition(), articleMode: 'single' as const, curateQuotes: true };
  const nodes = pipelineWorkerFlow('article', definition);
  assert.deepEqual(nodes.map(node => node.id), ['source', 'facts', 'outline', 'quotes', 'article', 'validate', 'images', 'photos', 'save']);
  assert.ok(nodes.find(node => node.id === 'facts')?.condition);
  assert.ok(nodes.find(node => node.id === 'outline')?.condition);
  assert.deepEqual(pipelineWorkerFlow('article', { ...definition, curateQuotes: false }).filter(node => node.prompt).map(node => node.prompt), ['facts', 'outline', 'article', 'images']);
});

test('sequential diagram places introduction before repeated sections', () => {
  const definition = { ...defaultPipelineDefinition(), articleMode: 'sequential' as const, curateQuotes: false };
  assert.deepEqual(pipelineWorkerFlow('article', definition).filter(node => node.prompt).map(node => node.prompt), ['facts', 'outline', 'intro', 'section', 'images']);
});

test('carousel never inherits transcription, outline or article prompts', () => {
  const nodes = pipelineWorkerFlow('carousel', defaultPipelineDefinition());
  assert.deepEqual(nodes.map(node => node.id), ['approved', 'layouts', 'carousel', 'validate', 'save']);
  assert.deepEqual(nodes.filter(node => node.prompt).map(node => node.prompt), ['carousel']);
});
