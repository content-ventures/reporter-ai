'use client';

import { useState } from 'react';
import {
  AttachedNote,
  Badge,
  BrandMark,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Grid,
  IconButton,
  LinkButton,
  Menu,
  MetaList,
  MetricStrip,
  PageHeader,
  PageStack,
  Select,
  Sparkline,
  toast,
} from '@content-ventures/design-system/v3';
import { AlertTriangle, Ellipsis, Pause, Play, Plus, RefreshCw, Rss, Trash2 } from '@content-ventures/design-system/v3/icons';
import type { NewsFeed } from '@/domain/hard-news';
import { useBreadcrumb } from '@/ui/shell';
import { RelativeTime } from '@/ui/time';
import { NEWS_HREF } from '../routes';
import { useHardNews, useNewsWatch } from '../state/hard-news-provider';
import { AddFeedDialog } from './add-feed-dialog';
import { FEED_STATE, feedOrigin, INTERVAL_OPTIONS } from './feed-format';

/**
 * Fontes (F2.1, REQ-2.1): the RSS feeds the desk reads, how often, and whether each one answers.
 * A feed that stopped answering comes first, with "Tentar de novo"; the table keeps frequency,
 * last read and the day's count per feed. Removing a feed never removes the news it brought.
 */
export function SourcesScreen() {
  const { state, ready, actions } = useHardNews();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<NewsFeed>();
  useBreadcrumb([{ label: 'Notícias', href: NEWS_HREF }, { label: 'Fontes' }]);
  useNewsWatch();

  const feeds = state.feeds;
  const failing = ready ? feeds.filter((feed) => feed.state === 'failing') : [];

  async function retry(feed: NewsFeed) {
    toast(`Lendo ${feed.name} de novo`);
    const read = await actions.retryFeed(feed.id);
    if (read?.state === 'failing') toast(`${feed.name} não respondeu`, { tone: 'error', description: read.lastError });
  }

  async function change(feed: NewsFeed, patch: { paused?: boolean; everyMinutes?: number }, done?: string) {
    const result = await actions.updateFeed(feed.id, patch);
    if (!result.ok) toast('Não foi possível salvar', { tone: 'error', description: result.message });
    else if (done) toast(done);
  }


  const active = feeds.filter((feed) => feed.state === 'active').length;
  const today = feeds.reduce((total, feed) => total + feed.lastDay, 0);
  const rhythm = feeds.reduce<number[]>((days, feed) => (feed.lastWeek ?? []).map((value, index) => (days[index] ?? 0) + value), []);
  const duplicates = state.news.reduce((total, item) => total + item.duplicates.length, 0);
  const lastRead = feeds.map((feed) => feed.lastReadAt ?? '').sort().pop();

  return (
    <>
      <PageStack>
        <PageHeader
          title="Fontes"
          actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Adicionar fonte</Button>}
        />
        {ready && feeds.length === 0 ? (
          <EmptyState
            icon={Rss}
            title="Nenhuma fonte cadastrada"
            actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Adicionar fonte</Button>}
          />
        ) : (
          <>
            <MetricStrip
              label="Leitura das fontes"
              items={[
                { label: 'Feeds ativos', value: ready ? `${active} de ${feeds.length}` : undefined, loading: !ready, ...(failing.length ? { hint: failing.length === 1 ? '1 com falha' : `${failing.length} com falha`, warn: true } : {}) },
                { label: 'Notícias em 24 h', value: ready ? String(today) : undefined, loading: !ready, ...(rhythm.length > 1 ? { sparkline: { points: rhythm, label: 'Notícias por dia, 7 dias' } } : {}) },
                { label: 'Duplicatas agrupadas', value: ready ? String(duplicates) : undefined, loading: !ready, hint: 'A mesma notícia em outro veículo' },
                { label: 'Última leitura', value: ready && lastRead ? <RelativeTime at={lastRead} /> : '—', loading: !ready },
              ]}
            />
            <Grid columns="1:1:1" collapseBelow={1024} as="ul">
              {feeds.map((feed) => (
                <FeedCard
                  key={feed.id}
                  feed={feed}
                  onRetry={() => void retry(feed)}
                  onPause={(paused) => void change(feed, { paused }, paused ? `${feed.name} pausada` : `${feed.name} retomada`)}
                  onRemove={() => setRemoving(feed)}
                  onInterval={(everyMinutes) => void change(feed, { everyMinutes })}
                />
              ))}
            </Grid>
          </>
        )}
      </PageStack>
      <AddFeedDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={`Remover ${removing?.name ?? 'fonte'}?`}
        description="As notícias já importadas continuam na fila."
        confirmLabel="Remover fonte"
        tone="danger"
        onConfirm={async () => {
          if (removing) {
            const result = await actions.removeFeed(removing.id);
            if (result.ok) toast('Fonte removida', { description: removing.name });
            else toast('Não foi possível remover', { tone: 'error', description: result.message });
          }
          setRemoving(undefined);
        }}
      />
    </>
  );
}

/** One source: its mark, how it is doing, its last 7 days, how often the desk reads it. */
function FeedCard({ feed, onRetry, onPause, onRemove, onInterval }: {
  feed: NewsFeed;
  onRetry: () => void;
  onPause: (paused: boolean) => void;
  onRemove: () => void;
  onInterval: (minutes: number) => void;
}) {
  const state = FEED_STATE[feed.state];
  const card = (
    <Card padding="md" as="div">
      <PageStack>
        <CardHeader
          titleAs="h2"
          leading={<BrandMark name={feed.name} size="md" />}
          title={feed.name}
          badge={<Badge variant="soft" size="sm" tone={state.tone} dot={feed.state === 'paused' ? 'hollow' : true}>{state.label}</Badge>}
          description={feedOrigin(feed)}
          actions={(
            <Menu
              label={`Ações de ${feed.name}`}
              align="end"
              sections={[{
                items: [
                  feed.state === 'failing'
                    ? { label: 'Tentar de novo', icon: RefreshCw, onSelect: onRetry }
                    : feed.state === 'paused'
                      ? { label: 'Retomar', icon: Play, onSelect: () => onPause(false) }
                      : { label: 'Pausar', icon: Pause, onSelect: () => onPause(true) },
                  { label: 'Remover', icon: Trash2, danger: true, onSelect: onRemove },
                ],
              }]}
              trigger={(props) => <IconButton {...props} label={`Ações de ${feed.name}`} icon={Ellipsis} variant="ghost" size="sm" />}
            />
          )}
        />
        {feed.lastWeek && feed.lastWeek.length > 1 ? (
          <Sparkline points={feed.lastWeek} tone={feed.state === 'failing' ? 'red' : feed.state === 'paused' ? 'gray' : 'blue'} fluid height={40} />
        ) : null}
        <MetaList
          size="sm"
          items={[
            `${feed.lastDay} em 24 h`,
            feed.lastReadAt ? <RelativeTime key="read" at={feed.lastReadAt} /> : 'Ainda não lida',
          ]}
        />
        <Select
          size="sm"
          label={`Frequência de ${feed.name}`}
          value={String(feed.everyMinutes)}
          options={INTERVAL_OPTIONS}
          disabled={feed.state === 'paused'}
          onChange={(value) => onInterval(Number(value))}
        />
      </PageStack>
    </Card>
  );
  if (feed.state !== 'failing') return card;
  return (
    <AttachedNote
      tone="red"
      icon={AlertTriangle}
      note={<>{feed.lastError ?? 'Não responde.'} <LinkButton size="sm" tone="inherit" onClick={onRetry}>Tentar de novo</LinkButton></>}
    >
      {card}
    </AttachedNote>
  );
}
