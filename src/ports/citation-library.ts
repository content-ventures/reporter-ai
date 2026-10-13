import type { CitationInput, CitationLibraryView, CitationView } from '../domain/citation-library.ts';
export interface CitationLibrary {
  get(): Promise<CitationLibraryView>;
  save(input: CitationInput, id?: string, baseRevision?: number): Promise<CitationView>;
}
