/**
 * F2.1 · Entrada de notícias (REQ-2.1): feeds (RSS, Atom, JSON Feed, Google Alertas, RSS.app) and
 * pasted links become one normalized shape. A repeat is dropped by identity (the feed's own id) or
 * by link (the canonical address); the same story from another outlet joins the first one as a
 * duplicate and never erases its origin. Pure TypeScript: the server parses XML and HTML into
 * `RawNewsEntry` and applies these rules.
 */

import type { FeedState } from './hard-news.ts';

/** Where a source's entries come from. Every kind is read as a feed; they differ in how it is made. */
export type NewsSourceKind = 'rss' | 'google-alerts' | 'rss-app';

export const NEWS_SOURCE_KIND_LABELS: Record<NewsSourceKind, string> = {
  rss: 'Feed RSS',
  'google-alerts': 'Google Alertas',
  'rss-app': 'RSS.app',
};

/** Pending decision (F2.1 "feeds, frequência e limites"): the defaults in force until then. */
export const NEWS_LIMITS = {
  /** Sources per workspace. */
  sources: 30,
  /** Newest entries kept per read; the rest of a long feed is old news. */
  itemsPerRead: 50,
  /** A source's first read keeps only the last week, not the outlet's whole archive. */
  firstReadDays: 7,
  feedBytes: 2 * 1024 * 1024,
  pageBytes: 3 * 1024 * 1024,
  timeoutMs: 15_000,
  /** Reads that fail in a row before the source shows "Com falha". */
  failuresToFail: 3,
  titleChars: 300,
  excerptChars: 400,
  bodyChars: 20_000,
  /** The same story from another outlet is grouped within this window. */
  duplicateHours: 72,
} as const;

/** One entry as a feed or a page gave it, already reduced to text by the parser. */
export type RawNewsEntry = {
  /** The feed's own id (RSS guid, Atom id, JSON Feed id). */
  id?: string;
  url?: string;
  title?: string;
  /** Paragraphs of the entry's text: the full content when the feed has it, else the summary. */
  paragraphs?: string[];
  /** Any date the feed or page gave; unreadable dates become the import time. */
  publishedAt?: string;
  /** The outlet the entry names (an aggregator's `<source>`, a page's site name). */
  outlet?: string;
  image?: string;
};

/** A news item ready for the queue, before it has an id. */
export type NormalizedNews = {
  /** Identity inside its source: the feed's id, else the canonical link. */
  guid: string;
  url: string;
  canonicalUrl: string;
  title: string;
  outlet: string;
  publishedAt: string;
  excerpt: string;
  /** Every paragraph, the lead first (the radar shows the rest as "Texto original"). */
  body: string[];
  image?: string;
  /** Present when the title is specific enough to group the same story from another outlet. */
  storyKey?: string;
};

const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_ga|_gl|ref_src|cmpid|xtor|ocid|at_[a-z_]+)$/i;

function parsedUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A full public http(s) address, the rule every news address follows. */
export function isNewsAddress(value: string): boolean {
  return parsedUrl(value) !== undefined;
}

/**
 * Google Alertas and other aggregators wrap the outlet's link (`google.com/url?url=…`): the news
 * is the outlet's address, so links are compared and opened unwrapped.
 */
export function unwrapLink(value: string): string {
  const url = parsedUrl(value);
  if (!url) return value.trim();
  const host = url.hostname.toLowerCase();
  if ((host === 'google.com' || host.endsWith('.google.com')) && url.pathname === '/url') {
    const target = url.searchParams.get('url') ?? url.searchParams.get('q');
    if (target && parsedUrl(target)) return target;
  }
  return url.toString();
}

/** The address without what does not change the page (tracking, fragment), for links people open. */
export function cleanLink(value: string): string | undefined {
  const url = parsedUrl(unwrapLink(value));
  if (!url) return undefined;
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}

/**
 * The dedupe key of a link: https, host without "www.", no tracking, no fragment, sorted query and
 * no trailing slash. Two addresses with the same key are the same page.
 */
export function canonicalUrl(value: string): string | undefined {
  const cleaned = cleanLink(value);
  const url = cleaned ? new URL(cleaned) : undefined;
  if (!url) return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const port = url.port ? `:${url.port}` : '';
  const params = [...url.searchParams].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  const path = url.pathname.replace(/\/+$/, '');
  return `https://${host}${port}${path}${query}`;
}

/** "g1.globo.com": the outlet of an entry that names none, from its address. */
export function outletOf(value: string): string {
  const url = parsedUrl(value);
  return url ? url.hostname.toLowerCase().replace(/^www\./, '') : value;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Folded, so "após" is "apos". Words of two letters or fewer never count.
const STOPWORDS = new Set([
  'para', 'com', 'que', 'por', 'dos', 'das', 'nos', 'nas', 'uma', 'umas', 'uns', 'mais', 'menos', 'sobre', 'apos', 'ante',
  'entre', 'como', 'sem', 'sua', 'seu', 'suas', 'seus', 'sao', 'ser', 'tem', 'ate', 'pelo', 'pela', 'pelos', 'pelas',
  'diz', 'dizem', 'nao', 'sim', 'ja', 'foi', 'esta', 'este', 'essa', 'esse', 'isso', 'veja', 'confira', 'video', 'fotos',
  'the', 'and', 'for', 'from', 'with', 'into', 'over', 'after', 'says',
]);

/**
 * The story behind a headline: its significant words, folded and sorted. Two outlets that ran the
 * same agency text share it. Headlines with fewer than four significant words are too generic to
 * group ("Preço do camarão sobe") and get none.
 */
export function storyKey(title: string): string | undefined {
  const words = [...new Set(fold(title).split(' ').filter((word) => word.length > 2 && !STOPWORDS.has(word)))].sort();
  return words.length >= 4 ? words.join(' ') : undefined;
}

/** Text as people read it: one space between words, no invisible characters. */
export function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/[​-‍﻿­]/g, '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:–-]+$/, '')}…`;
}

/** The paragraphs kept: cleaned, without repeats in a row, within `NEWS_LIMITS.bodyChars`. */
export function bodyOf(paragraphs: readonly string[] | undefined, title = ''): string[] {
  const body: string[] = [];
  let total = 0;
  for (const raw of paragraphs ?? []) {
    const text = cleanText(raw);
    if (!text || text === body.at(-1) || (body.length === 0 && fold(text) === fold(title))) continue;
    if (total + text.length > NEWS_LIMITS.bodyChars) break;
    body.push(text);
    total += text.length;
  }
  return body;
}

function isoOf(value: string | undefined, now: number): string {
  const time = value ? Date.parse(value) : Number.NaN;
  // An unreadable date, or one ahead of the clock, is the moment it arrived.
  return new Date(Number.isNaN(time) || time > now + 10 * 60_000 ? now : time).toISOString();
}

export type NormalizeOptions = {
  now: number;
  /** The source's own name, for outlets' feeds; aggregators (alerts, keywords) name each entry's outlet. */
  outlet?: string;
  /** Entries published before this moment are left out (a source's first read). */
  since?: number;
  limit?: number;
};

/** One entry, normalized; `undefined` when it has no usable link or title. */
export function normalizeEntry(entry: RawNewsEntry, options: NormalizeOptions): NormalizedNews | undefined {
  const url = entry.url ? cleanLink(entry.url) : undefined;
  const canonical = url ? canonicalUrl(url) : undefined;
  const title = clip(cleanText(entry.title), NEWS_LIMITS.titleChars);
  if (!url || !canonical || !title) return undefined;
  const body = bodyOf(entry.paragraphs, title);
  const image = entry.image ? cleanLink(entry.image) : undefined;
  const key = storyKey(title);
  return {
    guid: cleanText(entry.id).slice(0, 500) || canonical,
    url,
    canonicalUrl: canonical,
    title,
    outlet: clip(cleanText(options.outlet) || cleanText(entry.outlet) || outletOf(url), 120),
    publishedAt: isoOf(entry.publishedAt, options.now),
    excerpt: clip(body[0] ?? '', NEWS_LIMITS.excerptChars),
    body,
    ...(image ? { image } : {}),
    ...(key ? { storyKey: key } : {}),
  };
}

/**
 * A feed's entries as news: newest first, one per link, published since `since`, at most `limit`
 * (`NEWS_LIMITS.itemsPerRead`).
 */
export function normalizeEntries(entries: readonly RawNewsEntry[], options: NormalizeOptions): NormalizedNews[] {
  const seen = new Set<string>();
  const items: NormalizedNews[] = [];
  for (const entry of entries) {
    const item = normalizeEntry(entry, options);
    if (!item || seen.has(item.canonicalUrl)) continue;
    if (options.since !== undefined && Date.parse(item.publishedAt) < options.since) continue;
    seen.add(item.canonicalUrl);
    items.push(item);
  }
  return items
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, options.limit ?? NEWS_LIMITS.itemsPerRead);
}

/** Recognizes a Google Alertas feed by its address, so its entries are unwrapped and attributed. */
export function sourceKindOf(feedUrl: string): Exclude<NewsSourceKind, 'rss-app'> {
  const url = parsedUrl(feedUrl);
  return url && url.hostname.toLowerCase() === 'www.google.com' && url.pathname.startsWith('/alerts/feeds/') ? 'google-alerts' : 'rss';
}

/** How a source is doing, as the screens show it. */
export function feedStateOf(source: { paused: boolean; failures: number }): FeedState {
  if (source.paused) return 'paused';
  return source.failures >= NEWS_LIMITS.failuresToFail ? 'failing' : 'active';
}

/** The server's refusals and read failures, in the desk's words. A source keeps only the code. */
export const NEWS_MESSAGES: Record<string, string> = {
  NEWS_URL_INVALID: 'Cole um endereço completo, com https://.',
  NEWS_NAME_REQUIRED: 'Dê um nome à fonte.',
  NEWS_KEYWORD_REQUIRED: 'Digite a palavra-chave.',
  NEWS_SOURCE_DUPLICATE: 'Essa fonte já está cadastrada.',
  NEWS_SOURCE_LIMIT: `Limite de ${NEWS_LIMITS.sources} fontes. Remova uma antes de adicionar.`,
  NEWS_SOURCE_NOT_FOUND: 'Essa fonte não existe mais.',
  NEWS_SOURCE_RATING_INVALID: 'Revise o grau, a relevância e a justificativa da fonte.',
  NEWS_SOURCE_RATING_UNSUPPORTED: 'Avalie o veículo original. Este feed reúne notícias de várias fontes.',
  NEWS_FEED_INVALID: 'Esse endereço não é um feed RSS, Atom ou JSON Feed.',
  NEWS_FEED_EMPTY: 'O feed não tem notícias com link e título.',
  NEWS_UNREACHABLE: 'O endereço não respondeu.',
  NEWS_TIMEOUT: 'O endereço não respondeu em 15 segundos.',
  NEWS_TOO_LARGE: 'A resposta passa do limite de tamanho.',
  NEWS_ADDRESS_BLOCKED: 'Esse endereço não é público.',
  NEWS_PAGE_INVALID: 'Não encontramos uma notícia nesse endereço.',
  NEWS_ITEM_NOT_FOUND: 'Essa notícia não existe mais.',
  NEWS_TRANSLATION_UNCONFIGURED: 'A tradução não está configurada. Peça a um administrador para conectar a API de texto.',
  RSS_APP_UNCONFIGURED: 'O RSS.app ainda não está conectado.',
  RSS_APP_REFUSED: 'O RSS.app não conseguiu criar um feed desse endereço.',
  RSS_APP_LIMIT: 'O plano do RSS.app chegou ao limite de feeds.',
  RSS_APP_AUTH: 'O RSS.app recusou a chave de acesso.',
  RSS_APP_UNAVAILABLE: 'O RSS.app não respondeu. Tente de novo.',
};

/** What an HTTP refusal means for the desk ("HTTP_403" → the site blocks automatic reading). */
function httpMessage(status: number): string {
  if (status === 401 || status === 403) return 'O site recusou a leitura automática.';
  if (status === 404 || status === 410) return 'O endereço não existe mais.';
  if (status === 429) return 'O site pediu para esperar. Tente mais tarde.';
  if (status >= 500) return 'O site está fora do ar.';
  return `O endereço respondeu com erro ${status}.`;
}

/** A stored failure code, in words; unknown codes read as a generic failure. */
export function newsMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const status = /^HTTP_(\d{3})$/.exec(code)?.[1];
  return NEWS_MESSAGES[code] ?? (status ? httpMessage(Number(status)) : 'A leitura falhou.');
}
