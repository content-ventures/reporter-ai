import type { ArticleBody, ArticleBlock } from './article.ts';
import type { SourceRef } from './refs.ts';
import type { WritingArticle } from './writing-orchestration.ts';
import { contentHash } from './text/hash.ts';

/** Preserve reviewed semantic blocks and original evidence when creating the editable draft. */
export function writingArticleBody(article: WritingArticle, runId: string, references: (ids: string[]) => SourceRef[]): ArticleBody {
  const blocks = article.blocks.map((block): ArticleBlock => {
    const common = { id: `writing-${contentHash({ runId, blockId: block.id })}`, sourceRefs: references(block.evidenceIds), ai: 'unreviewed' as const };
    if (block.type === 'list') return { ...common, type: 'list', ordered: false, items: block.items.map(text => [{ text }]) };
    const inlines = [{ text: block.text }];
    if (block.type === 'heading') return { ...common, type: 'heading', level: block.level, inlines };
    return { ...common, type: block.type, inlines };
  });
  return { type: 'article', title: article.title, ...(article.dek ? { dek: article.dek } : {}), blocks };
}
