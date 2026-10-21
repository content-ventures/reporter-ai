import type { CitationInput, CitationLibraryView, CitationView } from '../domain/citation-library.ts';
import type { ClaimVerdict } from '../domain/fact-check.ts';
/** `checkedAt` names the check the claim index belongs to; a newer check refuses it. */
export type ClaimDecision = { claim: number; verdict: ClaimVerdict; reason: string; checkedAt: string };
export interface CitationLibrary {
  get(): Promise<CitationLibraryView>;
  /** One production's citations with their checks (the studio), without reading the whole library. */
  forProduction(productionId: string): Promise<CitationLibraryView>;
  save(input: CitationInput, id?: string, baseRevision?: number): Promise<CitationView>;
  /** Fact-checks the citation; one already checked comes back as is unless `force`. */
  check(id: string, force?: boolean): Promise<CitationView>;
  /** An editor's verdict on one claim of the last check. */
  decide(id: string, decision: ClaimDecision): Promise<CitationView>;
}
