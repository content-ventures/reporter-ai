'use client';

import { BarChart, ChartCard, ChartFigures } from '@content-ventures/design-system/v3';
import type { OverviewData } from '@/ports';
import { approvalBars, durationFigure, RANGE_OPTIONS, type OverviewRangeKey } from './overview-format';

/**
 * "Sua semana": the window's figures (em produção, aprovadas, tempo até aprovar) over the approvals
 * per day (7 dias) or per week (30 dias), with the 7 | 30 dias switch in the card header.
 */
export function WeekPanel({
  data,
  range,
  onRangeChange,
}: {
  /** Overview on screen (its own window until the newly chosen one arrives). */
  data: OverviewData | undefined;
  /** Window chosen in the switch. */
  range: OverviewRangeKey;
  onRangeChange: (range: OverviewRangeKey) => void;
}) {
  const week = data?.desk.week;
  const lead = week?.timeToApprovalMs == null ? undefined : durationFigure(week.timeToApprovalMs);
  const shown = data?.range ?? range;
  const bars = data ? approvalBars(data.rhythm, shown) : [];
  return (
    <ChartCard
      title="Sua semana"
      titleAs="h2"
      period={{ options: RANGE_OPTIONS, value: range, onChange: onRangeChange }}
      figures={
        <ChartFigures
          loading={!week}
          items={[
            { label: 'Em produção', value: week?.inProduction ?? '—' },
            { label: 'Aprovadas', value: week?.approved ?? '—' },
            { label: 'Até aprovar', value: lead?.value ?? '—', unit: lead?.unit },
          ]}
        />
      }
    >
      <BarChart
        label={shown === '30d' ? 'Aprovações por semana' : 'Aprovações por dia'}
        data={bars.map((bar) => ({ label: bar.label, title: bar.title, values: { approved: bar.approved } }))}
        series={[{ key: 'approved', label: 'Aprovadas' }]}
        height={160}
        grid="dashed"
      />
    </ChartCard>
  );
}
