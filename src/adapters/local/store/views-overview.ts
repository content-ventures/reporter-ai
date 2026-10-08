import type { ActivityEvent } from '../../../domain/activity.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import { buildOverview } from '../../../domain/overview.ts';
import type { MetricValue } from '../../../domain/overview.ts';
import { PIECE_LABELS } from '../../../domain/piece.ts';
import { findVersion, lastRun, pendingReview, pieceDecisions } from '../../../domain/record.ts';
import { pieceStatus } from '../../../domain/rules/status.ts';
import { toVersionView } from '../../../domain/views.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import type { Page } from '../../../ports/common.ts';
import type {
  ActivityItem,
  ActivityQuery,
  AwaitingItem,
  MetricWithDelta,
  OverviewData,
  OverviewRange,
} from '../../../ports/production-queries.ts';
import { activitySummary } from './activity-text.ts';
import { currentMember, personOf } from './people.ts';
import { recordOf } from './read-context.ts';
import type { ReadContext } from './read-context.ts';
import { assembleRecord } from './state.ts';
import { paginate } from './views-list.ts';

/** Visão geral: metrics with deltas, rhythm, "Continue de onde parou", "Aguardando você", activity. */

export const RANGE_DAYS: Record<OverviewRange, number> = { '7d': 7, '30d': 30 };

function withDelta(metric: MetricValue, lowerIsBetter = false): MetricWithDelta {
  if (metric.value === null || metric.previous === null) return { ...metric, delta: null, trend: 'unknown' };
  const delta = metric.value - metric.previous;
  if (delta === 0) return { ...metric, delta, trend: 'flat' };
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  return { ...metric, delta, trend: better ? 'better' : 'worse' };
}

export function toActivityItem(ctx: ReadContext, event: ActivityEvent): ActivityItem {
  const actor = personOf(ctx.state, event.actorId);
  const item: ActivityItem = { ...event, actor, summary: activitySummary(event, actor) };
  const production = event.productionId ? ctx.state.productions.find((entry) => entry.production.id === event.productionId) : undefined;
  if (production) item.productionTitle = production.production.title;
  return item;
}

export function activityPage(ctx: ReadContext, query: ActivityQuery = {}): Page<ActivityItem> {
  // Newest first; events of the same instant keep reverse log order (the log is append-only).
  const events = ctx.state.activity
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !query.productionId || event.productionId === query.productionId)
    .filter(({ event }) => !query.types || query.types.length === 0 || query.types.includes(event.type))
    .sort((a, b) => Date.parse(b.event.at) - Date.parse(a.event.at) || b.index - a.index)
    .map(({ event }) => event);
  const page = paginate(events, query);
  return { ...page, items: page.items.map((event) => toActivityItem(ctx, event)) };
}

function awaitingItems(ctx: ReadContext): AwaitingItem[] {
  const viewer = currentMember(ctx.state);
  if (!viewer) return [];
  const items: AwaitingItem[] = [];
  for (const production of ctx.state.productions) {
    if (production.production.archivedAt) continue;
    const record = recordOf(ctx, production);
    for (const piece of record.pieces) {
      const base = { productionId: record.production.id, productionTitle: record.production.title, pieceId: piece.id, kind: piece.kind, pieceLabel: PIECE_LABELS[piece.kind] };
      const request = pendingReview(record, piece.id);
      if (request) {
        const gate = gateForPiece(piece.kind, ctx.gates);
        if (!gate || !hasAnyRole(viewer, gate.roles)) continue;
        const version = findVersion(record, request.subject.versionId);
        const item: AwaitingItem = { ...base, reason: 'review', from: personOf(ctx.state, request.requestedBy), at: request.requestedAt };
        if (version) item.version = toVersionView(record, version);
        if (request.note) item.note = request.note;
        items.push(item);
        continue;
      }
      const responsible = record.production.ownerId === viewer.personId || hasAnyRole(viewer, ['admin']);
      if (responsible && pieceStatus(record, piece.kind) === 'failed') {
        // A generation that failed before writing anything waits for its owner (and the workspace
        // admin), like a returned piece.
        const run = lastRun(record, piece.id);
        const item: AwaitingItem = { ...base, reason: 'failed', from: personOf(ctx.state, run?.createdBy), at: run?.endedAt ?? run?.createdAt ?? record.production.updatedAt };
        if (run?.error?.message) item.note = run.error.message;
        items.push(item);
        continue;
      }
      const decisions = pieceDecisions(record, piece.id);
      const last = decisions[decisions.length - 1];
      if (last?.decision !== 'changes_requested' || record.production.ownerId !== viewer.personId) continue;
      const newer = record.versions.some((version) => version.pieceId === piece.id && Date.parse(version.createdAt) > Date.parse(last.at));
      if (newer) continue;
      const item: AwaitingItem = { ...base, reason: 'changes_requested', from: personOf(ctx.state, last.by), at: last.at };
      if (last.subject.kind === 'version') {
        const version = findVersion(record, last.subject.versionId);
        if (version) item.version = toVersionView(record, version);
      }
      if (last.note) item.note = last.note;
      items.push(item);
    }
  }
  return items.sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''));
}

export function overviewData(ctx: ReadContext, range: OverviewRange): OverviewData {
  const viewer = currentMember(ctx.state);
  const records = ctx.state.productions.map((production) => assembleRecord(ctx.state, production));
  const view = buildOverview({
    records,
    history: ctx.state.history,
    activity: [],
    rangeDays: RANGE_DAYS[range],
    gates: ctx.gates,
    now: ctx.now,
    templates: ctx.templates,
    flow: ctx.flow,
    assets: ctx.assets,
    ...(viewer ? { viewer } : {}),
  });
  const { metrics } = view;
  const data: OverviewData = {
    rangeDays: view.rangeDays,
    rhythm: view.rhythm,
    trends: view.trends,
    activeRuns: view.activeRuns,
    range,
    metrics: {
      inProduction: metrics.inProduction,
      generatingNow: metrics.generatingNow,
      awaitingApproval: metrics.awaitingApproval,
      approved: withDelta(metrics.approved),
      timeToApprovalMs: withDelta(metrics.timeToApprovalMs, true),
      aiRetention: withDelta(metrics.aiRetention),
    },
    awaitingYou: awaitingItems(ctx),
    activity: activityPage(ctx, { size: 20 }).items,
    empty: ctx.state.productions.every((production) => production.production.archivedAt !== undefined),
  };
  const next = view.continueWith;
  if (next) {
    data.continueWith = next;
    const stage = next.stages.find((entry) => entry.id === next.currentStageId);
    const piece = next.pieces.find((entry) => entry.kind === stage?.pieceKind) ?? next.pieces[0];
    if (piece) data.continueReadiness = { pieceKind: piece.kind, checks: piece.checks, readiness: piece.readiness };
  }
  return data;
}
