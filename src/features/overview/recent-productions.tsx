'use client';

import { useRouter } from 'next/navigation';
import { DataTable, EmptyState, ErrorState, MetaList, Panel, Section, TextLink, type Column } from '@content-ventures/design-system/v3';
import type { ProductionListItem } from '@/ports';
import { useProductions } from '@/state';
import { PersonAvatar } from '@/ui/person-avatar';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { NextStepCell, rowHref, SituationCell } from '@/features/productions/production-cells';

const TITLE = 'Produções recentes';
const FILTER = { sort: 'updated_desc' } as const;
const PAGE = { page: 1, size: 5 };

const columns: Column<ProductionListItem>[] = [
  {
    key: 'production',
    header: 'Produção',
    pinned: true,
    render: (item) => <TextLink href={rowHref(item)} tone="inherit">{item.title}</TextLink>,
  },
  {
    key: 'owner',
    header: 'Responsável',
    width: 152,
    skeleton: 'control',
    render: (item) => <MetaList size="sm" separator="" items={[<PersonAvatar key="avatar" person={item.owner} size="xs" decorative />, item.owner.name]} />,
  },
  { key: 'stage', header: 'Etapa', width: 104, skeleton: 'short', render: (item) => item.stages.find((stage) => stage.id === item.currentStageId)?.label },
  { key: 'situation', header: 'Situação', width: 184, render: (item) => <SituationCell item={item} size="sm" /> },
  { key: 'next', header: 'Próximo passo', width: 120, skeleton: 'short', render: (item) => <NextStepCell item={item} /> },
];

/** The five productions touched last, from the productions list; the rest is behind "Ver todas". */
export function RecentProductions() {
  const query = useProductions(FILTER, PAGE);
  const router = useRouter();
  return (
    <Panel>
      <Section title={TITLE} action={<TextLink size="sm" href={PRODUCTIONS_HREF}>Ver todas</TextLink>}>
        <DataTable
          label={TITLE}
          rows={query.data?.items ?? []}
          rowKey={(item) => item.id}
          columns={columns}
          variant="plain"
          density="compact"
          loading={query.status === 'loading'}
          loadingRows={PAGE.size}
          error={query.status === 'error' && !query.data ? <ErrorState size="inline" title="Não foi possível carregar as produções" onRetry={query.retry} /> : undefined}
          empty={<EmptyState size="inline" title="Nenhuma produção ainda" />}
          onRowClick={(item) => router.push(rowHref(item))}
        />
      </Section>
    </Panel>
  );
}
