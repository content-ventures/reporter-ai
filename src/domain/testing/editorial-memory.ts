import type { CommandContext } from '../result.ts';
import { createMemoryMaterial, memoryBlocks } from '../editorial-memory-import.ts';
import { materializeMemoryCandidates, type MemoryCandidate } from '../editorial-memory-extraction.ts';
import { prepareMemoryWriting, type MemoryWritingItem } from '../editorial-memory-writing.ts';
import { initialMemoryPolicy, memoryEligibility, memoryEvidenceRef, reviewMemoryEvidence, type MemorySelection } from '../editorial-memory.ts';

/** Synthetic accepted evidence built through the actual import, review and selection contracts. */
export function memoryWritingFixture(kind: 'citation' | 'statistic', text: string, ctx: CommandContext, workspace = 'workspace') {
  const policy = initialMemoryPolicy(workspace);
  const original = 'PRIVATE HEADER. ' + text + ' PRIVATE FOOTER.';
  const { material, source } = createMemoryMaterial({ title: kind, kind: 'report', text: original, authorized: true,
    primaryOrigin: kind, originalFileId: null, metadata: { publishedOn: null, recordedOn: null, institution: null,
      company: null, event: null, edition: null, topics: [], originalUrl: null } }, workspace, ctx);
  const common = { excerpt: text, from: original.indexOf(text) };
  const candidate: MemoryCandidate = kind === 'citation' ? { ...common, kind, kinds: ['opinion'] } : { ...common, kind, kinds: ['declared'],
    indicator: 'Pessoas', raw: '240', unit: 'pessoas', period: '2025', geography: null, population: null, qualifier: text.includes('cerca de') ? 'cerca de' : 'Cerca de', issuingInstitution: null };
  const evidence = materializeMemoryCandidates([candidate], memoryBlocks(material, 'job', original)[0], material, { from: 0, text: original }, ctx)[0];
  if (evidence.kind === 'citation') { evidence.personId = 'author'; evidence.authorConfirmed = true; }
  const decision = reviewMemoryEvidence({ evidence: memoryEvidenceRef(evidence), check: null, policyRevision: 1,
    previousSequence: 0, action: 'accept', reason: 'Synthetic technical review', supports: [] }, evidence, source, policy, null, null,
    { personId: 'actor', workspaceId: workspace, roles: ['editor'] }, ctx);
  if (!decision.ok) throw new Error(decision.refusal.message);
  const item: MemoryWritingItem = { policy, ...(kind === 'citation' ? { author: { id: 'author', name: 'Pessoa Fictícia', title: 'Porta-voz', organization: 'Organização sintética' } } : {}),
    view: { evidence, material: { id: material.id, title: material.title, kind: material.kind, primaryOrigin: material.primaryOrigin },
      check: null, decision: decision.value, eligibility: memoryEligibility(evidence, source, policy, null, decision.value),
      relevance: null, uses: { selected: 0, inserted: 0, approved: 0, published: 0 } } };
  const selection: MemorySelection = { id: ctx.newId('selection'), workspaceId: workspace, revision: 1, productionId: null,
    items: [{ evidence: memoryEvidenceRef(evidence), check: null, decisionId: decision.value.id, policyRevision: 1 }],
    createdBy: 'actor', updatedBy: 'actor', createdAt: ctx.now, updatedAt: ctx.now };
  const prepared = prepareMemoryWriting(selection, [item], 'Pauta sintética', ctx);
  if (!prepared.ok) throw new Error(prepared.refusal.message);
  return { source: prepared.value.source, item, selection };
}
