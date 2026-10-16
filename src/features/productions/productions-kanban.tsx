'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  ButtonLink,
  Badge,
  ConfirmDialog,
  ErrorState,
  FilterBar,
  KanbanBoard,
  KanbanCard,
  KanbanCardMeta,
  KanbanCardRow,
  KanbanColumn,
  KanbanEmpty,
  KanbanIconButton,
  KanbanPlaceholder,
  Menu,
  PageHeader,
  PageStack,
  SearchField,
  toast,
  useKanbanDrag,
  VisuallyHidden,
} from '@content-ventures/design-system/v3';
import { Archive, ArrowUpRight, BadgeCheck, ChevronDown, FileText, GalleryHorizontal, Inbox, MoreHorizontal, Package, Plus } from '@content-ventures/design-system/v3/icons';
import type { ProductionListItem, ProductionListPage } from '@/ports';
import type { StageView } from '@/domain/stage';
import type { KanbanMove } from '@content-ventures/design-system/v3';
import { useCommands, useProductions, useSession, type QueryState } from '@/state';
import { NEW_PRODUCTION_HREF } from '@/ui/routes';
import { RelativeTime } from '@/ui/time';
import { Avatar } from '@content-ventures/design-system/v3';
import { nextStepHref, rowHref, SituationCell, productionMeta } from './production-cells';
import { SORT_LABELS } from './list-model';
import { activeFilterCount, hasSearch, listFilter, LIST_SORTS, type ListSort } from './list-params';
import { ProductionActiveFilters, ProductionFilterBand } from './production-filters';
import { useListParams } from './use-list-params';

const PAGE_SIZE = 50;
const ARCHIVE_REASON = 'Disponível quando a IA terminar.';
type SearchState = { draft: string; url: string; pending?: string };
const LANES = [
  { id: 'source', title: 'Material', icon: Inbox, count: 'Produção', plural: 'Produções' },
  { id: 'article', title: 'Artigo', icon: FileText, count: 'Produção', plural: 'Produções' },
  { id: 'approval', title: 'Aprovação', icon: BadgeCheck, count: 'Produção', plural: 'Produções' },
  { id: 'carousel', title: 'Carrossel', icon: GalleryHorizontal, count: 'Produção', plural: 'Produções' },
  { id: 'delivery', title: 'Entrega', icon: Package, count: 'Produção', plural: 'Produções' },
  { id: 'archived', title: 'Arquivadas', icon: Archive, count: 'Produção', plural: 'Produções' },
] as const;
type LaneId = (typeof LANES)[number]['id'];
type BoardPlacement = {
  columnById: Record<string, LaneId>;
  orderByColumn: Partial<Record<LaneId, string[]>>;
};

export function ProductionsKanbanScreen() {
  return (
    <Suspense fallback={<PageHeader title="Produções" />}>
      <ProductionsKanban />
    </Suspense>
  );
}

function ProductionsKanban() {
  const router = useRouter();
  const [params, setParams] = useListParams();
  const commands = useCommands();
  const session = useSession();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useKanbanSearchDraft(params.q, setParams);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [placement, setPlacement] = useState<BoardPlacement>({ columnById: {}, orderByColumn: {} });
  const [confirm, setConfirm] = useState<ProductionListItem | null>(null);
  const [advancePrompt, setAdvancePrompt] = useState<ProductionListItem | null>(null);
  const [archiving, setArchiving] = useState(false);
  const filter = { ...listFilter(params), tab: 'all' as const };
  const query = useProductions(filter, { page: 1, size: pageSize });
  const archivedQuery = useProductions({ ...filter, tab: 'archived' }, { page: 1, size: pageSize });
  const page = query.data;
  const archivedPage = archivedQuery.data;
  const members = session.data?.members ?? [];
  const viewerId = session.data?.current?.id;
  const filterCount = activeFilterCount(params);
  const searching = hasSearch(params);
  const showChips = !filtersOpen && filterCount > 0;

  useEffect(() => {
    if (params.tab !== 'all') setParams({ tab: 'all' }, { history: 'replace' });
  }, [params.tab, setParams]);

  const rows = page?.items ?? [];
  const archivedRows = archivedPage?.items ?? [];
  const groups = Object.fromEntries(LANES.map((lane) => [
    lane.id,
    lane.id === 'archived' ? archivedRows : rows.filter((item) => item.currentStageId === lane.id),
  ])) as Record<(typeof LANES)[number]['id'], ProductionListItem[]>;
  const allItems = Object.values(groups).flat();
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const originalColumnById = new Map(allItems.map((item) => [item.id, item.archived ? 'archived' as const : item.currentStageId as LaneId]));
  const boardGroups = Object.fromEntries(LANES.map((lane) => {
    const members = allItems.filter((item) => (placement.columnById[item.id] ?? originalColumnById.get(item.id)) === lane.id);
    const memberIds = new Set(members.map((item) => item.id));
    const order = placement.orderByColumn[lane.id] ?? [];
    const ordered = order.filter((id) => memberIds.has(id)).map((id) => itemById.get(id)).filter((item): item is ProductionListItem => Boolean(item));
    return [lane.id, [...ordered, ...members.filter((item) => !order.includes(item.id))]];
  })) as Record<LaneId, ProductionListItem[]>;

  function moveCard(move: KanbanMove<LaneId>) {
    setPlacement((current) => {
      const columnOf = (id: string): LaneId | undefined => current.columnById[id] ?? originalColumnById.get(id);
      const orderedIds = (column: LaneId) => {
        const members = allItems.filter((item) => columnOf(item.id) === column).map((item) => item.id);
        const existing = current.orderByColumn[column] ?? members;
        return [...existing.filter((id) => members.includes(id)), ...members.filter((id) => !existing.includes(id))];
      };
      const from = columnOf(move.id);
      if (!from || !itemById.has(move.id)) return current;
      const source = orderedIds(from).filter((id) => id !== move.id);
      const target = from === move.column ? source : orderedIds(move.column).filter((id) => id !== move.id);
      const position = move.beforeId ? target.indexOf(move.beforeId) : -1;
      target.splice(position < 0 ? target.length : position, 0, move.id);
      return {
        columnById: { ...current.columnById, [move.id]: move.column },
        orderByColumn: {
          ...current.orderByColumn,
          [from]: from === move.column ? target : source,
          [move.column]: target,
        },
      };
    });
  }

  const dragLanes = LANES.map((lane) => ({
    id: lane.id,
    ids: boardGroups[lane.id].map((item) => item.id),
    label: lane.title,
  }));
  const drag = useKanbanDrag<LaneId>({
    lanes: dragLanes,
    onMove: moveCard,
    labelOf: (id) => itemById.get(id)?.title ?? 'Produção',
    onDrop: ({ id, column, from }) => {
      if (column === from) return;
      const item = itemById.get(id);
      if (!item) return;
      if (column === 'archived') {
        moveCard({ id, column: from, beforeId: null });
        if (item.liveRun) {
          toast(ARCHIVE_REASON, { tone: 'error' });
          return;
        }
        setConfirm(item);
        return;
      }
      moveCard({ id, column: from, beforeId: null });
      setAdvancePrompt(item);
    },
  });

  async function archive(item: ProductionListItem) {
    if (item.liveRun || item.archived || archiving) return;
    setArchiving(true);
    const result = await commands.production.archive([item.id]);
    setArchiving(false);
    if (!result.ok) {
      toast(result.refusal.message, { tone: 'error' });
      return;
    }
    setConfirm(null);
    toast('Produção arquivada');
  }

  function cardMenu(item: ProductionListItem) {
    return (
      <Menu
        label={`Ações de ${item.title}`}
        align="end"
        width={196}
        sections={[{
          items: [
            { label: 'Abrir produção', icon: ArrowUpRight, onSelect: () => router.push(rowHref(item)) },
            ...(!item.archived ? [{
              label: 'Arquivar',
              icon: Archive,
              disabled: Boolean(item.liveRun) || archiving,
              ...(item.liveRun ? { description: ARCHIVE_REASON } : {}),
              onSelect: () => setConfirm(item),
            }] : []),
          ],
        }]}
        trigger={(props) => <KanbanIconButton {...props} label={`Ações de ${item.title}`} icon={MoreHorizontal} />}
      />
    );
  }

  const errorState = (state: QueryState<ProductionListPage>) => (
    <ErrorState
      title="Não foi possível carregar as produções"
      description={state.error?.message}
      retrying={false}
      onRetry={state.retry}
    />
  );

  return (
    <>
      <PageHeader
        title="Produções"
        actions={<ButtonLink href={NEW_PRODUCTION_HREF} variant="primary" icon={Plus}>Nova produção</ButtonLink>}
      />
      <FilterBar
        spacing="comfortable"
        search={
          <SearchField
            size="sm"
            value={draft}
            onValueChange={setDraft}
            loading={query.status === 'loading' && Boolean(page)}
            placeholder="Produção, material ou falante"
            label="Buscar por produção, material ou falante"
          />
        }
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        filterCount={filterCount}
        bandId="productions-filters"
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
            summary={page ? `${page.total + (archivedPage?.counts.archived ?? 0)} produções` : undefined}
          />
        )}
        {query.status === 'error' && !page ? errorState(query) : archivedQuery.status === 'error' && !archivedPage ? errorState(archivedQuery) : (
          <>
            <VisuallyHidden role="heading" aria-level={2}>Etapas de produção e aprovações</VisuallyHidden>
            <KanbanBoard label="Etapas de produção e aprovações" fill>
              {LANES.map((lane) => {
                const laneRows = boardGroups[lane.id];
                const count = lane.id === 'archived' ? archivedPage?.counts.archived ?? 0 : laneRows.length;
                const laneLoading = !page || (lane.id === 'archived' && !archivedPage);
                const laneHasMore = lane.id === 'archived'
                  ? count > laneRows.length
                  : (page?.total ?? 0) > rows.length;
                const LaneIcon = lane.icon;
                return (
                  <KanbanColumn
                    key={lane.id}
                    {...drag.columnProps(lane.id)}
                    title={lane.title}
                    icon={<LaneIcon aria-hidden="true" />}
                    count={count}
                    countNoun={{ singular: lane.count, plural: lane.plural }}
                    empty={
                      <KanbanEmpty
                        title={laneLoading ? 'Carregando…' : searching || filterCount ? 'Nada neste filtro' : 'Nenhuma produção'}
                        compact={!laneLoading}
                      />
                    }
                    footer={laneHasMore ? <Button variant="ghost" size="sm" onClick={() => setPageSize((size) => size + PAGE_SIZE)}>Carregar mais</Button> : undefined}
                  >
                    {drag.layout(lane.id, laneRows.map((item) => item.id)).map((entry) => {
                      if (entry.kind === 'slot') return <KanbanPlaceholder key={entry.key} height={entry.height} motion={entry.motion} slotKey={entry.key} />;
                      const item = itemById.get(entry.id);
                      if (!item) return null;
                      return (
                        <KanbanCard
                          key={item.id}
                          {...(!item.archived ? drag.cardProps(item.id, lane.id) : {})}
                          title={item.title}
                          summary={productionMeta(item)}
                          menu={cardMenu(item)}
                          onOpen={() => router.push(rowHref(item))}
                        >
                          <KanbanCardRow start>
                            <StageBadge stage={item.stages.find((stage) => stage.id === item.currentStageId)} />
                            {item.liveRun && <Badge tone="blue" variant="soft" size="sm" live>{item.liveRun.label}</Badge>}
                          </KanbanCardRow>
                          <KanbanCardRow>
                            <KanbanCardMeta title={item.material?.title ?? productionMeta(item)}>
                              {item.material?.title ?? productionMeta(item)}
                            </KanbanCardMeta>
                            <RelativeTime at={item.updatedAt} />
                          </KanbanCardRow>
                          <KanbanCardRow start>
                            <SituationCell item={item} size="sm" />
                          </KanbanCardRow>
                          <KanbanCardRow start>
                            <Avatar name={item.owner.name} src={item.owner.avatarUrl} size="xs" decorative />
                            <KanbanCardMeta title={item.owner.name}>Responsável · {item.owner.name}</KanbanCardMeta>
                          </KanbanCardRow>
                        </KanbanCard>
                      );
                    })}
                  </KanbanColumn>
                );
              })}
            </KanbanBoard>
            {drag.region}
          </>
        )}
      </PageStack>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? `Arquivar ${confirm.title}?` : 'Arquivar produção?'}
        description="Fica em Arquivadas, com versões, aprovações e entregas."
        confirmLabel="Arquivar"
        onConfirm={() => { if (confirm) void archive(confirm); }}
      />
      <ConfirmDialog
        open={advancePrompt !== null}
        onClose={() => setAdvancePrompt(null)}
        title="Ação necessária para avançar"
        description={advancePrompt?.nextStep?.mine
          ? `Arrastar não muda o estágio. Para avançar, você precisa ${nextStepInstruction(advancePrompt)}. Ao continuar, vamos abrir essa etapa para você executar a ação.`
          : advancePrompt?.nextStep
            ? 'Arrastar não muda o estágio. Esta produção está aguardando uma ação de outra pessoa. Ao abrir a produção, você pode acompanhar o andamento.'
            : 'Arrastar não muda o estágio. Não há uma próxima ação disponível agora; ao abrir a produção, você pode conferir o que está pendente.'}
        confirmLabel={advancePrompt?.nextStep?.mine ? 'Continuar' : 'Abrir produção'}
        onConfirm={() => {
          if (advancePrompt) router.push(advancePrompt.nextStep ? nextStepHref(advancePrompt) : rowHref(advancePrompt));
        }}
      />
    </>
  );
}

function nextStepInstruction(item: ProductionListItem): string {
  const step = item.nextStep;
  if (!step) return 'conferir o que está pendente';
  if (step.kind === 'continue' && step.target.kind === 'studio') {
    const piece = step.target.pieceKind === 'article' ? 'artigo'
      : step.target.pieceKind === 'carousel' ? 'carrossel' : 'conteúdo';
    return `continuar a edição do ${piece}`;
  }
  return `concluir “${step.label}”`;
}

function useKanbanSearchDraft(query: string, setParams: ReturnType<typeof useListParams>[1]) {
  const [search, setSearch] = useState<SearchState>({ draft: query, url: query });
  if (search.url !== query) {
    setSearch({ draft: search.pending === query ? search.draft : query, url: query });
  }
  useEffect(() => {
    if (search.draft === query) return undefined;
    const value = search.draft;
    const timer = window.setTimeout(() => {
      setSearch((current) => ({ ...current, pending: value }));
      setParams({ q: value });
    }, value.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [search.draft, query, setParams]);
  return [search.draft, (draft: string) => setSearch((current) => ({ ...current, draft }))] as const;
}

function StageBadge({ stage }: { stage: StageView | undefined }) {
  if (!stage) return <Badge tone="gray" variant="soft" size="sm">Etapa indisponível</Badge>;
  const tone = stage.state === 'error' ? 'red'
    : stage.state === 'warn' ? 'amber'
      : stage.state === 'done' ? 'green'
        : stage.state === 'blocked' ? 'gray' : 'blue';
  const label = stage.detail ?? (stage.state === 'done' ? 'Concluída' : stage.state === 'blocked' ? 'Bloqueada' : stage.state === 'upcoming' ? 'Próxima etapa' : 'Em andamento');
  return <Badge tone={tone} variant="soft" size="sm">{label}</Badge>;
}

function SortMenu({ sort, onChange }: { sort: ListSort; onChange: (sort: ListSort) => void }) {
  return (
    <Menu
      label="Ordenar produções"
      align="end"
      sections={[{ items: LIST_SORTS.map((value) => ({ label: SORT_LABELS[value], checked: value === sort, onSelect: () => onChange(value) })) }]}
      trigger={(props) => <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>{SORT_LABELS[sort]}</Button>}
    />
  );
}
