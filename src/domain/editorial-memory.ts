import type { ClaimKind, CitationVerdict, FactClaim } from './fact-check.ts';
import type { CommandContext, Result } from './result.ts';
import { ok, refuse } from './result.ts';
import type { SourceVersionRef, VersionRef } from './refs.ts';
import type { Source } from './source.ts';
import { sourceVersion } from './source.ts';
import { contentHash } from './text/hash.ts';
import { can } from './permissions.ts';
import type { Member } from './workspace.ts';
import type { Citation } from './citation-library.ts';
import type { FactCheck } from './fact-check.ts';

export type MemoryMaterialKind = 'transcript' | 'news' | 'release' | 'report' | 'archive' | 'market_data';
export type MemoryProcessingStatus = 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
/** Unknown dates stay null; publication, speech and observation dates never stand in for each other. */
export type MemoryMetadata = {
  publishedOn: string | null; recordedOn: string | null;
  institution: string | null; company: string | null; event: string | null; edition: string | null;
  topics: string[]; originalUrl: string | null;
};
export type MemoryMaterial = {
  id: string; workspaceId: string; revision: number; title: string; kind: MemoryMaterialKind;
  source: SourceVersionRef; metadata: MemoryMetadata; importedAt: string; importedBy: string;
  /** Republishing one origin does not create independent corroboration. */
  primaryOrigin: string; originalFileId: string | null;
};
/** UTF-16 offsets into the saved source segment, following the existing SourceRef contract. */
export type MemorySpan = { segmentId: string; from: number; to: number };
export type MemoryAnchor = { source: SourceVersionRef; spans: MemorySpan[]; excerpt: string };
export type MemoryBlock = {
  id: string; materialId: string; ordinal: number; anchor: MemoryAnchor;
  status: 'pending' | 'completed' | 'failed'; attempts: number; error: string | null;
};
export type MemoryEvidenceBase = {
  id: string; workspaceId: string; materialId: string; revision: number; anchor: MemoryAnchor;
  metadata: MemoryMetadata; kinds: ClaimKind[]; status: 'active' | 'withdrawn' | 'superseded';
  createdAt: string; updatedAt: string; supersedes: string | null;
  /** Authenticated correction provenance; historical snapshots retain each earlier stamp. */
  correction?: { reason: string; personId: string; at: string };
  /** A corrected projection requires an explicit choice before consolidation. */
  deduplication?: { canonicalId: string; canonical: MemoryEvidenceRef; state: 'pending' | 'superseded'; choice: 'pending' | 'automatic' | 'keep_variant' | 'use_curated'; reason: string; personId: string; at: string };
};
export type MemoryCitation = MemoryEvidenceBase & {
  kind: 'citation'; text: string; personId: string | null; authorConfirmed: boolean;
  /** Exact legacy id is retained when importing an existing curated/article citation. */
  legacyCitationId: string | null;
  /** Original curation/check payloads are retained; their old composite score is not factual confidence. */
  legacy?: { citation: Citation; factCheck: FactCheck | null; hash: string; mappedHash: string; state: 'synchronized' | 'conflict';
    importedAt: string; importedBy: string; reason: string; article?: MemoryArticleOrigin;
    resolution?: { choice: 'keep_bank' | 'apply_legacy'; reason: string } };
};
/** Exact observed article document; its original part and timestamps remain retrievable. */
export type MemoryArticleOrigin = { productionId: string; kind: 'piece' | 'version'; id: string; storageHash: string; bodyHash: string; at: string };
/** Decimal strings avoid loss of precision; normalization is optional and never replaces raw evidence. */
export type MemoryNumericValue = {
  raw: string; decimal: string | null; lower: string | null; upper: string | null; scale: string | null;
};
export type MemoryStatistic = MemoryEvidenceBase & {
  kind: 'statistic'; indicator: string; value: MemoryNumericValue; unit: string;
  period: { label: string; from: string | null; to: string | null } | null;
  geography: string | null; population: string | null; qualifier: string | null;
  issuingInstitution: string | null; declaringPersonId: string | null;
};
export type MemoryEvidence = MemoryCitation | MemoryStatistic;
export type MemoryEvidenceRef = { id: string; revision: number; hash: string };
export type MemoryCheckRef = { id: string; revision: number };
export type MemorySupport =
  | { kind: 'internal'; evidence: MemoryEvidenceRef; primaryOrigin: string; excerpt: string }
  | { kind: 'external'; url: string; title: string; excerpt: string; retrievedAt: string; publishedOn: string | null; primaryOrigin: string };
export type MemoryCheck = {
  id: string; workspaceId: string; revision: number; evidence: MemoryEvidenceRef; policyRevision: number;
  checkedAt: string; verdict: CitationVerdict; confidence: number | null;
  claims: FactClaim[]; supports: { claim: number; relation: 'confirms' | 'contradicts' | 'related'; evidence: MemorySupport }[];
  strength: { score: number; reason: string } | null; provider: string | null; model: string | null;
};
export type MemoryPolicy = {
  id: string; workspaceId: string; revision: number; mode: 'review_required' | 'calibrated';
  thresholds: Record<ClaimKind, number | null>; calibrationReportId: string | null;
  activatedAt: string | null; activatedBy: string | null;
};
export type MemoryDecisionAction = 'accept' | 'reject' | 'request_revision';
/** Append-only audit record, independent of evidence and check revisions. */
export type MemoryDecision = {
  id: string; workspaceId: string; sequence: number; evidence: MemoryEvidenceRef; check: MemoryCheckRef | null;
  policyRevision: number; action: MemoryDecisionAction; reason: string; personId: string; at: string;
  supports: MemorySupport[];
};
export type MemoryDecisionInput = Pick<MemoryDecision, 'evidence' | 'check' | 'policyRevision' | 'action' | 'reason' | 'supports'> & {
  previousSequence: number;
};
export type MemoryUseStage = 'selected' | 'inserted' | 'approved' | 'published';
type MemoryUseBase = { id: string; workspaceId: string; evidence: MemoryEvidenceRef; at: string; personId: string };
type MemoryOccurrence = { productionId: string; blockId: string; from: number; to: number };
export type MemoryUse = MemoryUseBase & (
  | { stage: 'selected'; selectionId: string; productionId: string | null }
  | MemoryOccurrence & { stage: 'inserted'; pieceId: string; draftRevision: number; articleHash: string }
  | MemoryOccurrence & { stage: 'approved'; article: VersionRef }
  | MemoryOccurrence & { stage: 'published'; article: VersionRef; publicationReceipt: string }
);
export type MemorySelection = {
  id: string; workspaceId: string; revision: number; productionId: string | null;
  items: { evidence: MemoryEvidenceRef; decisionId: string | null; check: MemoryCheckRef | null; policyRevision: number }[];
  createdBy: string; updatedAt: string;
};
export type MemoryQuery = {
  kind?: MemoryEvidence['kind']; status?: MemoryEvidence['status'] | 'all'; query?: string; topics?: string[]; personId?: string; institution?: string;
  company?: string; event?: string; edition?: string; materialId?: string; materialKind?: MemoryMaterialKind;
  dateField?: 'recorded' | 'published' | 'observation'; from?: string; to?: string;
  verdict?: CitationVerdict; minConfidence?: number; unused?: boolean; useStage?: Exclude<MemoryUseStage, 'selected'>;
  sort?: 'newest' | 'oldest' | 'confidence' | 'relevance' | 'usage'; cursor?: string; limit?: number;
};
export type MemoryEvidenceView = {
  evidence: MemoryEvidence; material: Pick<MemoryMaterial, 'id' | 'title' | 'kind' | 'primaryOrigin'>;
  check: MemoryCheck | null; decision: MemoryDecision | null; eligibility: MemoryEligibility;
  checkState?: 'missing' | 'current' | 'outdated' | 'restricted'; reviewRestricted?: boolean;
  relevance: { score: number; reason: string } | null;
  uses: Record<MemoryUseStage, number>;
};
export type MemoryPage<T> = { items: T[]; nextCursor: string | null; total: number; snapshot: string };
export type MemoryHistoryKind = 'checks' | 'decisions' | 'revisions' | 'occurrences';
export type MemoryEligibility = { usable: boolean; reason: 'ready' | 'source_unavailable' | 'withdrawn' | 'authorship_pending' | 'review_required' | 'rejected' };

/** Snapshot all semantic fields, including attribution, qualifiers and metadata. Ignore operational timestamps. */
export function memoryEvidenceRef(evidence: MemoryEvidence): MemoryEvidenceRef {
  return { id: evidence.id, revision: evidence.revision,
    hash: contentHash({ ...evidence, createdAt: undefined, updatedAt: undefined, revision: undefined, correction: undefined,
      ...(evidence.deduplication ? { deduplication: { canonicalId: evidence.deduplication.canonicalId, canonical: evidence.deduplication.canonical, state: evidence.deduplication.state } } : {}),
      ...(evidence.kind === 'citation' ? { legacy: undefined } : {}) }) };
}
export function sameMemoryEvidence(a: MemoryEvidenceRef, b: MemoryEvidenceRef): boolean {
  return a.id === b.id && a.revision === b.revision && a.hash === b.hash;
}
const checkRef = (check: MemoryCheck | null): MemoryCheckRef | null => check ? { id: check.id, revision: check.revision } : null;
const sameCheck = (a: MemoryCheckRef | null, b: MemoryCheckRef | null) => a === null ? b === null : b !== null && a.id === b.id && a.revision === b.revision;

/** Resolve contiguous original words; never fabricate a quote by stitching disjoint source passages. */
export function resolveMemoryAnchor(source: Source, anchor: MemoryAnchor): string | undefined {
  if (source.id !== anchor.source.sourceId || !anchor.spans.length) return undefined;
  const version = sourceVersion(source, anchor.source.sourceVersion);
  if (!version || version.hash !== anchor.source.hash) return undefined;
  const pieces: string[] = [];
  let previousIndex = -1;
  for (let index = 0; index < anchor.spans.length; index++) {
    const span = anchor.spans[index], segmentIndex = version.content.segments.findIndex(segment => segment.id === span.segmentId);
    const segment = version.content.segments[segmentIndex];
    if (!segment || !Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < 0 || span.to <= span.from || span.to > segment.text.length
      || index > 0 && (segmentIndex !== previousIndex + 1 || span.from !== 0)
      || index < anchor.spans.length - 1 && span.to !== segment.text.length) return undefined;
    pieces.push(segment.text.slice(span.from, span.to)); previousIndex = segmentIndex;
  }
  const excerpt = pieces.join('\n');
  return excerpt === anchor.excerpt ? excerpt : undefined;
}

export function initialMemoryPolicy(workspaceId: string, ctx?: CommandContext): MemoryPolicy {
  return { id: 'editorial-memory', workspaceId, revision: 1, mode: 'review_required',
    thresholds: { fact: null, declared: null, opinion: null, forecast: null }, calibrationReportId: null,
    activatedAt: ctx?.now ?? null, activatedBy: ctx?.actorId ?? null };
}
function currentCheck(evidence: MemoryEvidence, policy: MemoryPolicy, check: MemoryCheck | null): boolean {
  return check !== null && check.workspaceId === evidence.workspaceId && sameMemoryEvidence(check.evidence, memoryEvidenceRef(evidence))
    && check.policyRevision === policy.revision;
}
export function memoryDecisionApplies(evidence: MemoryEvidence, policy: MemoryPolicy, check: MemoryCheck | null, decision: MemoryDecision | null): boolean {
  return decision !== null && decision.workspaceId === evidence.workspaceId && policy.workspaceId === evidence.workspaceId
    && decision.policyRevision === policy.revision && sameMemoryEvidence(decision.evidence, memoryEvidenceRef(evidence))
    && sameCheck(decision.check, checkRef(check)) && (check === null || currentCheck(evidence, policy, check));
}

/** Use, relevance and strength never participate in factual confidence or bypass a dispute. */
export function memoryEligibility(evidence: MemoryEvidence, source: Source, policy: MemoryPolicy,
  check: MemoryCheck | null, decision: MemoryDecision | null): MemoryEligibility {
  const blocked = (reason: MemoryEligibility['reason']): MemoryEligibility => ({ usable: false, reason });
  if (source.workspaceId !== evidence.workspaceId || policy.workspaceId !== evidence.workspaceId || !source.rights.authorized
    || resolveMemoryAnchor(source, evidence.anchor) === undefined
    || evidence.kind === 'citation' && evidence.text !== evidence.anchor.excerpt
    || evidence.kind === 'statistic' && (!evidence.value.raw.trim() || !evidence.unit.trim()
      || !evidence.anchor.excerpt.includes(evidence.value.raw) || !evidence.anchor.excerpt.includes(evidence.unit)
      || evidence.qualifier !== null && !evidence.anchor.excerpt.includes(evidence.qualifier))) return blocked('source_unavailable');
  if (evidence.status !== 'active') return blocked('withdrawn');
  if (evidence.deduplication?.state === 'pending') return blocked('review_required');
  if (evidence.kind === 'citation' && (!evidence.personId || !evidence.authorConfirmed)) return blocked('authorship_pending');
  if (evidence.kind === 'citation' && evidence.legacy?.state === 'conflict') return blocked('review_required');
  if (memoryDecisionApplies(evidence, policy, check, decision)) {
    return decision!.action === 'accept' ? { usable: true, reason: 'ready' } : blocked(decision!.action === 'reject' ? 'rejected' : 'review_required');
  }
  if (!currentCheck(evidence, policy, check) || policy.mode !== 'calibrated' || !policy.calibrationReportId
    || check!.verdict === 'disputed' || check!.verdict === 'pending' || !evidence.kinds.length
    || evidence.kinds.some(kind => kind === 'fact' || kind === 'declared') && check!.verdict !== 'validated'
    || check!.confidence === null || !Number.isFinite(check!.confidence) || check!.confidence < 0 || check!.confidence > 100) return blocked('review_required');
  const factual = check!.claims.flatMap((claim, index) => claim.kind === 'fact' || claim.kind === 'declared' ? [{ claim, index }] : []);
  if (evidence.kinds.some(kind => kind === 'fact' || kind === 'declared') && (!factual.length || factual.some(({ claim, index }) =>
    claim.verdict !== 'validated' || !check!.supports.some(({ claim: supported, relation, evidence: support }) => supported === index && relation === 'confirms'
      && (support.kind === 'external' ? claim.sources.some(source => source.url === support.url)
        : support.evidence.id !== evidence.id))
    || check!.supports.some(support => support.claim === index && support.relation === 'contradicts')))) return blocked('review_required');
  if (evidence.kinds.some(kind => policy.thresholds[kind] === null || !Number.isFinite(policy.thresholds[kind])
    || policy.thresholds[kind]! < 0 || policy.thresholds[kind]! > 100 || check!.confidence! < policy.thresholds[kind]!)) return blocked('review_required');
  return { usable: true, reason: 'ready' };
}

/** The server supplies current snapshots and appends the result atomically with its audit event. */
export function reviewMemoryEvidence(input: MemoryDecisionInput, evidence: MemoryEvidence, source: Source, policy: MemoryPolicy,
  check: MemoryCheck | null, previous: MemoryDecision | null, member: Member | undefined, ctx: CommandContext): Result<MemoryDecision> {
  if (!member || member.workspaceId !== evidence.workspaceId || member.personId !== ctx.actorId || !can(member, 'library.review'))
    return refuse('forbidden', 'Só um usuário com acesso ao cliente pode revisar a evidência.');
  if (!sameMemoryEvidence(input.evidence, memoryEvidenceRef(evidence)) || !sameCheck(input.check, checkRef(check))
    || input.policyRevision !== policy.revision || policy.workspaceId !== evidence.workspaceId
    || input.previousSequence !== (previous?.sequence ?? 0) || previous !== null && (previous.workspaceId !== evidence.workspaceId || previous.evidence.id !== evidence.id)
    || check !== null && !currentCheck(evidence, policy, check)) return refuse('conflict', 'A evidência ou a checagem mudou. Recarregue antes de decidir.');
  const reason = input.reason.trim();
  if (input.action === 'accept' && evidence.deduplication?.state === 'pending')
    return refuse('conflict', 'Resolva a duplicata antes de aceitar.');
  if (input.action === 'accept' && evidence.kind === 'citation' && evidence.legacy?.state === 'conflict')
    return refuse('conflict', 'Resolva a divergência com a citação antiga antes de aceitar.');
  if (!reason || reason.length > 2000 || !['accept', 'reject', 'request_revision'].includes(input.action))
    return refuse('invalid_input', 'Informe o motivo da decisão, com até 2.000 caracteres.');
  // A review can release uncertainty; it cannot create rights, literal words or confirmed authorship.
  const structural = memoryEligibility(evidence, source, policy, null, null);
  if (input.action === 'accept' && ['source_unavailable', 'withdrawn', 'authorship_pending'].includes(structural.reason))
    return refuse('source_not_authorized', 'Confira a fonte, a autorização e a autoria antes de aceitar.');
  return ok({ id: ctx.newId('memory-decision'), workspaceId: evidence.workspaceId, sequence: (previous?.sequence ?? 0) + 1,
    evidence: memoryEvidenceRef(evidence), check: checkRef(check), policyRevision: policy.revision,
    action: input.action, reason, personId: ctx.actorId, at: ctx.now, supports: structuredClone(input.supports) });
}
