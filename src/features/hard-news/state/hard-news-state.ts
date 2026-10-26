import type {
  ArchiveAnswer,
  ArchiveArticle,
  ArchiveImage,
  BankQuote,
  CmsConnection,
  CmsDelivery,
  DeskGoal,
  EditorialMap,
  EnrichmentSuggestion,
  EvidenceFlag,
  HardNewsDossier,
  NewsFeed,
  NewsItem,
  WritingGuide,
} from '../../../domain/hard-news.ts';
import { seedArchive, seedCms, seedImages, seedQuotes } from '../preview/library.ts';
import { clockAt, DESK_GOAL, seedEditorialMap, seedFeeds, seedNews, seedWritingGuide } from '../preview/news.ts';
import { defaultEditorialPolicy } from '../../../domain/editorial-policy.ts';
import { answerFrom } from './archive-search.ts';

/**
 * Everything the R2 desk keeps between screens, in one serialisable object. The preview keeps it in
 * this browser; the backend will serve the same shapes through ports.
 */
export type HardNewsState = {
  version: 2;
  feeds: NewsFeed[];
  news: NewsItem[];
  goal: DeskGoal;
  map: EditorialMap;
  guide: WritingGuide;
  /** By production id. */
  dossiers: Record<string, HardNewsDossier>;
  flags: Record<string, EvidenceFlag[]>;
  suggestions: Record<string, EnrichmentSuggestion[]>;
  deliveries: Record<string, CmsDelivery>;
  quotes: BankQuote[];
  archive: ArchiveArticle[];
  images: ArchiveImage[];
  cms: CmsConnection;
  /** The example's covered stories exist as productions of the workspace. */
  seeded: boolean;
  /** The radar's clock and what this person has seen (preview only; optional in older records). */
  radar?: RadarState;
  /** The desk's latest question to the archive, answered (Acervo shows it until the next one). */
  lastAsk?: ArchiveAsk;
  /** Every saved version of the editorial map and of the writing guide, newest first. */
  mapHistory?: VersionEntry[];
  guideHistory?: VersionEntry[];
};

/** One saved version of a desk setting: who, when, and what it changed, in words. */
export type VersionEntry = { version: number; at: string; by: string; changes: string[] };

/**
 * The example's history, under the stored version: a stored map or guide already past the example
 * (saved before the history existed) gets its own entry on top, without inventing what it changed.
 */
function withStored(entries: VersionEntry[], stored: { version: number; updatedAt: string; updatedBy: string }): VersionEntry[] {
  const top = entries[0]?.version ?? 0;
  return stored.version > top ? [{ version: stored.version, at: stored.updatedAt, by: stored.updatedBy, changes: [] }, ...entries] : entries;
}

/** The example's earlier versions (the current one is the map's or the guide's own). */
function seedMapHistory(map: EditorialMap): VersionEntry[] {
  const day = 86_400_000;
  const at = Date.parse(map.updatedAt);
  const ago = (days: number) => new Date(at - days * day).toISOString();
  return [
    { version: 4, at: map.updatedAt, by: map.updatedBy, changes: ['Eventos: Cobre → Às vezes', 'Fora do mapa: Política partidária'] },
    { version: 3, at: ago(18), by: 'Pedro', changes: ['Novo tema: Sustentabilidade (Cobre)', 'Fonte confiável: Agência Litoral'] },
    { version: 2, at: ago(41), by: 'Clara Souto', changes: ['Sanidade e regulação: Cobre → Principal'] },
    { version: 1, at: ago(70), by: 'Pedro', changes: ['Primeira versão do mapa'] },
  ];
}

function seedGuideHistory(guide: WritingGuide): VersionEntry[] {
  const day = 86_400_000;
  const at = Date.parse(guide.updatedAt);
  const ago = (days: number) => new Date(at - days * day).toISOString();
  return [
    { version: 3, at: guide.updatedAt, by: guide.updatedBy, changes: ['Novo termo: players → empresas', 'Lead revisto'] },
    { version: 2, at: ago(26), by: 'Juliana Prates', changes: ['Nova regra: Nada de "vale lembrar", "é importante destacar" ou "confira".'] },
    { version: 1, at: ago(64), by: 'Pedro', changes: ['Primeira versão do guia'] },
  ];
}

/** A question someone of the desk asked the archive, and its cited answer. */
export type ArchiveAsk = { question: string; askedBy: string; askedAt: string; answer: ArchiveAnswer };

/** The example's question: what the archive shows before anyone types. */
function seedAsk(archive: readonly ArchiveArticle[], askedAt: string): ArchiveAsk {
  const question = 'O que já publicamos sobre exportação de tilápia?';
  return { question, askedBy: 'Clara Souto', askedAt, answer: answerFrom(question, archive) };
}

/**
 * The radar's bookkeeping in the preview. `anchoredAt` is the last write: on the next visit every
 * time is moved forward by the time away, so the example still reads "há 4 min" instead of
 * "há 13 h". `seenSince` splits "Novas" from what this person already saw; `lastSeenAt` is when
 * they last left the desk; `released` are the simulated arrivals that already happened, and
 * `round` the set of arrivals this visit plays.
 */
export type RadarState = {
  anchoredAt: string;
  seenSince: string;
  lastSeenAt?: string;
  released: string[];
  /** Each visit after a break plays a new round of simulated arrivals. */
  round?: number;
};

/** How long the example pretends the person was away, whatever the real gap. */
const AWAY_MS = 20 * 60_000;
/** On a first visit, what arrived in the last 90 minutes counts as new. */
const FIRST_LOOK_MS = 90 * 60_000;

export function initialState(now = Date.now()): HardNewsState {
  const clock = clockAt(now);
  const archive = seedArchive(clock);
  return {
    version: 2,
    feeds: seedFeeds(clock),
    news: seedNews(clock),
    goal: DESK_GOAL,
    map: seedEditorialMap(clock),
    guide: seedWritingGuide(clock),
    dossiers: {},
    flags: {},
    suggestions: {},
    deliveries: {},
    quotes: seedQuotes(),
    archive,
    images: seedImages(),
    cms: seedCms(clock),
    seeded: false,
    radar: { anchoredAt: new Date(now).toISOString(), seenSince: new Date(now - FIRST_LOOK_MS).toISOString(), released: [] },
    lastAsk: seedAsk(archive, clock.ago(130)),
    mapHistory: seedMapHistory(seedEditorialMap(clock)),
    guideHistory: seedGuideHistory(seedWritingGuide(clock)),
  };
}

/** Connected clients begin with their own server policy and no demonstration records. */
export function emptyDeskState():HardNewsState{
  return {version:2,feeds:[],news:[],goal:{perDay:0},...defaultEditorialPolicy(),dossiers:{},flags:{},suggestions:{},deliveries:{},quotes:[],archive:[],images:[],
    cms:{platform:'WordPress',siteUrl:'',account:'',status:'disconnected',mode:'draft',categories:[],authors:[],authorMap:{},requires:{category:false,image:false,excerpt:false}},seeded:true};
}

/** The example's own map, if never edited, gains exclusions added to the example later. */
function withSeedExclusions(map: EditorialMap, clock: ReturnType<typeof clockAt>): EditorialMap {
  const seed = seedEditorialMap(clock);
  if (map.version !== seed.version) return map;
  const known = new Set(map.exclusions.map((term) => term.toLowerCase()));
  const missing = seed.exclusions.filter((term) => !known.has(term.toLowerCase()));
  return missing.length ? { ...map, exclusions: [...map.exclusions, ...missing] } : map;
}

function latestOf(a: string | undefined, b: string | undefined): string | undefined {
  if (!a || !b) return a ?? b;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function shiftIso(value: string | undefined, ms: number): string | undefined {
  if (!value || ms === 0) return value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time + ms).toISOString();
}

/** The newest time the desk wrote, for records saved before the radar kept its anchor. */
function newestTime(state: HardNewsState): number {
  let newest = 0;
  const see = (value?: string) => {
    const time = value ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(time) && time > newest) newest = time;
  };
  for (const item of state.news) {
    see(item.importedAt);
    see(item.decidedAt);
  }
  for (const feed of state.feeds) see(feed.lastReadAt);
  return newest;
}

/**
 * Moves the desk's clock forward by the time away (minus `AWAY_MS`): arrivals, reads, decisions
 * and research keep their distances to each other and to now. `laterUntil` stays: a postponed
 * story comes back at its real time.
 */
export function rebase(state: HardNewsState, now: number): HardNewsState {
  const anchor = state.radar ? Date.parse(state.radar.anchoredAt) : newestTime(state);
  const ms = Number.isNaN(anchor) || anchor === 0 ? 0 : Math.max(0, now - anchor - AWAY_MS);
  if (ms === 0) return state;
  const shift = (value?: string) => shiftIso(value, ms);
  return {
    ...state,
    news: state.news.map((item) => ({
      ...item,
      publishedAt: shift(item.publishedAt) ?? item.publishedAt,
      importedAt: shift(item.importedAt) ?? item.importedAt,
      decidedAt: shift(item.decidedAt),
      returnedAt: shift(item.returnedAt),
      duplicates: item.duplicates.map((duplicate) => ({ ...duplicate, publishedAt: shift(duplicate.publishedAt) ?? duplicate.publishedAt })),
      classification: item.classification?.correction
        ? { ...item.classification, correction: { ...item.classification.correction, at: shift(item.classification.correction.at) ?? item.classification.correction.at } }
        : item.classification,
    })),
    feeds: state.feeds.map((feed) => ({ ...feed, lastReadAt: shift(feed.lastReadAt) })),
    dossiers: Object.fromEntries(Object.entries(state.dossiers).map(([id, dossier]) => [id, { ...dossier, searchedAt: shift(dossier.searchedAt), writtenAt: shift(dossier.writtenAt) }])),
    deliveries: Object.fromEntries(Object.entries(state.deliveries).map(([id, delivery]) => [id, { ...delivery, sentAt: shift(delivery.sentAt) }])),
    cms: { ...state.cms, checkedAt: shift(state.cms.checkedAt) },
    radar: state.radar ? { ...state.radar, seenSince: shift(state.radar.seenSince) ?? state.radar.seenSince, lastSeenAt: shift(state.radar.lastSeenAt) } : undefined,
    lastAsk: state.lastAsk ? { ...state.lastAsk, askedAt: shift(state.lastAsk.askedAt) ?? state.lastAsk.askedAt } : undefined,
    map: { ...state.map, updatedAt: shift(state.map.updatedAt) ?? state.map.updatedAt },
    guide: { ...state.guide, updatedAt: shift(state.guide.updatedAt) ?? state.guide.updatedAt },
    mapHistory: state.mapHistory?.map((entry) => ({ ...entry, at: shift(entry.at) ?? entry.at })),
    guideHistory: state.guideHistory?.map((entry) => ({ ...entry, at: shift(entry.at) ?? entry.at })),
  };
}

/**
 * A stored desk, brought up to date on load: the clock moved to now, the radar's bookkeeping
 * filled, and example records added since it was saved (news, photos, quotes, archive) merged in by id.
 */
export function migrate(stored: HardNewsState, now: number): HardNewsState {
  const anchor = stored.radar ? Date.parse(stored.radar.anchoredAt) : newestTime(stored);
  const returning = !Number.isNaN(anchor) && anchor > 0 && now - anchor > AWAY_MS;
  const moved = rebase(stored, now);
  const clock = clockAt(now);
  const newsIds = new Set(moved.news.map((item) => item.id));
  const imageIds = new Set(moved.images.map((image) => image.id));
  const freshNews = seedNews(clock).filter((item) => !newsIds.has(item.id));
  const freshImages = seedImages().filter((image) => !imageIds.has(image.id));
  const quoteIds = new Set(moved.quotes.map((quote) => quote.id));
  const seededQuotes = seedQuotes();
  const freshQuotes = seededQuotes.filter((quote) => !quoteIds.has(quote.id));
  // Example fact checks arrived after some desks were saved: a quote nobody checked takes its example.
  const examples = new Map(seededQuotes.flatMap((quote) => (quote.factCheck ? [[quote.id, quote.factCheck] as const] : [])));
  const quotes = moved.quotes.map((quote) => (quote.factCheck || !examples.has(quote.id) ? quote : { ...quote, factCheck: examples.get(quote.id)! }));
  const articleIds = new Set(moved.archive.map((article) => article.id));
  const freshArticles = seedArchive(clock).filter((article) => !articleIds.has(article.id));
  const archive = freshArticles.length ? [...moved.archive, ...freshArticles] : moved.archive;
  const radar = moved.radar;
  return {
    ...moved,
    news: freshNews.length ? [...moved.news, ...freshNews] : moved.news,
    images: freshImages.length ? [...moved.images, ...freshImages] : moved.images,
    quotes: freshQuotes.length ? [...quotes, ...freshQuotes] : quotes,
    archive,
    lastAsk: moved.lastAsk ?? seedAsk(archive, clock.ago(130)),
    map: withSeedExclusions(moved.map, clock),
    // The topic weight "Prioridade" is now "Principal" (the queue's bands keep "Prioridade alta").
    mapHistory: (moved.mapHistory ?? withStored(seedMapHistory({ ...moved.map, version: Math.min(moved.map.version, 4) }), moved.map))
      .map((entry) => ({ ...entry, changes: entry.changes.map((change) => change.replace(/(→ |\()Prioridade(\)|$)/, '$1Principal$2').replace(/^(.*: )Prioridade( →)/, '$1Principal$2')) })),
    guideHistory: moved.guideHistory ?? withStored(seedGuideHistory({ ...moved.guide, version: Math.min(moved.guide.version, 3) }), moved.guide),
    radar: {
      anchoredAt: new Date(now).toISOString(),
      // A new visit: what arrived since the person last looked ("Marcar como vistas" or leaving).
      seenSince: latestOf(radar?.seenSince, radar?.lastSeenAt) ?? new Date(now - FIRST_LOOK_MS).toISOString(),
      lastSeenAt: radar?.lastSeenAt,
      released: radar?.released ?? [],
      round: (radar?.round ?? 0) + (returning && radar ? 1 : 0),
    },
  };
}

export const STORAGE_KEY = 'reporter.r2-preview.v2';

export function readStored(key=STORAGE_KEY): HardNewsState | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as HardNewsState;
    return parsed?.version === 2 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeStored(state: HardNewsState,key=STORAGE_KEY): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // The preview keeps working in memory when the browser refuses storage.
  }
}

export function clearStored(key=STORAGE_KEY): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}

/** Covered stories of a day: what counts toward the desk's goal. */
export function coveredToday(news: readonly NewsItem[], now = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return news.filter((item) => item.status === 'covered' && item.decidedAt && new Date(item.decidedAt) >= start).length;
}
