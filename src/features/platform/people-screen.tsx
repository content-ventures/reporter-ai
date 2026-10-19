'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  List,
  ListItem,
  ListItemSkeleton,
  MetaList,
  PageHeader,
  PageStack,
  Pagination,
  SearchField,
  Tabs,
  type Column,
} from '@content-ventures/design-system/v3';
import { SearchX, UserPlus, Users } from '@content-ventures/design-system/v3/icons';
import { ACCESS_STATUSES, type AccessStatus, type PlatformPerson } from '@/domain';
import { usePlatformDirectory, usePlatformUsage } from '@/state';
import { formatCount } from '@/ui/format';
import { RelativeTime } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import { InviteDrawer } from './invite-drawer';
import { PersonName } from './person-name';
import { PersonDrawer } from './person-drawer';
import { PEOPLE_HREF, rolesLabel, statusLabel, STATUS_TONES } from './format';

type Filter = 'all' | AccessStatus;

const PAGE_SIZE = 20;

const TAB_LABELS: Readonly<Record<Filter, string>> = { all: 'Todos', active: 'Ativos', invited: 'Convidados', pending: 'Aguardando', suspended: 'Suspensos' };

function matches(person: PlatformPerson, query: string): boolean {
  if (!query) return true;
  const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = fold(query.trim());
  return fold(person.name).includes(needle) || fold(person.email).includes(needle);
}

/** Who sees what first: waiting sign-ups, open links, active people, then suspended. */
const ORDER: Readonly<Record<AccessStatus, number>> = { pending: 0, invited: 1, active: 2, suspended: 3 };

export function PeopleScreen() {
  return (
    <Suspense fallback={null}>
      <PeopleView />
    </Suspense>
  );
}

function PeopleView() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = usePhone();
  const directory = usePlatformDirectory();
  const usage = usePlatformUsage(30);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const inviting = params.get('new') === '1';
  const openId = params.get('person');

  const setParam = (key: 'new' | 'person', value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key); else next.set(key, value);
    if (key === 'new') next.delete('person');
    const search = next.toString();
    router.replace(`${PEOPLE_HREF}${search ? `?${search}` : ''}`, { scroll: false });
  };

  const people = useMemo(() => directory.data?.people ?? [], [directory.data]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: people.length, active: 0, invited: 0, pending: 0, suspended: 0 };
    for (const person of people) result[person.status] += 1;
    return result;
  }, [people]);
  const rows = useMemo(
    () => people
      .filter((person) => (filter === 'all' || person.status === filter) && matches(person, query))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, 'pt-BR')),
    [people, filter, query],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const usageOf = (id: string) => usage.data?.people.find((entry) => entry.personId === id);
  const multiWorkspace = (directory.data?.workspaces.length ?? 0) > 1;
  const opened = openId ? people.find((person) => person.id === openId) : undefined;

  const columns: Column<PlatformPerson>[] = [
    { key: 'person', header: 'Pessoa', width: '22%', pinned: true, skeleton: 'control', render: (person) => <PersonName name={person.name} avatarUrl={person.avatarUrl} you={person.operator} onOpen={() => setParam('person', person.id)} /> },
    { key: 'email', header: 'E-mail', truncate: true, skeleton: 'text', render: (person) => person.email },
    { key: 'roles', header: 'Função', width: '17%', truncate: true, title: (person) => rolesLabel(person.roles), skeleton: 'short', render: (person) => rolesLabel(person.roles) },
    ...(multiWorkspace ? [{ key: 'workspace', header: 'Workspace', width: '16%', truncate: true, skeleton: 'short' as const, render: (person: PlatformPerson) => person.workspace?.name ?? '—' }] : []),
    { key: 'status', header: 'Status', width: 176, skeleton: 'short', render: (person) => <Badge tone={STATUS_TONES[person.status]} variant="text" dot wrap>{statusLabel(person.status)}</Badge> },
    { key: 'seen', header: 'Último acesso', width: 132, skeleton: 'short', render: (person) => (person.lastSeenAt ? <RelativeTime at={person.lastSeenAt} /> : '—') },
    { key: 'generations', header: 'Gerações · 30 dias', width: 148, align: 'end', numeric: true, skeleton: 'short', render: (person) => formatCount(usageOf(person.id)?.generations ?? 0) },
  ];

  const tabs = (
    <Tabs<Filter>
      label="Status"
      size="sm"
      value={filter}
      onChange={(value) => { setFilter(value); setPage(1); }}
      items={(['all', ...ACCESS_STATUSES] as Filter[]).map((value) => ({ value, label: TAB_LABELS[value], count: directory.data ? counts[value] : undefined }))}
    />
  );

  const empty = query.trim() ? (
    <EmptyState icon={SearchX} title={`Nada encontrado para “${query.trim()}”`} actions={<Button size="sm" onClick={() => setQuery('')}>Limpar busca</Button>} />
  ) : (
    <EmptyState icon={Users} title={filter === 'all' ? 'Ninguém com acesso ainda' : `Nenhuma pessoa em “${TAB_LABELS[filter]}”`} />
  );
  const error = directory.status === 'error' ? (
    <ErrorState title="Pessoas indisponíveis" description={directory.error?.message} onRetry={directory.retry} />
  ) : undefined;
  const pagination = rows.length > PAGE_SIZE ? (
    <Pagination page={current} pageSize={PAGE_SIZE} total={rows.length} noun={rows.length === 1 ? 'pessoa' : 'pessoas'} variant={phone ? 'compact' : 'auto'} onPageChange={setPage} />
  ) : undefined;
  const loading = directory.status === 'loading';

  return (
    <>
      <PageHeader
        title="Pessoas"
        actions={<Button variant="primary" icon={UserPlus} onClick={() => setParam('new', '1')}>Novo acesso</Button>}
      />
      <FilterBar
        filters={false}
        tabs={tabs}
        search={<SearchField size="sm" value={query} onValueChange={(value) => { setQuery(value); setPage(1); }} placeholder="Nome ou e-mail" label="Buscar por nome ou e-mail" />}
      />
      <PageStack>
        {phone ? (
          error ?? (
            <PageStack>
              <List label="Pessoas" empty={empty}>
                {loading ? [0, 1, 2, 3].map((index) => <ListItemSkeleton key={index} />) : shown.map((person) => (
                  <ListItem
                    key={person.id}
                    leading={<Avatar name={person.name} src={person.avatarUrl} size="sm" decorative />}
                    title={person.name}
                    onClick={() => setParam('person', person.id)}
                    trailing={<Badge tone={STATUS_TONES[person.status]} variant="text" dot>{statusLabel(person.status)}</Badge>}
                    description={<MetaList size="sm" wrap={false} items={[rolesLabel(person.roles), person.email]} />}
                  />
                ))}
              </List>
              {pagination}
            </PageStack>
          )
        ) : (
          <DataTable
            label="Pessoas da plataforma"
            rows={shown}
            rowKey={(person) => person.id}
            rowLabel={(person) => `${person.name} · ${statusLabel(person.status)}`}
            columns={columns}
            density="compact"
            fixed
            onRowClick={(person) => setParam('person', person.id)}
            loading={loading}
            loadingRows={6}
            error={error}
            empty={empty}
            transitionKey={`${filter}:${query}:${current}`}
            footer={pagination}
          />
        )}
      </PageStack>
      <InviteDrawer open={inviting} onClose={() => setParam('new', null)} workspaces={directory.data?.workspaces ?? []} />
      <PersonDrawer person={opened} usage={opened ? usageOf(opened.id) : undefined} onClose={() => setParam('person', null)} />
    </>
  );
}
