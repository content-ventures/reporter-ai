import type { EditorialMap, NewsItem, TopicWeight } from '../../../domain/hard-news.ts';

/**
 * Preview of the editorial map (F2.3): how the AI's score of a news item would move with the map
 * being edited, before it is saved. A rule of thumb for the screen, not the classifier: the real
 * score comes from the AI with the saved version.
 */

/** Points a rule moves a story's score by (the screen says them: "+15 na nota"). */
export const WEIGHT_POINTS: Record<TopicWeight, number> = { core: 15, regular: 5, occasional: -10 };
export const MISSING_TOPIC = -20;
export const EXCLUDED_POINTS = -40;
export const BLOCKED_POINTS = -50;
export const TRUSTED_POINTS = 5;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole words only (a plural too): "Feiras" catches "feira", never "Ferreira" or "pré-feira". */
function mentions(text: string, term: string): boolean {
  const stem = fold(term.trim()).replace(/s$/, '');
  return Boolean(stem) && new RegExp(`(?<![\\p{L}-])${escape(stem)}s?(?![\\p{L}-])`, 'u').test(text);
}

function topicPoints(map: EditorialMap, topic: string): number {
  const entry = map.topics.find((candidate) => fold(candidate.label) === fold(topic));
  return entry ? WEIGHT_POINTS[entry.weight] : MISSING_TOPIC;
}

/** The exclusions of `map` a story falls under (its title, lead or topic mention them). */
export function excludedBy(map: EditorialMap, item: NewsItem): string[] {
  const text = fold(`${item.title} ${item.excerpt} ${item.classification?.topic ?? ''}`);
  const reasons = fold((item.classification?.reasons ?? []).filter((reason) => reason.criterion === 'Exclusão').map((reason) => reason.detail).join(' '));
  // The text mentions it, or the AI already said this exclusion is why the story scored low.
  return map.exclusions.filter((term) => term.trim() && (mentions(text, term) || mentions(reasons, term)));
}

function excluded(map: EditorialMap, item: NewsItem): boolean {
  return excludedBy(map, item).length > 0;
}

function sourcePoints(map: EditorialMap, item: NewsItem): number {
  if (map.blocked.some((name) => fold(name) === fold(item.source))) return BLOCKED_POINTS;
  if (map.trusted.some((name) => fold(name) === fold(item.source))) return TRUSTED_POINTS;
  return 0;
}

/** The score `item` would get with `draft`, from its score under `saved`. */
export function previewScore(item: NewsItem, saved: EditorialMap, draft: EditorialMap): number | undefined {
  const classification = item.classification;
  if (!classification) return undefined;
  const topic = classification.topic;
  let score = classification.score;
  score += topicPoints(draft, topic) - topicPoints(saved, topic);
  score += (excluded(draft, item) ? EXCLUDED_POINTS : 0) - (excluded(saved, item) ? EXCLUDED_POINTS : 0);
  score += sourcePoints(draft, item) - sourcePoints(saved, item);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function sameMap(a: EditorialMap, b: EditorialMap): boolean {
  const strip = (map: EditorialMap) => JSON.stringify({ ...map, version: 0, updatedAt: '', updatedBy: '' });
  return strip(a) === strip(b);
}
