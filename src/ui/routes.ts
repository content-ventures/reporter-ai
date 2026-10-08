import type { PieceKind, ProductionId, StageView } from '@/domain';
import { pieceKind, pieceKindBySlug } from '@/registries';

/**
 * Product URLs in one place (PLAN §2). Stage routes follow the journey: Material is `source`,
 * each piece kind has its slug from the registry, the gate lives under `/review`, and Entrega
 * is `delivery`. `/productions/[id]` redirects to the current stage.
 */

export const OVERVIEW_HREF = '/';
export const PRODUCTIONS_HREF = '/productions';
export const NEW_PRODUCTION_HREF = '/productions/new';
export const WHATS_NEW_HREF = '/whats-new';

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

/** Where a journey stage lives. */
export function stageHref(productionId: ProductionId | string, stage: Pick<StageView, 'kind' | 'pieceKind'>): string {
  if (stage.kind === 'source') return materialHref(productionId);
  if (stage.kind === 'delivery') return deliveryHref(productionId);
  return stage.pieceKind ? pieceHref(productionId, stage.pieceKind) : productionHref(productionId);
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

/** Journey stage id shown by a production route (for the Stepper). */
export function routeStageId(route: ProductionRoute, stages: readonly StageView[]): string | undefined {
  switch (route.kind) {
    case 'source':
      return stages.find((stage) => stage.kind === 'source')?.id;
    case 'delivery':
      return stages.find((stage) => stage.kind === 'delivery')?.id;
    case 'studio':
    case 'review':
      return stages.find((stage) => stage.pieceKind === route.pieceKind)?.id;
    default:
      return undefined;
  }
}
