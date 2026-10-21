import { diffSequence, diffWords, type DiffHunk } from '../../domain/text/diff.ts';
import { withArticleAssist, withFormatFunnels, type FilledPipelineDefinition, type PipelineDefinition, type PipelineStepKey } from '../../domain/pipeline.ts';
import { PRESET_PROMPT_KEYS, upgradePreset, type PresetPromptKey, type PresetUpgrade } from '../../domain/pipeline-preset.ts';
import type { EditorialFormat } from '../../domain/formats.ts';
import type { FunnelStepKey } from '../../domain/format-prompts.ts';

/** A line of a prompt in the Design System DiffView shape. */
export type PromptDiffBlock = { id: string; change: 'added' | 'removed' | 'modified' | 'unchanged'; hunks: DiffHunk[] };
export type PresetChange = { key: PresetPromptKey; added: boolean; blocks: PromptDiffBlock[] };

const blank = (line: string) => line.trim() === '';

/**
 * Line-by-line diff of two prompts. Deleted and inserted lines of the same change are paired in
 * order as `modified`, with word hunks; the rest are `added` or `removed`. Empty lines are dropped:
 * they carry no instruction.
 */
export function promptDiffBlocks(before: string, after: string): PromptDiffBlock[] {
  const a = before.split('\n'), b = after.split('\n');
  const blocks: PromptDiffBlock[] = [];
  const push = (change: PromptDiffBlock['change'], hunks: DiffHunk[]) => blocks.push({ id: `line-${blocks.length}`, change, hunks });
  let removed: string[] = [], inserted: string[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, inserted.length);
    for (let index = 0; index < pairs; index++) push('modified', diffWords(removed[index], inserted[index]));
    for (const line of removed.slice(pairs)) push('removed', [{ kind: 'delete', text: line }]);
    for (const line of inserted.slice(pairs)) push('added', [{ kind: 'insert', text: line }]);
    removed = []; inserted = [];
  };
  for (const op of diffSequence(a, b)) {
    if (op.kind === 'delete') { removed.push(...a.slice(op.aStart, op.aStart + op.length).filter(line => !blank(line))); continue; }
    if (op.kind === 'insert') { inserted.push(...b.slice(op.bStart, op.bStart + op.length).filter(line => !blank(line))); continue; }
    flush();
    for (const line of a.slice(op.aStart, op.aStart + op.length)) if (!blank(line)) push('unchanged', [{ kind: 'equal', text: line }]);
  }
  flush();
  return blocks;
}

function promptText(definition: FilledPipelineDefinition, key: PresetPromptKey): string {
  if (key === 'system') return definition.systemPrompt;
  if (key.startsWith('funnel:')) {
    const [, format, step] = key.split(':') as [string, EditorialFormat, FunnelStepKey];
    return definition.funnels[format][step].prompt;
  }
  return definition.steps[key as PipelineStepKey]?.prompt ?? '';
}

/**
 * What applying the preset would do to a saved definition, with the diff of each prompt it
 * changes against the text the Prompts page shows today. A step the revision lacks is diffed
 * against nothing, so it reads as a new step.
 */
export function presetUpgradeView(definition: PipelineDefinition): PresetUpgrade & { changes: PresetChange[] } {
  const upgrade = upgradePreset(definition);
  const before = withFormatFunnels(withArticleAssist(definition)), after = withFormatFunnels(upgrade.next);
  const changes = PRESET_PROMPT_KEYS.filter(key => upgrade.updated.includes(key) || upgrade.added.includes(key)).map(key => {
    const added = upgrade.added.includes(key);
    return { key, added, blocks: promptDiffBlocks(added ? '' : promptText(before, key), promptText(after, key)) };
  });
  return { ...upgrade, changes };
}
