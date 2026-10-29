import { headingBlock, listBlock, paragraphBlock, quoteBlock } from './article.ts';
import { memoryStatisticIssue } from './editorial-memory-article.ts';
import { memoryMarketHeaderValues } from './editorial-memory-market.ts';
import { contentHash } from './text/hash.ts';
import type { WritingArticle, WritingReview, WritingSource } from './writing-orchestration.ts';

/** Enforce statistical context even when no application-specific validator was supplied. */
export function writingMemoryChecks(article: WritingArticle, sources: readonly WritingSource[]): WritingReview['issues'] {
  const issues: WritingReview['issues'] = [];
  for (const value of article.blocks) {
    const block = value.type === 'quote' ? quoteBlock(value.id, value.text) : value.type === 'heading' ? headingBlock(value.id, value.text, value.level)
      : value.type === 'list' ? listBlock(value.id, value.items) : paragraphBlock(value.id, value.text);
    for (const source of sources) {
      if (source.memory?.kind !== 'statistic' || !value.evidenceIds.includes(source.id)) continue;
      const message = memoryStatisticIssue(block, source.text, memoryMarketHeaderValues(source.memory.market, source.text, source.memory.marketContext ?? {}).map(item => item.value));
      if (message) issues.push({ id: `contract-memory-${contentHash({ blockId: value.id, sourceId: source.id })}`, severity: 'critical', code: 'MEMORY_LITERAL_CHANGED',
        blockId: value.id, evidenceIds: [source.id], message, suggestion: 'Mantenha o dado completo em um parágrafo ou item de lista, com suas ressalvas e contexto, sem apresentá-lo como fala.' });
    }
  }
  return issues;
}
