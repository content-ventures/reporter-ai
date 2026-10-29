import type { MemoryLibrary } from '../../ports/editorial-memory.ts';
import { reporterResponse, type ReporterTransport } from './reporter-client.ts';

function parameters(input: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== null) {
    if (Array.isArray(value)) for (const item of value) params.append(key === 'topics' ? 'topic' : key, String(item));
    else params.set(key === 'query' ? 'q' : key, String(value));
  }
  const query = params.toString(); return query ? `?${query}` : '';
}
export function createHttpMemoryLibrary(http: ReporterTransport): MemoryLibrary {
  const id = encodeURIComponent;
  const command = async <T>(path: string, input: unknown, requestId: string): Promise<T> => reporterResponse<T>(await http.fetch(`/memory/${path}`, {
    method: 'POST', cache: 'no-store', headers: { 'x-reporter-client': 'local', 'content-type': 'application/json', 'idempotency-key': requestId }, body: JSON.stringify(input),
  }));
  return {
    query: input => http.request(`/memory${parameters(input)}`), detail: evidence => http.request(`/memory/${id(evidence)}`),
    history: (evidence, kind, input) => http.request(`/memory/${id(evidence)}/history/${kind}${parameters(input)}`),
    materials: input => http.request(`/memory/materials${parameters(input)}`), material: material => http.request(`/memory/materials/${id(material)}`),
    import: (input, key) => command('materials', input, key), job: job => http.request(`/memory/jobs/${id(job)}`),
    blocks: (job, input) => http.request(`/memory/jobs/${id(job)}/blocks${parameters(input)}`),
    authorizeMaterial: (material, input, key) => command(`materials/${id(material)}/authorization`, input, key),
    retry: (job, key) => command(`jobs/${id(job)}/retry`, {}, key), cancel: (job, baseRevision, key) => command(`jobs/${id(job)}/cancel`, { baseRevision }, key),
    check: (evidence, expected, key) => command(`${id(evidence)}/check`, { expected }, key),
    review: (evidence, input, key) => command(`${id(evidence)}/review`, input, key), correct: (evidence, input, key) => command(`${id(evidence)}/correction`, input, key),
    select: (input, key) => command('selections', input, key), selection: selection => http.request(`/memory/selections/${id(selection)}`),
    selections: input => http.request(`/memory/selections${parameters(input)}`),
    writeSelection: (selection, input, key) => command(`selections/${id(selection)}/write`, input, key),
    refreshSource: (source, input, key) => command(`sources/${id(source)}/refresh`, input, key),
    writingStatus: production => http.request(`/memory/productions/${id(production)}/writing-status`),
    policy: () => http.request('/memory/policy'), lookupLegacy: evidence => http.request(`/memory/legacy/${id(evidence)}`),
    originalArticle: (evidence, snapshot) => http.request(`/memory/${id(evidence)}/article${parameters({ snapshot })}`),
    reconcileLegacy: (input, key) => command('reconcile', input, key), reconcileArticles: (input, key) => command('reconcile/articles', input, key),
    resolveLegacy: (evidence, input, key) => command(`${id(evidence)}/legacy`, input, key), resolveDuplicate: (evidence, input, key) => command(`${id(evidence)}/duplicate`, input, key),
  };
}
