'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { Suspense, useEffect, useState } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {
  Button,
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
  TextLink,
  toast,
  useKanbanDrag,
  VisuallyHidden,
} from '@content-ventures/design-system/v3';
import { Archive, ArrowUpRight, BadgeCheck, ChevronDown, FileText, GalleryHorizontal, Inbox, MoreHorizontal, Package, Telescope } from '@content-ventures/design-system/v3/icons';
import type { ProductionListItem, ProductionListPage, ReceivedMaterial } from '@/ports';
import { firstName, FORMAT_SPECS, NEXT_STEP_LABELS } from '@/domain';
import type { StageView } from '@/domain/stage';
import type { KanbanMove } from '@content-ventures/design-system/v3';
import { useCan, useCommands, useProductions, useSession, type QueryState } from '@/state';
import { usePerson } from '@/ui/person-avatar';
import { NewProductionLink } from '@/features/new-production/new-production-link';
import { RelativeTime } from '@/ui/time';
import { Avatar } from '@content-ventures/design-system/v3';
import { nextStepHref, rowHref, SituationCell, productionMeta } from './production-cells';
import { SORT_LABELS } from './list-model';
import { activeFilterCount, hasSearch, listFilter, LIST_SORTS, type ListSort } from './list-params';
import { ProductionActiveFilters, ProductionFilterBand } from './production-filters';
import { useBoardArrival } from './use-board-arrival';
import { useReceivedMaterials } from './use-received-materials';
import { receivedMaterialHref } from '@/ui/routes';
import { useListParams } from './use-list-params';
import { notifyRefusal } from '@/ui/permission-dialog';
import { isReleased } from '@/registries';
import { useDeskBoard, type DeskBoard } from '@/features/hard-news/use-desk-board';
import { DemoBadge } from '@/features/hard-news/demo-badge';

const PAGE_SIZE = 50;
const ARCHIVE_REASON = 'Disponível quando a IA terminar.';
const RECEIVED_STATUS: Record<ReceivedMaterial['status'], { label: string; tone: 'blue' | 'teal' | 'red'; live?: boolean }> = {
  transcribing: { label: 'Transcrevendo', tone: 'blue', live: true },
  ready: { label: 'Pronto', tone: 'teal' },
  failed: { label: 'Erro na transcrição', tone: 'red' },
};
type SearchState = { draft: string; url: string; pending?: string };
const LANES = [
  { id: 'source', title: 'Material', icon: Inbox, count: 'Produção', plural: 'Produções' },
  { id: 'article', title: 'Artigo', icon: FileText, count: 'Produção', plural: 'Produções' },
  { id: 'approval', title: 'Aprovação', icon: BadgeCheck, count: 'Produção', plural: 'Produções' },
  { id: 'carousel', title: 'Carrossel', icon: GalleryHorizontal, count: 'Produção', plural: 'Produções' },
  { id: 'delivery', title: 'Entrega', icon: Package, count: 'Produção', plural: 'Produções' },
  { id: 'archived', title: 'Arquivadas', icon: Archive, count: 'Produção', plural: 'Produções' },
] as const;
/** R2: covered news stories are researched before the article ("Apuração"), first on the board. */
const RESEARCH_LANE = { id: 'research', title: 'Apuração', icon: Telescope, count: 'Produção', plural: 'Produções' } as const;
const BOARD_LANES: readonly (typeof LANES[number] | typeof RESEARCH_LANE)[] = isReleased('R2') ? [RESEARCH_LANE, ...LANES] : LANES;
type LaneId = (typeof BOARD_LANES)[number]['id'];

/** The lane a card sits in: R2's "Apuração" for a story being researched, else its journey stage. */
function laneOf(item: ProductionListItem, desk: DeskBoard | undefined): string {
  if (item.archived) return 'archived';
  return desk?.card(item)?.lane ?? item.currentStageId;
}
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
  const workspaceHrefFor = useWorkspaceHref();
  const router = useRouter();
  const [params, setParams] = useListParams();
  const commands = useCommands();
  const session = useSession();
  const desk = useDeskBoard();
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
  // Files from the Drive folder wait in "Material" until someone opens them in Nova produção.
  const createsProductions = useCan('production.create');
  const received = useReceivedMaterials(createsProductions && !searching && filterCount === 0);

  useEffect(() => {
    if (params.tab !== 'all') setParams({ tab: 'all' }, { history: 'replace' });
  }, [params.tab, setParams]);

  const arrival = useBoardArrival({
    items: page?.items ?? [],
    total: page?.total ?? 0,
    ready: query.status === 'ready',
    widen: (size) => setPageSize((current) => Math.max(current, size)),
    laneOf: (item) => BOARD_LANES.find((lane) => lane.id === laneOf(item, desk))?.title ?? item.situation.line,
    viewerId,
  });
  const rows = arrival.rows;
  const archivedRows = archivedPage?.items ?? [];
  const groups = Object.fromEntries(BOARD_LANES.map((lane) => [
    lane.id,
    lane.id === 'archived' ? archivedRows : rows.filter((item) => laneOf(item, desk) === lane.id),
  ])) as Record<LaneId, ProductionListItem[]>;
  const allItems = Object.values(groups).flat();
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const originalColumnById = new Map(allItems.map((item) => [item.id, laneOf(item, desk) as LaneId]));
  const boardGroups = Object.fromEntries(BOARD_LANES.map((lane) => {
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

  const dragLanes = BOARD_LANES.map((lane) => ({
    id: lane.id,
    ids: boardGroups[lane.id].map((item) => item.id),
    label: lane.title,
  }));
  // Moving cards (archive, next stage) is for who edits; others only open them.
  const canArchive = useCan('production.archive');
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
      notifyRefusal(undefined, result.refusal);
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
            ...(!item.archived && canArchive ? [{
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
        actions={<NewProductionLink />}
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
              {BOARD_LANES.map((lane) => {
                const laneRows = boardGroups[lane.id];
                const laneReceived = lane.id === 'source' ? received : [];
                const count = lane.id === 'archived' ? archivedPage?.counts.archived ?? 0 : laneRows.length + laneReceived.length;
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
                    actions={lane.id === RESEARCH_LANE.id ? <DemoBadge /> : undefined}
                    empty={
                      <KanbanEmpty
                        title={laneLoading ? 'Carregando…' : searching || filterCount ? 'Nada neste filtro' : 'Nenhuma produção'}
                        compact={!laneLoading}
                      />
                    }
                    footer={laneHasMore ? <Button variant="ghost" size="sm" onClick={() => setPageSize((size) => size + PAGE_SIZE)}>Carregar mais</Button> : undefined}
                  >
                    {laneReceived.map((material) => <ReceivedCard key={`drive-${material.id}`} material={material} onOpen={() => router.push(receivedMaterialHref(material.id))} />)}
                    {drag.layout(lane.id, laneRows.map((item) => item.id)).map((entry) => {
                      if (entry.kind === 'slot') return <KanbanPlaceholder key={entry.key} height={entry.height} motion={entry.motion} slotKey={entry.key} />;
                      const item = itemById.get(entry.id);
                      if (!item) return null;
                      // R2: a covered news story says where it came from and its desk step.
                      const deskCard = desk?.card(item);
                      const meta = deskCard?.meta ?? productionMeta(item);
                      return (
                        <KanbanCard
                          key={item.id}
                          {...(!item.archived && canArchive ? drag.cardProps(item.id, lane.id) : {})}
                          title={item.title}
                          summary={meta}
                          menu={cardMenu(item)}
                          arrived={item.id === arrival.arrivedId}
                          onOpen={() => router.push(deskCard?.href ?? rowHref(item))}
                        >
                          <KanbanCardRow start>
                            {deskCard?.lane ? <Badge tone="blue" variant="soft" size="sm">Em apuração</Badge> : <StageBadge stage={item.stages.find((stage) => stage.id === item.currentStageId)} />}
                            {item.liveRun && <Badge tone="blue" variant="soft" size="sm" live>{item.liveRun.label}</Badge>}
                          </KanbanCardRow>
                          <KanbanCardRow>
                            <KanbanCardMeta title={item.material?.title ?? meta}>
                              {item.material?.title ?? meta}
                            </KanbanCardMeta>
                            <RelativeTime at={item.updatedAt} />
                          </KanbanCardRow>
                          <KanbanCardRow start>
                            {deskCard?.situation ? (
                              <Badge tone={deskCard.situation.tone} variant="text" size="sm" dot live={deskCard.situation.live} wrap>{deskCard.situation.line}</Badge>
                            ) : (
                              <SituationCell item={item} size="sm" />
                            )}
                          </KanbanCardRow>
                          <NextActorRow item={item} viewerId={viewerId} href={workspaceHrefFor(deskCard?.href)} />
                        </KanbanCard>
                      );
                    })}
                  </KanbanColumn>
                );
              })}
            </KanbanBoard>
            {drag.region}
            {arrival.region}
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

/**
 * Who moves the card now, in place of the owner: "Agora: Pedro"; the viewer's own move links to it
 * ("Agora: você · Criar carrossel"). With nobody to act (the AI writing, delivered, archived) or
 * while the person is unknown, the owner stays ("Responsável · João").
 */
function NextActorRow({ item, viewerId, href }: { item: ProductionListItem; viewerId: string | undefined; href?: string }) {
  const workspaceHrefFor = useWorkspaceHref();
  const actor = item.situation.nextActor;
  // An unnamed review is the viewer's when their own next step is that review.
  const yours = Boolean(actor && (actor.personId ? actor.personId === viewerId : item.nextStep?.mine && item.nextStep.kind === actor.step));
  const personId = actor?.personId ?? (yours ? viewerId : undefined);
  const owner = personId === item.owner.id ? item.owner : undefined;
  const person = usePerson(owner ? null : personId) ?? owner;
  if (!actor || !person) {
    return (
      <KanbanCardRow start>
        <Avatar name={item.owner.name} src={item.owner.avatarUrl} size="xs" decorative />
        <KanbanCardMeta title={item.owner.name}>Responsável · {item.owner.name}</KanbanCardMeta>
      </KanbanCardRow>
    );
  }
  const step = NEXT_STEP_LABELS[actor.step];
  return (
    <KanbanCardRow start>
      <Avatar name={person.name} src={person.avatarUrl} size="xs" decorative />
      {yours ? (
        <>
          <KanbanCardMeta>Agora: você ·</KanbanCardMeta>
          {/* The card opens the same place: the link alone navigates. */}
          <TextLink href={workspaceHrefFor(href ?? nextStepHref(item))} size="sm" onClick={(event) => event.stopPropagation()}>{step}</TextLink>
        </>
      ) : (
        <KanbanCardMeta title={person.name}>Agora: {firstName(person.name)}</KanbanCardMeta>
      )}
    </KanbanCardRow>
  );
}

/** The current stage in a word; a delivered production reads "Concluída", not the stage in progress. */
function StageBadge({ stage }: { stage: StageView | undefined }) {
  if (!stage) return <Badge tone="gray" variant="soft" size="sm">Etapa indisponível</Badge>;
  const done = stage.state === 'done' || stage.status === 'completed';
  const tone = stage.state === 'error' ? 'red'
    : stage.state === 'warn' ? 'amber'
      : done ? 'green'
        : stage.state === 'blocked' ? 'gray' : 'blue';
  const label = stage.detail ?? (done ? 'Concluída' : stage.state === 'blocked' ? 'Bloqueada' : stage.state === 'upcoming' ? 'Próxima etapa' : 'Em andamento');
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

/** A Drive file on the Material lane: the same card, opened in Nova produção like an upload. */
function ReceivedCard({ material, onOpen }: { material: ReceivedMaterial; onOpen: () => void }) {
  const status = RECEIVED_STATUS[material.status];
  const title = material.fileName.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_\s]+/g, ' ').trim() || material.fileName;
  const meta = material.format ? FORMAT_SPECS[material.format].label : 'Drive';
  return (
    <KanbanCard title={title} summary={meta} onOpen={onOpen}>
      <KanbanCardRow start>
        <Badge tone="gray" variant="soft" size="sm">Drive</Badge>
        <Badge tone={status.tone} variant="soft" size="sm" live={status.live}>{status.label}</Badge>
      </KanbanCardRow>
      <KanbanCardRow>
        <KanbanCardMeta title={material.fileName}>{meta}</KanbanCardMeta>
        <RelativeTime at={material.receivedAt} />
      </KanbanCardRow>
    </KanbanCard>
  );
}
