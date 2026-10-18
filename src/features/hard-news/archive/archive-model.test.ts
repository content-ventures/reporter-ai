import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArchiveArticle, EnrichmentSuggestion, HardNewsDossier, NewsItem, ResearchSource } from '../../../domain/hard-news.ts';
import { addressOf, archivePulse, archiveShelves, archiveUses, searchArticles, storiesOf, suggestedSearches, tabCounts, usageLabel, usesByArticle, visibleArticles } from './archive-model.ts';

function article(id: string, patch: Partial<ArchiveArticle> = {}): ArchiveArticle {
  return {
    id, title: `Matéria ${id}`, url: `https://portal.exemplo/${id}`, section: 'Mercado', publishedAt: '2026-05-01T12:00:00.000Z',
    author: 'Clara Souto', excerpt: 'Trecho.', index: 'indexed', ...patch,
  };
}

function source(url: string, state: ResearchSource['state']): ResearchSource {
  return { id: url, title: 'Fonte', url, outlet: 'Acervo do portal', kind: 'archive', consultedAt: '2026-10-01T12:00:00.000Z', excerpt: '', state };
}

function dossier(productionId: string, patch: Partial<HardNewsDossier> = {}): HardNewsDossier {
  return { productionId, newsId: `news-${productionId}`, angle: '', research: 'done', sources: [], quoteIds: [], archiveIds: [], stage: 'research', ...patch };
}

function link(url: string, state: EnrichmentSuggestion['state']): EnrichmentSuggestion {
  return { id: `e-${url}-${state}`, kind: 'link', text: 'Link', anchor: '', why: '', origin: { title: 'Link', url, date: '2026-05-01' }, state };
}

const ARCHIVE = [
  article('a', { publishedAt: '2026-09-01T12:00:00.000Z', section: 'Mercado' }),
  article('b', { publishedAt: '2026-08-01T12:00:00.000Z', section: 'Aquicultura', author: 'João' }),
  article('c', { publishedAt: '2026-07-01T12:00:00.000Z', index: 'pending' }),
  article('d', { publishedAt: '2026-01-12T12:00:00.000Z', index: 'failed' }),
];

const NEWS = [{ id: 'news-p1', title: 'Notícia da pauta 1' }] as NewsItem[];

const INPUT = {
  archive: ARCHIVE,
  news: NEWS,
  dossiers: {
    p1: dossier('p1', { archiveIds: ['a'], sources: [source('https://portal.exemplo/a/', 'accepted'), source('https://portal.exemplo/b', 'discarded')] }),
    p2: dossier('p2', { archiveIds: ['a', 'b'], outline: { headline: 'Título da pauta 2', lead: '', sections: [], size: 'short' } }),
  },
  suggestions: { p2: [link('https://portal.exemplo/a', 'accepted'), link('https://portal.exemplo/b', 'pending'), link('https://portal.exemplo/c', 'rejected')] },
};

test('uses: context once per story, accepted archive sources by address, links not rejected', () => {
  const uses = archiveUses(INPUT);
  const context = uses.filter((use) => use.kind === 'context');
  assert.deepEqual(context.map((use) => `${use.productionId}:${use.articleId}`).sort(), ['p1:a', 'p2:a', 'p2:b']);
  assert.equal(context.find((use) => use.productionId === 'p1')?.story, 'Notícia da pauta 1');
  assert.equal(context.find((use) => use.productionId === 'p2')?.story, 'Título da pauta 2');
  const links = uses.filter((use) => use.kind === 'link');
  assert.deepEqual(links.map((use) => `${use.articleId}:${use.state}`), ['a:inserted', 'b:suggested']);
});

test('a source the reporter discarded is no context, even when the research attached it', () => {
  const uses = archiveUses({ ...INPUT, dossiers: { p3: dossier('p3', { archiveIds: ['a'], sources: [source('https://portal.exemplo/a', 'discarded')] }) }, suggestions: {} });
  assert.deepEqual(uses, []);
});

test('tabs, editoria and search over author', () => {
  const uses = usesByArticle(archiveUses(INPUT));
  assert.deepEqual(visibleArticles(ARCHIVE, uses, { tab: 'all', section: 'all', query: '' }).map((item) => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(visibleArticles(ARCHIVE, uses, { tab: 'used', section: 'all', query: '' }).map((item) => item.id), ['a', 'b']);
  assert.deepEqual(visibleArticles(ARCHIVE, uses, { tab: 'out', section: 'all', query: '' }).map((item) => item.id), ['d', 'c']);
  assert.deepEqual(visibleArticles(ARCHIVE, uses, { tab: 'all', section: 'Aquicultura', query: '' }).map((item) => item.id), ['b']);
  assert.deepEqual(visibleArticles(ARCHIVE, uses, { tab: 'all', section: 'all', query: 'joao' }).map((item) => item.id), ['b']);
  assert.deepEqual(tabCounts(ARCHIVE, uses), { all: 4, used: 2, out: 2 });
});

test('pulse counts what the AI read and used', () => {
  const pulse = archivePulse(ARCHIVE, archiveUses(INPUT));
  assert.deepEqual(pulse, {
    total: 4, read: 2, pending: 1, failed: 1, contextArticles: 2, contextStories: 2, linksInserted: 1, linksSuggested: 1,
    since: '2026-01-12T12:00:00.000Z',
  });
});

test('usage tag counts stories, and the address', () => {
  const uses = usesByArticle(archiveUses(INPUT));
  assert.equal(usageLabel(uses.get('a') ?? []), 'Usada em 2 pautas');
  assert.equal(usageLabel(uses.get('b') ?? []), 'Usada em 1 pauta');
  assert.equal(usageLabel([]), undefined);
  assert.equal(storiesOf(uses.get('a') ?? []), 2);
  assert.equal(addressOf('https://portal-do-pescado.exemplo/salmao-reajuste/'), 'portal-do-pescado.exemplo/salmao-reajuste');
});

test('suggested searches lead only to what the AI read', () => {
  const archive = [
    article('t', { title: 'Exportação de tilápia bate recorde', excerpt: 'Exportações de tilápia cresceram.' }),
    article('s', { title: 'Salmão chileno sobe de preço', excerpt: 'Reajuste.', index: 'failed' }),
  ];
  const all = suggestedSearches(archive).map((item) => item.value);
  assert.ok(all.includes('Exportação de tilápia'));
  assert.ok(!all.includes('Preço do salmão'));
  assert.equal(suggestedSearches([article('x', { title: 'Feira', excerpt: 'Evento', section: 'Eventos' })]).length, 0);
});

test('search ranks by subject (ties newest first), then author, and keeps the articles the AI has not read', () => {
  const archive = [
    article('old', { title: 'Tilápia no Paraná', publishedAt: '2026-01-01T12:00:00.000Z' }),
    article('best', { title: 'Exportação de tilápia', excerpt: 'Exportação cresce.', publishedAt: '2026-02-01T12:00:00.000Z' }),
    article('unread', { title: 'Exportação em queda', index: 'failed' }),
    article('byline', { title: 'Feira', author: 'Tilápia Souza' }),
  ];
  assert.deepEqual(searchArticles(archive, 'exportação de tilápia').map((item) => item.id), ['best', 'unread', 'old']);
  assert.deepEqual(searchArticles(archive, 'souza').map((item) => item.id), ['byline']);
  const uses = usesByArticle([]);
  assert.deepEqual(visibleArticles(archive, uses, { tab: 'out', section: 'all', query: 'exportação' }).map((item) => item.id), ['unread']);
});

test('shelves: editorias by size, their authors by frequency, the latest date', () => {
  const shelves = archiveShelves([...ARCHIVE, article('e', { section: 'Aquicultura', author: 'João', publishedAt: '2026-10-01T12:00:00.000Z' })]);
  assert.deepEqual(shelves.map((shelf) => `${shelf.name}:${shelf.count}`), ['Mercado:3', 'Aquicultura:2']);
  assert.deepEqual(shelves[0].authors, ['Clara Souto']);
  assert.equal(shelves[1].latest, '2026-10-01T12:00:00.000Z');
});
