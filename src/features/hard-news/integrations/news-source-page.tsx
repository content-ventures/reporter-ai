'use client';

import { newsLogoUrl } from '@/domain/news-branding';

import { useState } from 'react';
import {
  Badge,
  BrandMark,
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  List,
  ListItem,
  PageHeader,
  PageStack,
  Panel,
  Section,
  Segmented,
  toast,
} from '@content-ventures/design-system/v3';
import { Plus, Trash2 } from '@content-ventures/design-system/v3/icons';
import type { NewsFeed } from '@/domain/hard-news';
import type { NewSource } from '@/ports/news-intake';
import { useNow } from '@/ui/time';
import { waitLabel } from '../news/radar-model';
import { DEFAULT_INTERVAL, FEED_STATE, feedOrigin } from '../sources/feed-format';
import { useHardNews, useNewsWatch } from '../state/hard-news-provider';
import { ConnectionPanel, GuideSteps } from './app-parts';
import { guideOf } from './integrations-guides';
import { STATUS_META } from './integrations-model';
import type { AppDef } from './integrations-model';
import { feedsOf } from './use-catalog';

type Kind = 'google-alerts' | 'rss-app';

/**
 * A news-source app on the server (F2.1, connected build): Google Alertas (one feed per keyword,
 * pasted from Google) and RSS.app (the platform's account makes the feed of a site or a keyword).
 * The page lists the app's sources and adds one; Fontes keeps the frequency and the pauses.
 */
export function NewsSourcePage({ def }: { def: AppDef }) {
  const { state, ready, rssApp } = useHardNews();
  useNewsWatch();
  const kind: Kind = def.id === 'rss-app' ? 'rss-app' : 'google-alerts';
  const feeds = feedsOf(state.feeds, kind);
  const connected = kind === 'rss-app' ? rssApp : feeds.length > 0;
  const status = STATUS_META[connected ? 'connected' : 'available'];
  const guide = guideOf(def.id);
  const day = feeds.reduce((total, feed) => total + feed.lastDay, 0);

  if (!ready) return <PageStack><PageHeader title={def.name} /></PageStack>;
  return (
    <PageStack>
      <PageHeader title={def.name} status={<Badge tone={status.tone} variant="soft" dot={status.hollow ? 'hollow' : true}>{status.label}</Badge>} />
      {kind === 'rss-app' && !rssApp ? (
        guide ? (
          <Panel label="Como conectar">
            <Section title="Como conectar">
              <GuideSteps guide={guide} values={{}} name={def.name} />
            </Section>
          </Panel>
        ) : null
      ) : (
        <>
          <ConnectionPanel
            name={def.name}
            logo={def.logo}
            title={kind === 'rss-app' ? 'Conta da plataforma' : def.name}
            description={kind === 'rss-app' ? 'Chave guardada no servidor' : undefined}
            metrics={[
              { label: kind === 'rss-app' ? 'Feeds' : 'Alertas', value: String(feeds.length) },
              { label: 'Notícias em 24 h', value: String(day) },
            ]}
          />
          <SourceList kind={kind} feeds={feeds} />
          {/* Before the first alert, how to make one comes first; afterwards it is reference. */}
          {kind === 'google-alerts' && guide && feeds.length === 0 ? <AlertGuide guide={guide} name={def.name} /> : null}
          {kind === 'rss-app' ? <NewRssAppFeed /> : <NewAlert />}
          {kind === 'google-alerts' && guide && feeds.length > 0 ? <AlertGuide guide={guide} name={def.name} /> : null}
        </>
      )}
    </PageStack>
  );
}

function AlertGuide({ guide, name }: { guide: NonNullable<ReturnType<typeof guideOf>>; name: string }) {
  return (
    <Panel label="Como criar um alerta">
      <Section title="Como criar um alerta">
        <GuideSteps guide={guide} values={{}} name={name} />
      </Section>
    </Panel>
  );
}

function SourceList({ kind, feeds }: { kind: Kind; feeds: NewsFeed[] }) {
  const { actions } = useHardNews();
  const now = useNow()?.getTime() ?? 0;
  const [removing, setRemoving] = useState<NewsFeed>();
  const title = kind === 'rss-app' ? 'Feeds' : 'Alertas';
  return (
    <>
      <Panel label={title}>
        <Section title={title} meta={feeds.length}>
          <List label={title} framed={false} bleed empty={kind === 'rss-app' ? 'Nenhum feed ainda' : 'Nenhum alerta ainda'}>
            {feeds.map((feed) => {
              const state = FEED_STATE[feed.state];
              const read = feed.lastReadAt && now ? `Lida ${waitLabel(feed.lastReadAt, now)}` : 'Ainda não lida';
              return (
                <ListItem
                  key={feed.id}
                  leading={<BrandMark name={feed.name} src={newsLogoUrl(feed.site ?? feed.url)} size="sm" decorative />}
                  title={feed.name}
                  description={`${feedOrigin(feed)} · ${read} · ${feed.lastDay} em 24 h`}
                  meta={feed.state === 'active' ? undefined : <Badge variant="text" tone={state.tone} dot={feed.state === 'paused' ? 'hollow' : true}>{state.label}</Badge>}
                  actions={<IconButton label={`Remover ${feed.name}`} icon={Trash2} variant="ghost" size="sm" tone="danger" onClick={() => setRemoving(feed)} />}
                />
              );
            })}
          </List>
        </Section>
      </Panel>
      <ConfirmDialog
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={`Remover ${removing?.name ?? 'fonte'}?`}
        description="As notícias já importadas continuam na fila."
        confirmLabel="Remover"
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

/** Adds the source and reports what its first read brought. */
function useAddSource() {
  const { actions } = useHardNews();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function add(input: NewSource): Promise<boolean> {
    setSaving(true);
    const result = await actions.addFeed(input);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    toast('Fonte adicionada', {
      description: result.inserted > 0 ? `${result.feed.name} · ${result.inserted} ${result.inserted === 1 ? 'notícia' : 'notícias'}` : result.feed.name,
    });
    return true;
  }
  return { saving, error, setError, add };
}

/** Google Alertas: the keyword and the feed link copied from the alert. */
function NewAlert() {
  const { saving, error, setError, add } = useAddSource();
  const [keyword, setKeyword] = useState('');
  const [url, setUrl] = useState('');
  const ready = keyword.trim().length > 0 && url.trim().length > 0;
  async function submit() {
    if (!ready || saving) return;
    if (await add({ kind: 'google-alerts', keyword: keyword.trim(), url: url.trim(), everyMinutes: DEFAULT_INTERVAL })) {
      setKeyword('');
      setUrl('');
    }
  }
  return (
    <Panel label="Novo alerta">
      <Section title="Novo alerta" action={<Button variant="secondary" size="sm" icon={Plus} loading={saving} disabled={!ready} onClick={() => void submit()}>Adicionar alerta</Button>}>
        <Field label="Palavra-chave">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={keyword} placeholder="camarão" onChange={(event) => { setKeyword(event.target.value); setError(undefined); }} />
          )}
        </Field>
        <Field label="Link do feed" error={error} hint="Em Google Alertas, o ícone de RSS ao lado do alerta">
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={url} type="url" inputMode="url" placeholder="https://www.google.com/alerts/feeds/…" onChange={(event) => { setUrl(event.target.value); setError(undefined); }} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} />
          )}
        </Field>
      </Section>
    </Panel>
  );
}

/** RSS.app: a site without a feed, or a keyword's news. */
function NewRssAppFeed() {
  const { saving, error, setError, add } = useAddSource();
  const [mode, setMode] = useState<'site' | 'keyword'>('site');
  const [value, setValue] = useState('');
  const ready = value.trim().length > 0;
  async function submit() {
    if (!ready || saving) return;
    const input: NewSource = mode === 'site'
      ? { kind: 'rss-app', site: value.trim(), everyMinutes: DEFAULT_INTERVAL }
      : { kind: 'rss-app', keyword: value.trim(), everyMinutes: DEFAULT_INTERVAL };
    if (await add(input)) setValue('');
  }
  return (
    <Panel label="Novo feed">
      <Section title="Novo feed" action={<Button variant="secondary" size="sm" icon={Plus} loading={saving} disabled={!ready} onClick={() => void submit()}>Criar feed</Button>}>
        <Field label="Tipo">
          {() => <Segmented label="O que acompanhar" options={[{ value: 'site', label: 'Site' }, { value: 'keyword', label: 'Palavra-chave' }]} value={mode} onChange={(next) => { setMode(next); setValue(''); setError(undefined); }} />}
        </Field>
        <Field label={mode === 'site' ? 'Endereço do site' : 'Palavra-chave'} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={value}
              {...(mode === 'site' ? { type: 'url', inputMode: 'url' as const, placeholder: 'https://' } : { placeholder: 'tilápia' })}
              onChange={(event) => { setValue(event.target.value); setError(undefined); }}
              onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
            />
          )}
        </Field>
      </Section>
    </Panel>
  );
}
