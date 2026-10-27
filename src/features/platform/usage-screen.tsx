'use client';

import { Suspense,useState } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import type {PlatformFilter} from '@/ports/platform';
import { DataTable, EmptyState, ErrorState, formatBytes, Grid, MetaList, PageHeader, PageStack, Section, Segmented,Pagination, type Column } from '@content-ventures/design-system/v3';
import { ChartNoAxesColumn } from '@content-ventures/design-system/v3/icons';
import { DEFAULT_USAGE_PERIOD, type ModelUsage, type PersonUsage, type UsagePeriod } from '@/domain';
import { pipelineModelLabel } from '@/domain/pipeline';
import { usePlatformPeopleLabels, usePlatformUsage } from '@/state';
import { formatCount } from '@/ui/format';
import { formatCompact, formatUsd, PEOPLE_HREF, PERIOD_OPTIONS } from './format';
import { PersonName } from './person-name';
import { ActivityChart, CostChart, UsageStrip } from './usage-blocks';
import {PlatformFilters} from './platform-filters';

/**
 * Uso: the chosen period (7, 30 or 90 days) in indicators, activity and spend per day, and the
 * breakdown per model and per person. Cost is an estimate on the reference prices the page names.
 */
export function UsageScreen() {
  return<Suspense fallback={null}><UsageView/></Suspense>;
}
function UsageView(){
  const router = useRouter();
  const params=useSearchParams();
  const [filter,setFilter]=useState<PlatformFilter>({workspaceId:params.get('workspace')??undefined,personId:params.get('person')??undefined});
  const [period, setPeriod] = useState<UsagePeriod>(DEFAULT_USAGE_PERIOD);
  const usage = usePlatformUsage(period,filter);
  const report = usage.data;
  const [page,setPage]=useState(1);
  const rows=(report?.people??[]).slice((page-1)*20,page*20);
  const labels=usePlatformPeopleLabels(rows.map(entry=>entry.personId));
  const people = new Map((labels.data ?? []).map((person) => [person.id, person]));
  const loading = usage.status === 'loading';

  if (usage.status === 'error' && !report) {
    return (
      <>
        <PageHeader title="Uso" />
        <ErrorState title="Uso indisponível" description={usage.error?.message} onRetry={usage.retry} />
      </>
    );
  }

  const modelColumns: Column<ModelUsage>[] = [
    { key: 'model', header: 'Modelo', pinned: true, truncate: true, skeleton: 'lines', render: (model) => (model.model === '—' ? 'Modelo não informado' : pipelineModelLabel(model.model)) },
    { key: 'generations', header: 'Gerações', width: 112, align: 'end', numeric: true, skeleton: 'short', render: (model) => formatCount(model.generations) },
    { key: 'failed', header: 'Falhas', width: 96, align: 'end', numeric: true, skeleton: 'short', render: (model) => formatCount(model.failed) },
    { key: 'input', header: 'Tokens de entrada', width: 156, align: 'end', numeric: true, skeleton: 'short', render: (model) => formatCompact(model.inputTokens) },
    { key: 'output', header: 'Tokens gerados', width: 140, align: 'end', numeric: true, skeleton: 'short', render: (model) => formatCompact(model.outputTokens) },
    { key: 'cost', header: 'Custo estimado', width: 140, align: 'end', numeric: true, skeleton: 'short', render: (model) => (model.costUsd === null ? '—' : formatUsd(model.costUsd)) },
  ];

  const personColumns: Column<PersonUsage>[] = [
    {
      key: 'person',
      header: 'Pessoa',
      pinned: true,
      skeleton: 'control',
      render: (entry) => {
        const person = people.get(entry.personId);
        return <PersonName name={person?.name ?? `Consultar pessoa ${entry.personId.slice(0,8)}`} avatarUrl={person?.avatarUrl} onOpen={() => router.push(`${PEOPLE_HREF}?person=${encodeURIComponent(entry.personId)}`)} />;
      },
    },
    { key: 'days', header: 'Dias ativos', width: 112, align: 'end', numeric: true, skeleton: 'short', render: (entry) => formatCount(entry.activeDays) },
    { key: 'productions', header: 'Produções', width: 112, align: 'end', numeric: true, skeleton: 'short', render: (entry) => formatCount(entry.productions) },
    { key: 'generations', header: 'Gerações', width: 112, align: 'end', numeric: true, skeleton: 'short', render: (entry) => formatCount(entry.generations) },
    { key: 'tokens', header: 'Tokens', width: 112, align: 'end', numeric: true, skeleton: 'short', render: (entry) => formatCompact(entry.tokens) },
    { key: 'cost', header: 'Custo estimado', width: 140, align: 'end', numeric: true, skeleton: 'short', render: (entry) => formatUsd(entry.costUsd) },
  ];

  return (
    <>
      <PageHeader
        title="Uso"
        actions={<Segmented label="Período" size="sm" options={PERIOD_OPTIONS} value={`${period}`} onChange={(value) => {setPeriod(Number(value) as UsagePeriod);setPage(1);}} />}
      />
      <PageStack>
        <PlatformFilters value={filter} onChange={next=>{setFilter(next);setPage(1);}}/>
        <UsageStrip report={report} period={period} loading={loading} />
        <Grid columns="1:1" collapseBelow={1024}>
          <ActivityChart report={report} period={period} />
          <CostChart report={report} />
        </Grid>
        <Section title="Por modelo" titleAs="h2" variant="panel">
          <DataTable
            label="Uso por modelo"
            rows={report?.models ?? []}
            rowKey={(model) => model.model}
            columns={modelColumns}
            variant="plain"
            density="compact"
            fixed
            loading={loading}
            loadingRows={3}
            empty={<EmptyState size="inline" icon={ChartNoAxesColumn} title="Nenhuma geração no período" />}
          />
        </Section>
        <Section title="Por pessoa" titleAs="h2" variant="panel">
          <DataTable
            label="Uso por pessoa"
            rows={rows}
            rowKey={(entry) => entry.personId}
            rowLabel={(entry) => people.get(entry.personId)?.name ?? `Consultar pessoa ${entry.personId.slice(0,8)}`}
            columns={personColumns}
            variant="plain"
            density="compact"
            fixed
            onRowClick={(entry) => router.push(`${PEOPLE_HREF}?person=${encodeURIComponent(entry.personId)}`)}
            loading={loading}
            loadingRows={5}
            empty={<EmptyState size="inline" title="Ninguém usou no período" />}
            footer={report&&report.people.length>20?<Pagination page={page} pageSize={20} total={report.people.length} noun="pessoas" onPageChange={setPage}/>:undefined}
          />
        </Section>
        {report ? (
          <MetaList
            size="sm"
            items={[
              `${report.from.split('-').reverse().join('/')} – ${report.to.split('-').reverse().join('/')}`,
              `Armazenamento${report.storageIncomplete?' com autoria registrada':''}: ${formatBytes(report.storageBytes)}`,
              ...(report.storageIncomplete?['Arquivos antigos sem autoria ficam fora do filtro por pessoa.']:[]),
              `Custo estimado com preços de ${report.pricesAsOf.split('-').reverse().join('/')}`,
            ]}
          />
        ) : null}
      </PageStack>
    </>
  );
}
