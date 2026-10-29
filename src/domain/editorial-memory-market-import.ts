import type { MemoryBlock, MemoryMaterial, MemoryStatistic } from './editorial-memory.ts';
import type { MemoryDocument } from './editorial-memory-document.ts';
import { materializeMemoryCandidates } from './editorial-memory-extraction.ts';
import { mapMemoryMarketRows, type MemoryMarketField, type MemoryMarketPlan } from './editorial-memory-market.ts';
import type { Source } from './source.ts';
import { sourceContentHash, sourceVersion } from './source.ts';
import type { CommandContext, Result } from './result.ts';
import { ok, refuse } from './result.ts';

export type MemoryMarketPrepared = { record: number } & ({ status: 'ready'; evidence: MemoryStatistic }
  | { status: 'refused'; reason: 'missing' | 'nonliteral' | 'too_long'; fields: MemoryMarketField[] });

/** Create only literal row evidence; report rows requiring separate header/cell proofs for later review. */
export function prepareMemoryMarketRows(material: MemoryMaterial, source: Source, document: MemoryDocument, plan: MemoryMarketPlan,
  start: number, ctx: CommandContext): Result<{ rows: MemoryMarketPrepared[]; next: number | null; total: number }, 'invalid_market_mapping' | 'source_changed'> {
  const sourceRef = material.source, version = sourceVersion(source, sourceRef.sourceVersion);
  if (material.kind !== 'market_data' || material.workspaceId !== source.workspaceId || material.id !== plan.materialId
    || material.originalFileId !== plan.originalFileId || source.id !== sourceRef.sourceId || plan.source.sourceId !== sourceRef.sourceId
    || plan.source.sourceVersion !== sourceRef.sourceVersion || plan.source.hash !== sourceRef.hash
    || !source.rights.authorized || !version || version.hash !== sourceRef.hash || sourceContentHash(version.content) !== version.hash
    || version.content.segments.length !== 1 || version.content.segments[0].id !== 'original' || version.content.segments[0].text !== document.text)
    return refuse('source_changed', 'A versão autorizada do original mudou. Atualize o mapeamento.');
  const mapped = mapMemoryMarketRows(document, plan.mapping, start);
  if (!mapped.ok) return mapped;
  const output: MemoryMarketPrepared[] = [];
  for (const row of mapped.value.rows) {
    if (row.missing.length) { output.push({ record: row.record, status: 'refused', reason: 'missing', fields: row.missing }); continue; }
    const entries = Object.entries(row.fields) as [MemoryMarketField, NonNullable<typeof row.fields[MemoryMarketField]>][];
    const nonliteral = entries.filter(([, cell]) => cell.value && !row.excerpt.includes(cell.value)).map(([field]) => field);
    if (nonliteral.length) { output.push({ record: row.record, status: 'refused', reason: 'nonliteral', fields: nonliteral }); continue; }
    const values = row.fields;
    if (row.excerpt.length > 2000 || values.indicator!.value.length > 240 || values.value!.value.length > 240
      || values.unit!.value.length > 100 || entries.some(([, cell]) => cell.value.length > 500)) {
      output.push({ record: row.record, status: 'refused', reason: 'too_long', fields: [] }); continue;
    }
    const anchor = { source: sourceRef, spans: [{ segmentId: 'original', from: row.from, to: row.to }], excerpt: row.excerpt };
    const block: MemoryBlock = { id: 'market-preview', workspaceId: material.workspaceId, materialId: material.id, jobId: 'market-preview', ordinal: row.record - 1,
      anchor, status: 'pending', attempts: 0, error: null, evidenceIds: [] };
    const [evidence] = materializeMemoryCandidates([{ kind: 'statistic', excerpt: row.excerpt, from: 0, kinds: ['declared'],
      indicator: values.indicator!.value, raw: values.value!.value, unit: values.unit!.value, period: values.period!.value,
      geography: values.geography?.value || null, population: values.population?.value || null, qualifier: values.qualifier?.value || null,
      issuingInstitution: values.institution!.value }], block, material, { from: row.from, text: row.excerpt }, ctx);
    if (!evidence || evidence.kind !== 'statistic') throw new Error('MEMORY_MARKET_EVIDENCE_INVALID');
    output.push({ record: row.record, status: 'ready', evidence: { ...evidence, market: { originalFileId: plan.originalFileId,
      checksum: plan.checksum, mappingRevision: plan.revision, record: row.record, fileName: document.fileName,
      delimiter: document.delimiter!, mapping: structuredClone(plan.mapping), fields: structuredClone(row.fields) } } });
  }
  return ok({ rows: output, next: mapped.value.next, total: mapped.value.total });
}
