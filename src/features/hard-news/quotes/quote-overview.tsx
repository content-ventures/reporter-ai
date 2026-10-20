'use client';

import { ChartCard, DonutChart, Grid, MeterList, MetricStrip } from '@content-ventures/design-system/v3';
import { CITATION_VERDICTS, CLAIM_KIND_LABELS, CLAIM_KINDS, VERDICT_LABELS } from '@/domain/fact-check';
import { bankSummary, kindDistribution, verdictDistribution, type RankedQuote } from './quote-model';
import { KIND_COLOR, VERDICT_COLOR } from './verdict-view';

/** The bank at a glance: how much was checked, how it scored, and what it is made of. */
export function QuoteOverview({ entries, ready }: { entries: readonly RankedQuote[]; ready: boolean }) {
  const summary = bankSummary(entries);
  const kinds = kindDistribution(entries);
  const verdicts = verdictDistribution(entries);
  const value = (text: string) => (ready ? text : undefined);
  return (
    <>
      <MetricStrip
        label="Banco de citações"
        items={[
          { label: 'Falas', value: value(String(summary.total)), loading: !ready },
          summary.averageScore === undefined
            ? { label: 'Score médio', empty: 'Nenhuma fala checada', loading: !ready }
            : { label: 'Score médio', value: value(String(summary.averageScore)), loading: !ready, meter: { value: summary.averageScore, max: 100 } },
          { label: 'Checadas', value: value(`${summary.checked} de ${summary.total}`), loading: !ready,
            meter: { value: summary.checked, max: Math.max(1, summary.total), tone: summary.total && summary.checked === summary.total ? 'green' : 'neutral' } },
          { label: 'Contestadas', value: value(String(summary.disputed)), loading: !ready },
          { label: 'Usos em matérias', value: value(String(summary.uses)), loading: !ready },
        ]}
      />
      <Grid columns="1:1" collapseBelow={1024}>
        <ChartCard title="Tipos de afirmação" titleAs="h2">
          <DonutChart
            label="Afirmações das falas checadas, por tipo"
            size={168}
            centerLabel="Afirmações"
            data={CLAIM_KINDS.map((kind) => ({ key: kind, label: CLAIM_KIND_LABELS[kind], value: kinds[kind], color: KIND_COLOR[kind] }))}
          />
        </ChartCard>
        <ChartCard title="Vereditos" titleAs="h2">
          <MeterList
            label="Falas por veredito"
            items={CITATION_VERDICTS.map((verdict) => ({ key: verdict, label: VERDICT_LABELS[verdict], value: verdicts[verdict],
              share: summary.total ? (verdicts[verdict] / summary.total) * 100 : 0, color: VERDICT_COLOR[verdict] }))}
          />
        </ChartCard>
      </Grid>
    </>
  );
}
