'use client';

import { BarChart, ChartCard, ChartFigures, LineChart, MeterList, MetricStrip, type MetricProps } from '@content-ventures/design-system/v3';
import { type UsagePeriod, type UsageReport } from '@/domain';
import { pipelineModelLabel } from '@/domain/pipeline';
import { formatCount } from '@/ui/format';
import { dayLabel, deltaOf, formatCompact, formatMinutes, formatUsd, PERIOD_OPTIONS } from './format';

/** Six indicators of the period against the one before, each with its daily trend. */
export function UsageStrip({ report, period, loading }: { report: UsageReport | undefined; period: UsagePeriod; loading: boolean }) {
  const totals = report?.totals;
  const previous = report?.previous;
  const days = report?.days ?? [];
  const line = (pick: (day: UsageReport['days'][number]) => number) => (days.length > 1 ? { points: days.map(pick) } : undefined);
  const items: MetricProps[] = [
    {
      label: 'Pessoas ativas',
      value: totals ? formatCount(totals.activePeople) : undefined,
      delta: totals && previous ? deltaOf(totals.activePeople, previous.activePeople, period) : undefined,
      sparkline: line((day) => day.activePeople),
      loading,
    },
    {
      label: 'Produções',
      value: totals ? formatCount(totals.productions) : undefined,
      delta: totals && previous ? deltaOf(totals.productions, previous.productions, period) : undefined,
      hint: totals ? `${formatCount(totals.approvals)} aprovadas` : undefined,
      sparkline: line((day) => day.productions),
      loading,
    },
    {
      label: 'Gerações de IA',
      value: totals ? formatCount(totals.generations) : undefined,
      delta: totals && previous ? deltaOf(totals.generations, previous.generations, period) : undefined,
      hint: totals && totals.failedGenerations > 0 ? `${formatCount(totals.failedGenerations)} com falha` : undefined,
      warn: Boolean(totals && totals.generations > 0 && totals.failedGenerations / (totals.generations + totals.failedGenerations) > 0.1),
      sparkline: line((day) => day.generations),
      loading,
    },
    {
      label: 'Tokens',
      value: totals ? formatCompact(totals.inputTokens + totals.outputTokens) : undefined,
      hint: totals ? `${formatCompact(totals.outputTokens)} gerados` : undefined,
      loading,
    },
    {
      label: 'Custo estimado',
      value: totals ? formatUsd(totals.costUsd) : undefined,
      delta: totals && previous ? deltaOf(totals.costUsd, previous.costUsd, period, true) : undefined,
      hint: totals?.unpriced ? 'Há modelo sem preço de referência' : undefined,
      loading,
    },
    {
      label: 'Áudio transcrito',
      value: totals ? formatMinutes(totals.audioMinutes) : undefined,
      empty: totals ? totals.audioMinutes === 0 : undefined,
      loading,
    },
  ];
  return <MetricStrip label={`Uso dos últimos ${period} dias`} items={items} />;
}

/** Generations, productions and active people per day; the 7 | 30 | 90 dias switch when the page has no other. */
export function ActivityChart({ report, period, onPeriodChange }: { report: UsageReport | undefined; period: UsagePeriod; onPeriodChange?: (period: UsagePeriod) => void }) {
  const days = report?.days ?? [];
  return (
    <ChartCard
      title="Atividade"
      titleAs="h2"
      period={onPeriodChange ? { options: PERIOD_OPTIONS, value: `${period}`, onChange: (value) => onPeriodChange(Number(value) as UsagePeriod), label: 'Período' } : undefined}
      figures={(
        <ChartFigures
          loading={!report}
          items={[
            { label: 'Gerações', value: report ? formatCount(report.totals.generations) : '—', color: 'blue' },
            { label: 'Produções', value: report ? formatCount(report.totals.productions) : '—', color: 'teal' },
            { label: 'Pessoas ativas', value: report ? formatCount(report.totals.activePeople) : '—', color: 'violet' },
          ]}
        />
      )}
    >
      <LineChart
        label="Atividade por dia"
        data={days.map((day) => ({ ...dayLabel(day.day), values: { generations: day.generations, productions: day.productions, people: day.activePeople } }))}
        series={[
          { key: 'generations', label: 'Gerações', color: 'blue' },
          { key: 'productions', label: 'Produções', color: 'teal' },
          { key: 'people', label: 'Pessoas ativas', color: 'violet' },
        ]}
        height={220}
        grid="dashed"
        curve="linear"
      />
    </ChartCard>
  );
}

/** Estimated spend per day. */
export function CostChart({ report }: { report: UsageReport | undefined }) {
  const days = report?.days ?? [];
  return (
    <ChartCard
      title="Custo estimado por dia"
      titleAs="h2"
      figures={<ChartFigures loading={!report} items={[{ label: 'No período', value: report ? formatUsd(report.totals.costUsd) : '—' }]} />}
    >
      <BarChart
        label="Custo estimado por dia"
        data={days.map((day) => ({ ...dayLabel(day.day), values: { cost: Math.round(day.costUsd * 100) / 100 } }))}
        series={[{ key: 'cost', label: 'Custo (US$)' }]}
        format={formatUsd}
        axisFormat={(value) => `US$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`}
        height={220}
        grid="dashed"
      />
    </ChartCard>
  );
}

/** Share of tokens per model, with the estimated cost of each. */
export function ModelShare({ report }: { report: UsageReport | undefined }) {
  const models = report?.models ?? [];
  const total = models.reduce((sum, model) => sum + model.inputTokens + model.outputTokens, 0);
  return (
    <ChartCard title="Por modelo" titleAs="h2">
      <MeterList
        label="Tokens por modelo"
        format={formatCompact}
        items={models.map((model, index) => {
          const tokens = model.inputTokens + model.outputTokens;
          return {
            key: model.model,
            label: model.model === '—' ? 'Modelo não informado' : pipelineModelLabel(model.model),
            value: tokens,
            share: total ? Math.round((tokens / total) * 1000) / 10 : 0,
            caption: `${formatCount(model.generations)} gerações · ${model.costUsd === null ? 'sem preço' : formatUsd(model.costUsd)}`,
            color: (['blue', 'teal', 'violet', 'amber', 'pink'] as const)[index % 5],
          };
        })}
      />
    </ChartCard>
  );
}
