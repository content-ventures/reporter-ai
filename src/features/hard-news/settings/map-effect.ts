import { TOPIC_WEIGHT_LABELS } from '../../../domain/hard-news.ts';
import type { EditorialMap, NewsItem, NewsPriority } from '../../../domain/hard-news.ts';
import { excludedBy, previewScore } from './map-preview.ts';

/**
 * What the editorial map does to the radar (F2.3), rule by rule: every story waiting on the desk
 * scored with the saved map and with the one on screen, so each rule shows its effect before it is
 * saved, and the version history says in words what changed.
 */

export function priorityFor(score: number): NewsPriority {
  return score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
}

/** A waiting story under the saved map and under the draft. */
export type MapRow = {
  item: NewsItem;
  before: number;
  after: number;
  /** "Fora do mapa": an exclusion or a blocked outlet takes it off the radar. */
  outBefore: boolean;
  outAfter: boolean;
  priorityBefore: NewsPriority;
  priorityAfter: NewsPriority;
};

function blockedBy(map: EditorialMap, item: NewsItem): boolean {
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return map.blocked.some((name) => fold(name) === fold(item.source));
}

/** The stories waiting for a decision, read with both maps (best score under the draft first). */
export function mapRows(news: readonly NewsItem[], saved: EditorialMap, draft: EditorialMap): MapRow[] {
  return news
    .filter((item) => item.status === 'new' && item.classification)
    .map((item) => {
      const before = item.classification?.score ?? 0;
      const after = previewScore(item, saved, draft) ?? before;
      // A person's correction in the radar wins over the score, on both sides.
      const corrected = item.classification?.correction?.priority;
      return {
        item,
        before,
        after,
        outBefore: excludedBy(saved, item).length > 0 || blockedBy(saved, item),
        outAfter: excludedBy(draft, item).length > 0 || blockedBy(draft, item),
        priorityBefore: corrected ?? priorityFor(before),
        priorityAfter: corrected ?? priorityFor(after),
      };
    })
    .sort((a, b) => b.after - a.after);
}

/** A row the draft changes: another priority, or in or out of the map. */
export function changed(row: MapRow): boolean {
  return row.priorityBefore !== row.priorityAfter || row.outBefore !== row.outAfter;
}

export type MapCounts = { high: number; medium: number; low: number; out: number };

/** The queue as the radar groups it: high, medium, low; off the map apart. */
export function mapCounts(rows: readonly MapRow[], side: 'before' | 'after'): MapCounts {
  const counts: MapCounts = { high: 0, medium: 0, low: 0, out: 0 };
  for (const row of rows) {
    if (side === 'before' ? row.outBefore : row.outAfter) counts.out += 1;
    else counts[side === 'before' ? row.priorityBefore : row.priorityAfter] += 1;
  }
  return counts;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What a rule does to the waiting stories: "3 na fila · 2 mudam de prioridade". */
export function ruleEffect(rows: readonly MapRow[]): { queued: number; moved: number; line: string } {
  const moved = rows.filter(changed).length;
  const line = [rows.length ? plural(rows.length, 'na fila', 'na fila') : 'Nada na fila', moved ? plural(moved, 'muda de prioridade', 'mudam de prioridade') : undefined]
    .filter(Boolean)
    .join(' · ');
  return { queued: rows.length, moved, line };
}

/** The waiting stories of a topic (by the AI's topic). */
export function topicRows(rows: readonly MapRow[], topic: string): MapRow[] {
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return rows.filter((row) => fold(row.item.classification?.topic ?? '') === fold(topic));
}

/** The waiting stories one exclusion takes off the map. */
export function exclusionRows(rows: readonly MapRow[], map: EditorialMap, term: string): MapRow[] {
  return rows.filter((row) => excludedBy({ ...map, exclusions: [term] }, row.item).length > 0);
}

/** The waiting stories of one outlet. */
export function sourceRows(rows: readonly MapRow[], name: string): MapRow[] {
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return rows.filter((row) => fold(row.item.source) === fold(name));
}

const added = (before: readonly string[], after: readonly string[]) => {
  const known = new Set(before.map((value) => value.trim().toLowerCase()));
  return after.filter((value) => value.trim() && !known.has(value.trim().toLowerCase()));
};

/** What a new version changes, in words, for the history ("Pesca: Cobre → Prioridade"). */
export function mapChanges(saved: EditorialMap, draft: EditorialMap): string[] {
  const changes: string[] = [];
  for (const topic of draft.topics) {
    const old = saved.topics.find((candidate) => candidate.id === topic.id);
    const sameLabel = old ?? saved.topics.find((candidate) => candidate.label.trim().toLowerCase() === topic.label.trim().toLowerCase());
    if (!old && sameLabel) {
      if (sameLabel.weight !== topic.weight) changes.push(`${topic.label}: ${TOPIC_WEIGHT_LABELS[sameLabel.weight]} → ${TOPIC_WEIGHT_LABELS[topic.weight]}`);
      continue;
    }
    if (!old) changes.push(`Novo tema: ${topic.label} (${TOPIC_WEIGHT_LABELS[topic.weight]})`);
    else if (old.weight !== topic.weight) changes.push(`${topic.label}: ${TOPIC_WEIGHT_LABELS[old.weight]} → ${TOPIC_WEIGHT_LABELS[topic.weight]}`);
  }
  for (const topic of saved.topics) {
    const kept = draft.topics.some((candidate) => candidate.id === topic.id || candidate.label.trim().toLowerCase() === topic.label.trim().toLowerCase());
    if (!kept) changes.push(`Tema removido: ${topic.label}`);
  }
  for (const term of added(saved.exclusions, draft.exclusions)) changes.push(`Fora do mapa: ${term}`);
  for (const term of added(draft.exclusions, saved.exclusions)) changes.push(`Volta ao mapa: ${term}`);
  for (const name of added(saved.trusted, draft.trusted)) changes.push(`Fonte confiável: ${name}`);
  for (const name of added(draft.trusted, saved.trusted)) changes.push(`Deixa de ser confiável: ${name}`);
  for (const name of added(saved.blocked, draft.blocked)) changes.push(`Fonte bloqueada: ${name}`);
  for (const name of added(draft.blocked, saved.blocked)) changes.push(`Fonte desbloqueada: ${name}`);
  if (saved.audience.trim() !== draft.audience.trim()) changes.push('Público revisto');
  if (added(saved.regions, draft.regions).length || added(draft.regions, saved.regions).length) changes.push('Regiões revistas');
  return changes;
}
