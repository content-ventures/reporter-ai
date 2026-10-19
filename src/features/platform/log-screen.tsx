'use client';

import { DataTable, EmptyState, ErrorState, PageHeader, PageStack, type Column } from '@content-ventures/design-system/v3';
import { ScrollText } from '@content-ventures/design-system/v3/icons';
import { PLATFORM_ACTION_LABELS, type PlatformLogEntry } from '@/domain';
import { usePlatformLog } from '@/state';
import { formatListDateTime } from '@/ui/format';
import { rolesLabel } from './format';
import { PersonName } from './person-name';

const LIMIT = 200;

/** Registro: every console write (who did what to whom), newest first. */
export function LogScreen() {
  const log = usePlatformLog(LIMIT);
  const columns: Column<PlatformLogEntry>[] = [
    { key: 'at', header: 'Quando', width: 120, skeleton: 'short', render: (entry) => formatListDateTime(entry.at) },
    {
      key: 'actor',
      header: 'Quem',
      width: 200,
      skeleton: 'control',
      render: (entry) => <PersonName name={entry.actor?.name ?? 'A própria pessoa'} avatarUrl={entry.actor?.avatarUrl} />,
    },
    { key: 'action', header: 'Ação', width: 180, skeleton: 'short', render: (entry) => PLATFORM_ACTION_LABELS[entry.action] },
    { key: 'target', header: 'Pessoa', pinned: true, truncate: true, title: (entry) => entry.target?.email ?? '', skeleton: 'lines', render: (entry) => (entry.target ? `${entry.target.name} · ${entry.target.email}` : '—') },
    { key: 'roles', header: 'Funções', width: '18%', truncate: true, skeleton: 'short', render: (entry) => (entry.roles?.length ? rolesLabel(entry.roles) : '—') },
  ];
  return (
    <>
      <PageHeader title="Registro" />
      <PageStack>
        <DataTable
          label="Registro do console"
          rows={log.data?.items ?? []}
          rowKey={(entry) => entry.id}
          rowLabel={(entry) => `${PLATFORM_ACTION_LABELS[entry.action]} · ${entry.target?.name ?? ''}`}
          columns={columns}
          density="compact"
          fixed
          loading={log.status === 'loading'}
          loadingRows={8}
          error={log.status === 'error' ? <ErrorState title="Registro indisponível" description={log.error?.message} onRetry={log.retry} /> : undefined}
          empty={<EmptyState icon={ScrollText} title="Nenhuma ação registrada" />}
        />
      </PageStack>
    </>
  );
}
