import type { ActorId, BatchId, FlowId, IsoDateTime, PersonId, PieceId, ProductionId, SourceId, WorkspaceId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import type { BriefRef, VersionRef } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';
import { ARTICLE_SIZES, DEFAULT_ARTICLE_SIZE, isArticleSize } from './sizing.ts';
import type { ArticleSize } from './sizing.ts';
import { contentHash } from './text/hash.ts';

/** Sections after the introduction of a new production (the default size's default). */
export const DEFAULT_SECTIONS = ARTICLE_SIZES[DEFAULT_ARTICLE_SIZE].sections.default;

/** The editorial brief (pauta): seed of the R2 writing guide (F2.5). */
export type Brief = {
  /** "Orientação editorial", optional. */
  angle?: string;
  /** Sections after the introduction, inside the size's range (Curto 1–3, Padrão 2–5). */
  sections: number;
  /** "Tamanho do artigo": Curto (1 lauda) or Padrão (2 laudas). */
  size: ArticleSize;
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
  return contentHash({ angle: brief.angle?.trim() || undefined, sections: brief.sections, size: brief.size });
}

export function toBriefRef(production: Production): BriefRef {
  return { kind: 'brief', productionId: production.id, revision: production.brief.revision, hash: briefHash(production.brief) };
}

export type BriefRefusal = 'sections_out_of_range' | 'unknown_size';

/** The size first (it sets the section range), then the sections: "Curto aceita de 1 a 3 seções." */
export function validateBrief(brief: Brief): Result<Brief, BriefRefusal> {
  if (!isArticleSize(brief.size)) return refuse('unknown_size', 'Tamanho desconhecido.');
  const { label, sections } = ARTICLE_SIZES[brief.size];
  if (!Number.isInteger(brief.sections) || brief.sections < sections.min || brief.sections > sections.max) {
    return refuse('sections_out_of_range', `${label} aceita de ${sections.min} a ${sections.max} seções.`);
  }
  const angle = brief.angle?.trim();
  return ok(angle ? { ...brief, angle } : { sections: brief.sections, size: brief.size, revision: brief.revision });
}

export type PlanRefusal = 'article_required';

/** R1 plan rule: the article is mandatory; the carousel needs the article. */
export function validatePlan(plan: readonly PieceKind[]): Result<PieceKind[], PlanRefusal> {
  if (!plan.includes('article')) return refuse('article_required', 'O artigo é obrigatório.');
  const unique = [...new Set(plan)];
  return ok(unique.sort((a, b) => (a === 'article' ? -1 : b === 'article' ? 1 : 0)));
}
