import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { defaultPipelineDefinition, PIPELINE_STEP_KEYS, type PipelineDefinition } from '../../domain/pipeline.ts';
import { presetUpgradeView, promptDiffBlocks } from './preset-upgrade-model.ts';

const revisionOne = (): PipelineDefinition => JSON.parse(readFileSync(new URL('../../../tests/fixtures/pipeline-revision-1.json', import.meta.url), 'utf8'));

test('revision 1 shows the change of each of its 11 prompts', () => {
  const view = presetUpgradeView(revisionOne());
  assert.deepEqual(view.changes.map(change => change.key), ['system', ...PIPELINE_STEP_KEYS]);
  for (const change of view.changes) {
    assert.equal(change.added, false, change.key);
    assert.ok(change.blocks.some(block => block.change !== 'unchanged'), change.key);
  }
  // The text the page shows today on the left, preset 3.0 on the right.
  const [tag, ...system] = view.changes[0].blocks;
  assert.equal(tag.change, 'modified');
  assert.deepEqual(tag.hunks.filter(hunk => hunk.kind !== 'equal').map(hunk => `${hunk.kind} ${hunk.text}`), ['delete AI', 'insert IA', 'delete 2', 'insert 3']);
  assert.ok(system.some(block => block.change === 'added' && block.hunks[0].text.startsWith('NOTÍCIA — O PADRÃO')));
});

test('lines are paired as modified; the rest are added or removed, and empty lines are dropped', () => {
  assert.deepEqual(promptDiffBlocks('a\nb', 'a\nc\nd').map(block => block.change), ['unchanged', 'modified', 'added']);
  assert.deepEqual(promptDiffBlocks('a\nb\nc', 'a'), [
    { id: 'line-0', change: 'unchanged', hunks: [{ kind: 'equal', text: 'a' }] },
    { id: 'line-1', change: 'removed', hunks: [{ kind: 'delete', text: 'b' }] },
    { id: 'line-2', change: 'removed', hunks: [{ kind: 'delete', text: 'c' }] },
  ]);
  assert.deepEqual(promptDiffBlocks('Use até 2 ids.\n\nFim', 'Use até 4 ids.\n\nFim')[0].hunks,
    [{ kind: 'equal', text: 'Use até ' }, { kind: 'delete', text: '2' }, { kind: 'insert', text: '4' }, { kind: 'equal', text: ' ids.' }]);
  assert.equal(promptDiffBlocks('a\n\nb', 'a\n\nb').length, 2);
});

test('current defaults give no change', () => {
  assert.deepEqual(presetUpgradeView(defaultPipelineDefinition()).changes, []);
});

test('a step the revision lacks reads as a new step', () => {
  const fixture = revisionOne();
  const steps: Partial<PipelineDefinition['steps']> = { ...fixture.steps };
  delete steps.images;
  const change = presetUpgradeView({ ...fixture, steps: steps as PipelineDefinition['steps'] }).changes.find(item => item.key === 'images');
  assert.equal(change?.added, true);
  assert.ok(change?.blocks.length && change.blocks.every(block => block.change === 'added'));
});
