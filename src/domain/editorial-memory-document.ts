import { MAX_TEXT_BYTES } from './reporter.ts';
import { ok, refuse, type Result } from './result.ts';

export type MemoryDocumentFormat = 'text' | 'markdown' | 'srt' | 'vtt' | 'csv' | 'tsv';
export type MemoryDocumentDelimiter = ',' | ';' | '\t';
/** Positions always address the unchanged UTF-16 source, including quoting and line endings. */
export type MemoryDocumentCell = { from: number; to: number; value: string };
export type MemoryDocumentLocation = {
  ordinal: number; from: number; to: number; firstLine: number; lastLine: number;
  cells?: MemoryDocumentCell[];
};
export type MemoryDocument = {
  format: MemoryDocumentFormat; fileName: string; bytes: number; text: string;
  delimiter: MemoryDocumentDelimiter | null; locations: MemoryDocumentLocation[];
};
export type MemoryDocumentRefusal = 'unsupported_type' | 'too_large' | 'empty' | 'invalid_encoding' | 'invalid_document' | 'document_limit';
export const MEMORY_DOCUMENT_MAX_RECORDS = 10_000;
export const MEMORY_DOCUMENT_MAX_COLUMNS = 128;
const formats: Record<string, MemoryDocumentFormat> = { txt: 'text', md: 'markdown', srt: 'srt', vtt: 'vtt', csv: 'csv', tsv: 'tsv' };

/** Decode bounded originals; filenames/dates/attribution never supply factual metadata. */
export function readMemoryDocument(input: { name: string; bytes: Uint8Array; delimiter?: MemoryDocumentDelimiter }): Result<MemoryDocument, MemoryDocumentRefusal> {
  if (!input.name || input.name.length > 255 || /[\\/\x00-\x1f\x7f-\x9f]/.test(input.name)) return refuse('invalid_document', 'Use um nome de arquivo válido, sem caminho.');
  const extension = input.name.split('.').at(-1)?.toLowerCase() ?? '';
  const format = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  if (!format || !input.name.includes('.')) return refuse('unsupported_type', 'Escolha um arquivo TXT, MD, SRT, VTT, CSV ou TSV.');
  if (input.bytes.byteLength > MAX_TEXT_BYTES) return refuse('too_large', 'Divida o documento em arquivos de até 1 MiB.');
  if (!input.bytes.byteLength) return refuse('empty', 'O arquivo está vazio.');
  let text: string;
  // ignoreBOM preserves it in the original instead of silently changing its bytes/text.
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.bytes); }
  catch { return refuse('invalid_encoding', 'Salve o arquivo em UTF-8 e tente novamente.'); }
  if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return refuse('invalid_document', 'O arquivo contém dados binários ou caracteres de controle inválidos.');
  if (!text.trim()) return refuse('empty', 'O arquivo não contém texto.');
  const tabular = format === 'csv' || format === 'tsv';
  if (input.delimiter !== undefined && (!tabular || ![',', ';', '\t'].includes(input.delimiter) || format === 'tsv' && input.delimiter !== '\t'))
    return refuse('invalid_document', 'Confira o separador do arquivo.');
  const delimiter = tabular ? format === 'tsv' ? '\t' : input.delimiter ?? ',' : null;
  const parsed = delimiter ? readDelimited(text, delimiter) : readLines(text);
  return parsed.ok ? ok({ format, fileName: input.name, bytes: input.bytes.byteLength, text, delimiter, locations: parsed.value }) : parsed;
}

function readLines(text: string): Result<MemoryDocumentLocation[], MemoryDocumentRefusal> {
  const locations: MemoryDocumentLocation[] = [];
  let from = 0, line = 1;
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '\n' && text[at] !== '\r') continue;
    if (text[at] === '\r' && text[at + 1] === '\n') at++;
    locations.push({ ordinal: locations.length, from, to: at + 1, firstLine: line, lastLine: line });
    from = at + 1; line++;
    if (locations.length > MEMORY_DOCUMENT_MAX_RECORDS) return refuse('document_limit', 'Divida o documento em arquivos com até 10.000 linhas.');
  }
  if (from < text.length) locations.push({ ordinal: locations.length, from, to: text.length, firstLine: line, lastLine: line });
  return locations.length > MEMORY_DOCUMENT_MAX_RECORDS ? refuse('document_limit', 'Divida o documento em arquivos com até 10.000 linhas.') : ok(locations);
}

/** RFC 4180 quoting with explicit comma/semicolon/tab dialects; no header or numeric coercion. */
function readDelimited(text: string, delimiter: MemoryDocumentDelimiter): Result<MemoryDocumentLocation[], MemoryDocumentRefusal> {
  const rows: MemoryDocumentLocation[] = [];
  let at = text.startsWith('\ufeff') ? 1 : 0, rowFrom = 0, firstLine = 1, line = 1;
  let cells: MemoryDocumentCell[] = [], columns: number | undefined;
  const invalid = () => refuse('invalid_document', `Confira as aspas e as colunas do CSV/TSV na linha ${line}.`, { line });
  while (at < text.length) {
    const from = at;
    let value = '';
    if (text[at] === '"') {
      at++; let closed = false;
      while (at < text.length) {
        if (text[at] === '"') {
          if (text[at + 1] === '"') { value += '"'; at += 2; continue; }
          at++; closed = true; break;
        }
        if (text[at] === '\r') { line++; if (text[at + 1] === '\n') { value += '\r\n'; at += 2; continue; } }
        else if (text[at] === '\n') line++;
        value += text[at++];
      }
      if (!closed || at < text.length && ![delimiter, '\r', '\n'].includes(text[at])) return invalid();
    } else {
      while (at < text.length && ![delimiter, '\r', '\n'].includes(text[at])) {
        if (text[at] === '"') return invalid();
        value += text[at++];
      }
    }
    cells.push({ from, to: at, value });
    if (cells.length > MEMORY_DOCUMENT_MAX_COLUMNS) return refuse('document_limit', 'Divida a tabela em arquivos com até 128 colunas.');
    if (text[at] === delimiter) {
      at++;
      if (at < text.length) continue;
      cells.push({ from: at, to: at, value: '' });
      if (cells.length > MEMORY_DOCUMENT_MAX_COLUMNS) return refuse('document_limit', 'Divida a tabela em arquivos com até 128 colunas.');
    }
    if (columns !== undefined && cells.length !== columns) return invalid();
    columns ??= cells.length;
    const lastLine = line;
    if (text[at] === '\r') { at++; if (text[at] === '\n') at++; line++; }
    else if (text[at] === '\n') { at++; line++; }
    rows.push({ ordinal: rows.length, from: rowFrom, to: at, firstLine, lastLine, cells });
    if (rows.length > MEMORY_DOCUMENT_MAX_RECORDS) return refuse('document_limit', 'Divida a tabela em arquivos com até 10.000 registros.');
    cells = []; rowFrom = at; firstLine = line;
  }
  return ok(rows);
}
