import type { MemoryQuery } from './editorial-memory.ts';
import type { Result } from './result.ts';
import { ok, refuse } from './result.ts';

export type MemoryTab = 'all' | 'citation' | 'statistic' | 'materials' | 'selections';
export type MemoryAddress = { tab: MemoryTab; query: MemoryQuery };
const tabs: readonly string[] = ['all', 'citation', 'statistic', 'materials', 'selections'];
const choices = {
  status: ['active', 'withdrawn', 'superseded', 'all'], materialKind: ['transcript', 'news', 'release', 'report', 'archive', 'market_data'],
  dateField: ['recorded', 'published', 'observation'], verdict: ['validated', 'disputed', 'not_validated', 'not_checkable', 'pending'],
  useStage: ['inserted', 'approved', 'published'], sort: ['newest', 'oldest', 'confidence', 'relevance', 'usage'],
} as const;
const lengths = { q: 200, personId: 160, institution: 240, company: 240, event: 240, edition: 160, materialId: 160, cursor: 4096 } as const;
const owned = ['bankView', 'kind', 'topic', 'minConfidence', 'unused', 'from', 'to', ...Object.keys(choices), ...Object.keys(lengths)];
const invalid = () => refuse('invalid_filters' as const, 'Os filtros do endereço não são válidos. Limpe os filtros para continuar.');
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** View-state validation is portable; the API remains authoritative for scopes and query rules. */
export function readMemoryAddress(params: URLSearchParams): Result<MemoryAddress, 'invalid_filters'> {
  for (const key of owned) if (key !== 'topic' && params.getAll(key).length > 1) return invalid();
  const kind = params.get('kind'), tab = params.get('bankView') ?? kind ?? 'all';
  if (!tabs.includes(tab) || kind && (!['citation', 'statistic'].includes(kind) || kind !== tab)) return invalid();
  const query: MemoryQuery = {};
  for (const [key, max] of Object.entries(lengths)) {
    const raw = params.get(key); if (raw === null) continue;
    const value = key === 'cursor' || key === 'q' ? raw : raw.trim();
    if (value.length > max || key !== 'q' && !value) return invalid();
    Object.assign(query, { [key === 'q' ? 'query' : key]: value });
  }
  for (const [key, allowed] of Object.entries(choices)) {
    const value = params.get(key); if (value === null) continue;
    if (!(allowed as readonly string[]).includes(value)) return invalid();
    Object.assign(query, { [key]: value });
  }
  const topics = params.getAll('topic').map(value => value.trim());
  if (topics.length > 20 || topics.some(topic => !topic || topic.length > 100)) return invalid();
  if (topics.length) query.topics = [...new Set(topics)].sort();
  const confidence = params.get('minConfidence');
  if (confidence !== null) {
    if (!/^\d+(?:\.\d+)?$/.test(confidence) || Number(confidence) > 100) return invalid();
    query.minConfidence = Number(confidence);
  }
  const unused = params.get('unused');
  if (unused !== null) { if (!['true', 'false'].includes(unused)) return invalid(); query.unused = unused === 'true'; }
  for (const key of ['from', 'to'] as const) {
    const value = params.get(key); if (value === null) continue;
    if (!validDay(value) || !query.dateField) return invalid(); query[key] = value;
  }
  if (query.from && query.to && query.from > query.to) return invalid();
  return ok({ tab: tab as MemoryTab, query });
}

/** Preserve the application's other context selectors, replacing only this library's state. */
export function memoryAddressParams(current: URLSearchParams, state: MemoryAddress): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const key of owned) params.delete(key);
  if (state.tab !== 'all') params.set('bankView', state.tab);
  for (const [key, value] of Object.entries(state.query)) {
    if (value === undefined || value === null || value === '' || key === 'limit' || key === 'kind'
      || key === 'status' && value === 'active' || key === 'useStage' && value === 'inserted' || key === 'sort' && value === 'newest') continue;
    if (key === 'topics') for (const topic of [...new Set(value as string[])].sort()) params.append('topic', topic);
    else params.set(key === 'query' ? 'q' : key, String(value));
  }
  return params;
}
