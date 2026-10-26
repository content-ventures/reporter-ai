import type { CitationLibrary } from '../../ports/citation-library.ts';
import { defaultReporterTransport, type ReporterTransport } from './reporter-client.ts';
export function createHttpCitationLibrary(http: ReporterTransport = defaultReporterTransport): CitationLibrary {
  return { get: () => http.request('/citations'),
    forProduction: productionId => http.request(`/citations?production=${encodeURIComponent(productionId)}`), save: (input,id,baseRevision = 0) => http.request('/citations', { input,id,baseRevision }),
    // Two model calls and up to three web searches: longer than an ordinary request.
    check: (id,force = false) => http.request(`/citations/${id}/check`, { force },AbortSignal.timeout(170000)),
    decide: (id,decision) => http.request(`/citations/${id}/decision`, decision) };
}
