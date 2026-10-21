import type { NewsItem } from '../../../domain/hard-news.ts';

const DAY = 24 * 60 * 60_000;
// Editorial topics come from repeated title terms, not article scores or web-wide popularity.
const STOP = new Set(`a ao aos as com como da das de do dos e em entre esse esta este foi mais na nas no nos o os ou para pela pelas pelo pelos por que se sem sobre sua suas seu seus um uma uns umas até após ante
  the and for from into that this with are has have how new its their over under will not you your las los del con una por sus para como que
  anos ano hoje ontem amanhã semana mês meses dias dia durante nesta neste neste essas esses ser são está estão ter tem todo todos toda todas cada quando onde ainda também muito contra antes depois agora
  anuncia anunciado aumenta ampliar amplia avanço avança busca chega crescem cresce debate destaca desenvolve discute discute discutem entrega entregará expande fortalece ganha impulsiona lança mais marca novo nova novos novas apresenta promove reforça reúne reconhece relança revela terá traz vai vão podem pode primeiro primeira maior maiores melhor melhores próximo próxima próximos próximas`.split(/\s+/));

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

function tokens(title: string): string[] {
  return title.match(/[\p{L}][\p{L}\p{N}-]*/gu) ?? [];
}

function recent(item: NewsItem, now: number): boolean {
  const at = Date.parse(item.publishedAt);
  return item.status === 'new' && Number.isFinite(at) && at > now - DAY && at <= now;
}

function address(url: string): { article: string; publisher: string } {
  try {
    const value = new URL(url);
    value.hash = '';
    for (const key of [...value.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) value.searchParams.delete(key);
    return { article: value.href, publisher: value.hostname.toLowerCase().replace(/^www\./, '') };
  } catch { return { article: url, publisher: '' }; }
}

export type NewsTopic = {
  key: string;
  label: string;
  items: NewsItem[];
  sources: number;
  /** Six consecutive four-hour publication buckets, oldest first. */
  points: number[];
};

/** Exact, accent-insensitive title terms, in the same publication window as the topic count. */
export function matchesTopic(item: NewsItem, key: string, now: number): boolean {
  if (!recent(item, now)) return false;
  const title = ` ${tokens(item.title).map(normalize).join(' ')} `;
  return title.includes(` ${key} `);
}

/** Repeated terms in collected headlines. No growth claim, AI classification or reach estimate. */
export function newsTopics(news: readonly NewsItem[], now: number): NewsTopic[] {
  const seen = new Set<string>();
  const items = news.filter(item => {
    if (!recent(item, now)) return false;
    const key = address(item.url).article || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  const candidates = new Map<string, { label: string; items: NewsItem[] }>();
  for (const item of items) {
    const words = tokens(item.title);
    const found = new Set<string>();
    const eligible = (word: string) => word.length >= 4 && !STOP.has(normalize(word));
    words.forEach((word, index) => {
      if (!eligible(word)) return;
      const phrases = [word];
      if (words[index + 1] && eligible(words[index + 1])) phrases.push(`${word} ${words[index + 1]}`);
      for (const phrase of phrases) {
        const key = normalize(phrase);
        if (found.has(key)) continue;
        found.add(key);
        const entry = candidates.get(key) ?? { label: phrase.charAt(0).toLocaleUpperCase('pt-BR') + phrase.slice(1), items: [] };
        entry.items.push(item);
        candidates.set(key, entry);
      }
    });
  }
  const ranked = [...candidates].filter(([, entry]) => entry.items.length >= 2).map(([key, entry]) => {
    const sources = new Set(entry.items.map(item => address(item.url).publisher || normalize(item.source))).size;
    const points = Array<number>(6).fill(0);
    for (const item of entry.items) points[Math.min(5, Math.floor((Date.parse(item.publishedAt) - now + DAY) / (DAY / 6)))]++;
    return { key, ...entry, sources, points };
  }).sort((a, b) => {
    const score = (topic: NewsTopic) => topic.items.length * (1 + Math.log2(topic.sources) / 4) * (topic.key.includes(' ') ? 1.15 : 1);
    return score(b) - score(a) || a.key.localeCompare(b.key, 'pt-BR');
  });
  const chosen: NewsTopic[] = [];
  for (const candidate of ranked) {
    // Avoid filling the rail with different words describing almost the same set of headlines.
    if (chosen.some(topic => {
      const overlap = candidate.items.filter(item => topic.items.some(other => other.id === item.id)).length;
      return overlap / Math.min(topic.items.length, candidate.items.length) >= 0.8;
    })) continue;
    chosen.push(candidate);
    if (chosen.length === 6) break;
  }
  return chosen;
}
