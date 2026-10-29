import type { MemoryDocument, MemoryDocumentCell } from './editorial-memory-document.ts';
import type { SourceVersionRef } from './refs.ts';
import { ok, refuse, type Result } from './result.ts';

/** Each mapped value remains tied to a cell in the immutable original, including its raw CSV encoding. */
export type MemoryMarketColumn = { record: 'header' | 'row'; column: number };
export type MemoryMarketField = 'institution' | 'indicator' | 'value' | 'unit' | 'period' | 'geography' | 'population' | 'qualifier';
export type MemoryMarketMapping = Record<'institution' | 'indicator' | 'value' | 'unit' | 'period', MemoryMarketColumn>
  & Partial<Record<'geography' | 'population' | 'qualifier', MemoryMarketColumn>>;
export type MemoryMarketCell = { record: number; column: number; from: number; to: number; value: string; original: string };
export type MemoryMarketRow = { record: number; from: number; to: number; excerpt: string;
  fields: Partial<Record<MemoryMarketField, MemoryMarketCell>>; missing: MemoryMarketField[] };
export type MemoryMarketPlan = { materialId: string; revision: number; source: SourceVersionRef; originalFileId: string;
  checksum: string; mapping: MemoryMarketMapping; updatedBy: string; updatedAt: string };
export type MemoryMarketPreview = { materialRevision: number; source: SourceVersionRef; originalFileId: string; checksum: string;
  headers: string[]; preview: { rows: MemoryMarketRow[]; next: number | null; total: number } | null; mapping: MemoryMarketPlan | null };
export type MemoryMarketImportReport = { rows: ({ record: number; status: 'created' | 'existing' | 'conflict'; id: string }
  | { record: number; status: 'refused'; reason: 'missing' | 'nonliteral' | 'too_long'; fields: MemoryMarketField[] })[]; next: number | null; total: number };

const required = ['institution', 'indicator', 'value', 'unit', 'period'] as const;
const fields: readonly MemoryMarketField[] = [...required, 'geography', 'population', 'qualifier'];

/** Preview only: no inferred numbers, dates, facts, or editorial decisions. Call with a verified original. */
export function mapMemoryMarketRows(document: MemoryDocument, mapping: MemoryMarketMapping, start = 1, limit = 50):
  Result<{ rows: MemoryMarketRow[]; next: number | null; total: number }, 'invalid_market_mapping'> {
  const invalid = (message: string) => refuse('invalid_market_mapping' as const, message);
  if (!['csv', 'tsv'].includes(document.format) || !document.locations[0]?.cells || document.locations.length < 2)
    return invalid('Escolha uma tabela CSV ou TSV com cabeçalho e pelo menos um registro.');
  if (!Number.isInteger(start) || start < 1 || start > document.locations.length || !Number.isInteger(limit) || limit < 1 || limit > 100)
    return invalid('Confira a página da tabela.');
  if (Object.keys(mapping).some(key => !fields.includes(key as MemoryMarketField))) return invalid('Confira os campos do mapeamento.');
  const columns = document.locations[0].cells.length;
  for (const name of fields) {
    const spec = mapping[name];
    if (!spec && required.includes(name as typeof required[number])) return invalid('Selecione uma coluna para cada campo obrigatório.');
    if (spec && (!['header', 'row'].includes(spec.record) || !Number.isInteger(spec.column) || spec.column < 0 || spec.column >= columns))
      return invalid('Confira as colunas selecionadas.');
  }
  const cell = (record: number, column: number): MemoryMarketCell => {
    const item: MemoryDocumentCell = document.locations[record].cells![column];
    return { record: record + 1, column: column + 1, from: item.from, to: item.to, value: item.value, original: document.text.slice(item.from, item.to) };
  };
  const end = Math.min(document.locations.length, start + limit), rows: MemoryMarketRow[] = [];
  for (let index = start; index < end; index++) {
    const location = document.locations[index], selected: MemoryMarketRow['fields'] = {};
    for (const name of fields) { const spec = mapping[name]; if (spec) selected[name] = cell(spec.record === 'header' ? 0 : index, spec.column); }
    rows.push({ record: index + 1, from: location.from, to: location.to, excerpt: document.text.slice(location.from, location.to),
      fields: selected, missing: required.filter(name => !selected[name]?.value.trim()) });
  }
  return ok({ rows, next: end < document.locations.length ? end : null, total: document.locations.length - 1 });
}
