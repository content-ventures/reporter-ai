'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  BulkBar,
  Button,
  ButtonLink,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  List,
  ListItem,
  ListItemSkeleton,
  Menu,
  PageHeader,
  PageStack,
  Pagination,
  RowActions,
  SearchField,
  Skeleton,
  Tabs,
  toast,
  VisuallyHidden,
  type BulkAction,
  type Column,
  type TabItem,
} from '@content-ventures/design-system/v3';
import { Archive, ArrowUpRight, ChevronDown, LayoutList, ListFilter, Plus, SearchX } from '@content-ventures/design-system/v3/icons';
import type { ListTab, ProductionListItem, ProductionListPage } from '@/ports';
import { useCommands, useProductions, useSession, useSimulation, type QueryState } from '@/state';
import { plural } from '@/ui/format';
import { NEW_PRODUCTION_HREF } from '@/ui/routes';
import { useCommandGroup } from '@/ui/shell';
import { RelativeTime } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import { SORT_LABELS, sortAfterHeaderClick, tableSort, visibleTabs } from './list-model';
import {
  DEFAULT_LIST_PARAMS,
  activeFilterCount,
  hasSearch,
  LIST_SORTS,
  listFilter,
  serializeListParams,
  type ListParams,
  type ListSort,
} from './list-params';
import { NextStepButton, NextStepCell, OwnerCell, ProductionCell, rowHref, SituationCell } from './production-cells';
import { FILTER_BAND_ID, ProductionActiveFilters, ProductionFilterBand } from './production-filters';
import { useListParams, type SetListParams } from './use-list-params';

/**
 * Produções (`/productions`, D12): status tabs (empty ones hidden), search, "Filtros" band with
 * chips, and a table that answers two questions per production — where it stands ("Situação":
 * "Artigo · Aguardando aprovação de Pedro") and what the person looking does next ("Próximo
 * passo": "Revisar", "Continuar") — most urgent first. "Abrir" and "Arquivar" live in the row's ⋯.
 * The whole state lives in the URL (`?status&q&owner&origin&from&to&sort&page&size`). Live runs
 * update their row in place; a refetch never flashes a skeleton (the last page stays until the new
 * one arrives and the body crossfades).
 */

type TabDefinition = { value: ListTab; label: string; /** "Nenhuma produção …" */ phrase: string; command?: string };

const TABS: readonly TabDefinition[] = [
  { value: 'all', label: 'Todas', phrase: '' },
  { value: 'editing', label: 'Em edição', phrase: 'em edição', command: 'Ver produções em edição' },
  { value: 'in_review', label: 'Aguardando aprovação', phrase: 'aguardando aprovação', command: 'Ver produções aguardando aprovação' },
  { value: 'changes_requested', label: 'Ajustes solicitados', phrase: 'com ajustes solicitados', command: 'Ver produções com ajustes solicitados' },
  { value: 'approved', label: 'Aprovadas', phrase: 'aprovada', command: 'Ver produções aprovadas' },
  { value: 'completed', label: 'Concluídas', phrase: 'concluída', command: 'Ver produções concluídas' },
  { value: 'archived', label: 'Arquivadas', phrase: 'arquivada', command: 'Ver produções arquivadas' },
];

const EMPTY_IDS: ReadonlySet<string> = new Set();
/** Rows collapse (DataTable `exiting`, --dur-2) before the archive lands and the list drops them. */
const EXIT_MS = 220;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function ProductionsScreen() {
  return (
    <Suspense fallback={<ProductionsList params={DEFAULT_LIST_PARAMS} setParams={() => undefined} />}>
      <ProductionsFromUrl />
    </Suspense>
  );
}

function ProductionsFromUrl() {
  const [params, setParams] = useListParams();
  return <ProductionsList params={params} setParams={setParams} />;
}

/** While the AI writes a production it cannot be archived (COPY §9). */
const ARCHIVE_REASON = 'Disponível quando a IA terminar.';

type Shown = { page: ProductionListPage; key: string };

/**
 * The page on screen: the latest answer, or the previous one while a new filter's first answer
 * is on its way (no skeleton between tabs or keystrokes; the body crossfades on arrival).
 */
function useShownPage(state: QueryState<ProductionListPage>, key: string, onNewPage: () => void): Shown | undefined {
  const [kept, setKept] = useState<Shown | undefined>(undefined);
  const fresh = state.status === 'ready' ? state.data : undefined;
  if (fresh && (kept?.page !== fresh || kept.key !== key)) {
    setKept({ page: fresh, key });
    onNewPage();
  }
  return fresh ? { page: fresh, key } : kept;
}

type SearchState = { draft: string; url: string; pending?: string };

/** The search box keeps what is typed; the URL (and the query) follow 220 ms later. */
function useSearchDraft(params: ListParams, setParams: SetListParams) {
  const [search, setSearch] = useState<SearchState>({ draft: params.q, url: params.q });
  if (search.url !== params.q) {
    // Our own commit keeps the draft (the person may have typed on); any other change of the
    // address (back, a cleared chip, "Limpar busca") replaces it.
    setSearch({ draft: search.pending === params.q ? search.draft : params.q, url: params.q });
  }
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

function ProductionsList({ params, setParams }: { params: ListParams; setParams: SetListParams }) {
  const router = useRouter();
  const phone = usePhone();
  const commands = useCommands();
  const session = useSession();
  const simulation = useSimulation();

  const filter = listFilter(params);
  const listKey = serializeListParams(params);
  const query = useProductions(filter, { page: params.page, size: params.size });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exiting, setExiting] = useState<{ ids: ReadonlySet<string>; done: boolean }>({ ids: EMPTY_IDS, done: false });
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: listKey, ids: EMPTY_IDS });
  const [confirm, setConfirm] = useState<ProductionListItem[] | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [retryOf, setRetryOf] = useState<QueryState<ProductionListPage> | null>(null);
  const [draft, setDraft] = useSearchDraft(params, setParams);

  const shown = useShownPage(query, listKey, () => {
    if (exiting.done) setExiting({ ids: EMPTY_IDS, done: false });
  });
  // "Tentando…" lasts while the failed answer on screen is the one being retried; the next
  // answer (a new snapshot) ends it, and a new failure brings the button back.
  const retrying = query.status === 'error' && query === retryOf;

  const page = shown?.page;
  const rows = page?.items ?? [];
  const counts = page?.counts;
  const mode: 'loading' | 'error' | 'rows' = query.status === 'error' ? 'error' : page ? 'rows' : 'loading';
  const refreshing = query.status === 'loading' && Boolean(page);

  const members = session.data?.members ?? [];
  const viewerId = session.data?.current?.id;
  const searching = hasSearch(params);
  const filterCount = activeFilterCount(params);
  const archivedTab = params.tab === 'archived';

  // Selection belongs to what is on screen: another tab, filter or page starts empty.
  const rowIds = new Set(rows.map((row) => row.id));
  const selected = selection.key === listKey ? new Set([...selection.ids].filter((id) => rowIds.has(id))) : EMPTY_IDS;
  const setSelected = (ids: ReadonlySet<string>) => setSelection({ key: listKey, ids });
  const exitingIds = exiting.ids.size > 0 ? new Set([...exiting.ids].filter((id) => rowIds.has(id))) : EMPTY_IDS;

  const open = (item: ProductionListItem) => router.push(rowHref(item));
  const toggleOwner = (ownerId: string) => setParams({ owner: params.owner === ownerId ? null : ownerId });
  const clearAll = () => setParams({ q: '', owner: null, origin: null, from: null, to: null });

  async function archive(items: ProductionListItem[]) {
    const ids = items.filter((item) => !item.liveRun && !item.archived).map((item) => item.id);
    if (ids.length === 0) return;
    setArchiving(true);
    setExiting({ ids: new Set(ids), done: false });
    await wait(EXIT_MS);
    const result = await commands.production.archive(ids);
    setArchiving(false);
    if (!result.ok) {
      setExiting({ ids: EMPTY_IDS, done: false });
      toast(result.refusal.message, { tone: 'error' });
      return;
    }
    setExiting({ ids: new Set(ids), done: true });
    toast(result.value.archived === 1 ? 'Produção arquivada' : `${result.value.archived} produções arquivadas`, {
      action: { label: 'Ver arquivadas', onClick: () => setParams({ tab: 'archived' }, { history: 'push' }) },
    });
  }

  useCommandGroup({
    label: 'Filtrar produções',
    showWhenEmpty: false,
    items: [
      ...(viewerId ? [{ id: 'productions-mine', label: 'Ver minhas produções', icon: ListFilter, onSelect: () => setParams({ owner: viewerId }) }] : []),
      ...TABS.filter((tab) => tab.command).map((tab) => ({
        id: `productions-tab-${tab.value}`,
        label: tab.command ?? tab.label,
        icon: ListFilter,
        onSelect: () => setParams({ tab: tab.value }, { history: 'push' }),
      })),
    ],
  });

  // Empty tabs stay out ("Aprovadas 0"), except "Todas" and the one on screen.
  const shownTabs = visibleTabs(
    TABS.map((tab) => tab.value),
    counts,
    params.tab,
  );
  const tabItems: TabItem<ListTab>[] = TABS.filter((tab) => shownTabs.includes(tab.value)).map((tab) => ({
    value: tab.value,
    label: tab.label,
    // While the first page loads, a pulsing count keeps the bar's width (no jump when numbers land).
    count: counts ? counts[tab.value] : <Skeleton width={8} height={10} />,
  }));

  const columns: Column<ProductionListItem>[] = [
    {
      key: 'production',
      header: 'Produção',
      pinned: true,
      skeleton: 'lines',
      render: (item) => <ProductionCell item={item} href={rowHref(item)} query={params.q} />,
    },
    { key: 'situation', header: 'Situação', width: 216, render: (item) => <SituationCell item={item} /> },
    { key: 'next', header: 'Próximo passo', width: 144, skeleton: 'short', render: (item) => <NextStepCell item={item} /> },
    {
      key: 'owner',
      header: 'Responsável',
      width: 152,
      skeleton: 'control',
      render: (item) => <OwnerCell owner={item.owner} active={params.owner === item.owner.id} onToggle={() => toggleOwner(item.owner.id)} />,
    },
    {
      key: 'updated',
      header: 'Atualizada',
      width: 104,
      sortable: true,
      skeleton: 'short',
      render: (item) => <RelativeTime at={item.updatedAt} />,
    },
    {
      key: 'actions',
      header: <VisuallyHidden>Ações</VisuallyHidden>,
      name: 'Ações',
      align: 'end',
      width: 48,
      skeleton: 'none',
      render: (item) => (
        <RowActions
          label={`Ações de ${item.title}`}
          compact
          actions={[
            { id: 'open', label: 'Abrir', icon: ArrowUpRight, onSelect: () => open(item) },
            {
              id: 'archive',
              label: 'Arquivar',
              icon: Archive,
              hidden: item.archived,
              disabled: Boolean(item.liveRun),
              hint: item.liveRun ? ARCHIVE_REASON : undefined,
              onSelect: () => setConfirm([item]),
            },
          ]}
        />
      ),
    },
  ];

  const emptyBlock = emptyState({ params, counts, searching, filterCount, setParams, clearAll, simulation });
  const errorBlock = (
    <ErrorState
      title="Não foi possível carregar as produções"
      description={query.error?.message}
      retrying={retrying}
      onRetry={() => {
        setRetryOf(query);
        query.retry();
      }}
    />
  );

  const selectedItems = rows.filter((row) => selected.has(row.id));
  const archivable = selectedItems.filter((item) => !item.liveRun);
  const bulkActions: BulkAction[] = archivedTab
    ? []
    : [
        {
          label: 'Arquivar',
          icon: Archive,
          disabled: selectedItems.length > 0 && archivable.length === 0,
          hint: archivable.length === 0 ? ARCHIVE_REASON : undefined,
          onSelect: () => setConfirm(selectedItems),
        },
      ];

  const confirmItems = confirm ?? [];
  const confirmArchivable = confirmItems.filter((item) => !item.liveRun);
  const confirmSkipped = confirmItems.length - confirmArchivable.length;
  const confirmTitle =
    confirmArchivable.length === 1 ? `Arquivar ${confirmArchivable[0]?.title}?` : `Arquivar ${plural(confirmArchivable.length, 'produção', 'produções')}?`;

  const table = (
    <DataTable
      label="Produções"
      rows={rows}
      rowKey={(item) => item.id}
      rowLabel={(item) => item.title}
      columns={columns}
      density="compact"
      fixed
      selectable={!archivedTab}
      selected={selected}
      onSelectedChange={setSelected}
      sort={tableSort(params.sort)}
      onSort={() => setParams({ sort: sortAfterHeaderClick(params.sort) })}
      onRowClick={open}
      loading={mode === 'loading'}
      loadingRows={params.size > 10 ? 10 : 8}
      error={mode === 'error' ? errorBlock : undefined}
      empty={emptyBlock}
      exiting={exitingIds}
      transitionKey={shown?.key ?? listKey}
      footer={
        mode === 'rows' && page ? (
          <Pagination
            page={page.page}
            pageSize={params.size}
            total={page.total}
            noun={page.total === 1 ? 'produção' : 'produções'}
            onPageChange={(next) => setParams({ page: next }, { history: 'push' })}
            onPageSizeChange={(size) => setParams({ size })}
          />
        ) : undefined
      }
    />
  );
  const showChips = !filtersOpen && filterCount > 0;
  // On a phone each production is one row (title, where it stands, the next step) instead of a
  // stacked card with every column.
  const list = phone ? (
    <PhoneList
      rows={rows}
      mode={mode}
      empty={emptyBlock}
      error={errorBlock}
      footer={
        mode === 'rows' && page ? (
          <Pagination
            page={page.page}
            pageSize={params.size}
            total={page.total}
            noun={page.total === 1 ? 'produção' : 'produções'}
            variant="compact"
            onPageChange={(next) => setParams({ page: next }, { history: 'push' })}
          />
        ) : undefined
      }
    />
  ) : (
    table
  );

  return (
    <>
      <PageHeader
        title="Produções"
        actions={
          <ButtonLink href={NEW_PRODUCTION_HREF} variant="primary" icon={Plus}>
            Nova produção
          </ButtonLink>
        }
      />
      <FilterBar
        tabs={<Tabs label="Produções por status" value={params.tab} items={tabItems} onChange={(tab) => setParams({ tab }, { history: 'push' })} />}
        search={
          <SearchField
            size="sm"
            value={draft}
            onValueChange={setDraft}
            loading={refreshing && searching}
            placeholder="Produção, material ou falante"
            label="Buscar por produção, material ou falante"
          />
        }
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        filterCount={filterCount}
        bandId={FILTER_BAND_ID}
        actions={<SortMenu sort={params.sort} onChange={(sort) => setParams({ sort })} />}
      />
      <PageStack>
        <ProductionFilterBand open={filtersOpen} params={params} setParams={setParams} owners={members} viewerId={viewerId} />
        {showChips && (
          <ProductionActiveFilters
            params={params}
            setParams={setParams}
            owners={members}
            onEdit={() => setFiltersOpen(true)}
            summary={page ? plural(page.total, 'produção', 'produções') : undefined}
          />
        )}
        {list}
      </PageStack>
      <BulkBar
        dock
        count={selected.size}
        noun={selected.size === 1 ? 'selecionada' : 'selecionadas'}
        processing={archiving ? 'Arquivar' : undefined}
        onClear={() => setSelected(EMPTY_IDS)}
        actions={bulkActions}
      />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirmTitle}
        description={
          confirmSkipped > 0
            ? `${plural(confirmSkipped, 'produção com a IA escrevendo fica', 'produções com a IA escrevendo ficam')} de fora.`
            : 'Fica em Arquivadas, com versões, aprovações e entregas.'
        }
        confirmLabel={confirmArchivable.length > 1 ? `Arquivar ${confirmArchivable.length}` : 'Arquivar'}
        onConfirm={() => {
          const items = confirmItems;
          setConfirm(null);
          void archive(items);
        }}
      />
    </>
  );
}

/** "Ordenar": most urgent first (default), or by the last activity. */
function SortMenu({ sort, onChange }: { sort: ListSort; onChange: (sort: ListSort) => void }) {
  return (
    <Menu
      label="Ordenar produções"
      align="end"
      sections={[{ items: LIST_SORTS.map((value) => ({ label: SORT_LABELS[value], checked: value === sort, onSelect: () => onChange(value) })) }]}
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>
          {SORT_LABELS[sort]}
        </Button>
      )}
    />
  );
}

function PhoneRow({ item }: { item: ProductionListItem }) {
  return (
    <ListItem
      title={item.title}
      titleLines={2}
      href={rowHref(item)}
      description={<SituationCell item={item} size="sm" />}
      actions={<NextStepButton item={item} />}
    />
  );
}

function PhoneList({
  rows,
  mode,
  empty,
  error,
  footer,
}: {
  rows: readonly ProductionListItem[];
  mode: 'loading' | 'error' | 'rows';
  empty: ReactNode;
  error: ReactNode;
  footer: ReactNode;
}) {
  if (mode === 'error') return error;
  return (
    <PageStack>
      <List label="Produções" empty={empty}>
        {mode === 'loading' ? [0, 1, 2, 3].map((index) => <ListItemSkeleton key={index} />) : rows.map((item) => <PhoneRow key={item.id} item={item} />)}
      </List>
      {footer}
    </PageStack>
  );
}

type EmptyInput = {
  params: ListParams;
  counts: ProductionListPage['counts'] | undefined;
  searching: boolean;
  filterCount: number;
  setParams: SetListParams;
  clearAll: () => void;
  simulation: ReturnType<typeof useSimulation>;
};

/** Empty per situation: nothing yet, nothing for the search, for the filters, or in this tab. */
function emptyState({ params, counts, searching, filterCount, setParams, clearAll, simulation }: EmptyInput): ReactNode {
  const nothingYet = !searching && filterCount === 0 && counts !== undefined && counts.all === 0 && counts.archived === 0;
  if (nothingYet) {
    return (
      <EmptyState
        icon={LayoutList}
        title="Nenhuma produção ainda"
        actions={
          <>
            <ButtonLink href={NEW_PRODUCTION_HREF} variant="primary" size="sm" icon={Plus}>
              Nova produção
            </ButtonLink>
            {simulation.available && (
              <Button size="sm" onClick={simulation.reset}>
                Carregar exemplo
              </Button>
            )}
          </>
        }
      />
    );
  }
  if (searching && filterCount === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="Nenhuma produção encontrada"
        actions={
          <Button size="sm" onClick={() => setParams({ q: '' })}>
            Limpar busca
          </Button>
        }
      />
    );
  }
  if (searching || filterCount > 0) {
    return (
      <EmptyState
        icon={ListFilter}
        title="Nenhuma produção com esses filtros"
        actions={
          <Button size="sm" onClick={clearAll}>
            Limpar filtros
          </Button>
        }
      />
    );
  }
  const tab = TABS.find((entry) => entry.value === params.tab);
  return (
    <EmptyState
      icon={LayoutList}
      title={`Nenhuma produção ${tab?.phrase ?? ''}`.trim()}
      actions={
        <Button size="sm" variant="ghost" onClick={() => setParams({ tab: 'all' }, { history: 'push' })}>
          Ver todas
        </Button>
      }
    />
  );
}
