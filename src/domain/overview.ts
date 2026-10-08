import type { ActivityEvent } from './activity.ts';
import { gateForPiece } from './decision.ts';
import type { GateDefinition } from './decision.ts';
import type { IsoDateTime, ProductionId } from './ids.ts';
import { average, median, productionRetention, timeToApprovalMs } from './metrics.ts';
import { lastActivityAt, pieceDecisions, pieceOfKind } from './record.ts';
import type { ProductionRecord } from './record.ts';
import { buildProductionView } from './views.ts';
import type { ProductionView, RunView, ViewOptions } from './views.ts';
import { hasAnyRole } from './workspace.ts';
import type { Member } from './workspace.ts';

/**
 * "Visão geral" read model. Metrics come from real records plus a seeded summary history
 * (fixtures) so 7/30-day deltas are believable; nothing is invented (no simulated cost).
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Summary of a past approval (seeded 60-day history; real records are converted the same way). */
export type ApprovalPoint = {
  productionId: ProductionId;
  approvedAt: IsoDateTime;
  timeToApprovalMs?: number;
  /** 0–1 share of AI words kept. */
  aiRetention?: number;
};

export type MetricValue = { value: number | null; previous: number | null };

export type OverviewView = {
  rangeDays: number;
  metrics: {
    inProduction: number;
    generatingNow: number;
    awaitingApproval: number;
    approved: MetricValue;
    timeToApprovalMs: MetricValue;
    aiRetention: MetricValue;
  };
  /** Approvals per day: `current` window vs the `previous` one, oldest day first. */
  rhythm: { dayOffset: number; dayEnd: IsoDateTime; current: number; previous: number }[];
  /**
   * Each windowed metric as it stood at the end of every day of the window (a trailing window of
   * the same length), oldest day first; the last point is the metric now (KPI sparklines). `null`
   * where that trailing window had no sample.
   */
  trends: { approved: (number | null)[]; timeToApprovalMs: (number | null)[]; aiRetention: (number | null)[] };
  continueWith?: ProductionView;
  awaitingYou: ProductionView[];
  activeRuns: (RunView & { productionTitle: string })[];
  activity: ActivityEvent[];
};

export type OverviewInput = {
  records: readonly ProductionRecord[];
  history?: readonly ApprovalPoint[];
  activity?: readonly ActivityEvent[];
  rangeDays: number;
  viewer?: Member;
  gates?: readonly GateDefinition[];
  activityLimit?: number;
} & ViewOptions;

/** First article approval of each record, as an ApprovalPoint. */
export function approvalPoints(records: readonly ProductionRecord[]): ApprovalPoint[] {
  const points: ApprovalPoint[] = [];
  for (const record of records) {
    const article = pieceOfKind(record, 'article');
    if (!article) continue;
    const first = pieceDecisions(record, article.id).find((decision) => decision.decision === 'approved');
    if (!first) continue;
    const point: ApprovalPoint = { productionId: record.production.id, approvedAt: first.at };
    const lead = timeToApprovalMs(record);
    if (lead !== undefined) point.timeToApprovalMs = lead;
    const retention = productionRetention(record)?.ratio;
    if (retention !== undefined && retention !== null) point.aiRetention = retention;
    points.push(point);
  }
  return points;
}

function inWindow(at: IsoDateTime, end: number, days: number): boolean {
  const time = Date.parse(at);
  return time <= end && time > end - days * DAY_MS;
}

type MetricPick = (points: ApprovalPoint[]) => number | undefined;

function metric(points: readonly ApprovalPoint[], now: number, days: number, pick: MetricPick): MetricValue {
  const current = points.filter((point) => inWindow(point.approvedAt, now, days));
  const previous = points.filter((point) => inWindow(point.approvedAt, now - days * DAY_MS, days));
  return { value: pick(current) ?? null, previous: pick(previous) ?? null };
}

/** The metric over a trailing `days` window ending at each day of the window, oldest first. */
function trend(points: readonly ApprovalPoint[], now: number, days: number, pick: MetricPick): (number | null)[] {
  const series: (number | null)[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const end = now - offset * DAY_MS;
    series.push(pick(points.filter((point) => inWindow(point.approvedAt, end, days))) ?? null);
  }
  return series;
}

const countOf: MetricPick = (window) => window.length;
const medianLead: MetricPick = (window) =>
  median(window.map((point) => point.timeToApprovalMs).filter((value): value is number => value !== undefined));
const averageRetention: MetricPick = (window) =>
  average(window.map((point) => point.aiRetention).filter((value): value is number => value !== undefined));

export function buildOverview(input: OverviewInput): OverviewView {
  const now = Date.parse(input.now);
  const days = input.rangeDays;
  const live = input.records.filter((record) => !record.production.archivedAt);
  const views = live.map((record) => ({ record, view: buildProductionView(record, input) }));

  const recordIds = new Set(input.records.map((record) => record.production.id));
  const points = [...approvalPoints(input.records), ...(input.history ?? []).filter((point) => !recordIds.has(point.productionId))];

  const rhythm: OverviewView['rhythm'] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const end = now - offset * DAY_MS;
    rhythm.push({
      dayOffset: offset,
      dayEnd: new Date(end).toISOString(),
      current: points.filter((point) => inWindow(point.approvedAt, end, 1)).length,
      previous: points.filter((point) => inWindow(point.approvedAt, end - days * DAY_MS, 1)).length,
    });
  }

  const awaitingYou = views
    .filter(({ record, view }) =>
      view.pieces.some((piece) => {
        if (piece.status === 'in_review') {
          const gate = gateForPiece(piece.kind, input.gates);
          return gate !== undefined && hasAnyRole(input.viewer, gate.roles);
        }
        return piece.status === 'changes_requested' && record.production.ownerId === input.viewer?.personId;
      }),
    )
    .map(({ view }) => view);

  const candidates = views
    .filter(({ view, record }) => {
      if (view.status === 'completed' || view.status === 'archived') return false;
      return !input.viewer || record.production.ownerId === input.viewer.personId;
    })
    .sort((a, b) => Date.parse(lastActivityAt(b.record)) - Date.parse(lastActivityAt(a.record)));

  const activeRuns = views.flatMap(({ view }) => view.activeRuns.map((run) => ({ ...run, productionTitle: view.title })));

  const overview: OverviewView = {
    rangeDays: days,
    metrics: {
      inProduction: views.filter(({ view }) => view.status !== 'completed').length,
      generatingNow: activeRuns.length,
      awaitingApproval: views.reduce((total, { view }) => total + view.pieces.filter((piece) => piece.status === 'in_review').length, 0),
      approved: metric(points, now, days, countOf),
      timeToApprovalMs: metric(points, now, days, medianLead),
      aiRetention: metric(points, now, days, averageRetention),
    },
    rhythm,
    trends: {
      approved: trend(points, now, days, countOf),
      timeToApprovalMs: trend(points, now, days, medianLead),
      aiRetention: trend(points, now, days, averageRetention),
    },
    awaitingYou,
    activeRuns,
    activity: [...(input.activity ?? [])]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, input.activityLimit ?? 20),
  };
  if (candidates[0]) overview.continueWith = candidates[0].view;
  return overview;
}
