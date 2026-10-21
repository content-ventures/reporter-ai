'use client';

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_SECTIONS } from '@/domain';
import type { ArticleBody } from '@/domain';
import {
  priorityOf,
  slugify,
} from '@/domain/hard-news';
import type {
  ArchiveAnswer,
  ArchiveImage,
  BankQuote,
  CmsConnection,
  CmsDelivery,
  EditorialMap,
  EnrichmentSuggestion,
  EvidenceState,
  HardNewsDossier,
  HardNewsOutline,
  NewsFeed,
  NewsItem,
  NewsPriority,
  ResearchSource,
  WritingGuide,
} from '@/domain/hard-news';
import type { NewsSearchView, NewsSearchWrite } from '@/domain/news-search';
import type { NewSource, SourcePatch } from '@/ports/news-intake';
import type { NewsDiscoveryInput, NewsDiscoveryResult } from '@/domain/news-discovery';
import type { NewsDecisionInput } from '@/domain/news-decisions';
import { toast } from '@content-ventures/design-system/v3';
import { useCommands, useRuntime, useSession } from '@/state';
import type { Arrival } from '../preview/arrivals';
import { ARTICLE_NEWS_ID, classificationFor, clockAt, RESEARCH_NEWS_ID } from '../preview/news';
import { outlineFor, researchFor, writeDraft } from '../preview/research';
import { previewScore } from '../settings/map-preview';
import { answerFrom } from './archive-search';
import { createDeskStore } from './desk-store';
import type { HardNewsState } from './hard-news-state';
import { createLiveNewsStore } from './live-news';
import type { LiveNews } from './live-news';

/** One step of "Escrever artigo", as the writing trace shows it. */
export type WritingStep = { id: string; label: string; detail?: string };

export const WRITING_STEPS: readonly WritingStep[] = [
  { id: 'read', label: 'Lendo pauta e fontes aceitas' },
  { id: 'guide', label: 'Seguindo o guia de escrita' },
  { id: 'lead', label: 'Escrevendo título e lead' },
  { id: 'body', label: 'Escrevendo as seções' },
  { id: 'evidence', label: 'Conferindo evidências e atribuições' },
];

export type WritingProgress = { productionId: string; step: number };

export type HardNewsActions = {
  readNewsSearch(): Promise<NewsSearchView>;
  saveNewsSearch(input: NewsSearchWrite): Promise<NewsSearchView>;
  collectNewsSearch(): Promise<NewsSearchView>;
  discoverSources(input: NewsDiscoveryInput): Promise<NewsDiscoveryResult>;
  refreshNews(): Promise<void>;
  decideNews(id: string, input: NewsDecisionInput): Promise<{ ok: true } | { ok: false; message: string }>;
  retryTranslation(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  cover(newsId: string): Promise<string | undefined>;
  postpone(newsId: string, hours: number): void;
  discard(newsId: string, reason: string): void;
  restore(newsId: string): void;
  correct(newsId: string, priority: NewsPriority, note?: string): void;
  /** "Colar link": the story's id, also when it was already in the queue (`outcome: 'repeat'`). */
  importUrl(url: string): Promise<{ ok: true; id: string; outcome: 'inserted' | 'grouped' | 'repeat' } | { ok: false; message: string }>;
  setGoal(perDay: number): void;
  addFeed(input: NewSource): Promise<{ ok: true; feed: NewsFeed; inserted: number; grouped?: number } | { ok: false; message: string }>;
  updateFeed(id: string, patch: SourcePatch): Promise<{ ok: true } | { ok: false; message: string }>;
  /** "Tentar de novo": the source as the new read left it. */
  retryFeed(id: string): Promise<NewsFeed | undefined>;
  removeFeed(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The text of a story read from the server (the ficha's "Texto original"). */
  loadBody(id: string): Promise<boolean>;
  research(productionId: string): void;
  setSource(productionId: string, sourceId: string, state: ResearchSource['state']): void;
  addSource(productionId: string, url: string): { ok: true } | { ok: false; message: string };
  setAngle(productionId: string, angle: string): void;
  buildOutline(productionId: string): void;
  updateOutline(productionId: string, outline: HardNewsOutline): void;
  toggleDossierQuote(productionId: string, quoteId: string): void;
  write(productionId: string): Promise<boolean>;
  decideFlag(productionId: string, flagId: string, state: EvidenceState): void;
  decideSuggestion(productionId: string, suggestionId: string, state: EnrichmentSuggestion['state']): void;
  /** A new version of the editorial map; `changes` says in words what it changed (history). */
  saveMap(map: EditorialMap, changes?: string[]): void;
  /** A new version of the writing guide; `changes` says in words what it changed (history). */
  saveGuide(guide: WritingGuide, changes?: string[]): void;
  updateCms(patch: Partial<CmsConnection>): void;
  testCms(): Promise<boolean>;
  saveDelivery(productionId: string, patch: Partial<CmsDelivery>): void;
  sendToCms(productionId: string, version: number): Promise<boolean>;
  saveQuote(quote: BankQuote): void;
  ask(question: string): Promise<ArchiveAnswer>;
  reindex(articleId: string): void;
  saveImage(image: ArchiveImage): void;
  /** Radar (preview): a simulated arrival lands (a new story or an outlet joining one). */
  arrive(arrival: Arrival): void;
  /** Radar (preview): the active feed that is due soonest is read now. */
  readFeed(): void;
  /** Radar: postponed stories whose time came go back to the queue. */
  returnDue(): void;
  /** Radar: everything that arrived so far counts as seen. */
  markSeen(): void;
  /** "Restaurar exemplo" of the desk. */
  reset(): void;
};

type HardNewsContextValue = {
  state: HardNewsState;
  ready: boolean;
  writing?: WritingProgress;
  actions: HardNewsActions;
  /** The R1 build's demonstration: simulated data only, nothing written to the workspace. */
  demo: boolean;
  /** F2.1 on the server (connected build): sources and news are real, the triage is not there yet. */
  live: boolean;
  /** Last read failed; keep the previous records visible and offer a retry. */
  newsFailed: boolean;
  /** RSS.app can create feeds: the platform's account in the connected build, simulated otherwise. */
  rssApp: boolean;
  search?: NewsSearchView;
  /** A screen that shows the news keeps the server polling while mounted (a no-op in the simulation). */
  watch: () => () => void;
};

const HardNewsContext = createContext<HardNewsContextValue | null>(null);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const EMPTY_LIVE: LiveNews = { ready: false, feeds: [], news: [], rssApp: false, failed: false };
const emptyLive = () => EMPTY_LIVE;
const noSubscription = () => () => {};
const noWatch = () => () => {};
const failure = (error: unknown) => ({ ok: false as const, message: error instanceof Error && error.message ? error.message : 'Não foi possível concluir. Tente de novo.' });

function urlProblem(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use um endereço que comece com https://.';
    return undefined;
  } catch {
    return 'Cole um endereço completo, com https://.';
  }
}

function sameUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.host === right.host && left.pathname.replace(/\/$/, '') === right.pathname.replace(/\/$/, '');
  } catch {
    return a === b;
  }
}

/**
 * R2 · Hard News desk. It keeps the desk's records in this browser and uses the workspace's own
 * commands where R2 meets R1: "Cobrir" opens a production in Produções and the written draft lands
 * in the same article studio. As the R1 build's demonstration (`demo`) it writes nothing to the
 * workspace: no example productions and no "Cobrir"; the R1 screens do not see the desk.
 */
export function HardNewsProvider({ children, demo = false }: { children: ReactNode; demo?: boolean }) {
  const commands = useCommands();
  const runtime = useRuntime();
  const session = useSession();
  const actor = session.data?.current?.name ?? 'João';
  const [store] = useState(createDeskStore);
  const { state, ready } = useSyncExternalStore(store.subscribe, store.get, store.server);
  const [writing, setWriting] = useState<WritingProgress>();
  const actorRef = useRef(actor);
  const seeding = useRef(false);
  const runtimeRef = useRef(runtime.runtime);
  /** The latest records, for async steps that outlive a render. */
  const latest = useMemo(() => ({ get current() { return store.get().state; } }), [store]);
  // F2.1 on the server: the connected build's runtime brings the news port.
  const newsPort = runtime.runtime?.news;
  const liveStore = useMemo(() => (newsPort ? createLiveNewsStore(newsPort) : undefined), [newsPort]);
  const liveNews = useSyncExternalStore(liveStore?.subscribe ?? noSubscription, liveStore?.get ?? emptyLive, emptyLive);

  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  // Load once on the client (the store reads this browser, never during render).
  useEffect(() => store.load(), [store]);

  // Leaving the desk (reload, close): the next visit's "Novas" start here.
  useEffect(() => {
    if (!ready) return;
    const leave = () => store.set((current) => (current.radar ? { ...current, radar: { ...current.radar, lastSeenAt: new Date().toISOString() } } : current));
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [ready, store]);

  // "Restaurar exemplo" replaces the workspace runtime: the desk restarts with it.
  useEffect(() => {
    if (!runtime.runtime) return;
    if (runtimeRef.current && runtimeRef.current !== runtime.runtime) {
      store.reset();
      seeding.current = false;
    }
    runtimeRef.current = runtime.runtime;
  }, [runtime.runtime, store]);

  const update = store.set;

  const patchNews = useCallback((id: string, patch: Partial<NewsItem>) => {
    update((current) => ({ ...current, news: current.news.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  }, [update]);

  const patchDossier = useCallback((productionId: string, patch: Partial<HardNewsDossier>) => {
    update((current) => {
      const dossier = current.dossiers[productionId];
      if (!dossier) return current;
      return { ...current, dossiers: { ...current.dossiers, [productionId]: { ...dossier, ...patch } } };
    });
  }, [update]);

  /** Creates the production and its blank article in the workspace, as "Escrever do zero" does. */
  const openProduction = useCallback(async (title: string, size: HardNewsOutline['size'] = 'standard') => {
    const result = await commands.production.createBlank({
      title,
      brief: { size, sections: size === 'short' ? 1 : DEFAULT_SECTIONS },
    });
    return result.ok ? result.value : undefined;
  }, [commands]);

  // The example's covered stories: one being researched, one already written in the studio.
  useEffect(() => {
    if (demo || newsPort || !ready || latest.current.seeded || seeding.current || !runtime.runtime) return;
    seeding.current = true;
    const live = runtime.runtime;
    /**
     * The example's production of a story: the one this workspace already has with that title (the
     * desk's records were reset but the workspace was not), else a new blank one. Never a duplicate.
     */
    const seedProduction = async (title: string, size: HardNewsOutline['size']) => {
      const found = await live.queries.list({ search: title, sort: 'created_desc' }, { page: 1, size: 20 }).catch(() => undefined);
      const existing = found?.items.find((item) => item.title === title && !item.archived);
      if (existing) {
        const detail = await live.queries.get(existing.id).catch(() => undefined);
        const article = detail?.ok ? detail.value.pieces.find((piece) => piece.kind === 'article') : undefined;
        if (article) return { productionId: existing.id, pieceId: article.id, reused: true, revision: article.draft.revision };
      }
      const opened = await openProduction(title, size);
      return opened ? { ...opened, reused: false, revision: 0 } : undefined;
    };
    void (async () => {
      const current = latest.current;
      const clock = clockAt(Date.now());
      const researchNews = current.news.find((item) => item.id === RESEARCH_NEWS_ID);
      const articleNews = current.news.find((item) => item.id === ARTICLE_NEWS_ID);
      const dossiers: Record<string, HardNewsDossier> = {};
      const flags: HardNewsState['flags'] = {};
      const suggestions: HardNewsState['suggestions'] = {};
      const productionByNews: Record<string, string> = {};
      if (researchNews) {
        const sources = researchFor(researchNews, clock, current.archive);
        const opened = await seedProduction(outlineFor(researchNews, sources).headline, 'short');
        if (opened) {
          productionByNews[researchNews.id] = opened.productionId;
          dossiers[opened.productionId] = {
            productionId: opened.productionId, newsId: researchNews.id, angle: 'Quanto do recorde é pescado e o que muda para quem exporta.',
            research: 'done', searchedAt: clock.ago(980), sources, quoteIds: [], archiveIds: ['a-reefer'], stage: 'research',
          };
        }
      }
      if (articleNews) {
        const sources = researchFor(articleNews, clock, current.archive);
        const outline = outlineFor(articleNews, sources);
        const opened = await seedProduction(outline.headline, 'standard');
        if (opened) {
          const draft = writeDraft(articleNews, outline, sources, { quotes: current.quotes, archive: current.archive });
          if (opened.revision === 0) await commands.production.saveDraft(opened.pieceId, draft.body, 0);
          productionByNews[articleNews.id] = opened.productionId;
          dossiers[opened.productionId] = {
            productionId: opened.productionId, newsId: articleNews.id, angle: 'O que o produtor precisa saber para pedir o crédito.',
            research: 'done', searchedAt: clock.ago(1_250), sources, quoteIds: ['q-sonia'], archiveIds: ['a-credit-2025', 'a-energy'],
            outline, stage: 'article', writtenAt: clock.ago(1_200), guideVersion: current.guide.version,
          };
          flags[opened.productionId] = draft.flags;
          suggestions[opened.productionId] = draft.suggestions;
        }
      }
      update((now) => ({
        ...now,
        seeded: true,
        news: now.news.map((item) => (productionByNews[item.id] ? { ...item, productionId: productionByNews[item.id] } : item)),
        dossiers: { ...now.dossiers, ...dossiers },
        flags: { ...now.flags, ...flags },
        suggestions: { ...now.suggestions, ...suggestions },
      }));
      seeding.current = false;
    })();
  }, [commands, demo, latest, newsPort, openProduction, ready, runtime.runtime, update]);

  /** The article piece of a covered story and its revision, read from the workspace. */
  const articlePieceId = useCallback(async (productionId: string): Promise<{ pieceId: string; revision: number } | undefined> => {
    const live = runtimeRef.current;
    if (!live) return undefined;
    const found = await live.queries.get(productionId).catch(() => undefined);
    const article = found?.ok ? found.value.pieces.find((piece) => piece.kind === 'article') : undefined;
    return article ? { pieceId: article.id, revision: article.draft.revision } : undefined;
  }, []);

  // The AI reads every news item that arrives (F2.4): a few seconds after it lands in the queue.
  const reading = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    for (const item of state.news) {
      if (item.classification || reading.current.has(item.id)) continue;
      reading.current.add(item.id);
      void wait(3200).then(() => {
        reading.current.delete(item.id);
        const current = latest.current.news.find((candidate) => candidate.id === item.id);
        if (current && !current.classification) patchNews(item.id, { classification: classificationFor(current, latest.current.map.version) });
      });
    }
  }, [latest, patchNews, ready, state.news]);

  const research = useCallback((productionId: string) => {
    const dossier = latest.current.dossiers[productionId];
    const news = dossier && latest.current.news.find((item) => item.id === dossier.newsId);
    if (!dossier || !news || dossier.research === 'searching') return;
    patchDossier(productionId, { research: 'searching' });
    void wait(2600).then(() => {
      const found = researchFor(news, clockAt(Date.now()), latest.current.archive);
      const kept = latest.current.dossiers[productionId]?.sources ?? [];
      const merged = found.map((item) => kept.find((old) => old.id === item.id) ?? item);
      const manual = kept.filter((old) => !found.some((item) => item.id === old.id));
      patchDossier(productionId, { research: 'done', searchedAt: new Date().toISOString(), sources: [...merged, ...manual] });
    });
  }, [latest, patchDossier]);

  const actions = useMemo<HardNewsActions>(() => ({
    async readNewsSearch() { if (!newsPort?.search) throw new Error('Busca indisponível.'); return newsPort.search.read(); },
    async saveNewsSearch(input) {
      if (!newsPort?.search) throw new Error('Busca indisponível.');
      const saved = await newsPort.search.save(input); await liveStore?.refresh(); return saved;
    },
    async collectNewsSearch() {
      if (!newsPort?.search) throw new Error('Busca indisponível.');
      const saved = await newsPort.search.collect(); await liveStore?.refresh(); return saved;
    },
    async discoverSources(input) {
      if (!newsPort) throw new Error('A descoberta de fontes está disponível no ambiente conectado.');
      return newsPort.discover(input);
    },
    async refreshNews() { await liveStore?.refresh(); },
    async retryTranslation(id) {
      if (!newsPort || !liveStore) return { ok: false, message: 'A tradução está disponível no ambiente conectado.' };
      try {
        liveStore.putItem(await newsPort.retryTranslation(id));
        return { ok: true };
      } catch (error) { return failure(error); }
    },
    async decideNews(id, input) {
      if (!newsPort || !liveStore) return { ok: false, message: 'As decisões estão disponíveis no ambiente conectado.' };
      try {
        liveStore.putItem(await newsPort.decide(id, input));
        return { ok: true };
      } catch (error) {
        await liveStore.refresh();
        return failure(error);
      }
    },
    async cover(newsId) {
      // Connected stories are selected as material; the prototype cannot create productions.
      if (demo || newsPort) return undefined;
      const news = latest.current.news.find((item) => item.id === newsId);
      if (!news) return undefined;
      if (news.productionId) return news.productionId;
      const opened = await openProduction(news.title);
      if (!opened) return undefined;
      const now = new Date().toISOString();
      update((current) => ({
        ...current,
        news: current.news.map((item) => (item.id === newsId ? { ...item, status: 'covered', decidedBy: actorRef.current, decidedAt: now, productionId: opened.productionId } : item)),
        dossiers: {
          ...current.dossiers,
          [opened.productionId]: { productionId: opened.productionId, newsId, angle: '', research: 'idle', sources: [], quoteIds: [], archiveIds: [], stage: 'research' },
        },
      }));
      research(opened.productionId);
      return opened.productionId;
    },
    postpone(newsId, hours) {
      patchNews(newsId, { status: 'later', decidedBy: actorRef.current, decidedAt: new Date().toISOString(), laterUntil: new Date(Date.now() + hours * 3_600_000).toISOString() });
    },
    discard(newsId, reason) {
      patchNews(newsId, { status: 'discarded', decidedBy: actorRef.current, decidedAt: new Date().toISOString(), discardReason: reason });
    },
    restore(newsId) {
      patchNews(newsId, { status: 'new', decidedBy: undefined, decidedAt: undefined, laterUntil: undefined, discardReason: undefined });
    },
    correct(newsId, priority, note) {
      update((current) => ({
        ...current,
        news: current.news.map((item) => {
          if (item.id !== newsId || !item.classification) return item;
          const automatic = priorityOf({ classification: { ...item.classification, correction: undefined } });
          const correction = priority === automatic ? undefined : { priority, by: actorRef.current, at: new Date().toISOString(), note };
          return { ...item, classification: { ...item.classification, correction } };
        }),
      }));
    },
    async importUrl(url) {
      const problem = urlProblem(url);
      if (problem) return { ok: false, message: problem };
      if (newsPort && liveStore) {
        try {
          const imported = await newsPort.importLink(url.trim());
          await liveStore.refresh();
          await liveStore.loadBody(imported.id);
          return { ok: true, ...imported };
        } catch (error) {
          return failure(error);
        }
      }
      const existing = latest.current.news.find((item) => sameUrl(item.url, url) || item.duplicates.some((duplicate) => sameUrl(duplicate.url, url)));
      if (existing) return { ok: true, id: existing.id, outcome: 'repeat' };
      const address = new URL(url.trim());
      const id = `news-url-${Date.now().toString(36)}`;
      const now = new Date().toISOString();
      const slug = address.pathname.split('/').filter(Boolean).pop() ?? address.host;
      const title = slug.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').replace(/^\w/, (letter) => letter.toUpperCase());
      const item: NewsItem = {
        id, title, url: address.href, source: address.host.replace(/^www\./, ''), via: 'url',
        publishedAt: now, importedAt: now, excerpt: 'Texto importado do endereço informado.', body: ['Texto importado do endereço informado.'],
        duplicates: [], status: 'new',
      };
      update((current) => ({ ...current, news: [item, ...current.news] }));
      return { ok: true, id, outcome: 'inserted' };
    },
    setGoal(perDay) {
      update((current) => ({ ...current, goal: { perDay: Math.max(1, Math.min(50, Math.round(perDay))) } }));
    },
    async addFeed(input) {
      const address = 'url' in input ? input.url : 'site' in input ? input.site : undefined;
      const problem = address === undefined ? undefined : urlProblem(address);
      if (problem) return { ok: false, message: problem };
      if (newsPort && liveStore) {
        try {
          const read = await newsPort.addSource(input);
          liveStore.putFeed(read.source);
          await liveStore.refresh();
          return { ok: true, feed: read.source, inserted: read.inserted, grouped: read.grouped };
        } catch (error) {
          return failure(error);
        }
      }
      // The example: the source is read a moment later and brings a few stories.
      if (address && latest.current.feeds.some((feed) => sameUrl(feed.url, address) || (feed.site && sameUrl(feed.site, address)))) {
        return { ok: false, message: 'Essa fonte já está cadastrada.' };
      }
      const keyword = 'keyword' in input ? input.keyword.trim() : undefined;
      if (keyword !== undefined && !keyword) return { ok: false, message: 'Digite a palavra-chave.' };
      const host = address ? new URL(address.trim()).host.replace(/^www\./, '') : '';
      const name = ('name' in input ? input.name?.trim() : undefined) || keyword || host;
      const feed: NewsFeed = {
        id: `feed-${Date.now().toString(36)}`, name, url: address ? new URL(address.trim()).href : `https://rss.app/feeds/${Date.now().toString(36)}.xml`,
        everyMinutes: input.everyMinutes, state: 'active', lastDay: 0, kind: input.kind,
        ...('site' in input ? { site: input.site } : {}), ...(keyword ? { keyword } : {}),
      };
      update((current) => ({ ...current, feeds: [...current.feeds, feed] }));
      void wait(1800).then(() => {
        update((current) => ({ ...current, feeds: current.feeds.map((item) => (item.id === feed.id ? { ...item, lastReadAt: new Date().toISOString(), lastDay: 4 } : item)) }));
      });
      return { ok: true, feed, inserted: 0 };
    },
    async updateFeed(id, patch) {
      if (newsPort && liveStore) {
        try {
          liveStore.putFeed(await newsPort.updateSource(id, patch));
          return { ok: true };
        } catch (error) {
          return failure(error);
        }
      }
      const { paused, rating, ...rest } = patch;
      update((current) => ({ ...current, feeds: current.feeds.map((feed) => (feed.id === id
        ? { ...feed, ...rest, ...(paused === undefined ? {} : { state: paused ? 'paused' : 'active' }),
          ...(rating === undefined ? {} : { rating: rating === null ? undefined : { ...rating, updatedAt: new Date().toISOString() } }) }
        : feed)) }));
      return { ok: true };
    },
    async retryFeed(id) {
      if (newsPort && liveStore) {
        try {
          const read = await newsPort.readSource(id);
          liveStore.putFeed(read.source);
          void liveStore.refresh();
          return read.source;
        } catch (error) {
          toast('Não foi possível ler a fonte', { tone: 'error', description: failure(error).message });
          return undefined;
        }
      }
      update((current) => ({ ...current, feeds: current.feeds.map((feed) => (feed.id === id ? { ...feed, state: 'active', lastError: undefined } : feed)) }));
      void wait(1500).then(() => {
        update((current) => ({ ...current, feeds: current.feeds.map((feed) => (feed.id === id ? { ...feed, lastReadAt: new Date().toISOString(), lastDay: 3 } : feed)) }));
      });
      return latest.current.feeds.find((feed) => feed.id === id);
    },
    async removeFeed(id) {
      if (newsPort && liveStore) {
        try {
          await newsPort.removeSource(id);
          liveStore.dropFeed(id);
          return { ok: true };
        } catch (error) {
          return failure(error);
        }
      }
      update((current) => ({ ...current, feeds: current.feeds.filter((feed) => feed.id !== id) }));
      return { ok: true };
    },
    async loadBody(id) {
      if (!liveStore) return true;
      try { await liveStore.loadBody(id); return true; }
      catch { return false; }
    },
    research,
    setSource(productionId, sourceId, sourceState) {
      const dossier = latest.current.dossiers[productionId];
      if (!dossier) return;
      patchDossier(productionId, { sources: dossier.sources.map((item) => (item.id === sourceId ? { ...item, state: sourceState } : item)) });
    },
    addSource(productionId, url) {
      const dossier = latest.current.dossiers[productionId];
      if (!dossier) return { ok: false, message: 'Pauta não encontrada.' };
      const problem = urlProblem(url);
      if (problem) return { ok: false, message: problem };
      if (dossier.sources.some((item) => sameUrl(item.url, url))) return { ok: false, message: 'Essa fonte já está na apuração.' };
      const address = new URL(url.trim());
      const added: ResearchSource = {
        id: `s-manual-${Date.now().toString(36)}`, title: address.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ') ?? address.host,
        url: address.href, outlet: address.host.replace(/^www\./, ''), kind: 'press', consultedAt: new Date().toISOString(),
        excerpt: 'Trecho a confirmar na leitura da fonte.', state: 'accepted',
      };
      patchDossier(productionId, { sources: [...dossier.sources, added] });
      return { ok: true };
    },
    setAngle(productionId, angle) {
      patchDossier(productionId, { angle });
    },
    buildOutline(productionId) {
      const dossier = latest.current.dossiers[productionId];
      const news = dossier && latest.current.news.find((item) => item.id === dossier.newsId);
      if (!dossier || !news) return;
      patchDossier(productionId, { outline: outlineFor(news, dossier.sources) });
    },
    updateOutline(productionId, outline) {
      patchDossier(productionId, { outline });
    },
    toggleDossierQuote(productionId, quoteId) {
      const dossier = latest.current.dossiers[productionId];
      if (!dossier) return;
      const quoteIds = dossier.quoteIds.includes(quoteId) ? dossier.quoteIds.filter((id) => id !== quoteId) : [...dossier.quoteIds, quoteId];
      patchDossier(productionId, { quoteIds });
    },
    async write(productionId) {
      const current = latest.current;
      const dossier = current.dossiers[productionId];
      const news = dossier && current.news.find((item) => item.id === dossier.newsId);
      if (!dossier || !news) return false;
      const outline = dossier.outline ?? outlineFor(news, dossier.sources);
      patchDossier(productionId, { stage: 'writing', outline });
      for (let step = 0; step < WRITING_STEPS.length; step += 1) {
        setWriting({ productionId, step });
        await wait(step === 3 ? 1600 : 850);
      }
      const draft = writeDraft(news, outline, dossier.sources, { quotes: current.quotes, archive: current.archive });
      const pieceId = await articlePieceId(productionId);
      if (pieceId) {
        const saved = await commands.production.saveDraft(pieceId.pieceId, { ...draft.body, title: outline.headline } satisfies ArticleBody, pieceId.revision);
        if (!saved.ok) {
          setWriting(undefined);
          patchDossier(productionId, { stage: 'research' });
          return false;
        }
      }
      update((now) => ({
        ...now,
        dossiers: { ...now.dossiers, [productionId]: { ...now.dossiers[productionId], stage: 'article', writtenAt: new Date().toISOString(), guideVersion: now.guide.version, outline } },
        flags: { ...now.flags, [productionId]: draft.flags },
        suggestions: { ...now.suggestions, [productionId]: draft.suggestions },
      }));
      setWriting(undefined);
      return true;
    },
    decideFlag(productionId, flagId, flagState) {
      update((current) => ({
        ...current,
        flags: {
          ...current.flags,
          [productionId]: (current.flags[productionId] ?? []).map((flag) => (flag.id === flagId
            ? { ...flag, state: flagState, decidedBy: flagState === 'open' ? undefined : actorRef.current, decidedAt: flagState === 'open' ? undefined : new Date().toISOString() }
            : flag)),
        },
      }));
    },
    decideSuggestion(productionId, suggestionId, suggestionState) {
      update((current) => ({
        ...current,
        suggestions: {
          ...current.suggestions,
          [productionId]: (current.suggestions[productionId] ?? []).map((item) => (item.id === suggestionId ? { ...item, state: suggestionState } : item)),
        },
      }));
    },
    saveMap(map, changes = []) {
      update((current) => {
        const saved = { ...map, version: current.map.version + 1, updatedAt: new Date().toISOString(), updatedBy: actorRef.current };
        const entry = { version: saved.version, at: saved.updatedAt, by: saved.updatedBy, changes };
        // The AI rereads the waiting stories with the new version: the radar shows what the preview promised.
        const news = current.news.map((item) => {
          if (item.status !== 'new' || !item.classification) return item;
          const score = previewScore(item, current.map, saved) ?? item.classification.score;
          return { ...item, classification: { ...item.classification, score, mapVersion: saved.version } };
        });
        return { ...current, map: saved, news, mapHistory: [entry, ...(current.mapHistory ?? [])] };
      });
    },
    saveGuide(guide, changes = []) {
      update((current) => {
        const saved = { ...guide, version: current.guide.version + 1, updatedAt: new Date().toISOString(), updatedBy: actorRef.current };
        const entry = { version: saved.version, at: saved.updatedAt, by: saved.updatedBy, changes };
        return { ...current, guide: saved, guideHistory: [entry, ...(current.guideHistory ?? [])] };
      });
    },
    updateCms(patch) {
      update((current) => ({ ...current, cms: { ...current.cms, ...patch } }));
    },
    async testCms() {
      update((current) => ({ ...current, cms: { ...current.cms, status: 'connected' } }));
      await wait(1400);
      const ok = Boolean(latest.current.cms.siteUrl) && !urlProblem(latest.current.cms.siteUrl);
      update((current) => ({ ...current, cms: { ...current.cms, status: ok ? 'connected' : 'failing', checkedAt: new Date().toISOString() } }));
      return ok;
    },
    saveDelivery(productionId, patch) {
      update((current) => {
        const existing = current.deliveries[productionId] ?? { productionId, state: 'idle', slug: '', tags: [], excerpt: '', attempts: 0 };
        return { ...current, deliveries: { ...current.deliveries, [productionId]: { ...existing, ...patch } } };
      });
    },
    async sendToCms(productionId, version) {
      const existing = latest.current.deliveries[productionId];
      if (!existing || existing.state === 'sending') return false;
      const attempts = existing.attempts + 1;
      update((current) => ({ ...current, deliveries: { ...current.deliveries, [productionId]: { ...existing, state: 'sending', attempts, error: undefined } } }));
      await wait(1800);
      const cms = latest.current.cms;
      if (cms.status !== 'connected') {
        update((current) => ({ ...current, deliveries: { ...current.deliveries, [productionId]: { ...current.deliveries[productionId], state: 'failed', error: 'O CMS não aceitou a conexão. Confira a integração e tente de novo.' } } }));
        return false;
      }
      // An article already sent updates the same post (REQ-2.10: never a duplicate).
      const remoteId = existing.remoteId ?? String(48_000 + Math.floor(Math.random() * 900));
      const slug = existing.slug || slugify(productionId);
      update((current) => ({
        ...current,
        deliveries: {
          ...current.deliveries,
          [productionId]: { ...current.deliveries[productionId], state: 'sent', remoteId, url: `${cms.siteUrl}/?p=${remoteId}&preview=true`, sentAt: new Date().toISOString(), sentVersion: version, slug },
        },
      }));
      return true;
    },
    saveQuote(quote) {
      update((current) => {
        const exists = current.quotes.some((item) => item.id === quote.id);
        return { ...current, quotes: exists ? current.quotes.map((item) => (item.id === quote.id ? quote : item)) : [quote, ...current.quotes] };
      });
    },
    async ask(question) {
      await wait(1400);
      const answer = answerFrom(question, latest.current.archive);
      // The desk's latest question stays on the Acervo for whoever opens it next.
      update((current) => ({ ...current, lastAsk: { question, askedBy: actorRef.current, askedAt: new Date().toISOString(), answer } }));
      return answer;
    },
    reindex(articleId) {
      update((current) => ({ ...current, archive: current.archive.map((item) => (item.id === articleId ? { ...item, index: 'pending' } : item)) }));
      void wait(2400).then(() => {
        update((current) => ({ ...current, archive: current.archive.map((item) => (item.id === articleId ? { ...item, index: 'indexed' } : item)) }));
      });
    },
    saveImage(image) {
      // Upsert: a photo saved from a bank enters the archive at the top.
      update((current) => ({
        ...current,
        images: current.images.some((item) => item.id === image.id)
          ? current.images.map((item) => (item.id === image.id ? image : item))
          : [image, ...current.images],
      }));
    },
    arrive(arrival) {
      update((current) => {
        const radar = current.radar;
        if (!radar || radar.released.includes(arrival.id)) return current;
        const now = new Date().toISOString();
        const released = { ...radar, released: [...radar.released, arrival.id] };
        if (arrival.kind === 'duplicate') {
          const duplicate = arrival.build(clockAt(Date.now()));
          return {
            ...current,
            radar: released,
            news: current.news.map((item) => (item.id === arrival.newsId && !item.duplicates.some((known) => known.url === duplicate.url)
              ? { ...item, duplicates: [...item.duplicates, duplicate] }
              : item)),
          };
        }
        const item = arrival.build(clockAt(Date.now()));
        const feed = current.feeds.find((candidate) => candidate.id === item.feedId);
        // A paused or removed source brings nothing; the arrival is spent all the same.
        if (!feed || feed.state !== 'active' || current.news.some((known) => known.id === item.id)) return { ...current, radar: released };
        return {
          ...current,
          radar: released,
          news: [item, ...current.news],
          feeds: current.feeds.map((feed) => (feed.id === item.feedId ? { ...feed, lastReadAt: now, lastDay: feed.lastDay + 1 } : feed)),
        };
      });
    },
    readFeed() {
      update((current) => {
        const due = (feed: NewsFeed) => (feed.lastReadAt ? Date.parse(feed.lastReadAt) : 0) + feed.everyMinutes * 60_000;
        const next = current.feeds.filter((feed) => feed.state === 'active').sort((a, b) => due(a) - due(b))[0];
        // Nothing due yet: no write (an idle radar never rewrites the desk).
        if (!next || due(next) > Date.now()) return current;
        const now = new Date().toISOString();
        return { ...current, feeds: current.feeds.map((feed) => (feed.id === next.id ? { ...feed, lastReadAt: now } : feed)) };
      });
    },
    returnDue() {
      update((current) => {
        const now = Date.now();
        const due = current.news.filter((item) => item.status === 'later' && item.laterUntil && Date.parse(item.laterUntil) <= now);
        if (due.length === 0) return current;
        const at = new Date(now).toISOString();
        return {
          ...current,
          news: current.news.map((item) => (due.includes(item)
            ? { ...item, status: 'new', returnedAt: at, laterUntil: undefined, decidedBy: undefined, decidedAt: undefined }
            : item)),
        };
      });
    },
    markSeen() {
      update((current) => (current.radar ? { ...current, radar: { ...current.radar, seenSince: new Date().toISOString() } } : current));
    },
    reset() {
      store.reset();
    },
  }), [articlePieceId, commands, demo, latest, liveStore, newsPort, openProduction, patchDossier, patchNews, research, store, update]);

  // The connected build reads sources and news from the server; everything else stays the desk's.
  const live = Boolean(liveStore);
  const shown = useMemo(() => (live ? { ...state, feeds: liveNews.feeds, news: liveNews.news } : state), [live, liveNews.feeds, liveNews.news, state]);
  const watch = useMemo(() => (liveStore ? () => liveStore.watch() : noWatch), [liveStore]);
  const value = useMemo<HardNewsContextValue>(() => ({
    state: shown,
    ready: live ? ready && liveNews.ready : ready,
    writing,
    actions,
    demo,
    live,
    newsFailed: live && liveNews.failed,
    rssApp: live ? liveNews.rssApp : true,
    search: liveNews.search,
    watch,
  }), [actions, demo, live, liveNews.failed, liveNews.ready, liveNews.rssApp, ready, shown, watch, writing]);
  return <HardNewsContext value={value}>{children}</HardNewsContext>;
}

export function useHardNews(): HardNewsContextValue {
  const value = use(HardNewsContext);
  if (!value) throw new Error('useHardNews needs HardNewsProvider.');
  return value;
}

/**
 * The desk as the R1 screens see it: null unless R2 is released. In the R1 build's demonstration
 * the desk exists for the Hard News screens only, so every R1 plug point stays as it was.
 */
export function useOptionalHardNews(): HardNewsContextValue | null {
  const value = use(HardNewsContext);
  return value?.demo ? null : value;
}

/** Keeps the server's news polling while the calling screen is mounted (F2.1, connected build). */
export function useNewsWatch(): void {
  const { watch } = useHardNews();
  useEffect(() => watch(), [watch]);
}

export function useDossier(productionId: string | undefined): HardNewsDossier | undefined {
  const value = useOptionalHardNews();
  return productionId ? value?.state.dossiers[productionId] : undefined;
}
