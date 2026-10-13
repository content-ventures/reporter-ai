import type { PieceKind, ProductionId, StageView, StepTarget } from '@/domain';
import type { ApprovalsTab } from '@/ports';
import { pieceKind, pieceKindBySlug } from '@/registries';

/**
 * Product URLs in one place (PLAN §2). Stage routes follow the journey: Material is `source`,
 * each piece kind has its slug from the registry, the approval (gate) lives under `/review`, and
 * Entrega is `delivery`. `/productions/[id]` redirects to the current stage.
 */

export const OVERVIEW_HREF = '/';
export const PRODUCTIONS_HREF = '/productions';
export const NEW_PRODUCTION_HREF = '/productions/new';
export const WHATS_NEW_HREF = '/whats-new';
export const APPROVALS_HREF = '/approvals';

/** `?aba=` value of each Aprovações tab ("Para aprovar" is the page without it). */
export const APPROVALS_TAB_PARAM: Readonly<Record<ApprovalsTab, string | null>> = {
  to_approve: null,
  approved_by_me: 'aprovadas',
  returned: 'devolvidas',
};

/** `/approvals`, `/approvals?aba=aprovadas`, `/approvals?aba=devolvidas`. */
export function approvalsHref(tab?: ApprovalsTab): string {
  const param = tab ? APPROVALS_TAB_PARAM[tab] : null;
  return param ? `${APPROVALS_HREF}?aba=${param}` : APPROVALS_HREF;
}

/** The Aprovações tab named by `?aba=` (unknown or absent: "Para aprovar"). */
export function approvalsTabOf(param: string | null | undefined): ApprovalsTab {
  const entry = (Object.entries(APPROVALS_TAB_PARAM) as [ApprovalsTab, string | null][]).find(([, value]) => value !== null && value === param);
  return entry ? entry[0] : 'to_approve';
}

export function productionHref(productionId: ProductionId | string): string {
  return `${PRODUCTIONS_HREF}/${encodeURIComponent(productionId)}`;
}

export function materialHref(productionId: ProductionId | string): string {
  return `${productionHref(productionId)}/source`;
}

export function deliveryHref(productionId: ProductionId | string): string {
  return `${productionHref(productionId)}/delivery`;
}

export function pieceSlug(kind: PieceKind): string {
  return pieceKind(kind)?.slug ?? kind;
}

/** Studio of a piece: `/productions/[id]/article`, `/productions/[id]/carousel`. */
export function pieceHref(productionId: ProductionId | string, kind: PieceKind): string {
  return `${productionHref(productionId)}/${pieceSlug(kind)}`;
}

/** Review gate of a piece: `/productions/[id]/article/review`. */
export function reviewHref(productionId: ProductionId | string, kind: PieceKind): string {
  return `${pieceHref(productionId, kind)}/review`;
}

/** Nova produção, step 3 (Estrutura), for a production that already exists. */
export function structureHref(productionId: ProductionId | string): string {
  return `${NEW_PRODUCTION_HREF}?producao=${encodeURIComponent(productionId)}`;
}

/**
 * Where a journey stage lives. The approval (`gate`) opens the guided review for whoever decides
 * there, and the piece's studio for everyone else (the author waits there, read-only).
 */
export function stageHref(
  productionId: ProductionId | string,
  stage: Pick<StageView, 'kind' | 'pieceKind'>,
  options: { canDecide?: boolean } = {},
): string {
  switch (stage.kind) {
    case 'source':
      return materialHref(productionId);
    case 'delivery':
      return deliveryHref(productionId);
    case 'gate':
      if (!stage.pieceKind) return productionHref(productionId);
      return options.canDecide ? reviewHref(productionId, stage.pieceKind) : pieceHref(productionId, stage.pieceKind);
    case 'piece':
      return stage.pieceKind ? pieceHref(productionId, stage.pieceKind) : productionHref(productionId);
  }
}

/** Where a next step lands ("Revisar" → review, "Montar estrutura" → Nova produção step 3…). */
export function stepTargetHref(productionId: ProductionId | string, target: StepTarget): string {
  switch (target.kind) {
    case 'source':
      return materialHref(productionId);
    case 'studio':
      return pieceHref(productionId, target.pieceKind);
    case 'review':
      return reviewHref(productionId, target.pieceKind);
    case 'delivery':
      return deliveryHref(productionId);
    case 'structure':
      return structureHref(productionId);
  }
}

/** The production sub-route below `/productions/[id]`, from the layout segments. */
export type ProductionRoute =
  | { kind: 'index' }
  | { kind: 'source' }
  | { kind: 'delivery' }
  | { kind: 'studio'; pieceKind: PieceKind }
  | { kind: 'review'; pieceKind: PieceKind }
  | { kind: 'unknown' };

export function productionRoute(segments: readonly string[]): ProductionRoute {
  const [first, second] = segments;
  if (first === undefined) return { kind: 'index' };
  if (first === 'source' && second === undefined) return { kind: 'source' };
  if (first === 'delivery' && second === undefined) return { kind: 'delivery' };
  const entry = pieceKindBySlug(first);
  if (!entry) return { kind: 'unknown' };
  if (second === undefined) return { kind: 'studio', pieceKind: entry.kind };
  if (second === 'review' && segments.length === 2) return { kind: 'review', pieceKind: entry.kind };
  return { kind: 'unknown' };
}

/**
 * Journey stage id shown by a production route (the header's "Artigo · 2 de 5"). The review route
 * is the approval stage of its piece; a flow without one falls back to the piece's own stage.
 */
export function routeStageId(route: ProductionRoute, stages: readonly StageView[]): string | undefined {
  switch (route.kind) {
    case 'source':
      return stages.find((stage) => stage.kind === 'source')?.id;
    case 'delivery':
      return stages.find((stage) => stage.kind === 'delivery')?.id;
    case 'studio':
      return stages.find((stage) => stage.kind === 'piece' && stage.pieceKind === route.pieceKind)?.id;
    case 'review':
      return (
        stages.find((stage) => stage.kind === 'gate' && stage.pieceKind === route.pieceKind)?.id ??
        stages.find((stage) => stage.kind === 'piece' && stage.pieceKind === route.pieceKind)?.id
      );
    default:
      return undefined;
  }
}
