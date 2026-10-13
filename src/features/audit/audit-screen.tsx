'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  AccessState,
  Button,
  ButtonLink,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  List,
  ListItem,
  ListItemSkeleton,
  MetaList,
  MetricStrip,
  PageHeader,
  PageStack,
  Pagination,
  SearchField,
  type Column,
  type MetricProps,
} from '@content-ventures/design-system/v3';
import { ListFilter, ScrollText, SearchX, ShieldAlert, TriangleAlert, CalendarDays } from '@content-ventures/design-system/v3/icons';
import { canReadAudit } from '@/domain';
import type { AuditEntry, AuditPage } from '@/ports';
import { useAudit, useAuditEvent, useSession, useSimulation, type QueryState } from '@/state';
import { formatCount, formatListDateTime, plural } from '@/ui/format';
import { PersonAvatar } from '@/ui/person-avatar';
import { OVERVIEW_HREF } from '@/ui/routes';
import { memberDetail, useCommandGroup } from '@/ui/shell';
import { RelativeTime, useNow, useRelativeTime } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import { localDay } from '@/ui/days';
import { ActionCell, ItemCell, PersonCell, ResultBadge } from './audit-cells';
import { AuditDrawer } from './audit-drawer';
import { AUDIT_FILTER_BAND_ID, AuditActiveFilters, AuditFilterBand } from './audit-filters';
import { itemLabel, lastSeen } from './audit-format';
import { AUDIT_PAGE_SIZES, auditFilter, auditFilterCount, CLEARED_AUDIT_FILTERS, DEFAULT_AUDIT_PARAMS, serializeAuditParams, type AuditParams } from './audit-params';
import { useAuditParams, type SetAuditParams } from './use-audit-params';

/**
 * Logs (`/admin/audit`, F1.7, wireframe R1·5): the read-only audit trail for admins. "Filtros"
 * with Período, Pessoa, Tipo and Resultado (all in the URL), a strip with events, sign-ins, access
 * denials and failures of what the filters keep (the last three narrow the table), the table of
 * events newest first with pagination, and the event drawer (`?event=`). Anyone else gets AccessState, and the refusal is audited;
 * ⌘K › Simulação can make the next read fail ("Log indisponível").
 */

export function AuditScreen() {
  return (
    <Suspense fallback={<AuditView params={DEFAULT_AUDIT_PARAMS} setParams={() => undefined} />}>
      <AuditFromUrl />
    </Suspense>
  );
}

function AuditFromUrl() {
  const [params, setParams] = useAuditParams();
  return <AuditView params={params} setParams={setParams} />;
}

type Shown = { page: AuditPage; key: string };

/** The page on screen: the latest answer, or the previous one while a new filter's first answer is on its way. */
function useShownPage(state: QueryState<AuditPage>, key: string): Shown | undefined {
  const [kept, setKept] = useState<Shown | undefined>(undefined);
  const fresh = state.status === 'ready' ? state.data : undefined;
  if (fresh && (kept?.page !== fresh || kept.key !== key)) setKept({ page: fresh, key });
  return fresh ? { page: fresh, key } : kept;
}

type SearchState = { draft: string; url: string; pending?: string };

/** The search box keeps what is typed; the URL (and the query) follow 220 ms later. */
function useSearchDraft(params: AuditParams, setParams: SetAuditParams) {
  const [search, setSearch] = useState<SearchState>({ draft: params.q, url: params.q });
  if (search.url !== params.q) setSearch({ draft: search.pending === params.q ? search.draft : params.q, url: params.q });
  useEffect(() => {
    if (search.draft === params.q) return undefined;
    const value = search.draft;
    const timer = window.setTimeout(
      () => {
        setSearch((current) => ({ ...current, pending: value }));
        setParams({ q: value });
      },
      value.trim() ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [search.draft, params.q, setParams]);
  return [search.draft, (draft: string) => setSearch((current) => ({ ...current, draft }))] as const;
}

function AuditView({ params, setParams }: { params: AuditParams; setParams: SetAuditParams }) {
  const phone = usePhone();
  const now = useNow();
  const session = useSession();
  const simulation = useSimulation();
  const member = session.data?.current;

  // The trail is asked even when the session already says no: the refusal is what gets audited.
  const listKey = serializeAuditParams({ ...params, event: null });
  const query = useAudit(auditFilter(params), { page: params.page, size: params.size });
  const shown = useShownPage(query, listKey);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retryOf, setRetryOf] = useState<QueryState<AuditPage> | null>(null);
  const [draft, setDraft] = useSearchDraft(params, setParams);

  const restricted = (member !== undefined && !canReadAudit(member.roles)) || query.error?.code === 'restricted';
  const failed = query.status === 'error' && !restricted;
  const retrying = failed && query === retryOf;

  const page = failed ? undefined : shown?.page;
  const rows = page?.items ?? [];
  const metrics = page?.metrics;
  const mode: 'loading' | 'error' | 'rows' = failed ? 'error' : page ? 'rows' : 'loading';
  const refreshing = query.status === 'loading' && Boolean(page);
  const filterCount = auditFilterCount(params);
  const searching = params.q.trim().length > 0;
  const people = page?.people ?? [];

  const fromRows = params.event ? rows.find((row) => row.id === params.event) : undefined;
  const lookup = useAuditEvent(params.event && !fromRows && !restricted ? params.event : null);
  const opened = fromRows ?? lookup.data;

  const lastSignIn = useRelativeTime(metrics?.lastSignInAt);
  const lastDenied = useRelativeTime(metrics?.lastDeniedAt);
  const lastFailure = useRelativeTime(metrics?.lastFailureAt);

  const toggleResult = (result: 'denied' | 'failure') => setParams({ result: params.result === result ? null : result });
  const toggleSessions = () => setParams({ type: params.type === 'session' ? null : 'session' });
  const today = now ? localDay(now) : undefined;

  useCommandGroup(
    restricted
      ? null
      : {
          label: 'Filtrar logs',
          showWhenEmpty: false,
          items: [
            { id: 'audit-denied', label: 'Ver acessos negados', icon: ShieldAlert, onSelect: () => setParams({ result: 'denied' }) },
            { id: 'audit-failures', label: 'Ver falhas nos logs', icon: TriangleAlert, onSelect: () => setParams({ result: 'failure' }) },
            ...(today ? [{ id: 'audit-today', label: 'Ver eventos de hoje', icon: CalendarDays, onSelect: () => setParams({ from: today, to: today }) }] : []),
            ...(member ? [{ id: 'audit-mine', label: 'Ver meus eventos', icon: ListFilter, onSelect: () => setParams({ person: member.id }) }] : []),
          ],
        },
  );

  if (restricted) {
    return (
      <AccessState
        kind="restricted"
        heading="h1"
        title="Logs restritos a administradores"
        meta={member ? `${member.name} · ${memberDetail(member)}` : undefined}
        actions={
          <ButtonLink href={OVERVIEW_HREF} variant="primary">
            Ir para o Início
          </ButtonLink>
        }
      />
    );
  }

  const open = (entry: AuditEntry) => setParams({ event: entry.id });
  const loading = mode === 'loading';
  const metricItems: MetricProps[] = [
    {
      label: 'Eventos',
      value: metrics ? formatCount(metrics.events) : undefined,
      hint: metrics && metrics.people > 0 ? plural(metrics.people, 'pessoa', 'pessoas') : undefined,
      loading,
    },
    {
      label: 'Logins',
      value: metrics ? formatCount(metrics.signIns) : undefined,
      hint: lastSeen(lastSignIn, 'm'),
      tooltip: params.type === 'session' ? 'Mostrar todos os tipos' : 'Ver só login e sessão',
      onClick: toggleSessions,
      loading,
    },
    {
      label: 'Acessos negados',
      value: metrics ? formatCount(metrics.denied) : undefined,
      hint: lastSeen(lastDenied, 'm'),
      warn: params.result !== 'denied' && (metrics?.denied ?? 0) > 0,
      tooltip: params.result === 'denied' ? 'Mostrar todos os resultados' : 'Ver só os acessos negados',
      onClick: () => toggleResult('denied'),
      loading,
    },
    {
      label: 'Falhas',
      value: metrics ? formatCount(metrics.failures) : undefined,
      hint: lastSeen(lastFailure, 'f'),
      tooltip: params.result === 'failure' ? 'Mostrar todos os resultados' : 'Ver só as falhas',
      onClick: () => toggleResult('failure'),
      loading,
    },
  ];

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'Quando', width: 112, sortable: true, skeleton: 'short', render: (entry) => formatListDateTime(entry.at) },
    {
      key: 'person',
      header: 'Pessoa',
      width: 176,
      skeleton: 'control',
      render: (entry) => <PersonCell entry={entry} active={params.person === entry.actorId} onToggle={() => setParams({ person: params.person === entry.actorId ? null : entry.actorId })} />,
    },
    { key: 'action', header: 'Ação', pinned: true, truncate: true, title: (entry) => entry.title, skeleton: 'lines', render: (entry) => <ActionCell entry={entry} /> },
    { key: 'item', header: 'Item', width: '32%', truncate: true, title: itemLabel, skeleton: 'lines', render: (entry) => <ItemCell entry={entry} /> },
    { key: 'result', header: 'Resultado', width: 112, skeleton: 'short', render: (entry) => <ResultBadge result={entry.result} wrap /> },
  ];

  const errorBlock = (
    <ErrorState
      title="Log indisponível"
      description={query.error?.message}
      retrying={retrying}
      onRetry={() => {
        setRetryOf(query);
        query.retry();
      }}
    />
  );
  const emptyBlock = emptyState({ params, page, searching, filterCount, setParams, simulation });
  const pagination =
    mode === 'rows' && page && page.total > 0 ? (
      <Pagination
        page={page.page}
        pageSize={params.size}
        sizes={[...AUDIT_PAGE_SIZES]}
        total={page.total}
        noun={page.total === 1 ? 'evento' : 'eventos'}
        variant={phone ? 'compact' : 'auto'}
        onPageChange={(next) => setParams({ page: next }, { history: 'push' })}
        onPageSizeChange={phone ? undefined : (size) => setParams({ size })}
      />
    ) : undefined;

  const table = phone ? (
    <PhoneList rows={rows} mode={mode} empty={emptyBlock} error={errorBlock} footer={pagination} onOpen={open} />
  ) : (
    <DataTable
      label="Eventos do log"
      rows={rows}
      rowKey={(entry) => entry.id}
      rowLabel={(entry) => `${entry.title} · ${itemLabel(entry)}`}
      columns={columns}
      density="compact"
      fixed
      sort={{ key: 'at', direction: params.sort === 'oldest' ? 'asc' : 'desc' }}
      onSort={(next) => setParams({ sort: next.direction === 'asc' ? 'oldest' : 'newest' })}
      onRowClick={open}
      loading={mode === 'loading'}
      loadingRows={10}
      error={mode === 'error' ? errorBlock : undefined}
      empty={emptyBlock}
      transitionKey={shown?.key ?? listKey}
      footer={pagination}
    />
  );

  // Wireframe R1·5 order: filters, then the strip (it summarizes what the filters keep), then rows.
  return (
    <>
      <PageHeader title="Logs" />
      <FilterBar
        search={
          <SearchField
            size="sm"
            value={draft}
            onValueChange={setDraft}
            loading={refreshing && searching}
            placeholder="Ação, item ou ID"
            label="Buscar por ação, item ou ID"
          />
        }
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        filterCount={filterCount}
        bandId={AUDIT_FILTER_BAND_ID}
      />
      <PageStack>
        <AuditFilterBand open={filtersOpen} params={params} setParams={setParams} people={people} viewerId={member?.id} />
        {!filtersOpen && filterCount > 0 && (
          <AuditActiveFilters
            params={params}
            setParams={setParams}
            people={people}
            onEdit={() => setFiltersOpen(true)}
            summary={page ? plural(page.total, 'evento', 'eventos') : undefined}
          />
        )}
        {mode !== 'error' && <MetricStrip label="Resumo dos logs" items={metricItems} />}
        {table}
      </PageStack>
      <AuditDrawer
        open={Boolean(params.event)}
        onClose={() => setParams({ event: null })}
        entry={opened}
        loading={!opened && lookup.status === 'loading'}
        missing={!opened && lookup.status === 'error'}
      />
    </>
  );
}

function PhoneRow({ entry, onOpen }: { entry: AuditEntry; onOpen: (entry: AuditEntry) => void }) {
  return (
    <ListItem
      leading={<PersonAvatar person={entry.actor} name="Sistema" size="sm" decorative />}
      title={entry.title}
      onClick={() => onOpen(entry)}
      trailing={entry.result === 'success' ? undefined : <ResultBadge result={entry.result} />}
      description={<MetaList size="sm" wrap={false} items={[itemLabel(entry), entry.actor?.name ?? 'Sistema', <RelativeTime key="at" at={entry.at} />]} />}
    />
  );
}

function PhoneList({
  rows,
  mode,
  empty,
  error,
  footer,
  onOpen,
}: {
  rows: readonly AuditEntry[];
  mode: 'loading' | 'error' | 'rows';
  empty: ReactNode;
  error: ReactNode;
  footer: ReactNode;
  onOpen: (entry: AuditEntry) => void;
}) {
  if (mode === 'error') return error;
  return (
    <PageStack>
      <List label="Eventos do log" empty={empty}>
        {mode === 'loading' ? [0, 1, 2, 3, 4].map((index) => <ListItemSkeleton key={index} />) : rows.map((entry) => <PhoneRow key={entry.id} entry={entry} onOpen={onOpen} />)}
      </List>
      {footer}
    </PageStack>
  );
}

type EmptyInput = {
  params: AuditParams;
  page: AuditPage | undefined;
  searching: boolean;
  filterCount: number;
  setParams: SetAuditParams;
  simulation: ReturnType<typeof useSimulation>;
};

/** Empty per situation: nothing recorded yet, nothing for the search, or for the filters. */
function emptyState({ params, page, searching, filterCount, setParams, simulation }: EmptyInput): ReactNode {
  if (!searching && filterCount === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="Nenhum evento registrado"
        actions={
          simulation.available && page?.since === undefined ? (
            <Button size="sm" onClick={simulation.reset}>
              Carregar exemplo
            </Button>
          ) : undefined
        }
      />
    );
  }
  if (searching && filterCount === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={`Nada encontrado para “${params.q.trim()}”`}
        actions={
          <Button size="sm" onClick={() => setParams({ q: '' })}>
            Limpar busca
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={ListFilter}
      title="Nenhum evento com esses filtros"
      actions={
        <Button size="sm" onClick={() => setParams({ ...CLEARED_AUDIT_FILTERS, q: '' })}>
          Limpar filtros
        </Button>
      }
    />
  );
}
