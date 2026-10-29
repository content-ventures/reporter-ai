import type { FactClaim, ClaimVerdict } from './fact-check.ts';
import { checkable } from './fact-check.ts';
import type { MemoryCheck, MemoryEvidence, MemoryMaterial, MemoryPolicy } from './editorial-memory.ts';
import { memoryEvidenceRef } from './editorial-memory.ts';
import type { CommandContext } from './result.ts';
import { memoryCalibrationBin, memoryCalibratedConfidence } from './editorial-memory-calibration.ts';

export type MemoryAssessment = {
  claims: Pick<FactClaim, 'text' | 'kind' | 'query'>[];
  supports: MemoryCheck['supports'];
  strength: MemoryCheck['strength']; provider: string; model: string;
};
/** Literal claims and actual source relations determine the verdict, independently of popularity. */
export function assessMemoryEvidence(evidence: MemoryEvidence, material: MemoryMaterial, policy: MemoryPolicy,
  previous: Pick<MemoryCheck, 'id' | 'workspaceId' | 'revision'> | null, input: MemoryAssessment, ctx: CommandContext): MemoryCheck {
  if (evidence.materialId !== material.id || evidence.workspaceId !== material.workspaceId || policy.workspaceId !== evidence.workspaceId
    || previous && (previous.id !== evidence.id || previous.workspaceId !== evidence.workspaceId)
    || !input.claims.length || input.claims.length > 6) throw new Error('MEMORY_CHECK_CONTEXT_INVALID');
  if (input.claims.some(claim => !claim.text.trim() || !evidence.anchor.excerpt.includes(claim.text)
    || claim.text.length > 2000 || !['fact', 'declared', 'opinion', 'forecast'].includes(claim.kind))) throw new Error('MEMORY_CHECK_CLAIM_NOT_LITERAL');
  if (evidence.kind === 'statistic' && !input.claims.some(claim => checkable(claim.kind)
    && claim.text.includes(evidence.value.raw)
    && ([['unit', evidence.unit], ['qualifier', evidence.qualifier], ['period', evidence.period?.label ?? null], ['population', evidence.population], ['geography', evidence.geography]] as const)
      .every(([field, value]) => value === null || claim.text.includes(value) || evidence.market?.mapping?.[field]?.record === 'header'
        && evidence.market.fields[field]?.record === 1 && evidence.market.fields[field]?.value === value)))
    throw new Error('MEMORY_CHECK_STATISTIC_CONTEXT_MISSING');
  if (input.strength && (!Number.isInteger(input.strength.score) || input.strength.score < 1 || input.strength.score > 5 || !input.strength.reason.trim())) throw new Error('MEMORY_CHECK_STRENGTH_INVALID');
  const supports: MemoryCheck['supports'] = [];
  for (const support of input.supports) {
    if (!Number.isInteger(support.claim) || support.claim < 0 || support.claim >= input.claims.length
      || !['confirms', 'contradicts', 'related'].includes(support.relation)) throw new Error('MEMORY_CHECK_SUPPORT_INVALID');
    if (support.evidence.kind === 'internal' && support.evidence.evidence.id === evidence.id) continue;
    const literal = structuredClone(support);
    if (!checkable(input.claims[support.claim].kind) || support.relation === 'confirms' && (support.evidence.originStatus === 'unverified' || support.evidence.primaryOrigin === material.primaryOrigin
      || support.evidence.excerpt.trim() === evidence.anchor.excerpt.trim()
      || support.evidence.kind === 'external' && samePublisher(support.evidence.url, material.metadata.originalUrl))) literal.relation = 'related';
    if (!supports.some(previous => JSON.stringify(previous) === JSON.stringify(literal))) supports.push(literal);
  }
  const claims: FactClaim[] = input.claims.map((claim, index) => {
    const relevant = supports.filter(support => support.claim === index);
    if (!checkable(claim.kind)) return { text: claim.text, kind: claim.kind, sources: [] };
    const verdict: ClaimVerdict = relevant.some(support => support.relation === 'contradicts') ? 'disputed'
      : relevant.some(support => support.relation === 'confirms') ? 'validated' : 'not_validated';
    return { ...claim, verdict, reason: verdict === 'disputed' ? 'Há uma fonte que contradiz esta afirmação.'
      : verdict === 'validated' ? 'Uma fonte de outra origem confirma esta afirmação.' : 'Não há confirmação independente nas fontes consultadas.',
      sources: relevant.flatMap(support => support.evidence.kind === 'external' && support.relation !== 'related' ? [{ url: support.evidence.url,
        title: support.evidence.title, site: new URL(support.evidence.url).hostname, excerpt: support.evidence.excerpt,
        ...(support.evidence.publishedOn ? { publishedOn: support.evidence.publishedOn } : {}) }] : []) };
  });
  const factual = claims.filter(claim => checkable(claim.kind));
  const verdict = !factual.length ? 'not_checkable' : factual.some(claim => claim.verdict === 'disputed') ? 'disputed'
    : factual.some(claim => claim.verdict !== 'validated') ? 'not_validated' : 'validated';
  const result: MemoryCheck = { id: evidence.id, workspaceId: evidence.workspaceId, revision: (previous?.revision ?? 0) + 1, evidence: memoryEvidenceRef(evidence),
    policyRevision: policy.revision, checkedAt: ctx.now, verdict, confidence: null, claims, supports,
    strength: structuredClone(input.strength), provider: input.provider, model: input.model };
  if (policy.mode === 'calibrated' && policy.calibrationReportId) result.confidence = memoryCalibratedConfidence(memoryCalibrationBin(evidence, material, result), policy.calibration);
  return result;
}

/** Treat a publisher's own pages conservatively; tracking URLs do not create independence. */
function samePublisher(left: string, right: string | null): boolean {
  if (!right) return false;
  try { return new URL(left).hostname.replace(/^www\./, '') === new URL(right).hostname.replace(/^www\./, ''); } catch { return false; }
}
