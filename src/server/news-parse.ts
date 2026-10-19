import 'server-only';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { RawNewsEntry } from '../domain/news-intake.ts';

type Document = ReturnType<typeof parseDocument>;
type Node = Document['children'][number];
type Element = Parameters<typeof DomUtils.getAttributeValue>[0];

/** A feed as read: its own title and site, and the entries in the order the feed gave them. */
export type ParsedFeed = { format: 'rss' | 'atom' | 'json'; title?: string; site?: string; entries: RawNewsEntry[] };

const BLOCKS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'li', 'blockquote', 'pre']);
const SKIPPED = new Set(['script', 'style', 'noscript', 'iframe', 'figure', 'figcaption', 'svg', 'form', 'button', 'nav', 'aside', 'footer', 'header']);

const isTag = (node: Node): node is Element => node.type === 'tag' || node.type === 'script' || node.type === 'style';
const local = (name: string) => name.toLowerCase().replace(/^.*:/, '');
const nameOf = (element: Element) => element.name.toLowerCase();

function children(node: Node | Document): Element[] {
  return 'children' in node ? node.children.filter(isTag) : [];
}

/** The first direct child named `name` (with or without its namespace prefix, as `prefixed`). */
function child(element: Element, name: string, prefixed?: string): Element | undefined {
  return children(element).find((item) => nameOf(item) === (prefixed ?? name) || (!prefixed && local(item.name) === name));
}

function text(element: Element | undefined): string | undefined {
  if (!element) return undefined;
  const value = DomUtils.textContent(element).trim();
  return value || undefined;
}

function descendants(root: Node | Document, test: (element: Element) => boolean): Element[] {
  return DomUtils.findAll(test, 'children' in root ? root.children : []);
}

/** HTML (a feed's description, a page's article) as paragraphs of plain text. */
export function htmlParagraphs(html: string | undefined): string[] {
  if (!html?.trim()) return [];
  if (!/[<&]/.test(html)) return html.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const document = parseDocument(html);
  return blockParagraphs(document);
}

/** Text with line breaks where the markup breaks lines (`<br>`, `<div>`); skipped elements leave nothing. */
function plainText(root: Document | Element): string {
  let value = '';
  const visit = (node: Node) => {
    if (node.type === 'text') { value += node.data; return; }
    if (!isTag(node)) return;
    const name = nameOf(node);
    if (SKIPPED.has(name)) return;
    if (name === 'br') { value += '\n'; return; }
    node.children.forEach(visit);
    if (name === 'div' || BLOCKS.has(name)) value += '\n';
  };
  root.children.forEach(visit);
  return value;
}

function blockParagraphs(root: Document | Element): string[] {
  const paragraphs: string[] = [];
  const visit = (node: Node) => {
    if (!isTag(node)) return;
    const name = nameOf(node);
    if (SKIPPED.has(name)) return;
    if (BLOCKS.has(name)) {
      const value = plainText(node).replace(/\s+/g, ' ').trim();
      if (value) paragraphs.push(value);
      return;
    }
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
  if (paragraphs.length) return paragraphs;
  // No block elements: the text itself, split where the markup broke lines.
  const flat = plainText(root).replace(/[ \t]+/g, ' ').trim();
  return flat ? flat.split(/\n\s*\n|\r?\n/).map((part) => part.trim()).filter(Boolean) : [];
}

/** Titles may carry markup (Google Alertas bolds the keyword): only the words stay. */
export function htmlText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/[<&]/.test(value)) return value;
  return DomUtils.textContent(parseDocument(value)).replace(/\s+/g, ' ').trim() || undefined;
}

function firstImage(html: string | undefined): string | undefined {
  if (!html || !/<img/i.test(html)) return undefined;
  const image = DomUtils.findOne((element) => nameOf(element) === 'img', parseDocument(html).children);
  return image ? DomUtils.getAttributeValue(image, 'src') : undefined;
}

function mediaImage(item: Element): string | undefined {
  for (const element of children(item)) {
    const name = nameOf(element);
    const url = DomUtils.getAttributeValue(element, 'url');
    if ((name === 'media:content' || name === 'media:thumbnail') && url) {
      const medium = DomUtils.getAttributeValue(element, 'medium') ?? DomUtils.getAttributeValue(element, 'type') ?? 'image';
      if (medium.startsWith('image')) return url;
    }
    if (name === 'enclosure' && url && (DomUtils.getAttributeValue(element, 'type') ?? '').startsWith('image/')) return url;
    if (name === 'media:group') {
      const nested = mediaImage(element);
      if (nested) return nested;
    }
  }
  return undefined;
}

function rssEntry(item: Element): RawNewsEntry {
  const content = text(child(item, 'encoded', 'content:encoded'));
  const description = text(child(item, 'description'));
  const atomLink = children(item).find((element) => nameOf(element) === 'atom:link' && (DomUtils.getAttributeValue(element, 'rel') ?? 'alternate') === 'alternate');
  const guid = child(item, 'guid');
  const permalink = guid && DomUtils.getAttributeValue(guid, 'isPermaLink') !== 'false' ? text(guid) : undefined;
  const link = text(child(item, 'link')) ?? (atomLink && DomUtils.getAttributeValue(atomLink, 'href')) ?? (permalink?.startsWith('http') ? permalink : undefined);
  const html = content ?? description;
  return {
    id: text(guid) ?? link,
    url: link,
    title: htmlText(text(child(item, 'title'))),
    paragraphs: htmlParagraphs(html),
    publishedAt: text(child(item, 'pubdate')) ?? text(child(item, 'date', 'dc:date')) ?? text(child(item, 'published')) ?? text(child(item, 'updated')),
    outlet: text(child(item, 'source')),
    image: mediaImage(item) ?? firstImage(html),
  };
}

function atomLinkOf(entry: Element): string | undefined {
  const links = children(entry).filter((element) => local(element.name) === 'link');
  const alternate = links.find((element) => (DomUtils.getAttributeValue(element, 'rel') ?? 'alternate') === 'alternate') ?? links[0];
  return alternate ? DomUtils.getAttributeValue(alternate, 'href') : undefined;
}

function atomEntry(entry: Element): RawNewsEntry {
  const content = child(entry, 'content');
  const summary = child(entry, 'summary');
  const html = text(content) ?? text(summary);
  const source = child(entry, 'source');
  return {
    id: text(child(entry, 'id')),
    url: atomLinkOf(entry),
    title: htmlText(text(child(entry, 'title'))),
    paragraphs: htmlParagraphs(html),
    publishedAt: text(child(entry, 'published')) ?? text(child(entry, 'updated')),
    outlet: source ? text(child(source, 'title')) : undefined,
    image: mediaImage(entry) ?? firstImage(html),
  };
}

type JsonFeedItem = { id?: unknown; url?: unknown; external_url?: unknown; title?: unknown; content_html?: unknown; content_text?: unknown;
  summary?: unknown; date_published?: unknown; date_modified?: unknown; image?: unknown; banner_image?: unknown };

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);

function jsonFeed(raw: string): ParsedFeed | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) return undefined;
  const feed = value as { title?: unknown; home_page_url?: unknown; version?: unknown; items: JsonFeedItem[] };
  if (!String(feed.version ?? '').includes('jsonfeed')) return undefined;
  return {
    format: 'json',
    title: str(feed.title),
    site: str(feed.home_page_url),
    entries: feed.items.slice(0, 500).filter((item) => item && typeof item === 'object').map((item) => ({
      id: str(item.id) ?? (typeof item.id === 'number' ? String(item.id) : undefined),
      url: str(item.url) ?? str(item.external_url),
      title: htmlText(str(item.title)),
      paragraphs: str(item.content_html) ? htmlParagraphs(str(item.content_html)) : htmlParagraphs(str(item.content_text) ?? str(item.summary)),
      publishedAt: str(item.date_published) ?? str(item.date_modified),
      image: str(item.image) ?? str(item.banner_image),
    })),
  };
}

/** RSS 2.0, RSS 1.0 (RDF), Atom or JSON Feed; `undefined` when the text is none of them. */
export function parseFeed(raw: string): ParsedFeed | undefined {
  const source = raw.replace(/^﻿/, '').trimStart();
  if (source.startsWith('{')) return jsonFeed(source);
  if (!source.startsWith('<')) return undefined;
  const document = parseDocument(source, { xmlMode: true });
  const root = children(document)[0];
  if (!root) return undefined;
  const rootName = local(root.name);
  if (rootName === 'feed') {
    return {
      format: 'atom',
      title: htmlText(text(child(root, 'title'))),
      site: atomLinkOf(root),
      entries: children(root).filter((element) => local(element.name) === 'entry').slice(0, 500).map(atomEntry),
    };
  }
  if (rootName === 'rss' || rootName === 'rdf') {
    const channel = child(root, 'channel');
    const items = descendants(root, (element) => local(element.name) === 'item' && !nameOf(element).includes(':')).slice(0, 500);
    return {
      format: 'rss',
      title: channel ? htmlText(text(child(channel, 'title'))) : undefined,
      site: channel ? text(child(channel, 'link')) : undefined,
      entries: items.map(rssEntry),
    };
  }
  return undefined;
}

/** `<link rel="alternate" type="application/rss+xml">` of a site's page: where its feed is. */
export function discoverFeeds(html: string, base: string): string[] {
  const document = parseDocument(html);
  const types = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json'];
  return descendants(document, (element) => nameOf(element) === 'link'
    && (DomUtils.getAttributeValue(element, 'rel') ?? '').toLowerCase().split(/\s+/).includes('alternate')
    && types.includes((DomUtils.getAttributeValue(element, 'type') ?? '').toLowerCase()))
    .flatMap((element) => {
      try { return [new URL(DomUtils.getAttributeValue(element, 'href') ?? '', base).toString()]; } catch { return []; }
    })
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 5);
}

type JsonLd = Record<string, unknown>;
const ARTICLE_TYPES = /^(NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|LiveBlogPosting|OpinionNewsArticle)$/;

function ldNodes(value: unknown): JsonLd[] {
  if (Array.isArray(value)) return value.flatMap(ldNodes);
  if (!value || typeof value !== 'object') return [];
  const node = value as JsonLd;
  return [node, ...ldNodes(node['@graph'])];
}

function ldArticle(document: Document): JsonLd | undefined {
  const scripts = descendants(document, (element) => nameOf(element) === 'script' && (DomUtils.getAttributeValue(element, 'type') ?? '').toLowerCase() === 'application/ld+json');
  for (const script of scripts) {
    let value: unknown;
    try { value = JSON.parse(DomUtils.textContent(script)); } catch { continue; }
    const article = ldNodes(value).find((node) => [node['@type']].flat().some((type) => typeof type === 'string' && ARTICLE_TYPES.test(type)));
    if (article) return article;
  }
  return undefined;
}

function ldImage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return ldImage(value[0]);
  if (value && typeof value === 'object') return str((value as JsonLd).url);
  return undefined;
}

/** "Lindt troca CEO | G1" → "Lindt troca CEO": a page title often ends with the site's name. */
function withoutSiteName(title: string, site: string): string {
  const parts = title.split(/\s+[|–—-]\s+/);
  if (parts.length < 2) return title;
  const last = parts.at(-1)!.trim().toLowerCase();
  const name = site.toLowerCase().replace(/^www\./, '');
  return last.length <= 40 && (name.includes(last) || last.includes(name.split('.')[0])) ? parts.slice(0, -1).join(' - ') : title;
}

/** The paragraphs of the page's story: inside `<article>` when there is one, else the page's longer paragraphs. */
function pageParagraphs(document: Document): string[] {
  const articles = descendants(document, (element) => nameOf(element) === 'article');
  const container = articles.sort((a, b) => DomUtils.textContent(b).length - DomUtils.textContent(a).length)[0];
  const scope = container ? blockParagraphs(container) : blockParagraphs(document);
  return scope.filter((paragraph) => paragraph.length >= (container ? 1 : 60));
}

/**
 * "Colar link": a news page as one entry. JSON-LD (NewsArticle) first, then OpenGraph and the
 * page's own tags, then the paragraphs of its article. `undefined` when the page names no story.
 */
export function parseArticlePage(html: string, finalUrl: string): RawNewsEntry | undefined {
  const document = parseDocument(html);
  const meta = (key: string) => {
    const element = DomUtils.findOne((item) => nameOf(item) === 'meta'
      && [DomUtils.getAttributeValue(item, 'property'), DomUtils.getAttributeValue(item, 'name')].some((name) => name?.toLowerCase() === key), document.children);
    return element ? str(DomUtils.getAttributeValue(element, 'content')) : undefined;
  };
  const canonicalLink = DomUtils.findOne((item) => nameOf(item) === 'link' && (DomUtils.getAttributeValue(item, 'rel') ?? '').toLowerCase() === 'canonical', document.children);
  const article = ldArticle(document);
  const publisher = article?.publisher && typeof article.publisher === 'object' ? str((article.publisher as JsonLd).name) : undefined;
  const titleTag = DomUtils.findOne((item) => nameOf(item) === 'title', document.children);
  const title = str(article?.headline) ?? meta('og:title') ?? meta('twitter:title') ?? (titleTag ? str(DomUtils.textContent(titleTag)) : undefined);
  if (!title) return undefined;
  const body = str(article?.articleBody);
  const paragraphs = body ? body.split(/\n+/).map((part) => part.trim()).filter(Boolean) : pageParagraphs(document);
  const description = str(article?.description) ?? meta('og:description') ?? meta('description');
  const isArticle = Boolean(article) || meta('og:type') === 'article' || paragraphs.length >= 2;
  if (!isArticle && !description) return undefined;
  // The page's canonical address stands for it only on the same site.
  const final = new URL(finalUrl);
  const declared = (canonicalLink ? DomUtils.getAttributeValue(canonicalLink, 'href') : undefined) ?? meta('og:url');
  let url = finalUrl;
  try {
    const canonical = declared ? new URL(declared, finalUrl) : undefined;
    if (canonical && canonical.hostname.replace(/^www\./, '') === final.hostname.replace(/^www\./, '')) url = canonical.toString();
  } catch { /* An unreadable canonical keeps the address that answered. */ }
  const lead = paragraphs.length && description && paragraphs[0].startsWith(description.slice(0, 40)) ? [] : description ? [description] : [];
  const outlet = meta('og:site_name') ?? publisher;
  return {
    url,
    title: withoutSiteName(htmlText(title) ?? title, outlet ?? final.hostname),
    paragraphs: [...lead, ...paragraphs],
    publishedAt: str(article?.datePublished) ?? meta('article:published_time') ?? meta('og:article:published_time') ?? meta('date'),
    outlet,
    image: ldImage(article?.image) ?? meta('og:image'),
  };
}
