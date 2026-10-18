'use client';

import { useMemo } from 'react';
import { NEWS_SOURCES_HREF } from '../routes';
import { useHardNews } from '../state/hard-news-provider';
import { CATALOG, failureStreak, statusOf, webhooksState } from './integrations-model';
import type { AppId, CatalogEntry, ConnectionState, IntegrationsState } from './integrations-model';
import { useIntegrations } from './integrations-store';
import { portalHost } from './portal-address';

export const INTEGRATIONS_HREF = '/admin/integrations';
export const CMS_HREF = '/admin/integrations/cms';

/** Where an app's card leads: WordPress keeps its CMS page, the RSS feeds are the desk's Fontes. */
export function appHref(id: AppId): string {
  if (id === 'wordpress') return CMS_HREF;
  if (id === 'rss') return NEWS_SOURCES_HREF;
  return `${INTEGRATIONS_HREF}/${id}`;
}

/** What a card says under its name, and the problem it carries when something stopped. */
export type EntryFacts = { facts: string[]; problem?: { tone: 'red' | 'amber'; text: string; fix: string } };

export type CatalogItem = CatalogEntry & EntryFacts;

type Desk = ReturnType<typeof useHardNews>['state'];

function connectionOf(id: AppId, desk: Desk, store: IntegrationsState): ConnectionState | undefined {
  if (id === 'wordpress') return desk.cms.status;
  if (id === 'rss') return desk.feeds.length > 0 ? 'connected' : 'disconnected';
  if (id === 'webhooks') return webhooksState(store.endpoints);
  return store.apps[id]?.state;
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
const thousands = (value: number) => value.toLocaleString('pt-BR');
const failedText = (name: string, streak: number) => (streak > 1 ? `${name} falhou nas últimas ${streak} entregas` : `${name} falhou na última entrega`);

function factsOf(id: AppId, desk: Desk, store: IntegrationsState): EntryFacts {
  const record = store.apps[id];
  switch (id) {
    case 'wordpress': {
      const sent = Object.values(desk.deliveries).filter((delivery) => delivery.state === 'sent').length;
      const failed = Object.values(desk.deliveries).filter((delivery) => delivery.state === 'failed').length;
      return {
        facts: [portalHost(desk.cms.siteUrl), ...(sent ? [count(sent, 'envio', 'envios')] : [])],
        problem: desk.cms.status === 'failing'
          ? { tone: 'red', text: 'O portal não respondeu ao último teste.', fix: 'Testar de novo' }
          : failed ? { tone: 'red', text: count(failed, 'envio falhou', 'envios falharam'), fix: 'Ver envios' } : undefined,
      };
    }
    case 'rss': {
      const failing = desk.feeds.filter((feed) => feed.state === 'failing');
      return {
        facts: [count(desk.feeds.length, 'feed', 'feeds'), `${desk.feeds.reduce((total, feed) => total + feed.lastDay, 0)} em 24 h`],
        problem: failing.length
          ? { tone: 'amber', text: failing.length === 1 ? `${failing[0]?.name} não responde` : `${failing.length} feeds não respondem`, fix: 'Ver fontes' }
          : undefined,
      };
    }
    case 'webhooks': {
      const failing = store.endpoints.filter((endpoint) => endpoint.state === 'failing');
      const first = failing[0];
      return {
        facts: store.endpoints.length ? [count(store.endpoints.length, 'endpoint', 'endpoints'), count(store.deliveries.length, 'entrega', 'entregas')] : [],
        problem: first
          ? { tone: 'red', text: failedText(first.name, failureStreak(store.deliveries, first.id)), fix: 'Corrigir' }
          : undefined,
      };
    }
    default:
      break;
  }
  if (!record || record.state === 'disconnected') return { facts: [] };
  const facts = [record.account ?? 'Conectado'];
  if (record.rules) facts.push(count(record.rules.filter((rule) => rule.on).length, 'aviso ligado', 'avisos ligados'));
  else if (record.usage) facts.push(`${thousands(record.usage.used)} de ${thousands(record.usage.limit)} ${record.usage.period}`);
  else if (record.recipients) facts.push(count(record.recipients.length, 'destinatário', 'destinatários'));
  return {
    facts,
    problem: record.state === 'failing' ? { tone: 'red', text: record.error ?? 'O app recusou a conexão.', fix: 'Autorizar de novo' } : undefined,
  };
}

/** The catalog with each app's status and facts, from the desk (WordPress, feeds) and the store. */
export function useCatalog(): { items: CatalogItem[]; ready: boolean } {
  const desk = useHardNews();
  const store = useIntegrations();
  const ready = desk.ready && store.ready;
  const items = useMemo(() => CATALOG.map((def) => {
    const status = statusOf(def, ready ? connectionOf(def.id, desk.state, store.state) : undefined);
    return { ...def, status, ...(ready && !def.since ? factsOf(def.id, desk.state, store.state) : { facts: [] }) };
  }), [desk.state, store.state, ready]);
  return { items, ready };
}
