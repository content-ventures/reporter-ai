import { memoryEvidenceRef, type MemoryDiscovery, type MemoryEvidence, type MemoryEvidenceChoice, type MemoryEvidenceRef, type MemoryQuery, type MemorySelection } from './editorial-memory.ts';

/** Capture the displayed search when an item is chosen, before later query/navigation changes. */
export function captureMemoryChoice(evidence: MemoryEvidence, input: MemoryQuery, snapshot: string): MemoryEvidenceChoice {
  const query = Object.fromEntries(Object.entries(input).filter(([key, value]) => key !== 'cursor' && key !== 'limit' && value !== undefined)) as MemoryDiscovery['query'];
  const ref = memoryEvidenceRef(evidence);
  return { ...ref, discovery: { evidence: { ...ref }, snapshot, query: structuredClone({ status: 'active', useStage: 'inserted', sort: 'newest', ...query,
    ...(query.topics ? { topics: [...new Set(query.topics)].sort() } : {}) }) } };
}
export function memoryChoiceFromItem(item: MemorySelection['items'][number]): MemoryEvidenceChoice {
  return { ...item.evidence, ...(item.discovery ? { discovery: structuredClone(item.discovery) } : {}) };
}
/** A later correction keeps its original discovery revision; it does not claim a fresh search. */
export function updateMemoryChoice(choice: MemoryEvidenceChoice, evidence: MemoryEvidenceRef): MemoryEvidenceChoice {
  return { id: evidence.id, revision: evidence.revision, hash: evidence.hash, ...(choice.id === evidence.id && choice.discovery ? { discovery: structuredClone(choice.discovery) } : {}) };
}
