import type { CitationLibrary } from '../../ports/citation-library.ts';
import { reporterRequest } from './reporter-client.ts';
export function createHttpCitationLibrary(): CitationLibrary {
  return { get: () => reporterRequest('/citations'), save: (input,id,baseRevision = 0) => reporterRequest('/citations', { input,id,baseRevision }),
    // Two model calls and up to three web searches: longer than an ordinary request.
    check: (id,force = false) => reporterRequest(`/citations/${id}/check`, { force },AbortSignal.timeout(170000)),
    decide: (id,decision) => reporterRequest(`/citations/${id}/decision`, decision) };
}
