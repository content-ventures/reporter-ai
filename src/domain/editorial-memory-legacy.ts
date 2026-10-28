import type { Citation } from './citation-library.ts';
import { citationDay, podcastLink } from './citation-library.ts';
import type { FactCheck } from './fact-check.ts';
import type { Source } from './source.ts';
import { sourceVersion } from './source.ts';
import type { MemoryCitation, MemoryMaterial, MemoryMetadata } from './editorial-memory.ts';
import { contentHash } from './text/hash.ts';

export type MemoryLegacyCandidate = { citation: Citation; factCheck: FactCheck | null; source: Source | null };
export type MemoryLegacyState = 'imported' | 'updated' | 'unchanged' | 'conflict' | 'source_unavailable' | 'nonliteral' | 'id_conflict';
export type MemoryLegacyReport = { items: { id: string; state: MemoryLegacyState }[]; nextAfter: string | null; total: number };
/** A literal migration never normalizes legacy words or invents missing dates and authors. */
export function mapLegacyCitation(candidate: MemoryLegacyCandidate, workspaceId: string, actor: string, at: string):
  { material: MemoryMaterial; evidence: MemoryCitation } | 'source_unavailable' | 'nonliteral' {
  const { citation, source } = candidate;
  const version = source && sourceVersion(source, citation.ref.sourceVersion);
  if (!source || source.id !== citation.ref.sourceId || !version || version.hash !== citation.sourceHash || citation.ref.locator.type !== 'segment') return 'source_unavailable';
  const segmentId = citation.ref.locator.segmentId, segment = version.content.segments.find(segment => segment.id === segmentId);
  const from = segment?.text.indexOf(citation.text) ?? -1;
  if (!segment || !citation.text || from < 0) return 'nonliteral';
  const metadata: MemoryMetadata = { recordedOn: citation.recordedOn && citationDay(citation.recordedOn) ? citation.recordedOn
    : source.recordedOn && citationDay(source.recordedOn) ? source.recordedOn : null,
    publishedOn: source.research?.publishedOn && citationDay(source.research.publishedOn) ? source.research.publishedOn : null,
    institution: null, company: null, event: null, edition: null, topics: [], originalUrl: podcastLink(citation.podcastUrl ?? source.sourceUrl) ?? null };
  const ref = { kind: 'source-version' as const, sourceId: source.id, sourceVersion: version.number, hash: version.hash };
  const material: MemoryMaterial = { id: `legacy-material-${contentHash({ production: citation.productionId, ref })}`, workspaceId, revision: 1,
    title: source.title, kind: source.research || source.kind === 'news' ? 'news' : 'transcript', source: ref,
    metadata: { ...metadata, recordedOn: source.recordedOn && citationDay(source.recordedOn) ? source.recordedOn : null, originalUrl: podcastLink(source.sourceUrl) ?? null },
    importedAt: at, importedBy: actor, primaryOrigin: podcastLink(source.sourceUrl ?? citation.podcastUrl) ?? `source:${source.id}`, originalFileId: null };
  const kinds = [...new Set(candidate.factCheck?.claims.map(claim => claim.kind) ?? [])];
  return { material, evidence: { id: citation.id, workspaceId, materialId: material.id, revision: citation.revision,
    anchor: { source: ref, spans: [{ segmentId, from, to: from + citation.text.length }], excerpt: citation.text }, metadata,
    kinds: kinds.length ? kinds : ['declared'], status: 'active', createdAt: citation.createdAt, updatedAt: citation.updatedAt, supersedes: null,
    kind: 'citation', text: citation.text, personId: citation.personId ?? null, authorConfirmed: citation.authorConfirmed, legacyCitationId: citation.id } };
}
