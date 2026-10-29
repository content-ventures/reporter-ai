import { blockText, findBlock, sliceText, type ArticleBody } from './article.ts';
import { memoryArticleContentIssues, memoryArticleReferences } from './editorial-memory-article.ts';
import { ok, refuse, type Result } from './result.ts';
import type { Source } from './source.ts';
import { applySuggestion, type Suggestion } from './suggestion.ts';

type MemorySuggestion = Pick<Suggestion, 'target' | 'anchorText' | 'proposal'>;
/** Refine exact citation receipts and validate the resulting blocks before any AI proposal can be accepted. */
export function prepareMemorySuggestion<T extends MemorySuggestion>(body: ArticleBody, sources: readonly Source[], suggestion: T): Result<T, 'invalid_target' | 'memory_source_changed' | 'memory_literal_changed'> {
  if (suggestion.proposal.kind === 'title') return ok(suggestion);
  const applied = applySuggestion(body, { ...suggestion, state: 'ready' });
  if (!applied.ok) return refuse('invalid_target', applied.refusal.message);
  const { target, proposal } = suggestion;
  const affected = new Set([...target.map(range => range.blockId), ...(proposal.kind === 'replace-blocks' ? proposal.blocks.map(block => block.id) : [])]);
  const changed = applied.value.blocks.filter(block => affected.has(block.id)).map(block => ({ ...block,
    ...(block.sourceRefs ? { sourceRefs: memoryArticleReferences(block, block.sourceRefs, sources) } : {}) }));
  const issue = memoryArticleContentIssues({ ...applied.value, blocks: changed }, sources)[0];
  if (issue) return refuse(issue.code, issue.message);
  const bankIds = new Set(sources.filter(source => source.memory).map(source => source.id));
  if (!changed.some(block => block.sourceRefs?.some(ref => bankIds.has(ref.sourceId)))) return ok(suggestion);
  // Refined receipts replace the old block refs atomically. Whole-block anchors preserve later human edits.
  const fullTargets = [...new Set(target.map(range => range.blockId))].map(blockId => ({ blockId, from: 0, to: blockText(findBlock(body, blockId)!).length }));
  return ok({ ...suggestion, target: fullTargets, anchorText: fullTargets.map(range => sliceText(body, range)!),
    proposal: { kind: 'replace-blocks', blocks: changed } });
}
