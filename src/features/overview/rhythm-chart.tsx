'use client';

import { BarChart, ChartCard, ChartState, Legend, type ChartDatum, type ChartSeries } from '@content-ventures/design-system/v3';
import type { OverviewData } from '@/ports';
import { formatCount } from '@/ui/format';
import { axisNumber, dayTitle, RANGE_DAYS, rhythmLabels, weeklyTicks, type OverviewRangeKey } from './overview-format';

/**
 * "Ritmo editorial" (PLAN §3.1, reference 4): approvals per day in the window against the same
 * day of the window before it, the last day read as "Hoje". Whole approvals per day are bars, not
 * a line that reads as a rate; 180 px keeps it a strip beside the activity. Fed by the seeded
 * 60-day history plus the real records, so the bars move when something is approved.
 */

const HEIGHT = 180;

function seriesFor(range: OverviewRangeKey): ChartSeries[] {
  const days = RANGE_DAYS[range];
  return [
    { key: 'current', label: `Últimos ${days} dias`, color: 'blue' },
    { key: 'previous', label: `${days} dias anteriores`, color: 'neutral' },
  ];
}

function chartData(rhythm: OverviewData['rhythm'], range: OverviewRangeKey): ChartDatum[] {
  const labels = rhythmLabels(rhythm, range);
  return rhythm.map((point, index) => ({
    label: labels[index] ?? '—',
    title: dayTitle(point.dayEnd),
    values: { current: point.current, previous: point.previous },
  }));
}

export function RhythmChart({
  data,
  range,
  loading,
}: {
  data: OverviewData | undefined;
  range: OverviewRangeKey;
  loading: boolean;
}) {
  const series = seriesFor(range);
  const rhythm = data?.rhythm ?? [];
  const totals = {
    current: rhythm.reduce((sum, point) => sum + point.current, 0),
    previous: rhythm.reduce((sum, point) => sum + point.previous, 0),
  };
  const ready = !loading && data !== undefined;
  const days = RANGE_DAYS[range];

  return (
    <ChartCard
      title="Ritmo editorial"
      legend={
        <Legend
          label="Séries do ritmo editorial"
          items={[
            { key: 'current', label: series[0].label, color: 'blue', shape: 'square', value: ready ? formatCount(totals.current) : '—' },
            { key: 'previous', label: series[1].label, color: 'neutral', shape: 'square', value: ready ? formatCount(totals.previous) : '—' },
          ]}
        />
      }
    >
      {!ready ? (
        <ChartState kind="loading" skeleton="bars" height={HEIGHT} />
      ) : rhythm.every((point) => point.current === 0 && point.previous === 0) ? (
        <ChartState kind="empty" height={HEIGHT} title="Nenhuma aprovação no período" />
      ) : (
        <BarChart
          label={`Aprovações por dia nos últimos ${days} dias, contra os ${days} dias anteriores`}
          data={chartData(rhythm, range)}
          series={series}
          height={HEIGHT}
          format={formatCount}
          axisFormat={axisNumber}
          xTicks={weeklyTicks(rhythm.length)}
        />
      )}
    </ChartCard>
  );
}
