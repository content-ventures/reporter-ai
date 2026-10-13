import type { CitationLibrary } from '../../ports/citation-library.ts';
import { reporterRequest } from './reporter-client.ts';
export function createHttpCitationLibrary(): CitationLibrary {
  return { get: () => reporterRequest('/citations'), save: (input,id,baseRevision = 0) => reporterRequest('/citations', { input,id,baseRevision }) };
}
