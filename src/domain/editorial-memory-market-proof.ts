import type { MemoryAnchor, MemoryStatistic } from './editorial-memory.ts';
import type { MemoryMarketField } from './editorial-memory-market.ts';
import { resolveMemoryAnchor } from './editorial-memory.ts';
import { readMemoryDocument } from './editorial-memory-document.ts';
import { mapMemoryMarketRows } from './editorial-memory-market.ts';
import { sourceContentHash, sourceVersion, type Source } from './source.ts';
import { stableStringify } from './text/hash.ts';

/** Reconstruct the original mapped cells without joining separate passages into a quote. */
export function verifyMemoryMarketProof(evidence: MemoryStatistic, source: Source, originalFileId: string): boolean {
  const proof = evidence.market;
  if (!proof?.fileName || !proof.delimiter || !proof.mapping || proof.originalFileId !== originalFileId
    || !/^[a-f0-9]{64}$/.test(proof.checksum) || !Number.isInteger(proof.mappingRevision) || proof.mappingRevision < 1
    || !Number.isInteger(proof.record) || proof.record < 2 || source.workspaceId !== evidence.workspaceId
    || resolveMemoryAnchor(source, evidence.anchor) === undefined) return false;
  const version = sourceVersion(source, evidence.anchor.source.sourceVersion);
  if (!version || sourceContentHash(version.content) !== version.hash || version.hash !== evidence.anchor.source.hash
    || version.content.segments.length !== 1 || version.content.segments[0].id !== 'original') return false;
  const parsed = readMemoryDocument({ name: proof.fileName, bytes: new TextEncoder().encode(version.content.segments[0].text), delimiter: proof.delimiter });
  if (!parsed.ok) return false;
  const mapped = mapMemoryMarketRows(parsed.value, proof.mapping, proof.record - 1, 1);
  if (!mapped.ok || mapped.value.rows.length !== 1) return false;
  const row = mapped.value.rows[0], span = evidence.anchor.spans[0];
  return evidence.anchor.spans.length === 1 && span.segmentId === 'original' && span.from === row.from && span.to === row.to
    && evidence.anchor.excerpt === row.excerpt && stableStringify(proof.fields) === stableStringify(row.fields);
}

/** Independent cell anchors preserve the distinction between the header and the observation. */
export function memoryMarketContext(evidence: MemoryStatistic, source: Source, originalFileId: string):
  { field: MemoryMarketField; value: string; record: number; column: number; anchor: MemoryAnchor }[] | undefined {
  if (!verifyMemoryMarketProof(evidence, source, originalFileId)) return undefined;
  return (Object.entries(evidence.market!.fields) as [MemoryMarketField, NonNullable<NonNullable<MemoryStatistic['market']>['fields'][MemoryMarketField]>][])
    .flatMap(([field, cell]) => {
      if (cell.record !== 1 || !cell.value.trim()) return [];
      const anchor: MemoryAnchor = { source: evidence.anchor.source, spans: [{ segmentId: 'original', from: cell.from, to: cell.to }], excerpt: cell.original };
      return resolveMemoryAnchor(source, anchor) === cell.original ? [{ field, value: cell.value, record: cell.record, column: cell.column, anchor }] : [];
    });
}
