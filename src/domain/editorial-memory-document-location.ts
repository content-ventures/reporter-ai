import { resolveMemoryAnchor, type MemoryAnchor, type MemoryMaterial } from './editorial-memory.ts';
import type { MemoryDocument, MemoryDocumentFormat } from './editorial-memory-document.ts';
import { sourceContentHash, sourceVersion, type Source } from './source.ts';

export type MemoryDocumentEvidenceLocation = {
  originalFileId: string;
  fileName: string;
  format: MemoryDocumentFormat;
  source: MemoryAnchor['source'];
  from: number;
  to: number;
  firstLine: number;
  lastLine: number;
  /** Records and columns are one-based; an empty column list means the excerpt only intersects delimiters. */
  records: { record: number; columns: number[] }[];
};

/** The caller must obtain the document through the authorized, checksum-verified original-file reader. */
export function locateMemoryDocumentEvidence(material: MemoryMaterial, source: Source, anchor: MemoryAnchor,
  originalFileId: string, document: MemoryDocument): MemoryDocumentEvidenceLocation | undefined {
  if (!material.originalFileId || material.originalFileId !== originalFileId || material.workspaceId !== source.workspaceId
    || material.source.sourceId !== source.id || anchor.spans.length !== 1 || anchor.spans[0].segmentId !== 'original') return undefined;
  const version = sourceVersion(source, anchor.source.sourceVersion);
  if (!version || sourceContentHash(version.content) !== version.hash || version.content.segments.length !== 1
    || version.content.segments[0].id !== 'original' || version.content.segments[0].text !== document.text
    || resolveMemoryAnchor(source, anchor) === undefined) return undefined;
  const { from, to } = anchor.spans[0];
  const splitsPair = (at: number) => at > 0 && at < document.text.length && document.text.charCodeAt(at - 1) >= 0xd800
    && document.text.charCodeAt(at - 1) <= 0xdbff && document.text.charCodeAt(at) >= 0xdc00 && document.text.charCodeAt(at) <= 0xdfff;
  if (splitsPair(from) || splitsPair(to)) return undefined;
  const lineAt = (offset: number) => {
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (document.text[i] === '\r') {
        if (document.text[i + 1] === '\n') { if (i + 1 >= offset) break; i++; }
        line++;
      } else if (document.text[i] === '\n') line++;
    }
    return line;
  };
  const records = document.locations.filter(row => row.from < to && row.to > from).map(row => ({ record: row.ordinal + 1,
    columns: row.cells?.flatMap((cell, index) => cell.from < to && cell.to > from ? [index + 1] : []) ?? [] }));
  if (!records.length) return undefined;
  return { originalFileId, fileName: document.fileName, format: document.format, source: anchor.source, from, to, firstLine: lineAt(from), lastLine: lineAt(to - 1), records };
}
