import type { MemoryAnchor, MemoryBlock, MemoryEvidence, MemoryMaterial } from './editorial-memory.ts';
import type { ClaimKind } from './fact-check.ts';
import type { CommandContext } from './result.ts';
import { contentHash } from './text/hash.ts';

export type MemoryCandidate = { excerpt: string; from: number | null; kinds: ClaimKind[] } & (
  | { kind: 'citation' }
  | { kind: 'statistic'; indicator: string; raw: string; unit: string; period: string | null; geography: string | null;
    population: string | null; qualifier: string | null; issuingInstitution: string | null }
);
/** Adjacent original text supplies context; every candidate belongs to exactly one starting block. */
export function memoryExtractionWindow(block: MemoryBlock, original: string): { from: number; text: string } {
  const span = block.anchor.spans[0]; let from = Math.max(0, span.from - 1000), to = Math.min(original.length, span.to + 1000);
  if (from && original.charCodeAt(from) >= 0xdc00 && original.charCodeAt(from) <= 0xdfff) from--;
  if (to < original.length && original.charCodeAt(to - 1) >= 0xd800 && original.charCodeAt(to - 1) <= 0xdbff) to++;
  return { from, text: original.slice(from, to) };
}
/** Refuse paraphrases, ambiguous repeated fragments and inferred statistic context atomically. */
export function materializeMemoryCandidates(candidates: MemoryCandidate[], block: MemoryBlock, material: MemoryMaterial, window: { from: number; text: string }, ctx: CommandContext): MemoryEvidence[] {
  const span = block.anchor.spans[0], found = new Map<string, MemoryEvidence>();
  for (const candidate of candidates) {
    const offset = candidate.from !== null && Number.isInteger(candidate.from) && candidate.from >= 0
      && window.text.slice(candidate.from, candidate.from + candidate.excerpt.length) === candidate.excerpt ? candidate.from : window.text.indexOf(candidate.excerpt);
    if (!candidate.excerpt.trim() || offset < 0 || (candidate.from === null || offset !== candidate.from)
      && window.text.indexOf(candidate.excerpt, offset + 1) >= 0) throw new Error('MEMORY_EXTRACTION_ANCHOR_INVALID');
    const from = window.from + offset, to = from + candidate.excerpt.length;
    if (from < span.from || from >= span.to) continue;
    const anchor: MemoryAnchor = { source: material.source, spans: [{ segmentId: 'original', from, to }], excerpt: candidate.excerpt };
    if (candidate.kind === 'statistic' && (!candidate.raw.trim() || !candidate.unit.trim() || !candidate.indicator.trim()
      || [candidate.raw, candidate.unit, candidate.period, candidate.geography, candidate.population, candidate.qualifier, candidate.issuingInstitution]
        .some(value => value !== null && !candidate.excerpt.includes(value)))) throw new Error('MEMORY_EXTRACTION_CONTEXT_INVALID');
    const id = `memory-${candidate.kind}-${contentHash({ materialId: material.id, anchor, ...(candidate.kind === 'statistic' ? { indicator: candidate.indicator, raw: candidate.raw, unit: candidate.unit } : {}) })}`;
    const base = { id, workspaceId: material.workspaceId, materialId: material.id, revision: 0, anchor, metadata: structuredClone(material.metadata),
      kinds: [...new Set(candidate.kinds)], status: 'active' as const, createdAt: ctx.now, updatedAt: ctx.now, supersedes: null };
    const evidence: MemoryEvidence = candidate.kind === 'citation'
      ? { ...base, kind: 'citation', text: candidate.excerpt, personId: null, authorConfirmed: false, legacyCitationId: null }
      : { ...base, kind: 'statistic', indicator: candidate.indicator, value: { raw: candidate.raw, decimal: null, lower: null, upper: null, scale: null }, unit: candidate.unit,
        period: candidate.period ? { label: candidate.period, from: null, to: null } : null, geography: candidate.geography, population: candidate.population,
        qualifier: candidate.qualifier, issuingInstitution: candidate.issuingInstitution, declaringPersonId: null };
    found.set(id, evidence);
  }
  return [...found.values()];
}
