import { countWords } from './text/stats.ts';
import { blockText } from './article.ts';
import type { ArticleBody } from './article.ts';
import type { EditorialPlan } from './editorial-plan.ts';
export type PublicationMetadata = { title: string; description: string; slug: string; standfirst: string; keyword: string; searchIntent: string; secondaryKeywords: string };
function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
/** Conservative editable suggestions derived from the text; no invented search metrics. */
export function publicationMetadata(body: ArticleBody, plan?: EditorialPlan): PublicationMetadata {
  const first = body.blocks.find(block => block.type === 'paragraph');
  const summary = first ? blockText(first) : body.title;
  return { title: excerpt(body.title, 65), description: excerpt(summary, 160), standfirst: body.dek ?? '',
    slug: body.title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180),
    keyword: plan?.keyword || plan?.mainTopic || '', searchIntent: plan?.searchIntent || '', secondaryKeywords: plan?.secondaryTopics.filter(Boolean).join(', ') || '' };
}
export function readPublicationMetadata(value: unknown): PublicationMetadata | undefined {
  if (!value || typeof value !== 'object') return;
  const fields = ['title', 'description', 'slug', 'standfirst', 'keyword', 'searchIntent', 'secondaryKeywords'] as const;
  if (fields.some(key => typeof (value as Record<string, unknown>)[key] !== 'string' || ((value as Record<string, string>)[key]).length > 2000)) return;
  return Object.fromEntries(fields.map(key => [key, (value as PublicationMetadata)[key]])) as PublicationMetadata;
}

export function publicationReview(body: ArticleBody, metadata: PublicationMetadata) {
  const keyword = metadata.keyword.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const title = metadata.title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return {
    descriptionChars: Array.from(metadata.description).length,
    keywordInTitle: keyword ? title.includes(keyword) : null,
    longParagraphs: body.blocks.filter(block => block.type === 'paragraph' && countWords(blockText(block)) > 150).length,
    validSlug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug),
  };
}
