import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultEditorialPolicy, editorialSystemPrompt, reviseEditorialPolicy } from './editorial-policy.ts';
import { defaultPipelineDefinition, formatPipelineDefinition, pipelineRevision } from './pipeline.ts';

const actor = { at: '2026-10-21T12:00:00.000Z', by: 'Workspace editor' };

test('a new workspace starts without fabricated editorial rules or references', () => {
  const policy = defaultEditorialPolicy();
  assert.equal(policy.map.version, 0);
  assert.equal(policy.guide.version, 0);
  assert.equal(policy.map.updatedBy, '');
  assert.equal(policy.guide.voice, '');
  assert.deepEqual(policy.map.trusted, []);
  assert.deepEqual(policy.guide.examples, []);
  assert.equal(reviseEditorialPolicy(undefined, policy, actor), undefined);
});

test('each editorial document gets its own server-owned version and author only after content changes', () => {
  const draft = defaultEditorialPolicy();
  draft.map.audience = 'Fish industry professionals';
  draft.map.version = 999;
  draft.map.updatedBy = 'Forged author';
  const first = reviseEditorialPolicy(undefined, draft, actor)!;
  assert.equal(first.map.version, 1);
  assert.equal(first.map.updatedBy, actor.by);
  assert.equal(first.map.updatedAt, actor.at);
  assert.equal(first.guide.version, 0);
  const next = structuredClone(first);
  next.guide.dek = 'Complement the title with a sourced fact.';
  const second = reviseEditorialPolicy(first, next, { ...actor, by: 'Second editor' })!;
  assert.deepEqual(second.map, first.map);
  assert.equal(second.guide.version, 1);
  assert.equal(second.guide.updatedBy, 'Second editor');
  assert.equal(first.guide.dek, '');
});

test('metadata edits, optional empty fields and omitted policy cannot erase or revise settings', () => {
  const draft = defaultEditorialPolicy();
  draft.guide.voice = 'Precise and factual';
  const current = reviseEditorialPolicy(undefined, draft, actor)!;
  const forged = structuredClone(current);
  forged.guide.version = 900;
  forged.guide.updatedAt = '2099-01-01T00:00:00.000Z';
  forged.guide.updatedBy = 'Another person';
  delete forged.guide.dek;
  forged.guide.composition = { paragraphs: '' };
  assert.deepEqual(reviseEditorialPolicy(current, forged, actor), current);
  const preserved = reviseEditorialPolicy(current, undefined, actor)!;
  assert.deepEqual(preserved, current);
  preserved.guide.voice = 'Mutated client copy';
  assert.equal(current.guide.voice, 'Precise and factual');
});

test('writing policy is deterministic, preserves literal braces and stays out of unrelated tasks', () => {
  const policy = defaultEditorialPolicy();
  policy.guide.voice = 'Preserve the label {{source}}.';
  policy.guide.examples = [{ id: 'example', title: 'Reference', url: 'https://example.org/article', note: 'Attribute company claims.' }];
  const system = editorialSystemPrompt('Task contract', policy, 'article');
  assert.ok(system.includes('{{source}}'));
  assert.ok(system.includes('seus links não foram consultados'));
  assert.ok(system.includes('nunca à alteração de citações'));
  assert.equal(system, editorialSystemPrompt('Task contract', structuredClone(policy), 'article'));
  assert.equal(editorialSystemPrompt('Task contract', policy, 'carousel'), system);
  for (const step of ['material', 'images']) assert.equal(editorialSystemPrompt('Task contract', policy, step), 'Task contract');
  assert.equal(editorialSystemPrompt('Task contract', undefined, 'article'), 'Task contract');
});

test('queued revisions and event funnels retain an immutable policy snapshot', () => {
  const definition = defaultPipelineDefinition();
  definition.editorial = defaultEditorialPolicy();
  definition.editorial.guide.voice = 'Initial guide';
  const queued = pipelineRevision(definition, 3);
  definition.editorial.guide.voice = 'Next guide';
  assert.equal(queued.definition.editorial?.guide.voice, 'Initial guide');
  assert.notEqual(queued.hash, pipelineRevision(definition, 4).hash);
  assert.equal(formatPipelineDefinition(queued.definition, 'stand').editorial?.guide.voice, 'Initial guide');
});
