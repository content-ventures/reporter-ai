import 'server-only';
import { z } from 'zod';
import type { MemoryQuery } from '../domain/editorial-memory.ts';
import { EDITORIAL_FORMATS } from '../domain/formats.ts';

const id = z.string().trim().min(1).max(128);
export const memoryIdSchema = id;
export const memoryHistoryKindSchema = z.enum(['checks', 'decisions', 'revisions', 'occurrences']);
export const memoryHistoryQuerySchema = z.object({ cursor: z.string().min(1).max(4096).optional(), limit: z.number().int().min(1).max(100).default(25) }).strict();
const feedbackKind = z.enum(['correction', 'rejection', 'conflict_resolution', 'relevance']);
export const memoryFeedbackQuerySchema = memoryHistoryQuerySchema.extend({ kind: feedbackKind.optional(), evidenceId: id.optional(), materialId: id.optional() });
export const memoryHistoryBindingSchema = z.object({ resource: z.literal('history'), evidenceId: id, kind: memoryHistoryKindSchema, limit: z.number().int().min(1).max(100) }).strict();
export const memoryResourceBindingSchema = z.discriminatedUnion('resource', [memoryHistoryBindingSchema,
  z.object({ resource: z.literal('policy-records'), kind: z.enum(['case', 'proposal', 'version']), limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ resource: z.literal('feedback'), kind: feedbackKind.optional(), evidenceId: id.optional(), materialId: id.optional(), limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ resource: z.literal('correction-impact'), kind: z.enum(['material', 'evidence']), id, limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ resource: z.literal('selections'), limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ resource: z.literal('materials'), limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ resource: z.literal('blocks'), jobId: id, limit: z.number().int().min(1).max(100) }).strict()]);
export const memoryCancelSchema = z.object({ baseRevision: z.number().int().positive() }).strict();
export const memoryAuthorizationSchema = z.object({ baseRevision: z.number().int().positive(), authorized: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict();
export const memoryRetrySchema = z.object({}).strict();
export function parseMemoryHistoryQuery(params: URLSearchParams) {
  const values: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!['cursor', 'limit'].includes(key) || params.getAll(key).length !== 1)
      throw new z.ZodError([{ code: 'custom', path: [key], message: 'Filtro desconhecido ou repetido.' }]);
    values[key] = key === 'limit' && /^\d+$/.test(value) ? Number(value) : value;
  }
  return memoryHistoryQuerySchema.parse(values);
}
export function parseMemoryFeedbackQuery(params: URLSearchParams) {
  const values: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!['kind', 'evidenceId', 'materialId', 'cursor', 'limit'].includes(key) || params.getAll(key).length !== 1)
      throw new z.ZodError([{ code: 'custom', path: [key], message: 'Filtro desconhecido ou repetido.' }]);
    values[key] = key === 'limit' && /^\d+$/.test(value) ? Number(value) : value;
  }
  return memoryFeedbackQuerySchema.parse(values);
}
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const day = z.iso.date();
const safeUrl = z.url().max(2000).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, 'Use um endereço HTTP ou HTTPS sem credenciais.');
export const memoryMetadataSchema = z.object({
  publishedOn: day.nullable(), recordedOn: day.nullable(), institution: nullableText(240), company: nullableText(240),
  event: nullableText(240), edition: nullableText(160), topics: z.array(z.string().trim().min(1).max(100)).max(20), originalUrl: safeUrl.nullable(),
}).strict();
export const memoryEvidenceRefSchema = z.object({ id, revision: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{16}$/) }).strict();
export const memoryRelevanceSchema = z.object({ selection: z.object({ id, revision: z.number().int().positive() }).strict(), evidence: memoryEvidenceRefSchema,
  rating: z.enum(['useful', 'not_useful']), reason: z.string().trim().min(1).max(2000) }).strict();
export const memoryRelevanceContextSchema = memoryRelevanceSchema.pick({ selection: true, evidence: true });
export function parseMemoryRelevanceContext(params: URLSearchParams) {
  const values = z.object({ selectionId: id, selectionRevision: z.string().regex(/^[1-9]\d{0,8}$/), evidenceId: id,
    evidenceRevision: z.string().regex(/^(?:0|[1-9]\d{0,8})$/), evidenceHash: z.string().regex(/^[a-f0-9]{16}$/) }).strict().parse(Object.fromEntries(params));
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new z.ZodError([{ code: 'custom', path: [], message: 'Filtro repetido.' }]);
  return memoryRelevanceContextSchema.parse({ selection: { id: values.selectionId, revision: Number(values.selectionRevision) },
    evidence: { id: values.evidenceId, revision: Number(values.evidenceRevision), hash: values.evidenceHash } });
}
export const memoryCheckInputSchema = z.object({ expected: memoryEvidenceRefSchema }).strict();
export const memoryReplacementSchema = z.object({ expected: memoryEvidenceRefSchema, replacement: memoryEvidenceRefSchema, reason: z.string().trim().min(1).max(2000) }).strict()
  .refine(value => value.expected.id !== value.replacement.id, 'Escolha registros diferentes.');
export const memoryLegacyBatchSchema = z.object({ after: id.nullable().default(null), limit: z.number().int().min(1).max(100).default(25) }).strict();
const articlePosition = z.object({ productionId: id, kind: z.enum(['piece', 'version']), id, offset: z.number().int().min(0).max(1_000_000),
  storageHash: z.string().regex(/^[a-f0-9]{32}$/).nullable() }).strict().refine(value => value.offset === 0 || value.storageHash !== null);
export const memoryArticleBatchSchema = z.object({ after: articlePosition.nullable().default(null), limit: z.number().int().min(1).max(100).default(25) }).strict();
export const memoryLegacyResolutionSchema = z.object({ expected: memoryEvidenceRefSchema, legacyHash: z.string().regex(/^[a-f0-9]{16}$/),
  choice: z.enum(['keep_bank', 'apply_legacy']), reason: z.string().trim().min(1).max(2000) }).strict();
export const memoryDuplicateResolutionSchema = z.object({ expected: memoryEvidenceRefSchema, canonical: memoryEvidenceRefSchema,
  choice: z.enum(['keep_variant', 'use_curated']), reason: z.string().trim().min(1).max(2000) }).strict()
  .refine(value => value.expected.id !== value.canonical.id, 'Escolha registros diferentes.');
export const memoryCheckRefSchema = z.object({ id, revision: z.number().int().positive() }).strict();
export const memoryCalibrationCaseSchema = z.object({ evidence: memoryEvidenceRefSchema, check: memoryCheckRefSchema, purpose: z.enum(['technical', 'editorial']),
  outcome: z.enum(['confirmed', 'contradicted', 'insufficient']), reason: z.string().trim().min(1).max(2000) }).strict();
const threshold = z.number().min(0).max(100).nullable();
export const memoryPolicyProposalSchema = z.object({ baseRevision: z.number().int().positive(),
  settings: z.object({ mode: z.enum(['review_required', 'calibrated']), thresholds: z.object({ fact: threshold, declared: threshold, opinion: z.null(), forecast: z.null() }).strict() }).strict(),
  criteria: z.object({ minTraining: z.number().int().min(1).max(1000), minValidation: z.number().int().min(1).max(1000), minOrigins: z.number().int().min(1).max(1000),
    minReleased: z.number().int().min(1).max(1000), minPrecision: z.number().min(0).max(100), maxErrors: z.number().int().min(0).max(1000) }).strict().nullable().default(null),
  cases: z.array(z.object({ id, split: z.enum(['training', 'validation']) }).strict()).max(1000).default([]).refine(items => new Set(items.map(item => item.id)).size === items.length),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export const memoryPolicyActivationSchema = z.object({ baseRevision: z.number().int().positive(), reason: z.string().trim().min(1).max(2000) }).strict();
export const memoryPolicyRestoreSchema = memoryPolicyActivationSchema.extend({ targetRevision: z.number().int().positive() });
const sourceRef = z.object({ kind: z.literal('source-version'), sourceId: id, sourceVersion: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{16}$/) }).strict();
export const memorySourceRefreshSchema = z.object({
  target: z.object({ productionId: id, updatedAt: z.iso.datetime({ offset: true }), draftRevision: z.number().int().nonnegative() }).strict(),
  expected: sourceRef, selection: z.object({ id, revision: z.number().int().positive() }).strict().nullable(),
  updateDraftReferences: z.boolean(), reason: z.string().trim().min(1).max(2000),
}).strict();
const support = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('internal'), evidence: memoryEvidenceRefSchema, primaryOrigin: z.string().min(1).max(2000), excerpt: z.string().min(1).max(20000), originStatus: z.literal('unverified').optional() }).strict(),
  z.object({ kind: z.literal('external'), url: safeUrl, title: z.string().min(1).max(500), excerpt: z.string().min(1).max(20000),
    retrievedAt: z.iso.datetime({ offset: true }), publishedOn: day.nullable(), primaryOrigin: z.string().min(1).max(2000), originStatus: z.literal('unverified').optional() }).strict(),
]);
export const memoryDecisionInputSchema = z.object({
  evidence: memoryEvidenceRefSchema, check: memoryCheckRefSchema.nullable(), policyRevision: z.number().int().positive(),
  previousSequence: z.number().int().nonnegative(), action: z.enum(['accept', 'reject', 'request_revision']),
  reason: z.string().trim().min(1).max(2000), supports: z.array(support).max(20),
}).strict();
export const MEMORY_TEXT_MAX_BYTES = 1024 * 1024;
const originalText = z.string().refine(value => value.trim().length >= 24, 'O material precisa de pelo menos 24 caracteres.')
  .refine(value => !value.includes('\0'), 'O material contém caracteres inválidos.')
  .refine(value => value.isWellFormed(), 'O material contém Unicode inválido.')
  .refine(value => Buffer.byteLength(value, 'utf8') <= MEMORY_TEXT_MAX_BYTES, 'O texto excede o limite de 1 MiB.');
export const memoryImportInputSchema = z.object({
  title: z.string().trim().min(1).max(160), kind: z.enum(['transcript', 'news', 'release', 'report', 'archive', 'market_data']),
  text: originalText, metadata: memoryMetadataSchema, authorized: z.boolean(),
  primaryOrigin: nullableText(2000), originalFileId: id.nullable(),
}).strict();
const decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).max(100);
function compareDecimal(a: string, b: string): number {
  if (a.length > 100 || b.length > 100 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(a) || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(b)) return NaN;
  const precision = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const scaled = (value: string) => BigInt(value.replace('.', '') + '0'.repeat(precision - (value.split('.')[1]?.length ?? 0)));
  const left = scaled(a), right = scaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
const numeric = z.object({ raw: z.string().trim().min(1).max(240), decimal: decimal.nullable(),
  lower: decimal.nullable(), upper: decimal.nullable(), scale: decimal.refine(value => compareDecimal(value, '0') > 0).nullable() }).strict()
  .refine(value => value.lower === null || value.upper === null || compareDecimal(value.lower, value.upper) <= 0, 'O intervalo numérico está invertido.');
const period = z.object({ label: z.string().trim().min(1).max(160), from: day.nullable(), to: day.nullable() }).strict()
  .refine(value => !value.from || !value.to || value.from <= value.to, 'O período final deve ser posterior ao inicial.').nullable();
const correction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('citation'), metadata: memoryMetadataSchema.partial().optional(), personId: id.nullable().optional(), authorConfirmed: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('statistic'), metadata: memoryMetadataSchema.partial().optional(), indicator: z.string().trim().min(1).max(240).optional(),
    value: numeric.optional(), unit: z.string().trim().min(1).max(100).optional(), period: period.optional(), geography: nullableText(240).optional(),
    population: nullableText(500).optional(), qualifier: nullableText(500).optional(), issuingInstitution: nullableText(240).optional(), declaringPersonId: id.nullable().optional() }).strict(),
]).refine(value => Object.entries(value).some(([key, field]) => key !== 'kind' && field !== undefined
  && (key !== 'metadata' || Object.keys(field ?? {}).length > 0)), 'Informe pelo menos uma correção.');
export const memoryCorrectionSchema = z.object({ expected: memoryEvidenceRefSchema, reason: z.string().trim().min(1).max(2000), changes: correction }).strict();
const memoryNewWritingSchema = z.object({ baseRevision: z.number().int().positive(), title: z.string().trim().min(1).max(120),
  brief: z.object({ size: z.enum(['short', 'standard']), sections: z.number().int().min(1).max(8), angle: z.string().max(600).optional(),
    format: z.enum(EDITORIAL_FORMATS).optional(), formatSize: id.optional(), event: z.object({ name: z.string().trim().min(1).max(600), boxTitle: z.string().max(600).optional(),
      about: z.string().max(600).optional(), dates: z.string().max(600).optional(), hours: z.string().max(600).optional(), venue: z.string().max(600).optional(),
      address: z.string().max(600).optional(), cta: z.string().max(600).optional() }).strict().optional() }).strict() }).strict();
export const memoryWritingInputSchema = z.union([memoryNewWritingSchema,
  z.object({ baseRevision: z.number().int().positive(), target: z.object({ productionId: id, updatedAt: z.iso.datetime({ offset: true }) }).strict() }).strict()]);
export const memoryMaterialRevisionSchema = z.object({ baseRevision: z.number().int().positive(), source: sourceRef,
  text: originalText, reason: z.string().trim().min(1).max(2000) }).strict();

const memoryQueryFiltersSchema = z.object({
  kind: z.enum(['citation', 'statistic']).optional(), status: z.enum(['active', 'withdrawn', 'superseded', 'all']).default('active'), query: z.string().trim().max(200).optional(),
  topics: z.array(z.string().trim().min(1).max(100)).max(20).optional(), personId: id.optional(), institution: z.string().trim().min(1).max(240).optional(),
  company: z.string().trim().min(1).max(240).optional(), event: z.string().trim().min(1).max(240).optional(), edition: z.string().trim().min(1).max(160).optional(),
  materialId: id.optional(), materialKind: z.enum(['transcript', 'news', 'release', 'report', 'archive', 'market_data']).optional(),
  dateField: z.enum(['recorded', 'published', 'observation']).optional(), from: day.optional(), to: day.optional(),
  verdict: z.enum(['validated', 'disputed', 'not_validated', 'not_checkable', 'pending']).optional(),
  minConfidence: z.number().min(0).max(100).optional(), unused: z.boolean().optional(), useStage: z.enum(['inserted', 'approved', 'published']).default('inserted'),
  sort: z.enum(['newest', 'oldest', 'confidence', 'relevance', 'usage']).default('newest'),
}).strict().refine(value => !(value.from || value.to) || Boolean(value.dateField), 'Escolha qual data deseja filtrar.')
  .refine(value => !value.from || !value.to || value.from <= value.to, 'O período final deve ser posterior ao inicial.');
export const memoryQuerySchema = memoryQueryFiltersSchema.safeExtend({ cursor: z.string().min(1).max(4096).optional(), limit: z.number().int().min(1).max(100).default(25) });
const memoryDiscoverySchema = z.object({ evidence: memoryEvidenceRefSchema, query: memoryQueryFiltersSchema,
  snapshot: z.string().regex(/^(?:0|[1-9]\d{0,18})$/).refine(value => /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt('9223372036854775807')),
}).strict();
const memoryChoiceSchema = memoryEvidenceRefSchema.extend({ discovery: memoryDiscoverySchema.optional() })
  .refine(value => !value.discovery || value.discovery.evidence.id === value.id && value.discovery.evidence.revision <= value.revision,
    'A busca original precisa pertencer à evidência selecionada.');
export const memorySelectionInputSchema = z.object({ id: id.optional(), baseRevision: z.number().int().nonnegative(), productionId: id.nullable(),
  evidence: z.array(memoryChoiceSchema).min(1).max(100) }).strict()
  .refine(value => new Set(value.evidence.map(item => item.id)).size === value.evidence.length, 'Uma evidência só pode aparecer uma vez na seleção.');

/** Unknown or duplicate selectors are refused rather than silently changing a saved query. */
export function parseMemoryQuery(params: URLSearchParams): MemoryQuery {
  const values: Record<string, unknown> = {};
  const allowed = new Set(['kind', 'status', 'q', 'topic', 'personId', 'institution', 'company', 'event', 'edition', 'materialId', 'materialKind',
    'dateField', 'from', 'to', 'verdict', 'minConfidence', 'unused', 'useStage', 'sort', 'cursor', 'limit']);
  for (const [key, value] of params) {
    if (!allowed.has(key)) throw new z.ZodError([{ code: 'custom', path: [key], message: 'Filtro desconhecido.' }]);
    if (key === 'topic') continue;
    if (params.getAll(key).length !== 1) throw new z.ZodError([{ code: 'custom', path: [key], message: 'Filtro repetido.' }]);
    if (key === 'limit' || key === 'minConfidence') values[key] = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
    else if (key === 'unused') values[key] = value === 'true' ? true : value === 'false' ? false : value;
    else values[key === 'q' ? 'query' : key] = value;
  }
  const topics = params.getAll('topic');
  if (topics.length > 20) throw new z.ZodError([{ code: 'custom', path: ['topic'], message: 'Use até 20 temas.' }]);
  if (topics.length) values.topics = [...new Set(topics)].sort();
  return memoryQuerySchema.parse(values);
}
