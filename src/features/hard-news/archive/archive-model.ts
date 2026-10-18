import type { Tone } from '@content-ventures/design-system/v3';
import type { ArchiveAnswer, ArchiveArticle, EnrichmentSuggestion, HardNewsDossier, IndexState, NewsItem } from '../../../domain/hard-news.ts';
import { searchArchive } from '../state/archive-search.ts';

/**
 * Pure view rules of the Acervo (F2.12): where the AI used each published article (context in a
 * story's research, links in its article), the search, the editorias, the tabs and cited answers.
 */

// ── Where the AI used the archive ─────────────────────────────────────────────────────────────

export type ArchiveUseKind = 'context' | 'link';

/** One use of a published article by the AI, in one story. */
export type ArchiveUse = {
  articleId: string;
  productionId: string;
  kind: ArchiveUseKind;
  /** The story that used it (its headline, else the news it came from). */
  story: string;
  /** Links: suggested in the studio, or already inserted. */
  state?: 'suggested' | 'inserted';
};

export type ArchiveUseInput = {
  archive: readonly ArchiveArticle[];
  dossiers: Readonly<Record<string, HardNewsDossier>>;
  news: readonly NewsItem[];
  suggestions: Readonly<Record<string, readonly EnrichmentSuggestion[]>>;
};

function sameAddress(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a.replace(/\/$/, '') === b.replace(/\/$/, '');
}

/**
 * Every use of the archive in the desk's stories: the articles a story's research attached or
 * accepted as a source (context, once per story; one the reporter discarded is no use), and the
 * links the studio suggested or inserted (a rejected link is no use).
 */
export function archiveUses({ archive, dossiers, news, suggestions }: ArchiveUseInput): ArchiveUse[] {
  const uses: ArchiveUse[] = [];
  for (const dossier of Object.values(dossiers)) {
    const story = dossier.outline?.headline || news.find((item) => item.id === dossier.newsId)?.title || 'Pauta';
    const context = new Set(dossier.archiveIds);
    for (const source of dossier.sources) {
      if (source.kind !== 'archive') continue;
      const article = archive.find((candidate) => sameAddress(source.url, candidate.url));
      if (!article) continue;
      // The reporter's call wins: an accepted source is context, a discarded one is not.
      if (source.state === 'accepted') context.add(article.id);
      if (source.state === 'discarded') context.delete(article.id);
    }
    for (const articleId of context) {
      if (archive.some((article) => article.id === articleId)) uses.push({ articleId, productionId: dossier.productionId, kind: 'context', story });
    }
    for (const suggestion of suggestions[dossier.productionId] ?? []) {
      if (suggestion.kind !== 'link' || suggestion.state === 'rejected') continue;
      const article = archive.find((candidate) => sameAddress(suggestion.origin.url, candidate.url));
      if (article) uses.push({ articleId: article.id, productionId: dossier.productionId, kind: 'link', story, state: suggestion.state === 'accepted' ? 'inserted' : 'suggested' });
    }
  }
  return uses;
}

export function usesByArticle(uses: readonly ArchiveUse[]): Map<string, ArchiveUse[]> {
  const byArticle = new Map<string, ArchiveUse[]>();
  for (const use of uses) byArticle.set(use.articleId, [...(byArticle.get(use.articleId) ?? []), use]);
  return byArticle;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The stories that used an article (each story once, whatever it used it for). */
export function storiesOf(uses: readonly ArchiveUse[]): number {
  return new Set(uses.map((use) => use.productionId)).size;
}

/** The card's AI tag: "Usada em 2 pautas", or nothing when no story used the article. */
export function usageLabel(uses: readonly ArchiveUse[]): string | undefined {
  const stories = storiesOf(uses);
  return stories ? `Usada em ${plural(stories, 'pauta', 'pautas')}` : undefined;
}

// ── The page: search, editorias, tabs ─────────────────────────────────────────────────────────

export type ArchiveTab = 'all' | 'used' | 'out';

export const ARCHIVE_TABS: { value: ArchiveTab; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'used', label: 'Usadas pela IA' },
  { value: 'out', label: 'Fora da IA' },
];

/** Only exceptions carry a status: an article the AI has not read yet, or could not read. */
export const READING_BADGES: Record<Exclude<IndexState, 'indexed'>, { label: string; tone: Tone }> = {
  pending: { label: 'Na fila da IA', tone: 'gray' },
  failed: { label: 'Leitura falhou', tone: 'red' },
};

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export type ArchiveFilters = { tab: ArchiveTab; section: string; query: string };

/**
 * Articles about a search, most relevant first: the words of the title, the excerpt and the
 * editoria (the same reading the AI's answer uses), then the articles signed by a matching author.
 * Every article counts, also the ones the AI has not read: they show with their note.
 */
export function searchArticles(archive: readonly ArchiveArticle[], query: string): ArchiveArticle[] {
  const wanted = normalize(query.trim());
  if (!wanted) return [...archive];
  const ranked = searchArchive(query, archive);
  const byAuthor = archive.filter((article) => !ranked.includes(article) && normalize(article.author).includes(wanted));
  return [...ranked, ...byAuthor];
}

/**
 * Articles of a tab and an editoria, or of a search: a search keeps its relevance; otherwise Todas
 * newest first, Usadas pela IA by the stories that used them, Fora da IA with the failed ones first.
 */
export function visibleArticles(archive: readonly ArchiveArticle[], uses: ReadonlyMap<string, readonly ArchiveUse[]>, { tab, section, query }: ArchiveFilters): ArchiveArticle[] {
  const newest = (a: ArchiveArticle, b: ArchiveArticle) => b.publishedAt.localeCompare(a.publishedAt);
  const count = (article: ArchiveArticle) => storiesOf(uses.get(article.id) ?? []);
  const kept = archive
    .filter((article) => tab !== 'used' || count(article) > 0)
    .filter((article) => tab !== 'out' || article.index !== 'indexed')
    .filter((article) => section === 'all' || article.section === section);
  if (query.trim()) return searchArticles(kept, query);
  return kept.sort((a, b) => {
    if (tab === 'used') return count(b) - count(a) || newest(a, b);
    if (tab === 'out') return Number(b.index === 'failed') - Number(a.index === 'failed') || newest(a, b);
    return newest(a, b);
  });
}

export function tabCounts(archive: readonly ArchiveArticle[], uses: ReadonlyMap<string, readonly ArchiveUse[]>): Record<ArchiveTab, number> {
  return {
    all: archive.length,
    used: archive.filter((article) => (uses.get(article.id)?.length ?? 0) > 0).length,
    out: archive.filter((article) => article.index !== 'indexed').length,
  };
}

/** One editoria of the archive, as a shelf: how many articles, who signs them, the latest one. */
export type ArchiveShelf = { name: string; count: number; authors: string[]; latest: string };

/** The editorias, the fullest first; each shelf's authors, the most frequent first. */
export function archiveShelves(archive: readonly ArchiveArticle[]): ArchiveShelf[] {
  const shelves = new Map<string, ArchiveArticle[]>();
  for (const article of archive) shelves.set(article.section, [...(shelves.get(article.section) ?? []), article]);
  return [...shelves].map(([name, articles]) => {
    const signed = new Map<string, number>();
    for (const article of articles) signed.set(article.author, (signed.get(article.author) ?? 0) + 1);
    return {
      name,
      count: articles.length,
      authors: [...signed].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([author]) => author),
      latest: articles.map((article) => article.publishedAt).sort().at(-1) ?? '',
    };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

export type ArchivePulse = {
  total: number;
  read: number;
  pending: number;
  failed: number;
  /** Articles the research used as context, and in how many stories. */
  contextArticles: number;
  contextStories: number;
  linksInserted: number;
  linksSuggested: number;
  /** The oldest published article. */
  since?: string;
};

/** The archive in numbers: what the AI read, used in research and linked in the studio. */
export function archivePulse(archive: readonly ArchiveArticle[], uses: readonly ArchiveUse[]): ArchivePulse {
  const context = uses.filter((use) => use.kind === 'context');
  const links = uses.filter((use) => use.kind === 'link');
  return {
    total: archive.length,
    read: archive.filter((article) => article.index === 'indexed').length,
    pending: archive.filter((article) => article.index === 'pending').length,
    failed: archive.filter((article) => article.index === 'failed').length,
    contextArticles: new Set(context.map((use) => use.articleId)).size,
    contextStories: new Set(context.map((use) => use.productionId)).size,
    linksInserted: links.filter((use) => use.state === 'inserted').length,
    linksSuggested: links.filter((use) => use.state !== 'inserted').length,
    since: archive.map((article) => article.publishedAt).sort()[0],
  };
}

/** "portal-do-pescado.exemplo/salmao-reajuste": the address without the protocol. */
export function addressOf(url: string): string {
  try {
    const address = new URL(url);
    return `${address.host}${address.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * Subjects the desk searches often. The preview keeps them here; the backend will suggest them from
 * the archive. Only the ones the AI can answer are offered: a suggestion never leads to nothing.
 */
const COMMON_SEARCHES = [
  'Exportação de tilápia',
  'Mancha branca',
  'Crédito ao pequeno produtor',
  'Contêiner refrigerado',
  'Energia solar',
  'Preço do salmão',
];

export function suggestedSearches(archive: readonly ArchiveArticle[], max = 5): { value: string; label: string }[] {
  const read = archive.filter((article) => article.index === 'indexed');
  return COMMON_SEARCHES
    .filter((subject) => searchArchive(subject, read).length > 0)
    .slice(0, max)
    .map((subject) => ({ value: subject, label: subject }));
}

// ── Cited answers ─────────────────────────────────────────────────────────────────────────────

/** A run of the answer text followed by the citation markers (1-based) that support it. */
export type AnswerPiece = { text: string; cites: number[] };

type CitedAnswer = Extract<ArchiveAnswer, { kind: 'answer' }>;

/**
 * Splits an answer into text runs and the passages each run cites. An answer that already marks
 * its citations ("… destino [1].") is read as written; otherwise each passage is found in the text
 * (the answer quotes it) and its marker goes right after it. A passage not found is cited at the end.
 */
export function answerPieces(answer: CitedAnswer): AnswerPiece[] {
  const total = answer.passages.length;
  if (/\[\d+\]/.test(answer.text)) {
    const pieces: AnswerPiece[] = [];
    for (const part of answer.text.split(/((?:\s*\[\d+\])+)/)) {
      if (/^(?:\s*\[\d+\])+$/.test(part)) {
        const cites = [...part.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])).filter((cite) => cite >= 1 && cite <= total);
        if (pieces.length > 0) pieces[pieces.length - 1].cites.push(...cites);
        else pieces.push({ text: '', cites });
      } else if (part) {
        pieces.push({ text: part, cites: [] });
      }
    }
    return pieces;
  }
  const pieces: AnswerPiece[] = [];
  const placed = new Set<number>();
  let cursor = 0;
  answer.passages.forEach((passage, index) => {
    // The answer may lower-case the passage's first letter when it quotes it mid-sentence.
    const needle = passage.text.trim().slice(1);
    const at = needle ? answer.text.indexOf(needle, cursor) : -1;
    if (at < 0) return;
    const end = at + needle.length;
    pieces.push({ text: answer.text.slice(cursor, end), cites: [index + 1] });
    placed.add(index + 1);
    cursor = end;
  });
  const rest = answer.text.slice(cursor);
  const missing = answer.passages.map((_, index) => index + 1).filter((cite) => !placed.has(cite));
  if (rest.trim() || pieces.length === 0) pieces.push({ text: rest, cites: missing });
  else pieces[pieces.length - 1].cites.push(...missing);
  return pieces;
}
