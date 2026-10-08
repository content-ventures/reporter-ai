import type { ImageAsset } from '../domain/asset.ts';
import type { FeedbackEntry } from '../domain/feedback.ts';
import type { AssetId, PieceId, ProductionId, SourceId, VersionId } from '../domain/ids.ts';
import type { VersionRef } from '../domain/refs.ts';
import { ok, refuse } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { stableStringify } from '../domain/text/hash.ts';
import type { Workspace } from '../domain/workspace.ts';
import type { ChangeNotice, Page, PageRequest, PersonSummary } from '../ports/common.ts';
import type { FeedbackQuery } from '../ports/feedback.ts';
import type {
  ActivityItem,
  ActivityQuery,
  ApprovalsPage,
  ApprovalsTab,
  CompareView,
  DeliveryView,
  DraftView,
  OverviewData,
  OverviewRange,
  ProductionDetail,
  ProductionListFilter,
  ProductionListPage,
  ReviewView,
  SourceDetail,
  VersionDetail,
} from '../ports/production-queries.ts';
import type { SessionMember, SessionMode } from '../ports/session.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { QuerySpec } from './query-store.ts';

/**
 * Every read a screen can make, as a cache spec: a unique key, the port call, and which change
 * notices make the answer stale. Kept pure so the invalidation rules are unit-tested.
 */

export type RuntimeQuery<T> = QuerySpec<Runtime, T>;

/** Who is acting and with whom (header avatar, "Agir como", approver names). */
export type SessionData = {
  mode: SessionMode;
  workspace: Workspace;
  current: SessionMember | undefined;
  members: SessionMember[];
};

const key = (name: string, ...args: unknown[]): string => {
  let count = args.length;
  while (count > 0 && args[count - 1] === undefined) count -= 1;
  return count === 0 ? name : `${name}:${stableStringify(args.slice(0, count))}`;
};

const answer = async <T>(read: Promise<T>): Promise<Result<T, string>> => ok(await read);

// ── Invalidation rules ───────────────────────────────────────────────────────────────────

/** Session switches change guards and "Aguardando você"; resets change everything. */
export const isGlobal = (notice: ChangeNotice): boolean => notice.scope === 'reset' || notice.scope === 'session' || notice.scope === 'external';

export const always = (): boolean => true;

/** The notice may concern this production (workspace-wide notices carry no ids). */
export function touchesProduction(productionId: ProductionId) {
  return (notice: ChangeNotice): boolean =>
    isGlobal(notice) || notice.productionIds.length === 0 || notice.productionIds.includes(productionId);
}

/** For answers that name their production: scoped once known, broad before the first answer. */
function scopedBy<T>(productionOf: (data: T) => ProductionId | undefined) {
  return (notice: ChangeNotice, data: T | undefined): boolean => {
    const productionId = data === undefined ? undefined : productionOf(data);
    return productionId === undefined ? true : touchesProduction(productionId)(notice);
  };
}

// ── Specs ────────────────────────────────────────────────────────────────────────────────

/** Any change to a production's workflow (sends, decisions, edits): approval queues may move. */
const changesProductions = (notice: ChangeNotice): boolean => isGlobal(notice) || notice.scope === 'productions';

export function overviewQuery(range: OverviewRange): RuntimeQuery<OverviewData> {
  return { key: key('overview', range), fetch: (rt) => answer(rt.queries.overview(range)), affectedBy: always };
}

export function productionsQuery(filter?: ProductionListFilter, page?: Partial<PageRequest>): RuntimeQuery<ProductionListPage> {
  return {
    key: key('productions', filter ?? {}, page),
    fetch: (rt) => answer(rt.queries.list(filter, page)),
    affectedBy: (notice) => notice.scope !== 'feedback',
  };
}

/**
 * A production with its approvals: its own changes, and any production change (who to send to
 * comes from the viewer's sends elsewhere, CONTRACT §2.4).
 */
export function productionQuery(productionId: ProductionId): RuntimeQuery<ProductionDetail> {
  const own = touchesProduction(productionId);
  return { key: key('production', productionId), fetch: (rt) => rt.queries.get(productionId), affectedBy: (notice) => changesProductions(notice) || own(notice) };
}

/** The studio's working draft of a piece. */
export function pieceQuery(pieceId: PieceId): RuntimeQuery<DraftView> {
  return { key: key('piece', pieceId), fetch: (rt) => rt.queries.draft(pieceId), affectedBy: scopedBy((draft) => draft.productionId) };
}

export function versionQuery(versionId: VersionId): RuntimeQuery<VersionDetail> {
  return { key: key('version', versionId), fetch: (rt) => rt.queries.version(versionId), affectedBy: scopedBy((version) => version.productionId) };
}

/** Versions are immutable: only a reset (or an image credit shown in the diff) changes a comparison. */
export function compareQuery(pieceId: PieceId, fromVersionId: VersionId, toVersionId: VersionId): RuntimeQuery<CompareView> {
  return {
    key: key('compare', pieceId, fromVersionId, toVersionId),
    fetch: (rt) => rt.queries.compare(pieceId, fromVersionId, toVersionId),
    affectedBy: (notice, data) => data === undefined || notice.scope === 'reset' || notice.scope === 'external' || notice.scope === 'assets',
  };
}

export function sourceQuery(sourceId: SourceId, version?: number): RuntimeQuery<SourceDetail> {
  return {
    key: key('source', sourceId, version),
    fetch: (rt) => rt.queries.source(sourceId, version),
    affectedBy: (notice, data) =>
      data === undefined ||
      isGlobal(notice) ||
      notice.productionIds.length === 0 ||
      data.productions.some((production) => notice.productionIds.includes(production.id)),
  };
}


/**
 * Review surface: the version under review by default. Its own production's changes, and any
 * production change (the "Próxima: …" item comes from the viewer's queue).
 */
export function reviewQuery(pieceId: PieceId, versionId?: VersionId): RuntimeQuery<ReviewView> {
  const ownProduction = scopedBy<ReviewView>((review) => review.productionId);
  return {
    key: key('review', pieceId, versionId),
    fetch: (rt) => rt.queries.review(pieceId, versionId),
    affectedBy: (notice, data) => changesProductions(notice) || ownProduction(notice, data),
  };
}

/** "Aprovações": the acting member's queue per tab (every production change may move it). */
export function approvalsQuery(tab: ApprovalsTab): RuntimeQuery<ApprovalsPage> {
  return {
    key: key('approvals', tab),
    fetch: (rt) => answer(rt.queries.approvals(tab)),
    affectedBy: changesProductions,
  };
}

/** Entrega: the latest approved package, or another `selection` ("Exportar com artigo v4"). */
export function deliveryQuery(productionId: ProductionId, selection?: VersionRef[]): RuntimeQuery<DeliveryView> {
  return {
    key: key('delivery', productionId, selection),
    fetch: (rt) => rt.queries.delivery(productionId, selection ? { selection } : undefined),
    affectedBy: touchesProduction(productionId),
  };
}

export function activityQuery(query?: ActivityQuery): RuntimeQuery<Page<ActivityItem>> {
  const productionId = query?.productionId;
  return {
    key: key('activity', query ?? {}),
    fetch: (rt) => answer(rt.queries.activity(query)),
    affectedBy: productionId ? touchesProduction(productionId) : always,
  };
}

export function peopleQuery(): RuntimeQuery<PersonSummary[]> {
  return {
    key: key('people'),
    fetch: (rt) => answer(rt.queries.people()),
    affectedBy: (notice) => notice.scope !== 'runs' && notice.scope !== 'feedback' && notice.scope !== 'assets',
  };
}

// ── Images (AssetStore) ──────────────────────────────────────────────────────────────────

const IMAGE_NOT_FOUND = 'Imagem não encontrada neste navegador.';

/** Image changes of this production (or workspace-wide ones: store opened, reset). */
function touchesImagesOf(productionId?: ProductionId) {
  return (notice: ChangeNotice): boolean =>
    notice.scope === 'reset' ||
    (notice.scope === 'assets' && (productionId === undefined || notice.productionIds.length === 0 || notice.productionIds.includes(productionId)));
}

/** Images added to a production, newest first (picker, "Imagens desta produção"). */
export function assetsQuery(productionId: ProductionId): RuntimeQuery<ImageAsset[]> {
  return {
    key: key('assets', productionId),
    fetch: async (rt) => {
      await rt.assets.ready();
      return ok(rt.assets.list(productionId));
    },
    affectedBy: touchesImagesOf(productionId),
  };
}

/** One image's metadata (credit, rights, origin, size). */
export function assetQuery(assetId: AssetId): RuntimeQuery<ImageAsset> {
  return {
    key: key('asset', assetId),
    fetch: async (rt) => {
      await rt.assets.ready();
      const asset = rt.assets.get(assetId);
      return asset ? ok(asset) : refuse('not_found', IMAGE_NOT_FOUND);
    },
    affectedBy: touchesImagesOf(),
  };
}

/** URL to show an image (`blob:` for uploads, the address for links). */
export function assetUrlQuery(assetId: AssetId): RuntimeQuery<string> {
  return {
    key: key('asset-url', assetId),
    fetch: async (rt) => {
      await rt.assets.ready();
      const url = await rt.assets.objectUrl(assetId);
      return url ? ok(url) : refuse('not_found', IMAGE_NOT_FOUND);
    },
    affectedBy: touchesImagesOf(),
  };
}

export function feedbackQuery(query?: FeedbackQuery): RuntimeQuery<FeedbackEntry[]> {
  return {
    key: key('feedback', query ?? {}),
    fetch: (rt) => answer(rt.feedback.list(query)),
    // "Mine" changes with the acting person ("Entrar como").
    affectedBy: (notice) => notice.scope === 'feedback' || notice.scope === 'reset' || notice.scope === 'external' || (query?.mine === true && notice.scope === 'session'),
  };
}

export function sessionQuery(): RuntimeQuery<SessionData> {
  return {
    key: key('session'),
    fetch: async (rt) => {
      const [workspace, current, members] = await Promise.all([rt.session.workspace(), rt.session.current(), rt.session.members()]);
      return ok({ mode: rt.session.mode, workspace, current, members });
    },
    affectedBy: isGlobal,
  };
}
