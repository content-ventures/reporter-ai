import type { ArchiveAnswer, ArchiveArticle } from '../../../domain/hard-news.ts';

/**
 * Preview of the archive question (F2.12): it answers only from indexed passages that share words
 * with the question, cites each one, and says plainly when the archive has nothing.
 */

const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'que', 'qual', 'quais', 'como', 'para', 'por', 'com', 'um', 'uma', 'já', 'sobre', 'o que', 'foi', 'tem', 'há']);

function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

export function searchArchive(query: string, archive: readonly ArchiveArticle[]): ArchiveArticle[] {
  const wanted = words(query);
  if (wanted.length === 0) return [...archive];
  return archive
    .map((article) => {
      const haystack = words(`${article.title} ${article.excerpt} ${article.section}`);
      const score = wanted.filter((word) => haystack.some((candidate) => candidate.startsWith(word.slice(0, 5)))).length;
      return { article, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.article.publishedAt.localeCompare(a.article.publishedAt))
    .map((entry) => entry.article);
}

/** dd/mm/aaaa (DS §11). */
function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function answerFrom(question: string, archive: readonly ArchiveArticle[]): ArchiveAnswer {
  const found = searchArchive(question, archive.filter((article) => article.index === 'indexed')).slice(0, 3);
  if (found.length === 0) return { question, kind: 'none' };
  const [first, ...rest] = found;
  const text = [
    `O portal tratou do tema em ${found.length === 1 ? 'uma matéria' : `${found.length} matérias`}. A mais relevante, de ${dateOf(first.publishedAt)}, informa que ${first.excerpt.charAt(0).toLowerCase()}${first.excerpt.slice(1)}`,
    ...rest.map((article) => `Em ${dateOf(article.publishedAt)}, “${article.title}” acrescenta que ${article.excerpt.charAt(0).toLowerCase()}${article.excerpt.slice(1)}`),
  ].join(' ');
  return { question, kind: 'answer', text, passages: found.map((article) => ({ articleId: article.id, text: article.excerpt })) };
}
