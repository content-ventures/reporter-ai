import type { ArticleBody } from './article.ts';
import { articleHash, blockText } from './article.ts';
import type { MemoryUse } from './editorial-memory.ts';
import type { PieceBody } from './piece.ts';

export type MemoryVersionUse = Extract<MemoryUse, { stage: 'approved' | 'published' }>;
type Snapshot = { id: string; productionId: string; pieceId: string; number: number; hash: string; body: PieceBody };

/** A historical occurrence opens its exact frozen article, even after a newer approval. */
export function memoryUsedArticle(use: MemoryVersionUse, version: Snapshot): ArticleBody | null {
  if (version.productionId !== use.productionId || version.pieceId !== use.article.pieceId || version.id !== use.article.versionId
    || version.number !== use.article.number || version.hash !== use.article.hash || version.body.type !== 'article'
    || articleHash(version.body) !== use.article.hash) return null;
  const block = version.body.blocks.find(block => block.id === use.blockId);
  if (!block || !Number.isInteger(use.from) || !Number.isInteger(use.to) || use.from < 0 || use.to <= use.from
    || use.to > blockText(block).length || !blockText(block).slice(use.from, use.to).trim()) return null;
  return version.body;
}
