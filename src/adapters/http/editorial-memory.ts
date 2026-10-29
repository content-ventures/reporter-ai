import type { MemoryLibrary } from '../../ports/editorial-memory.ts';
import { reporterResponse, ReporterHttpError, type ReporterTransport } from './reporter-client.ts';
import { committedCommand } from './committed-command.ts';

function parameters(input: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== null) {
    if (Array.isArray(value)) for (const item of value) params.append(key === 'topics' ? 'topic' : key, String(item));
    else params.set(key === 'query' ? 'q' : key, String(value));
  }
  const query = params.toString(); return query ? `?${query}` : '';
}
export function createHttpMemoryLibrary(http: ReporterTransport, afterWrite: () => Promise<void> = async () => {}): MemoryLibrary {
  const id = encodeURIComponent;
  const command = <T>(path: string, input: unknown, requestId: string): Promise<T> => committedCommand(async () => reporterResponse<T>(await http.fetch(`/memory/${path}`, {
    method: 'POST', cache: 'no-store', headers: { 'x-reporter-client': 'local', 'content-type': 'application/json', 'idempotency-key': requestId }, body: JSON.stringify(input),
  })), afterWrite).catch(async error => {
    if (error instanceof ReporterHttpError && error.code === 'MEMORY_CONFLICT') {
      try { await afterWrite(); } catch { /* Preserve the original conflict; normal polling can recover the projection. */ }
    }
    throw error;
  });
  return {
    query: input => http.request(`/memory${parameters(input)}`), detail: evidence => http.request(`/memory/${id(evidence)}`),
    history: (evidence, kind, input) => http.request(`/memory/${id(evidence)}/history/${kind}${parameters(input)}`),
    materials: input => http.request(`/memory/materials${parameters(input)}`), material: (material, revision) => http.request(`/memory/materials/${id(material)}${parameters({ revision })}`),
    reviseMaterial: (material, input, key) => command(`materials/${id(material)}/revision`, input, key),
    correctionImpact: (scope, input) => http.request(`/memory/${scope.kind === 'material' ? 'materials/' : ''}${id(scope.id)}/impact${parameters(input)}`),
    replace: (evidence, input, key) => command(`${id(evidence)}/replacement`, input, key),
    replacement: relation => http.request(`/memory/replacements/${id(relation)}`),
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
    selectedContext: (production, input) => http.request(`/memory/productions/${id(production)}/sources/${id(input.sourceId)}/context${parameters({ sourceVersion: input.sourceVersion, segmentId: input.segmentId })}`),
    policy: () => http.request('/memory/policy'), lookupLegacy: evidence => http.request(`/memory/legacy/${id(evidence)}`),
    calibrationCases: input => http.request(`/memory/policy/cases${parameters(input)}`), annotateCalibration: (input, key) => command('policy/cases', input, key),
    policyProposals: input => http.request(`/memory/policy/proposals${parameters(input)}`), policyProposal: proposal => http.request(`/memory/policy/proposals/${id(proposal)}`),
    proposePolicy: (input, key) => command('policy/proposals', input, key), restorePolicy: (input, key) => command('policy/restore', input, key),
    activatePolicy: (proposal, input, key) => command(`policy/proposals/${id(proposal)}/activate`, input, key), policyVersions: input => http.request(`/memory/policy/versions${parameters(input)}`),
    feedback: input => http.request(`/memory/feedback${parameters(input)}`), rateRelevance: (input, key) => command('feedback/relevance', input, key),
    relevanceContext: input => http.request(`/memory/feedback/relevance-context${parameters({ selectionId: input.selection.id, selectionRevision: input.selection.revision, evidenceId: input.evidence.id, evidenceRevision: input.evidence.revision, evidenceHash: input.evidence.hash })}`),
    originalArticle: (evidence, snapshot) => http.request(`/memory/${id(evidence)}/article${parameters({ snapshot })}`),
    reconcileLegacy: (input, key) => command('reconcile', input, key), reconcileArticles: (input, key) => command('reconcile/articles', input, key),
    resolveLegacy: (evidence, input, key) => command(`${id(evidence)}/legacy`, input, key), resolveDuplicate: (evidence, input, key) => command(`${id(evidence)}/duplicate`, input, key),
  };
}
