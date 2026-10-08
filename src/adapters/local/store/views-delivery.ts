import type { ProductionId } from '../../../domain/ids.ts';
import { buildManifest, plannedExportFiles } from '../../../domain/manifest.ts';
import { PIECE_LABELS } from '../../../domain/piece.ts';
import type { Version } from '../../../domain/piece.ts';
import type { VersionRef } from '../../../domain/refs.ts';
import { findVersion, latestDecisionOn, latestDelivery, pieceDecisions, pieceOfKind } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { ok, refuse } from '../../../domain/result.ts';
import { canExport, defaultExportSelection } from '../../../domain/rules/export.ts';
import type { ExportItem, MixedVersionsDetails } from '../../../domain/rules/export.ts';
import { isDelivered } from '../../../domain/rules/status.ts';
import { currentSourceVersion } from '../../../domain/source.ts';
import { stageState } from '../../../domain/stage.ts';
import { shortHash } from '../../../domain/text/hash.ts';
import { toRunView, toVersionView } from '../../../domain/views.ts';
import type { Lookup } from '../../../ports/common.ts';
import type { DeliveryItemView, DeliveryQuery, DeliveryView } from '../../../ports/production-queries.ts';
import { personOf } from './people.ts';
import { recordOf } from './read-context.ts';
import type { ReadContext } from './read-context.ts';
import { findProduction } from './state.ts';

/** Entrega: the exact package, its coherence, files, manifest, provenance and timings. */

function itemView(ctx: ReadContext, record: ProductionRecord, item: ExportItem): DeliveryItemView {
  // canExport already proved the version exists with this exact hash.
  const version = findVersion(record, item.version.versionId) as Version;
  const decision = record.decisions.find((entry) => entry.id === item.decisionId);
  const view: DeliveryItemView = {
    ...item,
    label: PIECE_LABELS[item.kind],
    versionView: toVersionView(record, version),
    approvedBy: personOf(ctx.state, decision?.by),
  };
  if (decision) view.approvedAt = decision.at;
  if (version.body.type === 'carousel') view.templateId = version.body.templateId;
  return view;
}

/** The approved article of a selection, whether or not the package can be built with it. */
function approvedArticle(ctx: ReadContext, record: ProductionRecord, selection: readonly VersionRef[]): DeliveryItemView | undefined {
  const piece = pieceOfKind(record, 'article');
  const ref = piece ? selection.find((entry) => entry.pieceId === piece.id) : undefined;
  const version = ref ? findVersion(record, ref.versionId) : undefined;
  const decision = ref ? latestDecisionOn(record, ref) : undefined;
  if (!ref || !version || version.hash !== ref.hash || decision?.decision !== 'approved') return undefined;
  return itemView(ctx, record, { kind: 'article', version: ref, decisionId: decision.id });
}

function firstApprovalAt(record: ProductionRecord, kind: 'article' | 'carousel'): number | undefined {
  const piece = pieceOfKind(record, kind);
  const decision = piece ? pieceDecisions(record, piece.id).find((entry) => entry.decision === 'approved') : undefined;
  return decision ? Date.parse(decision.at) : undefined;
}

/** Automatic stage timings for "Retorno do piloto" (REQ-T.8). */
export function stageDurations(record: ProductionRecord): Record<string, number> {
  const durations: Record<string, number> = {};
  const created = Date.parse(record.production.createdAt);
  const article = firstApprovalAt(record, 'article');
  if (article !== undefined) durations.article = article - created;
  const carouselPiece = pieceOfKind(record, 'carousel');
  const carousel = firstApprovalAt(record, 'carousel');
  if (carouselPiece && carousel !== undefined) durations.carousel = carousel - Date.parse(carouselPiece.createdAt);
  const delivery = latestDelivery(record);
  if (delivery?.status === 'completed') {
    const lastApproval = Math.max(...[article, carousel].filter((value): value is number => value !== undefined));
    if (Number.isFinite(lastApproval)) durations.delivery = Date.parse(delivery.createdAt) - lastApproval;
    durations.total = Date.parse(delivery.createdAt) - created;
  }
  return Object.fromEntries(Object.entries(durations).filter(([, value]) => Number.isFinite(value) && value >= 0));
}

export function deliveryView(ctx: ReadContext, productionId: ProductionId, query: DeliveryQuery = {}): Lookup<DeliveryView> {
  const production = findProduction(ctx.state, productionId);
  if (!production) return refuse('not_found', 'Não encontramos esta produção.');
  const record = recordOf(ctx, production);
  const stage = stageState(record, ctx.flow).stages.find((entry) => entry.kind === 'delivery');
  const selection = query.selection ?? defaultExportSelection(record);
  const result = canExport(record, selection);
  const items = result.ok ? result.value.map((item) => itemView(ctx, record, item)) : [];
  const article = items.find((item) => item.kind === 'article') ?? approvedArticle(ctx, record, selection);
  const files = result.ok ? plannedExportFiles(record, result.value, ctx.formatSupport, ctx.assets) : [];
  const view: DeliveryView = {
    productionId,
    productionTitle: record.production.title,
    available: stage ? stage.state !== 'blocked' : true,
    selection,
    result,
    alternatives: {},
    items,
    files,
    provenance: {
      sources: record.sources.map((source) => {
        const version = currentSourceVersion(source);
        return { id: source.id, title: source.title, version: version.number, hash: version.hash, shortHash: shortHash(version.hash) };
      }),
      runs: record.runs
        .filter((run) => selection.some((ref) => findVersion(record, ref.versionId)?.runId === run.id))
        .map((run) => toRunView(run, ctx.now)),
    },
    delivered: isDelivered(record),
    stageDurations: stageDurations(record),
  };
  if (article) view.article = article;
  if (stage) view.stage = stage;
  if (stage?.blockedReason) view.blockedReason = stage.blockedReason;
  if (result.ok) view.manifest = buildManifest(record, result.value, files, ctx.now);
  if (!result.ok && result.refusal.code === 'mixed_versions') {
    const details = result.refusal.details as MixedVersionsDetails | undefined;
    if (details?.exportWithParent) {
      // COPY §8: deliver the package the carousel was made from ("Entregar assim mesmo").
      view.alternatives.exportWithParent = { selection: details.exportWithParent, label: 'Entregar assim mesmo' };
    }
    const derivative = details ? record.pieces.find((piece) => piece.id === details.derivative.pieceId) : undefined;
    if (derivative) {
      view.alternatives.updateDerivative = { pieceId: derivative.id, kind: derivative.kind, label: `Atualizar ${PIECE_LABELS[derivative.kind].toLowerCase()}` };
    }
  }
  const latest = latestDelivery(record);
  if (latest) view.latestDelivery = latest;
  return ok(view);
}
