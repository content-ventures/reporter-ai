'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Button,
  Card,
  Carousel,
  Chip,
  EmptyState,
  FilterBar,
  Grid,
  PageHeader,
  PageStack,
  Pagination,
  Panel,
  SearchField,
  Section,
  SkeletonText,
  Tabs,
  ToggleGroup,
  toast,
} from '@content-ventures/design-system/v3';
import { Library } from '@content-ventures/design-system/v3/icons';
import type { ArchiveAnswer, ArchiveArticle } from '@/domain/hard-news';
import { plural } from '@/ui/format';
import { usePhone } from '@/ui/use-phone';
import { useHardNews } from '../state/hard-news-provider';
import { AnswerPanel } from './archive-answer';
import type { AskStep } from './archive-answer';
import { ArchiveCard, archiveCardId, ShelfCard } from './archive-card';
import { ARCHIVE_TABS, archivePulse, archiveShelves, archiveUses, suggestedSearches, tabCounts, usesByArticle, visibleArticles } from './archive-model';
import type { ArchiveTab } from './archive-model';
import { ArticleDrawer } from './article-drawer';

const PAGE_SIZE = 12;
const ALL = 'all';
/** The Drawer's exit, so a toast fired after it lands outside the modal layer. */
const DRAWER_EXIT_MS = 320;
/** The preview's AI reads what is still in its queue a few seconds after the Acervo opens. */
const QUEUE_READ_MS = 6000;
/** The preview answers in 1.4 s: the first half is the search, the second the writing. */
const SEARCH_STEP_MS = 700;
/** Editoria folders: a row of seven from 1600 px (contract breakpoint), else a row to swipe. */
const WIDE = '(min-width: 1600px)';
const SHELVES_WIDE = 7;
const SHELVES = 5;

function subscribeWide(onChange: () => void) {
  const list = window.matchMedia(WIDE);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}

/** Focus back on an article's card (its title link) after its state changed. */
function focusCard(articleId: string) {
  requestAnimationFrame(() => document.getElementById(archiveCardId(articleId))?.querySelector<HTMLElement>('button, a')?.focus());
}

type Asked = { question: string; step?: AskStep; answer?: ArchiveAnswer; failed?: boolean };

/**
 * Acervo (F2.12): the articles the portal published, as a library the reporter searches before
 * covering a story ("o que já demos sobre isso?"). A search brings the AI's answer, citing only
 * published passages (REQ-2.12), above the articles found. Without a search, the editorias are the
 * shelves and every card says in how many stories the AI used the article.
 */
export function ArchiveScreen() {
  const { state, ready, actions } = useHardNews();
  const archive = state.archive;
  const [input, setInput] = useState('');
  const [asked, setAsked] = useState<Asked>();
  const latest = useRef('');
  const [tab, setTab] = useState<ArchiveTab>('all');
  const [section, setSection] = useState(ALL);
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<{ id: string; open: boolean }>();
  const query = asked?.question ?? '';
  const wide = useWide();
  const phone = usePhone();

  const uses = useMemo(() => archiveUses({ archive, dossiers: state.dossiers, news: state.news, suggestions: state.suggestions }), [archive, state.dossiers, state.news, state.suggestions]);
  const byArticle = useMemo(() => usesByArticle(uses), [uses]);
  const pulse = useMemo(() => archivePulse(archive, uses), [archive, uses]);
  const shelves = useMemo(() => archiveShelves(archive), [archive]);
  // The carousel keeps 0.4 of a slot for the next folder: when every folder fits, they fill the row.
  const perView = !wide ? SHELVES : shelves.length <= SHELVES_WIDE ? Math.max(1, shelves.length - 0.4) : SHELVES_WIDE;
  const suggestions = useMemo(() => (ready ? suggestedSearches(archive) : []), [archive, ready]);
  const inSection = useMemo(() => archive.filter((article) => section === ALL || article.section === section), [archive, section]);
  const counts = useMemo(() => tabCounts(inSection, byArticle), [inSection, byArticle]);
  const rows = useMemo(() => (query ? visibleArticles(archive, byArticle, { tab: 'all', section: ALL, query }) : visibleArticles(archive, byArticle, { tab, section, query: '' })), [archive, byArticle, query, section, tab]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const openArticle = opened ? archive.find((article) => article.id === opened.id) : undefined;

  // The preview's AI works through its queue: what was waiting gets read a little after the page
  // opens (also what a reload interrupted).
  const queued = useMemo(() => archive.filter((article) => article.index === 'pending').map((article) => article.id).join(' '), [archive]);
  useEffect(() => {
    if (!ready || !queued) return undefined;
    const timer = setTimeout(() => queued.split(' ').forEach((id) => actions.reindex(id)), QUEUE_READ_MS);
    return () => clearTimeout(timer);
  }, [actions, queued, ready]);

  /** A search: the articles about it at once, and the AI's cited answer above them. */
  async function search(text: string) {
    const question = text.trim();
    setInput(text);
    setPage(1);
    latest.current = question;
    if (!question) {
      setAsked(undefined);
      return;
    }
    setAsked({ question, step: 'search' });
    const writing = setTimeout(() => setAsked((previous) => (previous?.question === question && previous.step ? { question, step: 'write' } : previous)), SEARCH_STEP_MS);
    try {
      const answer = await actions.ask(question);
      if (latest.current === question) setAsked({ question, answer });
    } catch {
      if (latest.current === question) setAsked({ question, failed: true });
    } finally {
      clearTimeout(writing);
    }
  }

  function showShelf(name: string) {
    setSection((previous) => (previous === name ? ALL : name));
    setTab('all');
    setPage(1);
  }

  function resend(article: ArchiveArticle) {
    actions.reindex(article.id);
    toast('Matéria reenviada para a IA', { description: article.title });
    focusCard(article.id);
  }

  /** From the drawer: close it first, so the toast is not under the modal layer. */
  function resendFromDrawer(article: ArchiveArticle) {
    actions.reindex(article.id);
    setOpened((previous) => (previous ? { ...previous, open: false } : previous));
    setTimeout(() => {
      toast('Matéria reenviada para a IA', { description: article.title });
      focusCard(article.id);
    }, DRAWER_EXIT_MS);
  }

  const open = (id: string) => setOpened({ id, open: true });
  const unreadMatches = query ? rows.filter((article) => article.index !== 'indexed').length : 0;
  const listTitle = query ? 'Matérias encontradas' : section === ALL ? 'Matérias' : section;

  return (
    <PageStack>
      <PageHeader
        title="Acervo"
        meta={ready ? [plural(pulse.total, 'matéria publicada', 'matérias publicadas'), plural(pulse.read, 'lida pela IA', 'lidas pela IA')] : undefined}
        toolbar={(
          <Grid columns="auto" min={10000} gap="sm">
            <SearchField
              size="lg"
              label="Buscar no acervo"
              placeholder="O que o portal já publicou sobre…"
              hotkey="/"
              shortcut="/"
              enterKeyHint="search"
              disabled={!ready}
              loading={Boolean(asked?.step)}
              value={input}
              onValueChange={(value) => {
                setInput(value);
                if (!value.trim()) void search('');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void search(input);
              }}
            />
            {suggestions.length > 0 ? (
              <ToggleGroup
                type="single"
                label="Buscas sugeridas"
                size="sm"
                value={suggestions.some((item) => item.value === query) ? query : null}
                onChange={(value) => void search(value ?? '')}
                items={suggestions}
              />
            ) : null}
          </Grid>
        )}
      />
      {asked ? (
        <AnswerPanel
          question={asked.question}
          step={asked.step}
          answer={asked.answer}
          failed={Boolean(asked.failed)}
          archive={archive}
          unreadMatches={unreadMatches}
          onRetry={() => void search(asked.question)}
          onOpenArticle={open}
        />
      ) : ready ? (
        // The editorias head their own panel (h2), so the folders (h3) sit under it.
        <Panel label="Editorias">
          <Section title="Editorias">
            <Carousel label="Editorias" perView={perView}>
              {shelves.map((shelf) => <ShelfCard key={shelf.name} shelf={shelf} compact={phone} selected={section === shelf.name} onSelect={() => showShelf(shelf.name)} />)}
            </Carousel>
          </Section>
        </Panel>
      ) : (
        <Grid columns="auto" min={200} label="Carregando editorias">
          <Card padding="sm" loading><SkeletonText lines={3} /></Card>
          <Card padding="sm" loading><SkeletonText lines={3} /></Card>
          <Card padding="sm" loading><SkeletonText lines={3} /></Card>
        </Grid>
      )}
      {query && rows.length === 0 ? null : (
        <Section title={listTitle} meta={ready ? String(rows.length) : undefined}>
          <PageStack>
            {query ? null : (
              <FilterBar
                filters={false}
                spacing="comfortable"
                tabs={(
                  <Tabs<ArchiveTab>
                    label="Recorte"
                    size="sm"
                    value={tab}
                    onChange={(value) => { setTab(value); setPage(1); }}
                    items={ARCHIVE_TABS.map((entry) => ({ value: entry.value, label: entry.label, count: ready ? counts[entry.value] : undefined }))}
                  />
                )}
                actions={section === ALL ? undefined : (
                  <Chip label="Editoria:" onRemove={() => showShelf(section)} removeLabel={`Tirar o filtro ${section}`}>{section}</Chip>
                )}
              />
            )}
            {!ready ? (
              <Grid columns="auto" min={320} label="Carregando matérias">
                <Card padding="sm" loading><SkeletonText lines={4} /></Card>
                <Card padding="sm" loading><SkeletonText lines={4} /></Card>
                <Card padding="sm" loading><SkeletonText lines={4} /></Card>
              </Grid>
            ) : rows.length === 0 ? (
              <EmptyArticles tab={tab} filtered={section !== ALL} onShowAll={() => { setTab('all'); setSection(ALL); }} />
            ) : (
              <>
                <Grid columns="auto" min={320} as="ul" label={listTitle}>
                  {shown.map((article) => (
                    <ArchiveCard key={article.id} article={article} uses={byArticle.get(article.id) ?? []} onOpen={open} onResend={resend} />
                  ))}
                </Grid>
                <Pagination page={current} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="matérias" />
              </>
            )}
          </PageStack>
        </Section>
      )}
      <ArticleDrawer
        article={openArticle}
        uses={opened ? byArticle.get(opened.id) ?? [] : []}
        open={Boolean(opened?.open && openArticle)}
        onClose={() => setOpened((previous) => (previous ? { ...previous, open: false } : previous))}
        onResend={resendFromDrawer}
      />
    </PageStack>
  );
}

function EmptyArticles({ tab, filtered, onShowAll }: { tab: ArchiveTab; filtered: boolean; onShowAll: () => void }) {
  const title = tab === 'out' ? 'Todas as matérias foram lidas pela IA' : tab === 'used' ? 'A IA ainda não usou estas matérias' : 'Nenhuma matéria publicada';
  return <EmptyState size="panel" icon={Library} title={title} actions={tab !== 'all' || filtered ? <Button onClick={onShowAll}>Ver todas</Button> : undefined} />;
}
