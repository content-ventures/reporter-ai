import { articlePlainText } from './article.ts';
import type { ArticleBody } from './article.ts';
import type { PieceKind } from './piece.ts';
import { latestApproved, pieceDecisions, pieceOfKind, versionsOf } from './record.ts';
import type { ProductionRecord } from './record.ts';
import { commonLength } from './text/diff.ts';
import { words } from './text/stats.ts';

/** Dashboard indicators computed from real data (never invented). */

export type Retention = {
  /** Share of the AI draft's words kept, in order, in the approved text (0–1); null without words. */
  ratio: number | null;
  kept: number;
  generatedWords: number;
  finalWords: number;
};

/** "Aproveitamento da IA": word-level LCS between v1 · IA and the approved version. */
export function aiRetention(generated: ArticleBody, final: ArticleBody): Retention {
  const fold = (body: ArticleBody) => words(`${body.title}\n${articlePlainText(body)}`).map((word) => word.toLocaleLowerCase('pt-BR'));
  const before = fold(generated);
  const after = fold(final);
  const kept = commonLength(before, after);
  return {
    ratio: before.length === 0 ? null : kept / before.length,
    kept,
    generatedWords: before.length,
    finalWords: after.length,
  };
}

/** Retention for a production's article: first generated version vs latest approved one. */
export function productionRetention(record: ProductionRecord): Retention | undefined {
  const piece = pieceOfKind(record, 'article');
  if (!piece) return undefined;
  const generated = versionsOf(record, piece.id).find((version) => version.origin === 'generation');
  const approved = latestApproved(record, piece.id);
  if (!generated || !approved || generated.body.type !== 'article' || approved.version.body.type !== 'article') return undefined;
  return aiRetention(generated.body, approved.version.body);
}

/** Time from production creation to the first approval of a piece. */
export function timeToApprovalMs(record: ProductionRecord, kind: PieceKind = 'article'): number | undefined {
  const piece = pieceOfKind(record, kind);
  if (!piece) return undefined;
  const first = pieceDecisions(record, piece.id).find((decision) => decision.decision === 'approved');
  if (!first) return undefined;
  const duration = Date.parse(first.at) - Date.parse(record.production.createdAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
