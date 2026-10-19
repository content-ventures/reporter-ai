'use client';

import { Avatar, DataTable, EmptyState, ErrorState, List, ListItem, ListItemSkeleton, MetaList, PageHeader, PageStack, type Column } from '@content-ventures/design-system/v3';
import { ScrollText } from '@content-ventures/design-system/v3/icons';
import { PLATFORM_ACTION_LABELS, type PlatformLogEntry } from '@/domain';
import { usePlatformLog } from '@/state';
import { formatListDateTime } from '@/ui/format';
import { RelativeTime } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import { rolesLabel } from './format';
import { PersonName } from './person-name';

const LIMIT = 200;

/** Registro: every console write (who did what to whom), newest first; a list on phones. */
export function LogScreen() {
  const log = usePlatformLog(LIMIT);
  const phone = usePhone();
  const rows = log.data?.items ?? [];
  const loading = log.status === 'loading';
  const error = log.status === 'error' ? <ErrorState title="Registro indisponível" description={log.error?.message} onRetry={log.retry} /> : undefined;
  const empty = <EmptyState icon={ScrollText} title="Nenhuma ação registrada" />;
  const columns: Column<PlatformLogEntry>[] = [
    { key: 'at', header: 'Quando', width: 120, skeleton: 'short', render: (entry) => formatListDateTime(entry.at) },
    { key: 'actor', header: 'Quem', width: 200, skeleton: 'control', render: (entry) => <PersonName name={entry.actor?.name ?? 'A própria pessoa'} avatarUrl={entry.actor?.avatarUrl} /> },
    { key: 'action', header: 'Ação', width: 180, skeleton: 'short', render: (entry) => PLATFORM_ACTION_LABELS[entry.action] },
    { key: 'target', header: 'Pessoa', pinned: true, truncate: true, title: (entry) => entry.target?.email ?? '', skeleton: 'lines', render: (entry) => (entry.target ? `${entry.target.name} · ${entry.target.email}` : '—') },
    { key: 'roles', header: 'Funções', width: '18%', truncate: true, skeleton: 'short', render: (entry) => (entry.roles?.length ? rolesLabel(entry.roles) : '—') },
  ];
  return (
    <>
      <PageHeader title="Registro" />
      <PageStack>
        {phone ? (
          error ?? (
            <List label="Registro do console" empty={empty}>
              {loading ? [0, 1, 2, 3].map((index) => <ListItemSkeleton key={index} />) : rows.map((entry) => (
                <ListItem
                  key={entry.id}
                  leading={<Avatar name={entry.actor?.name ?? entry.target?.name ?? 'Pessoa'} src={entry.actor?.avatarUrl} size="sm" decorative />}
                  title={`${PLATFORM_ACTION_LABELS[entry.action]}${entry.target ? ` · ${entry.target.name}` : ''}`}
                  description={<MetaList size="sm" wrap={false} items={[entry.actor?.name ?? 'A própria pessoa', ...(entry.roles?.length ? [rolesLabel(entry.roles)] : [])]} />}
                  trailing={<RelativeTime at={entry.at} />}
                />
              ))}
            </List>
          )
        ) : (
          <DataTable
            label="Registro do console"
            rows={rows}
            rowKey={(entry) => entry.id}
            rowLabel={(entry) => `${PLATFORM_ACTION_LABELS[entry.action]} · ${entry.target?.name ?? ''}`}
            columns={columns}
            density="compact"
            fixed
            loading={loading}
            loadingRows={8}
            error={error}
            empty={empty}
          />
        )}
      </PageStack>
    </>
  );
}
