'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Drawer,
  IconButton,
  List,
  ListItemSkeleton,
  Menu,
  PageHeader,
  toast,
  WorkspaceLayout,
} from '@content-ventures/design-system/v3';
import type { WorkspaceView } from '@content-ventures/design-system/v3';
import { Activity, AlertTriangle, CheckCheck, Ellipsis, Link2, Newspaper, Plus, Rss, Target } from '@content-ventures/design-system/v3/icons';
import type { NewsItem } from '@/domain/hard-news';
import { matchesSourceTier, sourceForNews } from '@/domain/news-source-match';
import type { SourceTierFilter } from '@/domain/news-source-match';
import { useCan } from '@/state';
import { useDocumentTitle } from '@/ui/use-document-title';
import { usePhone } from '@/ui/use-phone';
import { useNow } from '@/ui/time';
import { NEWS_SOURCES_HREF, researchHref } from '../routes';
import { useHardNews, useNewsWatch } from '../state/hard-news-provider';
import { DiscoverSourcesDialog } from '../sources/discover-sources-dialog';
import { coveredToday } from '../state/hard-news-state';
import { DeskGoalDialog } from './desk-goal-dialog';
import { ImportLinkDialog } from './import-link-dialog';
import { DecisionBar, NewsFicha } from './news-ficha';
import { matchesQuery, nextAfter } from './news-model';
import type { DeskTab } from './news-model';
import { decidedOf, heroOf, lastRead, pulse, queueOf, waitLabel, wireGroups } from './radar-model';
import { RadarActivity, RadarBoard, RadarSkeleton, type RadarBoardProps } from './radar-board';
import { NewsFilters } from './news-filters';
import { useRadar } from './use-radar';

/** On a first visit with no record of the last look, the last 90 minutes are "Novas". */
const FIRST_LOOK_MS = 90 * 60_000;

/** The desk opened on one news item (`/news?item=<id>`, from Início). */
export function NewsDeskFromUrl() {
  const params = useSearchParams();
  const item = params.get('item') ?? undefined;
  return <NewsDesk key={item ?? 'radar'} initialItem={item} />;
}

/** The inbox and reader share one frame; collection health lives in a secondary drawer. */
export function NewsDesk({ initialItem }: { initialItem?: string } = {}) {
  const { state, ready, actions, demo, live: onServer, newsFailed } = useHardNews();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialItem);
  const [view, setView] = useState<WorkspaceView>(initialItem ? 'main' : 'start');
  const [importing, setImporting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [failedItem, setFailedItem] = useState<string>();
  const [bodyAttempt, setBodyAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [covering, setCovering] = useState(false);
  const deciding = useRef(false);

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

  const board = useMemo(() => {
    const filtered = state.news.filter(item => matchesSourceTier(item, state.feeds, sourceTier)
      && (sourceId === 'all' || (item.feedId ?? sourceForNews(item, state.feeds)?.id) === sourceId));
    const queue = queueOf(filtered, query);
    const { hero, overflow } = triage ? heroOf(queue, 1) : { hero: [], overflow: 0 };
    const rest = queue.filter((item) => !hero.includes(item));
    const groups = wireGroups(rest, seenSince, now);
    const decided = decidedOf(filtered, query);
    const ordered = tab === 'open' ? [...hero, ...groups.flatMap((group) => group.items)] : decided;
    return { hero, overflow, groups, decided, ordered, open: queue.length };
  }, [now, query, seenSince, sourceId, sourceTier, state.feeds, state.news, tab, triage]);

  const signals = useMemo(() => pulse(state.news, state.feeds, seenSince, now), [now, seenSince, state.feeds, state.news]);
  // The open story is explicit: on a wide frame the first story opens once, and nothing that
  // arrives or re-sorts later replaces it (the decision bar always acts on what the person sees).
  if (live && selectedId === undefined && board.ordered[0]) setSelectedId(board.ordered[0].id);
  const selected = state.news.find((item) => item.id === selectedId);
  const shown = selectedId ? selected : board.ordered[0];
  useEffect(() => {
    if (!onServer || !ready || !selectedId || selected) return;
    let active = true;
    void actions.loadBody(selectedId).then(found => { if (active && !found) setFailedItem(selectedId); });
    return () => { active = false; };
  }, [actions, onServer, ready, selectedId, selected, bodyAttempt]);
  const read = lastRead(state.feeds);
  const anyActive = state.feeds.some((feed) => feed.state === 'active');
  useDocumentTitle(live ? (signals.fresh.count > 0 ? `(${signals.fresh.count}) Notícias` : 'Notícias') : null);

  async function refresh() {
    setRefreshing(true);
    try { await actions.refreshNews(); } finally { setRefreshing(false); }
  }

  /** Opens a story from anywhere (board, strip, toast): its tab, its place on the board, the ficha. */
  function select(id: string) {
    const item = state.news.find((candidate) => candidate.id === id);
    if (item) {
      setTab(item.status === 'new' ? 'open' : 'decided');
      if (!matchesQuery(item, query)) setQuery('');
      if (!matchesSourceTier(item, state.feeds, sourceTier)) setSourceTier('all');
      if (sourceId !== 'all' && (item.feedId ?? sourceForNews(item, state.feeds)?.id) !== sourceId) setSourceId('all');
    }
    setSelectedId(id);
    setView('main');
    setActivityOpen(false);
    requestAnimationFrame(() => {
      document.querySelector(`[data-testid="news-card-${id}"], [data-testid="news-row-${id}"]`)?.scrollIntoView({ block: 'nearest' });
      // In tabs (tablet, phone) the story replaces the board: focus follows it.
      document.querySelector<HTMLElement>('[data-ws-stop="main"]')?.focus();
    });
  }

  const { region } = useRadar(select, !triage);

  async function cover(item: NewsItem) {
    if (covering || deciding.current) return;
    if (onServer) {
      deciding.current = true;
      setCovering(true);
      try {
        const result = await actions.decideNews(item.id, { revision: item.decisionRevision ?? 0, action: 'select' });
        if (!result.ok) { toast('Não foi possível selecionar', { tone: 'error', description: result.message }); return; }
        setTab('decided');
        setSelectedId(item.id);
        toast('Notícia selecionada para redação');
      } finally { deciding.current = false; setCovering(false); }
      return;
    }
    setCovering(true);
    const productionId = await actions.cover(item.id);
    setCovering(false);
    if (!productionId) {
      toast('Não foi possível abrir a pauta', { tone: 'error' });
      return;
    }
    // The story stays open: its research starts right here, in the ficha.
    setSelectedId(item.id);
    toast('Pauta aberta em Produções', {
      description: 'A IA já está apurando.',
      action: { label: 'Abrir apuração', onClick: () => router.push(researchHref(productionId)) },
    });
  }

  async function postpone(item: NewsItem, hours: number, label: string) {
    if (deciding.current) return;
    const next = nextAfter(board.ordered, item.id);
    if (onServer) {
      deciding.current = true;
      setCovering(true);
      try {
        const result = await actions.decideNews(item.id, { revision: item.decisionRevision ?? 0, action: 'postpone', hours });
        if (!result.ok) { toast('Não foi possível adiar', { tone: 'error', description: result.message }); return; }
        setSelectedId(next);
        toast(`Adiada: ${label.toLowerCase()}`);
      } finally { deciding.current = false; setCovering(false); }
      return;
    }
    actions.postpone(item.id, hours);
    setSelectedId(next);
    toast(`Adiada: ${label.toLowerCase()}`, { action: { label: 'Desfazer', onClick: () => actions.restore(item.id) } });
  }

  async function discard(item: NewsItem, reason: string) {
    if (deciding.current) return;
    const next = nextAfter(board.ordered, item.id);
    if (onServer) {
      deciding.current = true;
      setCovering(true);
      try {
        const result = await actions.decideNews(item.id, { revision: item.decisionRevision ?? 0, action: 'discard', reason });
        if (!result.ok) { toast('Não foi possível descartar', { tone: 'error', description: result.message }); return; }
        setSelectedId(next);
        toast('Notícia descartada', { description: reason });
      } finally { deciding.current = false; setCovering(false); }
      return;
    }
    actions.discard(item.id, reason);
    setSelectedId(next);
    toast('Notícia descartada', { description: reason, action: { label: 'Desfazer', onClick: () => actions.restore(item.id) } });
  }

  // J/K walk the board, C covers, A postpones until tomorrow (never while typing or in a menu).
  const latest = useRef({ ordered: board.ordered, shown, cover, postpone, tab, canCover, triage });
  useEffect(() => {
    latest.current = { ordered: board.ordered, shown, cover, postpone, tab, canCover, triage };
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
        setSelectedId(next.id);
        document.querySelector(`[data-testid="news-card-${next.id}"], [data-testid="news-row-${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (key === 'c' && current && currentTab === 'open' && current.status === 'new' && (!latest.current.triage || current.classification) && allowed) {
        event.preventDefault();
        void latest.current.cover(current);
      } else if (key === 'a' && current && currentTab === 'open' && current.status === 'new' && allowed) {
        event.preventDefault();
        latest.current.postpone(current, 18, 'Até amanhã cedo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const menu = (
    <Menu
      label="Mais ações"
      align="end"
      sections={[
        {
          items: [
            ...(phone ? [{ label: 'Ver atividade', icon: Activity, onSelect: () => setActivityOpen(true) }] : []),
            { label: 'Marcar como vistas', icon: CheckCheck, onSelect: () => actions.markSeen() },
            ...(triage ? [{ label: 'Ajustar meta do dia', icon: Target, onSelect: () => setGoalOpen(true) }] : []),
            ...(onServer && canEdit ? [{ label: 'Descobrir fontes', icon: Rss, onSelect: () => setDiscovering(true) }] : []),
          ],
        },
        ...(phone ? [{ items: [
          ...(canEdit ? [{ label: 'Colar link', icon: Link2, onSelect: () => setImporting(true) }] : []),
          { label: 'Fontes', icon: Rss, onSelect: () => router.push(NEWS_SOURCES_HREF) },
        ] }] : []),
      ]}
      trigger={(props) => <IconButton {...props} label="Mais ações" icon={Ellipsis} variant="ghost" />}
    />
  );

  const header = (
    <PageHeader
      variant="frame"
      title="Notícias"
      status={live ? (anyActive ? <Badge variant="text" tone="green" dot>Ao vivo</Badge> : <Badge variant="text" tone="gray" dot="hollow">Parado</Badge>) : undefined}
      meta={live && read ? [`Lido ${waitLabel(read, now)}`] : undefined}
      actions={phone ? undefined : (
        <>
          <Button variant="ghost" icon={Activity} onClick={() => setActivityOpen(true)}>Ver atividade</Button>
          {canEdit ? <Button variant="secondary" icon={Link2} onClick={() => setImporting(true)}>Colar link</Button> : null}
          <ButtonLink href={NEWS_SOURCES_HREF} variant="secondary" icon={Rss}>Fontes</ButtonLink>
        </>
      )}
      more={menu}
    />
  );

  const clearFilters = () => { setQuery(''); setSourceTier('all'); setSourceId('all'); setSelectedId(undefined); };
  const filters = <NewsFilters tab={tab} onTab={value => { setTab(value); setSelectedId(undefined); }}
    counts={live ? { open: board.open, decided: board.decided.length } : undefined}
    query={query} onQuery={value => { setQuery(value); setSelectedId(undefined); }}
    open={filtersOpen} onOpen={setFiltersOpen}
    tier={sourceTier} onTier={value => { setSourceTier(value); setSelectedId(undefined); }}
    source={sourceId} onSource={value => { setSourceId(value); setSelectedId(undefined); }} feeds={state.feeds} />;
  const radarProps: RadarBoardProps = {
    triage, tab, now, news: state.news, feeds: state.feeds, pulse: signals, seenSince,
    goal: { covered: coveredToday(state.news, now), perDay: state.goal.perDay },
    hero: board.hero, overflow: board.overflow, groups: board.groups, decided: board.decided,
    query: query || (sourceTier !== 'all' || sourceId !== 'all' ? 'fonte' : ''),
    selectedId: shown?.id, onSelect: select,
    onEditGoal: () => { setActivityOpen(false); setGoalOpen(true); }, onClearFilters: clearFilters,
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
  const reader = live && shown ? <NewsFicha key={shown.id} item={shown} now={now} /> : live && selectedId && failedItem === selectedId ? (
    <EmptyState icon={AlertTriangle} title="Não foi possível abrir esta notícia" size="panel"
      actions={<Button variant="secondary" onClick={() => { setFailedItem(undefined); setBodyAttempt(value => value + 1); }}>Tentar novamente</Button>} />
  ) : live && !selectedId ? (
    <EmptyState icon={Newspaper} title="Nenhuma notícia aberta" description="Selecione uma notícia no radar para ler e decidir." size="panel" />
  ) : <List label="Notícia" framed={false} dividers={false}>
    <ListItemSkeleton /><ListItemSkeleton /><ListItemSkeleton />
  </List>;

  return (
    <>
      <WorkspaceLayout docked data-fixed-footer="" storageKey="reporter.news-inbox"
        header={header} mainLabel="Notícia" mainMin={480} narrowBelow={900}
        viewsLabel="Mesa de notícias" view={view} onViewChange={setView} defaultView="start"
        start={{ label: 'Radar', defaultSize: 440, min: 360, max: 520, collapsible: false, flush: true,
          header: filters, content: inbox }}
        footer={narrow => live && shown && (!narrow || view === 'main') ? <DecisionBar item={shown} covering={covering} canCover={canCover} demo={demo}
          onCover={item => void cover(item)} onPostpone={postpone} onDiscard={discard} /> : undefined}
      >
        {reader}
      </WorkspaceLayout>
      <Drawer open={activityOpen} onClose={() => setActivityOpen(false)} title="Atividade do radar" size="lg">
        <RadarActivity {...radarProps} />
      </Drawer>
      {region}
      <ImportLinkDialog open={importing} onClose={() => setImporting(false)} onImported={(id) => { setTab('open'); setQuery(''); select(id); }} />
      {discovering ? <DiscoverSourcesDialog open onClose={() => setDiscovering(false)} /> : null}
      <DeskGoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} />
    </>
  );
}
