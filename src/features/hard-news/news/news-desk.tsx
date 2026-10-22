'use client';

import { NewsSearchDialog } from '../sources/news-search-dialog';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonLink,
  EmptyState,
  Drawer,
  IconButton,
  List,
  ListItemSkeleton,
  Menu,
  PageHeader,
  Tooltip,
  toast,
  WorkspaceLayout,
} from '@content-ventures/design-system/v3';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Globe,
  Link2,
  Newspaper,
  Plus,
  Rss,
  Target,
  Telescope,
} from '@content-ventures/design-system/v3/icons';
import type { NewsItem } from '@/domain/hard-news';
import { matchesSourceTier, sourceForNews } from '@/domain/news-source-match';
import type { SourceTierFilter } from '@/domain/news-source-match';
import { useCan } from '@/state';
import { useDocumentTitle } from '@/ui/use-document-title';
import { useBreadcrumb } from '@/ui/shell';
import { usePhone } from '@/ui/use-phone';
import { useNow } from '@/ui/time';
import { NEWS_HREF, NEWS_SOURCES_HREF, researchHref } from '../routes';
import { useHardNews, useNewsWatch } from '../state/hard-news-provider';
import { DiscoverSourcesDialog } from '../sources/discover-sources-dialog';
import { coveredToday } from '../state/hard-news-state';
import { DeskGoalDialog } from './desk-goal-dialog';
import { ImportLinkDialog } from './import-link-dialog';
import { DecisionBar, NewsFicha } from './news-ficha';
import { matchesQuery, nextAfter } from './news-model';
import type { DeskTab } from './news-model';
import { RowDecision } from './news-row';
import { decidedOf, decisionGroups, heroOf, lastRead, pulse, queueOf, waitLabel, wireGroups } from './radar-model';
import type { BoardGroup } from './radar-model';
import { RadarActivity, RadarBoard, RadarSkeleton, type RadarBoardProps } from './radar-board';
import { editionOrder } from './edition-model';
import { NewsFilters } from './news-filters';
import { useRadar } from './use-radar';
import { matchesTopic, newsTopics } from './topic-model';
import type { NewsTopic } from './topic-model';

/** On a first visit with no record of the last look, the last 90 minutes are "Novas". */
const FIRST_LOOK_MS = 90 * 60_000;
/** The cover: the lead and the next three highlights. */
const COVER_SIZE = 4;
const PAGE_SIZE = 24;

type DecisionResult = { ok: true } | { ok: false; message: string };
type DecisionAction = { action: 'select' } | { action: 'postpone'; hours: number } | { action: 'discard'; reason: string };

/** Another view of the board (a tab, a subject) starts at its top, not where the last one was left. */
function boardToTop() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-ws-stop="main"] [role="region"]')?.scrollTo({ top: 0 }));
}

/** The headline as it sits on the board: the row itself, or the link that covers a cover card. */
function focusHeadline(id: string, preventScroll: boolean) {
  const target = document.querySelector<HTMLElement>(`[data-testid="news-card-${id}"]`);
  const control = target?.matches('button') ? target : target?.querySelector<HTMLElement>('button[data-card-link]');
  control?.focus({ preventScroll });
}

/** The desk opened on one news item (`/news?item=<id>`, from Início). */
export function NewsDeskFromUrl() {
  const params = useSearchParams();
  const item = params.get('item') ?? undefined;
  return <NewsDesk initialItem={item} />;
}

/** Headline overview first; the URL opens an explicit story and browser history returns to it. */
export function NewsDesk({ initialItem }: { initialItem?: string } = {}) {
  const { state, ready, actions, demo, live: onServer, newsFailed, search: webSearch } = useHardNews();
  useNewsWatch();
  // The connected desk supports editorial decisions before AI classification is available.
  const triage = !onServer;
  const router = useRouter();
  const phone = usePhone();
  const clock = useNow();
  // The demonstration opens no production in the real workspace: "Cobrir" says why it waits.
  const canCreate = useCan('production.create');
  const canEdit = useCan('production.edit');
  const canCover = onServer ? canEdit : canCreate && !demo;
  const [chosenTab, setTab] = useState<DeskTab>();
  const [query, setQuery] = useState('');
  const [sourceTier, setSourceTier] = useState<SourceTierFilter>('all');
  const [sourceId, setSourceId] = useState('all');
  const [topic, setTopic] = useState<Pick<NewsTopic, 'key' | 'label'>>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [headlineLimit, setHeadlineLimit] = useState(PAGE_SIZE);
  const overviewScroll = useRef(0);
  const loadMoreFocus = useRef<string | undefined>(undefined);
  const returnFocus = useRef<string | undefined>(undefined);
  const selectedId = initialItem;
  function setSelectedId(id: string | undefined) {
    if (id !== selectedId) router.push(id ? `${NEWS_HREF}?item=${encodeURIComponent(id)}` : NEWS_HREF, { scroll: false });
  }
  const [importing, setImporting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [failedItem, setFailedItem] = useState<string>();
  const [bodyAttempt, setBodyAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  // Stories with a decision on its way: one at a time per story, many stories at once.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const deciding = useRef(new Set<string>());
  const newsNow = useRef(state.news);
  useEffect(() => { newsNow.current = state.news; });

  const now = clock?.getTime() ?? 0;
  const live = ready && now > 0;
  // The tab is resolved once (a linked story that is already decided opens "Decididas"); deciding
  // the story afterwards never flips the board.
  if (live && chosenTab === undefined) {
    const linked = initialItem ? state.news.find((item) => item.id === initialItem) : undefined;
    // A deep link can be older than the polling window; wait for its own read to choose the tab.
    if (!initialItem || linked || failedItem === initialItem) setTab(linked && linked.status !== 'new' ? 'decided' : 'open');
  }
  const tab: DeskTab = chosenTab ?? 'open';
  const seenSince = state.radar?.seenSince ?? new Date(now - FIRST_LOOK_MS).toISOString();
  const filtered = Boolean(query || topic || sourceTier !== 'all' || sourceId !== 'all');

  const board = useMemo(() => {
    const scoped = state.news.filter(item => matchesSourceTier(item, state.feeds, sourceTier)
      && (sourceId === 'all' || (item.feedId ?? sourceForNews(item, state.feeds)?.id) === sourceId));
    const topics = newsTopics(scoped, now);
    const queue = queueOf(topic ? scoped.filter(item => matchesTopic(item, topic.key, now)) : scoped, query);
    const decided = decidedOf(scoped, query);
    let cover: NewsItem[] = [];
    let groups: BoardGroup[];
    if (tab === 'decided') groups = decisionGroups(decided);
    else if (!filtered) {
      cover = editionOrder(queue, now, triage).slice(0, COVER_SIZE);
      groups = wireGroups(queue.filter(item => !cover.includes(item)), seenSince, now);
    } else {
      // With a search, a filter or a topic the simulation's top stories lead the results.
      const { hero } = triage ? heroOf(queue, 3) : { hero: [] as NewsItem[] };
      groups = [
        ...(hero.length ? [{ id: 'hero', label: 'Cobrir agora', items: hero }] : []),
        ...wireGroups(queue.filter(item => !hero.includes(item)), seenSince, now),
      ];
    }
    const ordered = [...cover, ...groups.flatMap(group => group.items)];
    return { cover, groups, ordered, open: queue.length, decided: decided.length, topics, hero: triage ? heroOf(queue, 1).hero : [] };
  }, [filtered, now, query, seenSince, sourceId, sourceTier, state.feeds, state.news, tab, topic, triage]);

  useEffect(() => {
    if (!loadMoreFocus.current) return;
    const id = loadMoreFocus.current;
    loadMoreFocus.current = undefined;
    const frame = requestAnimationFrame(() => focusHeadline(id, false));
    return () => cancelAnimationFrame(frame);
  }, [headlineLimit]);

  const signals = useMemo(() => pulse(state.news, state.feeds, seenSince, now), [now, seenSince, state.feeds, state.news]);
  // Merely visiting the radar never reads a body or enables a decision on an unseen story.
  const shown = state.news.find((item) => item.id === selectedId);
  const selected = shown;
  useBreadcrumb(selectedId ? [{ label: 'Notícias', href: NEWS_HREF }, { label: 'Matéria' }] : null);
  useEffect(() => {
    if (!onServer || !ready || !selectedId || selected) return;
    let active = true;
    void actions.loadBody(selectedId).then(found => { if (active && !found) setFailedItem(selectedId); });
    return () => { active = false; };
  }, [actions, onServer, ready, selectedId, selected, bodyAttempt]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>('[data-ws-stop="main"]');
      main?.querySelector<HTMLElement>('[role="region"]')?.scrollTo({ top: selectedId ? 0 : overviewScroll.current });
      if (selectedId) main?.focus({ preventScroll: true });
      else if (returnFocus.current) focusHeadline(returnFocus.current, true);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  const read = lastRead(state.feeds);
  const anyActive = state.feeds.some((feed) => feed.state === 'active')
    || Boolean(webSearch?.configured && webSearch.config?.enabled && !['failed', 'limited'].includes(webSearch.state));
  useDocumentTitle(live ? (signals.fresh.count > 0 ? `(${signals.fresh.count}) Notícias` : 'Notícias') : null);

  // Where the open story sits on the board, for "anterior" and "próxima".
  const position = shown ? board.ordered.findIndex(item => item.id === shown.id) : -1;
  // Other open stories on the subjects this one shares with "Em alta", the most specific subject first.
  const related = useMemo(() => {
    if (!shown) return [];
    const found = new Map<string, NewsItem>();
    const shared = newsTopics(state.news, now)
      .filter(entry => entry.items.some(item => item.id === shown.id))
      .sort((a, b) => a.items.length - b.items.length);
    for (const entry of shared) for (const item of entry.items) if (item.id !== shown.id && !found.has(item.id)) found.set(item.id, item);
    return [...found.values()].slice(0, 4);
  }, [now, shown, state.news]);

  async function refresh() {
    setRefreshing(true);
    try { await actions.refreshNews(); } finally { setRefreshing(false); }
  }

  /** Opens a story from anywhere (board, strip, toast): its tab, its place on the board, the ficha. */
  function select(id: string) {
    if (!selectedId) {
      overviewScroll.current = document.querySelector<HTMLElement>('[data-ws-stop="main"] [role="region"]')?.scrollTop ?? 0;
      returnFocus.current = id;
    }
    const item = state.news.find((candidate) => candidate.id === id);
    if (item) {
      setTab(item.status === 'new' ? 'open' : 'decided');
      if (topic && !matchesTopic(item, topic.key, now)) setTopic(undefined);
      if (!matchesQuery(item, query)) setQuery('');
      if (!matchesSourceTier(item, state.feeds, sourceTier)) setSourceTier('all');
      if (sourceId !== 'all' && (item.feedId ?? sourceForNews(item, state.feeds)?.id) !== sourceId) setSourceId('all');
    }
    setSelectedId(id);
    setActivityOpen(false);
  }

  const { region } = useRadar(select, !triage);

  /** One decision per story at a time: nothing happens while the story's last one is on its way. */
  async function decide<T>(item: NewsItem, write: () => Promise<T>): Promise<T | undefined> {
    if (deciding.current.has(item.id)) return undefined;
    deciding.current.add(item.id);
    setPending(new Set(deciding.current));
    try { return await write(); } finally {
      deciding.current.delete(item.id);
      setPending(new Set(deciding.current));
    }
  }

  /** "Desfazer": the story goes back to the queue with the revision its decision left. */
  async function undo(id: string) {
    if (!onServer) { actions.restore(id); return; }
    const current = newsNow.current.find(item => item.id === id);
    const result = await actions.decideNews(id, { revision: current?.decisionRevision ?? 0, action: 'restore' });
    if (!result.ok) toast('Não foi possível desfazer', { tone: 'error', description: result.message });
  }

  /** A connected decision, with "Desfazer" in its confirmation. */
  async function decideLive(item: NewsItem, input: DecisionAction, done: { title: string; description?: string }, failure: string): Promise<boolean> {
    const result: DecisionResult | undefined = await decide(item, () => actions.decideNews(item.id, { ...input, revision: item.decisionRevision ?? 0 }));
    if (!result) return false;
    if (!result.ok) { toast(failure, { tone: 'error', description: result.message }); return false; }
    toast(done.title, { description: done.description, action: { label: 'Desfazer', onClick: () => void undo(item.id) } });
    return true;
  }

  /** "Selecionar para redação" (connected) or "Cobrir" (simulation); from the ficha the story stays open. */
  async function cover(item: NewsItem, from: 'ficha' | 'row' = 'ficha') {
    if (onServer) {
      const done = await decideLive(item, { action: 'select' }, { title: 'Notícia selecionada para redação' }, 'Não foi possível selecionar');
      if (done && from === 'ficha') { setTab('decided'); setSelectedId(item.id); }
      return;
    }
    const opened = await decide(item, async () => ({ productionId: await actions.cover(item.id) }));
    if (!opened) return;
    const { productionId } = opened;
    if (!productionId) {
      toast('Não foi possível abrir a pauta', { tone: 'error' });
      return;
    }
    // From the ficha the story stays open: its research starts right there.
    if (from === 'ficha') setSelectedId(item.id);
    toast('Pauta aberta em Produções', {
      description: 'A IA já está apurando.',
      action: { label: 'Abrir apuração', onClick: () => router.push(researchHref(productionId)) },
    });
  }

  async function postpone(item: NewsItem, hours: number, label: string, from: 'ficha' | 'row' = 'ficha') {
    const next = nextAfter(board.ordered, item.id);
    if (onServer) {
      const done = await decideLive(item, { action: 'postpone', hours }, { title: `Adiada: ${label.toLowerCase()}` }, 'Não foi possível adiar');
      if (done && from === 'ficha') setSelectedId(next);
      return;
    }
    actions.postpone(item.id, hours);
    if (from === 'ficha') setSelectedId(next);
    toast(`Adiada: ${label.toLowerCase()}`, { action: { label: 'Desfazer', onClick: () => actions.restore(item.id) } });
  }

  async function discard(item: NewsItem, reason: string, from: 'ficha' | 'row' = 'ficha') {
    const next = nextAfter(board.ordered, item.id);
    if (onServer) {
      const done = await decideLive(item, { action: 'discard', reason }, { title: 'Notícia descartada', description: reason }, 'Não foi possível descartar');
      if (done && from === 'ficha') setSelectedId(next);
      return;
    }
    actions.discard(item.id, reason);
    if (from === 'ficha') setSelectedId(next);
    toast('Notícia descartada', { description: reason, action: { label: 'Desfazer', onClick: () => actions.restore(item.id) } });
  }

  async function restore(item: NewsItem) {
    if (!onServer) { actions.restore(item.id); toast('De volta à fila'); return; }
    const result = await decide(item, () => actions.decideNews(item.id, { revision: item.decisionRevision ?? 0, action: 'restore' }));
    if (result && !result.ok) toast('Não foi possível devolver à fila', { tone: 'error', description: result.message });
    else if (result) toast('De volta à fila');
  }

  // J/K walk the board, C covers, A postpones until tomorrow (never while typing or in a menu).
  const latest = useRef({ ordered: board.ordered, shown, cover, postpone, tab, canCover, triage, select });
  useEffect(() => {
    latest.current = { ordered: board.ordered, shown, cover, postpone, tab, canCover, triage, select };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      // Holding C or A must not decide one story after another.
      if (event.repeat && (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'a')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="menuitem"], [role="combobox"], [role="listbox"], [role="option"]')) return;
      const { ordered, shown: current, tab: currentTab, canCover: allowed } = latest.current;
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        const index = current ? ordered.findIndex((item) => item.id === current.id) : -1;
        const next = ordered[key === 'j' ? Math.min(ordered.length - 1, index + 1) : Math.max(0, index - 1)];
        if (!next) return;
        event.preventDefault();
        latest.current.select(next.id);
      } else if (key === 'c' && current && currentTab === 'open' && current.status === 'new' && (!latest.current.triage || current.classification) && allowed) {
        event.preventDefault();
        void latest.current.cover(current);
      } else if (key === 'a' && current && currentTab === 'open' && current.status === 'new' && allowed) {
        event.preventDefault();
        void latest.current.postpone(current, 18, 'Até amanhã cedo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Bringing news in: a pasted link, the web search, new sources.
  const intake = [
    ...(canEdit ? [{ label: 'Colar link', icon: Link2, onSelect: () => setImporting(true) }] : []),
    ...(onServer && canEdit ? [
      { label: 'Buscar na web', icon: Globe, onSelect: () => setSearching(true) },
      { label: 'Descobrir fontes', icon: Rss, onSelect: () => setDiscovering(true) },
    ] : []),
  ];
  const menu = (
    <Menu
      label="Mais ações"
      align="end"
      sections={[
        {
          items: [
            { label: 'Ver atividade', icon: Activity, onSelect: () => setActivityOpen(true) },
            { label: 'Marcar como vistas', icon: CheckCheck, onSelect: () => actions.markSeen() },
            ...(triage ? [{ label: 'Ajustar meta do dia', icon: Target, onSelect: () => setGoalOpen(true) }] : []),
          ],
        },
        ...(phone ? [{ items: [...intake, { label: 'Fontes', icon: Rss, onSelect: () => router.push(NEWS_SOURCES_HREF) }] }] : []),
      ]}
      trigger={(props) => <IconButton {...props} label="Mais ações" icon={Ellipsis} variant="ghost" />}
    />
  );

  const radarHeader = (
    <PageHeader
      variant="frame"
      title="Radar de notícias"
      status={live ? (anyActive ? <Badge variant="text" tone="green" dot>Ao vivo</Badge> : <Badge variant="text" tone="gray" dot="hollow">Parado</Badge>) : undefined}
      meta={live && read ? [`Lido ${waitLabel(read, now)}`] : undefined}
      actions={phone ? undefined : (
        <>
          {intake.length ? <Menu label="Adicionar notícias" align="end" sections={[{ items: intake }]}
            trigger={props => <Button {...props} variant="secondary" icon={Plus} trailingIcon={ChevronDown}>Adicionar</Button>} /> : null}
          <ButtonLink href={NEWS_SOURCES_HREF} variant="secondary" icon={Rss}>Fontes</ButtonLink>
        </>
      )}
      more={menu}
    />
  );
  const previous = position > 0 ? board.ordered[position - 1] : undefined;
  const following = position >= 0 ? board.ordered[position + 1] : undefined;
  // Previous and next keep their place at the end of the title line, on a phone too.
  const readerNav = position >= 0 ? (
    <ButtonGroup label="Navegar entre notícias">
      <Tooltip content="Notícia anterior" shortcut="K" disabled={!previous}>
        <IconButton icon={ChevronLeft} label="Notícia anterior" title="" disabled={!previous} onClick={() => previous && select(previous.id)} />
      </Tooltip>
      <Tooltip content="Próxima notícia" shortcut="J" disabled={!following}>
        <IconButton icon={ChevronRight} label="Próxima notícia" title="" disabled={!following} onClick={() => following && select(following.id)} />
      </Tooltip>
    </ButtonGroup>
  ) : undefined;
  const readerHeader = (
    <PageHeader
      variant="frame"
      title="Notícias"
      meta={position >= 0 ? [{ value: `${position + 1} de ${board.ordered.length}`, numeric: true }] : undefined}
      actions={phone ? undefined : readerNav}
      more={phone ? readerNav : undefined}
    />
  );

  const clearFilters = () => { setQuery(''); setTopic(undefined); setSourceTier('all'); setSourceId('all'); setSelectedId(undefined); };
  const filters = <NewsFilters tab={tab} onTab={value => { setTab(value); setTopic(undefined); setSelectedId(undefined); boardToTop(); }}
    counts={live ? { open: board.open, decided: board.decided } : undefined}
    query={query} onQuery={value => { setQuery(value); setTopic(undefined); setSelectedId(undefined); }}
    open={filtersOpen} onOpen={setFiltersOpen}
    tier={sourceTier} onTier={value => { setSourceTier(value); setTopic(undefined); setSelectedId(undefined); }}
    source={sourceId} onSource={value => { setSourceId(value); setTopic(undefined); setSelectedId(undefined); }} feeds={state.feeds} />;
  // The row's decisions: the same ones the ficha offers, for a person who can decide.
  const primary = onServer
    ? { label: 'Selecionar para redação', icon: Check, onSelect: (item: NewsItem) => void cover(item, 'row') }
    : canCover ? { label: 'Cobrir', icon: Telescope, onSelect: (item: NewsItem) => void cover(item, 'row') } : undefined;
  // Adiar and Descartar change only the simulation's own desk; Cobrir waits in the demonstration.
  const decides = onServer ? canEdit : canCreate;
  const radarProps: RadarBoardProps = {
    triage, tab, now, news: state.news, feeds: state.feeds, pulse: signals, seenSince,
    goal: { covered: coveredToday(state.news, now), perDay: state.goal.perDay },
    hero: board.hero, cover: board.cover, groups: board.groups, filtered,
    topics: query ? [] : board.topics, topic,
    onTopic: value => { setTopic({ key: value.key, label: value.label }); setHeadlineLimit(PAGE_SIZE); boardToTop(); },
    onClearTopic: () => { setTopic(undefined); boardToTop(); },
    onSelect: select,
    visibleCount: headlineLimit, onLoadMore: () => {
      loadMoreFocus.current = board.ordered[headlineLimit]?.id;
      setHeadlineLimit(value => value + PAGE_SIZE);
    },
    onEditGoal: () => { setActivityOpen(false); setGoalOpen(true); }, onClearFilters: clearFilters,
    compact: phone,
    decision: item => decides ? <RowDecision item={item} compact={phone} busy={pending.has(item.id)}
      primary={item.status === 'new' && (!triage || item.classification) ? primary : undefined}
      onPostpone={(story, hours, label) => void postpone(story, hours, label, 'row')}
      onDiscard={(story, reason) => void discard(story, reason, 'row')}
      onRestore={story => void restore(story)} /> : null,
  };
  const inbox = onServer && newsFailed ? (
    <EmptyState icon={AlertTriangle} title="Não foi possível carregar as notícias" description="Tente novamente para atualizar o radar."
      actions={<Button variant="primary" loading={refreshing} onClick={() => void refresh()}>Tentar novamente</Button>} />
  ) : live && !triage && state.feeds.length === 0 && state.news.length === 0 ? (
    <EmptyState icon={Rss} title="Nenhuma fonte cadastrada"
      description={canEdit ? 'Encontre fontes para o seu veículo ou setor e receba as primeiras notícias.' : undefined}
      actions={canEdit ? <>
        <Button variant="primary" icon={Rss} onClick={() => setDiscovering(true)}>Descobrir fontes</Button>
        <ButtonLink href={NEWS_SOURCES_HREF} variant="secondary" icon={Plus}>Adicionar fonte</ButtonLink>
      </> : undefined} />
  ) : live ? <RadarBoard {...radarProps} /> : <RadarSkeleton />;
  const reader = live && shown ? <NewsFicha key={shown.id} item={shown} now={now} related={related} onOpen={select} /> : live && selectedId && failedItem === selectedId ? (
    <EmptyState icon={AlertTriangle} title="Não foi possível abrir esta notícia" size="panel"
      actions={<Button variant="secondary" onClick={() => { setFailedItem(undefined); setBodyAttempt(value => value + 1); }}>Tentar novamente</Button>} />
  ) : live && !selectedId ? (
    <EmptyState icon={Newspaper} title="Nenhuma notícia aberta" description="Selecione uma notícia no radar para ler e decidir." size="panel" />
  ) : <List label="Notícia" framed={false} dividers={false}>
    <ListItemSkeleton /><ListItemSkeleton /><ListItemSkeleton />
  </List>;

  return (
    <>
      <WorkspaceLayout docked data-fixed-footer="" header={selectedId ? readerHeader : radarHeader}
        mainLabel={selectedId ? 'Notícia' : 'Manchetes'}
        mainHeader={!selectedId ? filters : undefined}
        footer={live && shown ? <DecisionBar item={shown} covering={pending.has(shown.id)} canCover={canCover} demo={demo}
          onCover={item => void cover(item)} onPostpone={(item, hours, label) => void postpone(item, hours, label)}
          onDiscard={(item, reason) => void discard(item, reason)} onRestore={item => void restore(item)} /> : undefined}
      >
        {selectedId ? reader : inbox}
      </WorkspaceLayout>
      <Drawer open={activityOpen} onClose={() => setActivityOpen(false)} title="Atividade do radar" size="lg">
        <RadarActivity {...radarProps} />
      </Drawer>
      {region}
      <ImportLinkDialog open={importing} onClose={() => setImporting(false)} onImported={(id) => { setTab('open'); setQuery(''); select(id); }} />
      {searching ? <NewsSearchDialog onClose={() => setSearching(false)} /> : null}
      {discovering ? <DiscoverSourcesDialog open onClose={() => setDiscovering(false)} /> : null}
      <DeskGoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} />
    </>
  );
}
