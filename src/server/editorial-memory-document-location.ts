import 'server-only';
import { locateMemoryDocumentEvidence } from '../domain/editorial-memory-document-location.ts';
import { readMemoryDocument } from '../domain/editorial-memory-document.ts';
import { memoryEvidenceRef, sameMemoryEvidence, type MemoryEvidenceRef } from '../domain/editorial-memory.ts';
import { memoryEvidenceRefSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { downloadMemoryOriginal, readMemoryOriginal } from './editorial-memory-original-files.ts';
import { memoryRead } from './editorial-memory-store.ts';
import { FlowError } from './errors.ts';

/** The location is derived only from a visible evidence revision and its verified original bytes. */
export async function readMemoryDocumentLocation(expected: MemoryEvidenceRef) {
  const proof = memoryEvidenceRefSchema.parse(expected);
  const read = () => memoryRead(async client => memoryBundle(client, proof.id, await memoryReadState(client)));
  const initial = await read();
  if (!sameMemoryEvidence(memoryEvidenceRef(initial.evidence), proof)) throw new FlowError('MEMORY_CONFLICT', 409);
  if (!initial.source || !initial.material.originalFileId) return null;
  const originalId = initial.material.originalFileId, file = await readMemoryOriginal(originalId);
  if (file.parserVersion !== 'memory-document-v1') return null;
  const response = await downloadMemoryOriginal(originalId), bytes = new Uint8Array(await response.arrayBuffer());
  const parsed = readMemoryDocument({ name: file.name, bytes, ...(file.delimiter ? { delimiter: file.delimiter } : {}) });
  if (!parsed.ok) throw new FlowError('MEMORY_ORIGINAL_INVALID', 422);
  if (parsed.value.format !== file.format || parsed.value.delimiter !== file.delimiter) return null;
  // Recheck current evidence, original identity and access after the potentially slow storage read.
  const current = await read();
  if (!sameMemoryEvidence(memoryEvidenceRef(current.evidence), proof) || current.material.originalFileId !== originalId)
    throw new FlowError('MEMORY_CONFLICT', 409);
  if (!current.source) return null;
  return locateMemoryDocumentEvidence(current.material, current.source, current.evidence.anchor, originalId, parsed.value) ?? null;
}
