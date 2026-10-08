'use client';

import { MetricStrip, type MetricProps } from '@content-ventures/design-system/v3';
import type { OverviewData } from '@/ports';
import { dashboardWidgetsFor, type DashboardWidget } from '@/registries';
import { formatCount } from '@/ui/format';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import {
  countDelta,
  durationDelta,
  durationFigure,
  durationText,
  percentFigure,
  pointsDelta,
  previousWindow,
  RANGE_DAYS,
  sparklineOf,
  type OverviewRangeKey,
} from './overview-format';

/**
 * The KPI strip of "Visão geral" (PLAN §3.1). The cells come from the dashboard registry
 * (`area: 'metrics'`), so a widget a later release adds — or the cost one, once a real adapter
 * reports cost — plugs in without touching the screen. Values crossfade when they change. The
 * approvals and the time to approval carry a gray sparkline of how they moved over the window
 * (seeded 60-day history plus the real records); the counts of right now (em produção,
 * aguardando) have none, and the AI retention keeps its meter instead.
 */

/** Productions list filtered to "Aguardando aprovação" (the list reads `?status=`). */
export const AWAITING_APPROVAL_HREF = '/productions?status=in_review';

type MetricBuilder = (data: OverviewData, days: number) => Omit<MetricProps, 'label'>;

const BUILDERS: Record<string, MetricBuilder> = {
  'in-production': (data) => ({
    value: formatCount(data.metrics.inProduction),
    href: PRODUCTIONS_HREF,
    hint: data.metrics.generatingNow > 0 ? `${formatCount(data.metrics.generatingNow)} gerando agora` : undefined,
  }),
  'awaiting-approval': (data) => ({
    value: formatCount(data.metrics.awaitingApproval),
    href: AWAITING_APPROVAL_HREF,
  }),
  approved: (data, days) => {
    const metric = data.metrics.approved;
    return {
      value: metric.value === null ? undefined : formatCount(metric.value),
      delta: countDelta(metric.delta, metric.trend, days),
      hint: metric.previous === null ? undefined : `${formatCount(metric.previous)} ${previousWindow(days)}`,
      sparkline: sparklineOf(data.trends.approved, days, formatCount),
    };
  },
  'time-to-approval': (data, days) => {
    const metric = data.metrics.timeToApprovalMs;
    const figure = metric.value === null ? undefined : durationFigure(metric.value);
    return {
      value: figure?.value,
      unit: figure?.unit,
      delta: durationDelta(metric.delta, metric.trend, days),
      hint: metric.previous === null ? undefined : `${durationText(metric.previous)} ${previousWindow(days)}`,
      sparkline: sparklineOf(data.trends.timeToApprovalMs, days, durationText),
    };
  },
  'ai-retention': (data, days) => {
    const metric = data.metrics.aiRetention;
    return {
      value: metric.value === null ? undefined : percentFigure(metric.value),
      unit: '%',
      delta: pointsDelta(metric.delta, metric.trend, days),
      meter: metric.value === null ? undefined : { value: Math.round(metric.value * 1000) / 10, label: 'Palavras da IA mantidas' },
      hint: 'Palavras da v1 mantidas',
    };
  },
};

function metricWidgets(): DashboardWidget[] {
  return dashboardWidgetsFor().filter((widget) => widget.area === 'metrics' && widget.id in BUILDERS);
}

export function OverviewMetrics({ data, range, loading }: { data: OverviewData | undefined; range: OverviewRangeKey; loading: boolean }) {
  const widgets = metricWidgets();
  const days = RANGE_DAYS[range];
  const items: MetricProps[] = widgets.map((widget) => {
    const build = BUILDERS[widget.id];
    if (loading || !data || !build) return { label: widget.label, loading: true };
    return { label: widget.label, ...build(data, days) };
  });
  return <MetricStrip label={`Indicadores dos últimos ${days} dias`} items={items} columns={items.length} />;
}
