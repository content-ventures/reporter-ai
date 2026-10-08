import type { ActorId, BatchId, FlowId, IsoDateTime, PersonId, PieceId, ProductionId, SourceId, WorkspaceId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import type { BriefRef, VersionRef } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';
import { contentHash } from './text/hash.ts';

export type ArticleLength = 'short' | 'medium' | 'long';

/** Word targets per length; "Extensão no alvo" passes inside [min, max]. */
export const LENGTH_TARGETS: Record<ArticleLength, { label: string; words: number; min: number; max: number }> = {
  short: { label: 'Curta', words: 500, min: 400, max: 650 },
  medium: { label: 'Média', words: 800, min: 650, max: 1000 },
  long: { label: 'Longa', words: 1200, min: 1000, max: 1600 },
};

/** D10: a generated draft lands within this share of its length target when the material allows. */
export const LENGTH_TOLERANCE = 0.1;

/**
 * What a draft of this length will have, given the longest draft the material supports: the
 * target when the material reaches it (within the tolerance), else everything the material gives.
 */
export function expectedDraftWords(length: ArticleLength, wordsAvailable: number): { words: number; reachesTarget: boolean } {
  const target = LENGTH_TARGETS[length].words;
  const reachesTarget = wordsAvailable >= target * (1 - LENGTH_TOLERANCE);
  return { words: reachesTarget ? target : wordsAvailable, reachesTarget };
}

export const MIN_SECTIONS = 2;
export const MAX_SECTIONS = 5;
export const DEFAULT_SECTIONS = 3;

/** The editorial brief (pauta): seed of the R2 writing guide (F2.5). */
export type Brief = {
  /** "Orientação editorial", optional. */
  angle?: string;
  /** Sections after the introduction (2–5, default 3). */
  sections: number;
  length: ArticleLength;
  /** Bumps on every change, so runs can record the exact brief they used. */
  revision: number;
};

export type RelationType = 'facet-of' | 'embeds' | 'compiles';

/** Cross-production links: pillar → articles (F3.9), cut ↔ article (F4.8), newsletter (F6.5). */
export type ProductionRelation = {
  type: RelationType;
  productionId: ProductionId;
  pieceId?: PieceId;
  version?: VersionRef;
};

export type Production = {
  id: ProductionId;
  workspaceId: WorkspaceId;
  flowId: FlowId;
  title: string;
  sourceIds: SourceId[];
  brief: Brief;
  /** Pieces this production will deliver, in flow order (article is mandatory in R1). */
  plan: PieceKind[];
  relations: ProductionRelation[];
  /** Reserved for R7 batches (F7.2). */
  batchId?: BatchId;
  ownerId: PersonId;
  /**
   * REQ-T.1 · who opens it: only these people, its owner and the workspace admins. Absent = the
   * whole workspace (the R1 default); material still waiting for its release is the typical case.
   */
  restrictedTo?: PersonId[];
  createdAt: IsoDateTime;
  createdBy: ActorId;
  updatedAt: IsoDateTime;
  archivedAt?: IsoDateTime;
};

/** Who may open a production (REQ-T.1): everyone without a restriction; else its team and admins. */
export function canOpenProduction(
  production: Pick<Production, 'ownerId' | 'restrictedTo'>,
  member: { personId: PersonId; roles: readonly string[] } | undefined,
): boolean {
  if (!production.restrictedTo) return true;
  if (!member) return false;
  return member.roles.includes('admin') || member.personId === production.ownerId || production.restrictedTo.includes(member.personId);
}

export function briefHash(brief: Brief): string {
  return contentHash({ angle: brief.angle?.trim() || undefined, sections: brief.sections, length: brief.length });
}

export function toBriefRef(production: Production): BriefRef {
  return { kind: 'brief', productionId: production.id, revision: production.brief.revision, hash: briefHash(production.brief) };
}

export type BriefRefusal = 'sections_out_of_range' | 'unknown_length';

export function validateBrief(brief: Brief): Result<Brief, BriefRefusal> {
  if (!Number.isInteger(brief.sections) || brief.sections < MIN_SECTIONS || brief.sections > MAX_SECTIONS) {
    return refuse('sections_out_of_range', `Escolha entre ${MIN_SECTIONS} e ${MAX_SECTIONS} seções.`);
  }
  if (!(brief.length in LENGTH_TARGETS)) return refuse('unknown_length', 'Extensão desconhecida.');
  const angle = brief.angle?.trim();
  return ok(angle ? { ...brief, angle } : { sections: brief.sections, length: brief.length, revision: brief.revision });
}

export type PlanRefusal = 'article_required';

/** R1 plan rule: the article is mandatory; the carousel needs the article. */
export function validatePlan(plan: readonly PieceKind[]): Result<PieceKind[], PlanRefusal> {
  if (!plan.includes('article')) return refuse('article_required', 'O artigo é obrigatório.');
  const unique = [...new Set(plan)];
  return ok(unique.sort((a, b) => (a === 'article' ? -1 : b === 'article' ? 1 : 0)));
}
