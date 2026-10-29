import type { ClaimKind } from './fact-check.ts';
import type { MemoryCheck, MemoryCheckRef, MemoryEvidence, MemoryEvidenceRef, MemoryMaterial, MemoryPolicy } from './editorial-memory.ts';
import { memoryEvidenceRef, sameMemoryEvidence } from './editorial-memory.ts';
import type { SourceVersionRef } from './refs.ts';
import { contentHash } from './text/hash.ts';

export const MEMORY_CALIBRATION_VERSION = 'independent-confirmation-v1' as const;
export type MemoryCalibrationBin = 'one_origin' | 'multiple_origins';
export type MemoryCalibration = { version: typeof MEMORY_CALIBRATION_VERSION; bins: { key: MemoryCalibrationBin; confirmed: number; total: number; confidence: number }[] };
export type MemoryCalibrationCase = {
  id: string; workspaceId: string; version: typeof MEMORY_CALIBRATION_VERSION; evidence: MemoryEvidenceRef; check: MemoryCheckRef; policyRevision: number; source: SourceVersionRef; materialId: string;
  primaryOrigin: string; excerpt: string; materialTitle: string; groups: string[]; kinds: ClaimKind[]; bin: MemoryCalibrationBin | null; structurallyUsable: boolean;
  purpose: 'technical' | 'editorial'; outcome: 'confirmed' | 'contradicted' | 'insufficient'; reason: string; personId: string; at: string;
};
export type MemoryCalibrationCaseInput = Pick<MemoryCalibrationCase, 'evidence' | 'check' | 'purpose' | 'outcome' | 'reason'>;
export type MemoryPolicySettings = Pick<MemoryPolicy, 'mode' | 'thresholds'>;
export type MemoryEvaluationCriteria = { minTraining: number; minValidation: number; minOrigins: number; minReleased: number; minPrecision: number; maxErrors: number };
export type MemoryPolicyEvaluation = {
  version: typeof MEMORY_CALIBRATION_VERSION; datasetHash: string; training: number; validation: number; trainingOrigins: number; validationOrigins: number;
  baselineComparable: boolean;
  calibration: MemoryCalibration; criteria: MemoryEvaluationCriteria | null; purpose: 'technical' | 'editorial';
  metrics: { kind: 'fact' | 'declared'; training: number; validation: number; trainingOrigins: number; validationOrigins: number;
    released: number; errors: number; releasedOrigins: number; errorOrigins: number; precision: number | null; lowerBound: number | null; baselineReleased: number | null }[];
  blockers: string[]; activatable: boolean;
};

/** Lower confidence bound for observed agreement, not the probability that a new claim is true. */
export function memoryPrecisionLowerBound(confirmed: number, total: number): number {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(confirmed) || confirmed < 0 || confirmed > total) return 0;
  const z = 1.959963984540054, p = confirmed / total, z2 = z * z;
  return Math.max(0, Math.min(100, 100 * (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total)));
}
function components<T>(items: T[], tokens: (item: T) => string[]): T[][] {
  const groups: { tokens: Set<string>; items: T[] }[] = [];
  for (const item of items) {
    const keys = tokens(item), matches = groups.filter(group => keys.some(key => group.tokens.has(key)));
    const merged = { tokens: new Set([...keys, ...matches.flatMap(group => [...group.tokens])]), items: [item, ...matches.flatMap(group => group.items)] };
    for (const group of matches) groups.splice(groups.indexOf(group), 1); groups.push(merged);
  }
  return groups.map(group => group.items);
}
const originalGroups = (items: MemoryCalibrationCase[]) => components(items, item => [`source:${item.source.sourceId}`, `origin:${item.primaryOrigin}`, ...item.groups]);
/** Exact republications and shared checked originals remain one sampling group across record IDs. */
export function memoryCalibrationGroups(evidence: MemoryEvidence, material: MemoryMaterial, check: MemoryCheck): string[] {
  const keys = [`source:${evidence.anchor.source.sourceId}`, `origin:${material.primaryOrigin}`,
    `statement:${evidence.anchor.excerpt.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('pt-BR')}`];
  for (const support of check.supports) {
    if (support.relation === 'related' || support.evidence.originStatus === 'unverified') continue;
    if (support.evidence.kind === 'internal') keys.push(`support-origin:${support.evidence.primaryOrigin}`);
    else {
      const url = new URL(support.evidence.url); url.hash = ''; url.hostname = url.hostname.replace(/^www\./, '');
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort(); keys.push(`support-url:${url.href}`);
    }
  }
  return [...new Set(keys.map(key => contentHash(key)))].sort();
}
/** Only independent, verified confirmations of every factual claim participate in a scoring bin. */
export function memoryCalibrationBin(evidence: MemoryEvidence, material: MemoryMaterial, check: MemoryCheck): MemoryCalibrationBin | null {
  if (!sameMemoryEvidence(check.evidence, memoryEvidenceRef(evidence)) || check.verdict !== 'validated') return null;
  const factual = check.claims.flatMap((claim, index) => claim.kind === 'fact' || claim.kind === 'declared' ? [{ claim, index }] : []);
  if (!factual.length || factual.some(({ claim }) => claim.verdict !== 'validated')) return null;
  let minimum = Infinity;
  for (const { claim, index } of factual) {
    const supports = check.supports.filter(support => support.claim === index);
    if (supports.some(support => support.relation === 'contradicts')) return null;
    const valid = supports.filter(support => {
      const ref = support.evidence;
      if (support.relation !== 'confirms' || ref.originStatus === 'unverified' || ref.primaryOrigin === material.primaryOrigin || ref.excerpt.trim() === evidence.anchor.excerpt.trim()) return false;
      if (ref.kind === 'internal') return ref.evidence.id !== evidence.id;
      try { return claim.sources.some(source => source.url === ref.url) && (!material.metadata.originalUrl
        || new URL(ref.url).hostname.replace(/^www\./, '') !== new URL(material.metadata.originalUrl).hostname.replace(/^www\./, '')); } catch { return false; }
    });
    const origins = components(valid, support => [`origin:${support.evidence.primaryOrigin}`, ...(support.evidence.kind === 'external' ? [`publisher:${new URL(support.evidence.url).hostname.replace(/^www\./, '')}`] : [])]);
    minimum = Math.min(minimum, origins.length);
  }
  return minimum < 1 ? null : minimum === 1 ? 'one_origin' : 'multiple_origins';
}
export function memoryCalibratedConfidence(bin: MemoryCalibrationBin | null, calibration: MemoryCalibration | undefined): number | null {
  if (bin === null || calibration?.version !== MEMORY_CALIBRATION_VERSION) return null;
  const measured = calibration.bins.find(item => item.key === bin);
  if (!measured || measured.total < 1 || measured.confirmed > measured.total || measured.confirmed < 0
    || !Number.isInteger(measured.confidence) || measured.confidence !== Math.floor(memoryPrecisionLowerBound(measured.confirmed, measured.total))) return null;
  return measured.confidence;
}
function automaticallyReleased(item: MemoryCalibrationCase, settings: MemoryPolicySettings, calibration?: MemoryCalibration): boolean {
  const confidence = memoryCalibratedConfidence(item.bin, calibration);
  return settings.mode === 'calibrated' && item.structurallyUsable && confidence !== null && item.kinds.length > 0
    && item.kinds.every(kind => settings.thresholds[kind] !== null && confidence >= settings.thresholds[kind]!);
}
export function evaluateMemoryPolicy(cases: { item: MemoryCalibrationCase; split: 'training' | 'validation' }[], baseline: MemoryPolicy,
  settings: MemoryPolicySettings, criteria: MemoryEvaluationCriteria | null): MemoryPolicyEvaluation {
  const ids = cases.map(({ item }) => item.id), proofs = cases.map(({ item }) => contentHash({ evidence: item.evidence, check: item.check }));
  if (cases.length > 1000 || new Set(ids).size !== ids.length || new Set(proofs).size !== proofs.length
    || cases.some(({ item, split }) => item.workspaceId !== baseline.workspaceId || item.version !== MEMORY_CALIBRATION_VERSION || !['training', 'validation'].includes(split)
      || !['confirmed', 'contradicted', 'insufficient'].includes(item.outcome) || !['technical', 'editorial'].includes(item.purpose)
      || !item.primaryOrigin || !item.source.sourceId || !item.groups.length || item.groups.some(group => !/^[a-f0-9]{16}$/.test(group))
      || !item.kinds.length || item.kinds.some(kind => !['fact', 'declared', 'opinion', 'forecast'].includes(kind)))) throw new Error('MEMORY_CALIBRATION_DATASET_INVALID');
  if (settings.mode === 'calibrated' && !criteria || criteria && (Object.values(criteria).some(value => !Number.isFinite(value) || value < 0) || ['minTraining', 'minValidation', 'minOrigins', 'minReleased'].some(key => criteria[key as keyof MemoryEvaluationCriteria] < 1)
    || Object.entries(criteria).some(([key, value]) => key !== 'minPrecision' && !Number.isInteger(value)) || criteria.minPrecision > 100)) throw new Error('MEMORY_CALIBRATION_CRITERIA_INVALID');
  if (!['review_required', 'calibrated'].includes(settings.mode) || Object.keys(settings.thresholds).length !== 4 || ['fact', 'declared', 'opinion', 'forecast'].some(kind => !Object.hasOwn(settings.thresholds, kind))
    || Object.values(settings.thresholds).some(value => value !== null && (!Number.isFinite(value) || value < 0 || value > 100))
    || settings.thresholds.opinion !== null || settings.thresholds.forecast !== null
    || settings.mode === 'review_required' && Object.values(settings.thresholds).some(value => value !== null)) throw new Error('MEMORY_POLICY_SETTINGS_INVALID');
  const training = cases.filter(item => item.split === 'training').map(item => item.item), validation = cases.filter(item => item.split === 'validation').map(item => item.item);
  const trainOrigins = originalGroups(training), validationOrigins = originalGroups(validation);
  const collision = components(cases, row => [`source:${row.item.source.sourceId}`, `origin:${row.item.primaryOrigin}`, ...row.item.groups]).some(group => new Set(group.map(row => row.split)).size > 1);
  const bins: MemoryCalibration['bins'] = [];
  for (const key of ['one_origin', 'multiple_origins'] as const) {
    const sample = originalGroups(training.filter(item => item.bin === key)), confirmed = sample.filter(group => group.every(item => item.outcome === 'confirmed')).length;
    if (sample.length) bins.push({ key, confirmed, total: sample.length, confidence: Math.floor(memoryPrecisionLowerBound(confirmed, sample.length)) });
  }
  const calibration: MemoryCalibration = { version: MEMORY_CALIBRATION_VERSION, bins }, blockers: string[] = [];
  const baselineComparable = baseline.mode === 'review_required' || baseline.calibration?.version === MEMORY_CALIBRATION_VERSION;
  const metrics = (['fact', 'declared'] as const).map(kind => {
    const train = training.filter(item => item.kinds.includes(kind)), sample = validation.filter(item => item.kinds.includes(kind));
    const released = sample.filter(item => automaticallyReleased(item, settings, calibration)), errors = released.filter(item => item.outcome !== 'confirmed').length;
    const groups = originalGroups(released), errorOrigins = groups.filter(group => group.some(item => item.outcome !== 'confirmed')).length;
    return { kind, training: train.length, validation: sample.length, trainingOrigins: originalGroups(train).length, validationOrigins: originalGroups(sample).length,
      released: released.length, errors, releasedOrigins: groups.length, errorOrigins,
      precision: released.length ? 100 * (released.length - errors) / released.length : null,
      lowerBound: groups.length ? memoryPrecisionLowerBound(groups.length - errorOrigins, groups.length) : null,
      baselineReleased: baselineComparable ? sample.filter(item => automaticallyReleased(item, baseline, baseline.calibration)).length : null };
  });
  if (settings.mode === 'calibrated' && criteria) {
    if (!cases.length || cases.some(({ item }) => item.purpose !== 'editorial')) blockers.push('EDITORIAL_CORPUS_REQUIRED');
    if (collision) blockers.push('SOURCE_LEAKAGE');
    if (trainOrigins.length < criteria.minOrigins || validationOrigins.length < criteria.minOrigins) blockers.push('INSUFFICIENT_ORIGINS');
    if (settings.thresholds.fact === null && settings.thresholds.declared === null) blockers.push('THRESHOLD_REQUIRED');
    for (const metric of metrics) if (settings.thresholds[metric.kind] !== null) {
      if (metric.training < criteria.minTraining || metric.validation < criteria.minValidation) blockers.push(`INSUFFICIENT_${metric.kind.toUpperCase()}_CASES`);
      if (metric.trainingOrigins < criteria.minOrigins || metric.validationOrigins < criteria.minOrigins) blockers.push(`INSUFFICIENT_${metric.kind.toUpperCase()}_ORIGINS`);
      if (metric.released < criteria.minReleased || metric.lowerBound === null || metric.lowerBound < criteria.minPrecision || metric.errors > criteria.maxErrors) blockers.push(`QUALITY_${metric.kind.toUpperCase()}_NOT_MET`);
    }
  }
  return { version: MEMORY_CALIBRATION_VERSION, datasetHash: contentHash(cases.map(({ item, split }) => ({ item, split })).sort((a, b) => a.item.id.localeCompare(b.item.id))),
    training: training.length, validation: validation.length, trainingOrigins: trainOrigins.length, validationOrigins: validationOrigins.length, baselineComparable,
    calibration, criteria: structuredClone(criteria), purpose: cases.length && cases.every(({ item }) => item.purpose === 'editorial') ? 'editorial' : 'technical', metrics,
    blockers: [...new Set(blockers)], activatable: blockers.length === 0 };
}
