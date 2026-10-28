import type { Citation } from './citation-library.ts';
import { citationDay, citationFromReference } from './citation-library.ts';
import type { SourceRef } from './refs.ts';
import type { FactCheck } from './fact-check.ts';
import type { Source } from './source.ts';
import { sourceVersion } from './source.ts';
import type { MemoryArticleOrigin, MemoryCitation, MemoryMaterial, MemoryMetadata } from './editorial-memory.ts';
import type { ArticleBody } from './article.ts';
import { extractQuotes } from './quotes.ts';
import { contentHash } from './text/hash.ts';

export type MemoryLegacyCandidate = { citation: Citation; factCheck: FactCheck | null; source: Source | null; article?: MemoryArticleOrigin };
export type MemoryArticlePosition = { productionId: string; kind: 'piece' | 'version'; id: string; offset: number; storageHash: string | null };
export function articleEvidenceId(citationId: string, productionId: string, ref: SourceRef): string { return `article-${contentHash({ citationId, productionId, ref })}`; }
export function articleCitations(body: ArticleBody, sources: Source[], origin: MemoryArticleOrigin): (MemoryLegacyCandidate | null | 'ambiguous')[] {
  return extractQuotes(body).map(quote => {
    const found = new Map<string, MemoryLegacyCandidate>();
    for (const ref of quote.sourceRefs) {
      if (ref.locator.type !== 'segment') continue;
      const source = sources.find(source => source.id === ref.sourceId);
      const citation = source && citationFromReference(source, ref, quote.text, origin.productionId, origin.at);
      if (source && citation) found.set(contentHash(citation.ref), { citation, source, factCheck: null, article: origin });
    }
    return found.size > 1 ? 'ambiguous' : found.values().next().value ?? null;
  });
}
export type MemoryLegacyState = 'imported' | 'updated' | 'unchanged' | 'conflict' | 'source_unavailable' | 'nonliteral' | 'id_conflict';
export type MemoryLegacyReport = { items: { id: string; state: MemoryLegacyState }[]; nextAfter: string | null; total: number };
export type MemoryArticleReport = { items: { productionId: string; articleKind: 'piece' | 'version'; articleId: string; id: string | null; legacyId: string | null;
  state: MemoryLegacyState | 'unmatched' | 'ambiguous' | 'invalid_metadata' | 'invalid_body' }[]; nextAfter: MemoryArticlePosition | null; totalArticles: number; scannedArticles: number };
function originalUrl(value: string | undefined): string | null {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2000 ? url.href : null; }
  catch { return null; }
}
/** Resolve legacy NFC/whitespace presentation to ONE exact original span, retaining UTF-16 offsets. */
function originalSpan(text: string, citation: string): { from: number; to: number } | null {
  const direct = text.indexOf(citation);
  if (direct >= 0) return { from: direct, to: direct + citation.length };
  const normal = (value: string) => value.normalize('NFD').replace(/\s+/gu, ' ').trim();
  const wanted = normal(citation), spans: { from: number; to: number }[] = []; let folded = '';
  for (const { segment, index } of new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)) {
    const value = /^\s+$/u.test(segment) ? ' ' : segment.normalize('NFD');
    if (value === ' ' && folded.endsWith(' ')) { spans[spans.length - 1].to = index + segment.length; continue; }
    folded += value;
    for (let offset = 0; offset < value.length; offset++) spans.push({ from: index, to: index + segment.length });
  }
  for (let at = folded.indexOf(wanted); at >= 0; at = folded.indexOf(wanted, at + 1)) {
    const span = { from: spans[at].from, to: spans[at + wanted.length - 1].to };
    if (normal(text.slice(span.from, span.to)) === wanted) return span;
  }
  return null;
}
/** A literal migration never normalizes legacy words or invents missing dates and authors. */
export function mapLegacyCitation(candidate: MemoryLegacyCandidate, workspaceId: string, actor: string, at: string):
  { material: MemoryMaterial; evidence: MemoryCitation } | 'source_unavailable' | 'nonliteral' {
  const { citation, source } = candidate;
  const version = source && sourceVersion(source, citation.ref.sourceVersion);
  if (!source || source.id !== citation.ref.sourceId || !version || version.hash !== citation.sourceHash || citation.ref.locator.type !== 'segment') return 'source_unavailable';
  const segmentId = citation.ref.locator.segmentId, segment = version.content.segments.find(segment => segment.id === segmentId);
  if (!segment || !citation.text.trim()) return 'nonliteral';
  const span = originalSpan(segment.text, citation.text);
  if (!span) return 'nonliteral';
  const text = segment.text.slice(span.from, span.to);
  const metadata: MemoryMetadata = { recordedOn: citation.recordedOn && citationDay(citation.recordedOn) ? citation.recordedOn
    : source.recordedOn && citationDay(source.recordedOn) ? source.recordedOn : null,
    publishedOn: source.research?.publishedOn && citationDay(source.research.publishedOn) ? source.research.publishedOn : null,
    institution: null, company: null, event: null, edition: null, topics: [], originalUrl: originalUrl(citation.podcastUrl) ?? originalUrl(source.sourceUrl) };
  const ref = { kind: 'source-version' as const, sourceId: source.id, sourceVersion: version.number, hash: version.hash };
  const material: MemoryMaterial = { id: `legacy-material-${contentHash({ production: citation.productionId, ref })}`, workspaceId, revision: 1,
    title: source.title, kind: source.research || source.kind === 'news' ? 'news' : 'transcript', source: ref,
    metadata: { ...metadata, recordedOn: source.recordedOn && citationDay(source.recordedOn) ? source.recordedOn : null, originalUrl: originalUrl(source.sourceUrl) },
    importedAt: at, importedBy: actor, primaryOrigin: originalUrl(source.sourceUrl) ?? `source:${source.id}`, originalFileId: null };
  const kinds = [...new Set(candidate.factCheck?.claims.map(claim => claim.kind) ?? [])];
  return { material, evidence: { id: candidate.article ? articleEvidenceId(citation.id, citation.productionId, citation.ref) : citation.id, workspaceId, materialId: material.id, revision: citation.revision,
    anchor: { source: ref, spans: [{ segmentId, ...span }], excerpt: text }, metadata,
    kinds: kinds.length ? kinds : ['declared'], status: 'active', createdAt: citation.createdAt, updatedAt: citation.updatedAt, supersedes: null,
    kind: 'citation', text, personId: citation.personId ?? null, authorConfirmed: citation.authorConfirmed, legacyCitationId: citation.id } };
}
