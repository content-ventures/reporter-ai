import type { EditorialMap, NewsClassification, NewsFeed, NewsItem } from '../../../domain/hard-news.ts';
import { sourceForNews } from '../../../domain/news-source-match.ts';

const STOP_WORDS = new Set(['com', 'para', 'sobre', 'entre', 'pela', 'pelo', 'das', 'dos', 'uma', 'que', 'como', 'setor']);

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function terms(value: string): string[] {
  return fold(value).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function mentions(text: string, phrase: string): boolean {
  const available = new Set(terms(text));
  const words = terms(phrase);
  return words.length > 0 && words.every((word) => available.has(word));
}

/** Explainable first-pass triage for connected news; the editor remains the final filter. */
export function classifyRadarItem(item: NewsItem, feeds: readonly NewsFeed[], map: EditorialMap): NewsItem {
  const text = `${item.title} ${item.excerpt}`;
  const reasons: NewsClassification['reasons'] = [];
  let score = 35;

  const topic = [...map.topics]
    .sort((a, b) => terms(b.label).length - terms(a.label).length)
    .find((candidate) => mentions(text, candidate.label));
  if (topic) {
    const points = { core: 38, regular: 24, occasional: 10 }[topic.weight];
    score += points;
    reasons.push({ criterion: 'Tema editorial', effect: 'up', detail: `${topic.label} · ${topic.weight === 'core' ? 'tema principal' : topic.weight === 'regular' ? 'tema coberto' : 'tema ocasional'}.` });
  } else {
    score -= 8;
    reasons.push({ criterion: 'Tema editorial', effect: 'down', detail: 'Não encontrei um tema do mapa no título ou no resumo.' });
  }

  const audienceTerms = terms(map.audience).filter((word) => word.length >= 5);
  const textTerms = new Set(terms(text));
  const audienceHits = audienceTerms.filter((word) => textTerms.has(word));
  if (audienceHits.length) {
    score += 10;
    reasons.push({ criterion: 'Público', effect: 'up', detail: 'O título ou resumo conversa com o público definido no mapa.' });
  }

  const rated = sourceForNews(item, feeds)?.rating;
  if (rated) {
    const tierPoints = { A1: 18, A2: 13, B: 7, C: -3 }[rated.tier];
    const relevancePoints = { high: 8, medium: 4, low: -5 }[rated.relevance];
    score += tierPoints + relevancePoints;
    reasons.push({ criterion: 'Veículo', effect: tierPoints + relevancePoints >= 0 ? 'up' : 'down', detail: `${rated.tier} · relevância ${rated.relevance}, conforme avaliação editorial.` });
  }

  const trusted = map.trusted.some((source) => fold(source) === fold(item.source));
  const blocked = map.blocked.some((source) => fold(source) === fold(item.source));
  const exclusion = map.exclusions.find((term) => mentions(text, term));
  if (trusted) {
    score += 8;
    reasons.push({ criterion: 'Fonte confiável', effect: 'up', detail: 'O veículo está marcado como confiável no mapa.' });
  }
  if (blocked) {
    score -= 60;
    reasons.push({ criterion: 'Fonte bloqueada', effect: 'down', detail: 'O mapa editorial não cobre este veículo.' });
  }
  if (exclusion) {
    score -= 55;
    reasons.push({ criterion: 'Exclusão', effect: 'down', detail: `O assunto corresponde à exclusão “${exclusion}”.` });
  }

  if (item.duplicates.length) {
    score -= 12;
    reasons.push({ criterion: 'Novidade', effect: 'down', detail: `A mesma pauta apareceu em ${item.duplicates.length + 1} veículos.` });
  } else {
    score += 5;
    reasons.push({ criterion: 'Novidade', effect: 'up', detail: 'Ainda não há outro veículo cobrindo esta pauta no radar.' });
  }

  const age = Date.now() - Date.parse(item.publishedAt);
  if (age > 7 * 86_400_000) {
    score -= 25;
    reasons.push({ criterion: 'Atualidade', effect: 'down', detail: 'A publicação tem mais de sete dias.' });
  } else if (age > 72 * 3_600_000) {
    score -= 12;
    reasons.push({ criterion: 'Atualidade', effect: 'down', detail: 'A publicação tem mais de três dias.' });
  }

  score = exclusion || blocked ? 0 : Math.max(0, Math.min(100, Math.round(score)));
  const classification: NewsClassification = {
    score,
    topic: topic?.label ?? 'Sem tema identificado',
    summary: exclusion ? `Fora do mapa: ${exclusion}.` : blocked ? 'Fonte bloqueada pelo mapa editorial.' : topic ? `${topic.label} · score inicial para revisão do editor.` : 'Pauta sem correspondência clara no mapa; confira antes de descartar.',
    reasons,
    mapVersion: map.version,
  };
  return { ...item, classification };
}
