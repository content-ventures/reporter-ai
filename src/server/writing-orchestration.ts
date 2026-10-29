import 'server-only';
import { z } from 'zod';
import { articleQuotationIssue } from '../domain/article-policy.ts';
import type { EditorialPolicy } from '../domain/editorial-policy.ts';
import { contentHash, stableStringify } from '../domain/text/hash.ts';
import { cleanText } from '../domain/text/normalize.ts';
import { pipelineDefaultEffort, pipelineModelReasons } from '../domain/pipeline.ts';
import { composeWritingPrompt, writingOutputSchema, WRITING_COMPILER_VERSION, WRITING_EDITORIAL_CHECK_KEYS } from '../domain/writing-orchestration.ts';
import type { WritingArticle, WritingArticlePassage, WritingOrchestration, WritingPlan, WritingReview, WritingReviewAudit, WritingSource, WritingStage, WritingTrace } from '../domain/writing-orchestration.ts';
import { FlowError, safeCode } from './errors';
import { generateStructured } from './groq';
import { cacheRead, cacheWrite } from './storage';
import { effectiveWritingResearch } from '../domain/writing-research.ts';
import type { WritingExternalSource, WritingResearchSettings, WritingResearchSnapshot } from '../domain/writing-research.ts';
import { runWritingResearch } from './writing-research';
import type { searchWebEvidence } from './tavily';
import { writingMemoryChecks } from '../domain/writing-memory.ts';

const id = z.string().min(1).max(128);
const ids = z.array(id).max(100);
const planSchema = z.object({ decision: z.enum(['ready', 'needs_reporting']), angle: z.string().max(2000),
  facts: z.array(z.object({ id, text: z.string().min(1).max(3000), kind: z.enum(['reported_fact', 'opinion', 'intention', 'forecast', 'quote']), evidenceIds: ids.min(1) }).strict()).max(150),
  essentialFactIds: ids, outline: z.array(z.string().min(1).max(1000)).max(30), issues: z.array(z.string().min(1).max(2000)).max(50),
  research: z.object({ queries: z.array(z.object({ query: z.string().trim().min(1).max(380), purpose: z.string().trim().min(1).max(500), evidenceIds: ids.min(1) }).strict()).max(3),
    reason: z.string().trim().min(1).max(1000) }).strict().optional() }).strict();
const articleSchema = z.object({ title: z.string().trim().min(1).max(500), dek: z.string().max(1000), titleEvidenceIds: ids.min(1), dekEvidenceIds: ids,
  blocks: z.array(z.object({ id, type: z.enum(['paragraph', 'heading', 'quote', 'list']), level: z.union([z.literal(2), z.literal(3)]),
    text: z.string().max(5000), items: z.array(z.string().trim().min(1).max(2000)).max(30), evidenceIds: ids.min(1) }).strict()).min(1).max(100) }).strict();
const articlePassages = z.array(z.object({ blockId: id, text: z.string().trim().min(1).max(3000) }).strict()).max(20);
const reviewAuditSchema = z.object({
  factualSummary: z.string().trim().min(1).max(3000), editorialSummary: z.string().trim().min(1).max(3000),
  editorialChecks: z.array(z.object({ criterion: z.enum(WRITING_EDITORIAL_CHECK_KEYS), status: z.enum(['pass', 'revise']),
    articlePassages, issueIds: ids, reason: z.string().trim().min(1).max(3000) }).strict()).length(WRITING_EDITORIAL_CHECK_KEYS.length),
  factChecks: z.array(z.object({ factId: id, status: z.enum(['preserved', 'partial', 'missing', 'contradicted']),
    articlePassages, evidenceIds: ids.min(1), reason: z.string().trim().min(1).max(3000) }).strict()).max(100),
  issueChecks: z.array(z.object({ issueId: id, status: z.enum(['resolved', 'unresolved']),
    articlePassages, reason: z.string().trim().min(1).max(3000) }).strict()).max(100),
}).strict();
const reviewSchema = z.object({ decision: z.enum(['ready_for_human', 'revise', 'needs_reporting']), summary: z.string().trim().min(1).max(3000),
  issues: z.array(z.object({ id, severity: z.enum(['critical', 'major', 'minor']), code: z.string().min(1).max(80), blockId: id,
    message: z.string().trim().min(1).max(3000), evidenceIds: ids, suggestion: z.string().trim().min(1).max(3000) }).strict()).max(100),
  audit: reviewAuditSchema }).strict();

function fail(code: string, reason: string): never {
  const error = new FlowError(code, 422);
  error.reason = reason;
  throw error;
}
function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function checkIds(values: readonly string[], evidence: ReadonlyMap<string, string>) {
  if (!unique(values) || values.some(value => !evidence.has(value))) fail('UNKNOWN_EVIDENCE', 'A etapa citou uma referência inexistente ou repetida. Confira a saída registrada.');
}
function checkQuotes(texts: { text: string; evidenceIds: string[] }[], evidence: ReadonlyMap<string, string>) {
  const issue = articleQuotationIssue(texts, evidence, 0);
  if (issue) fail(issue, 'Uma citação não corresponde à evidência original. Confira a saída da etapa antes de tentar novamente.');
}

type ReviewContext = { plan?: WritingPlan; review?: WritingReview; previousArticle?: WritingArticle;
  researchSettings?: WritingResearchSettings; quotationEvidence?: ReadonlyMap<string, string>; statisticEvidence?: ReadonlySet<string> };

function exactCoverage(actual: readonly string[], expected: readonly string[], reason: string) {
  if (!unique(actual) || actual.length !== expected.length || actual.some(key => !expected.includes(key)))
    fail('WRITING_INVALID_OUTPUT', reason);
}

/** Provenance and block IDs do not change what the reader sees. */
function publishableArticle(article: WritingArticle) {
  return { title: article.title, dek: article.dek,
    blocks: article.blocks.map(({ type, level, text, items }) => ({ type, level, text, items })) };
}

/** Literal passages are inspectable evidence of the model's semantic assessment, not proof of it. */
function validateReviewAudit(audit: WritingReviewAudit, article: WritingArticle, evidence: ReadonlyMap<string, string>, context: ReviewContext,
  issues: WritingReview['issues']) {
  if (!context.plan) fail('WRITING_INVALID_OUTPUT', 'A revisão precisa do planejamento original para conferir os fatos essenciais.');
  const plan = context.plan;
  const locations = new Map([
    ['title', { texts: [article.title], evidenceIds: article.titleEvidenceIds }],
    ['dek', { texts: [article.dek], evidenceIds: article.dekEvidenceIds }],
    ...article.blocks.map(block => [block.id, { texts: block.type === 'list' ? block.items : [block.text], evidenceIds: block.evidenceIds }] as const),
  ]);
  const passagesExist = (passages: WritingArticlePassage[]) => {
    const keys = passages.map(passage => stableStringify(passage));
    if (!unique(keys)) fail('WRITING_INVALID_OUTPUT', 'A auditoria repetiu o mesmo trecho do artigo.');
    for (const passage of passages) {
      const location = locations.get(passage.blockId);
      const excerpt = cleanText(passage.text);
      if (!excerpt || !location || !location.texts.some(text => cleanText(text).includes(excerpt)))
        fail('WRITING_INVALID_OUTPUT', 'A auditoria citou um trecho que não existe no bloco indicado do artigo atual.');
    }
  };
  if (!audit.editorialChecks) fail('WRITING_INVALID_OUTPUT', 'A revisão precisa registrar os cinco eixos editoriais.');
  exactCoverage(audit.editorialChecks.map(check => check.criterion), WRITING_EDITORIAL_CHECK_KEYS,
    'A revisão precisa conferir cada eixo editorial exatamente uma vez.');
  for (const check of audit.editorialChecks) {
    passagesExist(check.articlePassages);
    if (!unique(check.issueIds) || (check.status === 'pass' ? check.issueIds.length > 0 : !check.issueIds.length)
      || check.issueIds.some(key => !issues.some(issue => issue.id === key && issue.severity !== 'minor')))
      fail('WRITING_INVALID_OUTPUT', 'Um eixo editorial revise precisa apontar problemas major ou critical existentes; pass não pode apontar pendências.');
  }
  exactCoverage(audit.factChecks.map(check => check.factId), plan.essentialFactIds,
    'A revisão precisa conferir cada fato essencial exatamente uma vez, sem omitir ou acrescentar IDs.');
  for (const check of audit.factChecks) {
    const fact = plan.facts.find(fact => fact.id === check.factId)!;
    checkIds(check.evidenceIds, evidence);
    if (!check.evidenceIds.some(key => fact.evidenceIds.includes(key)))
      fail('WRITING_INVALID_OUTPUT', 'A auditoria do fato não referencia sua evidência original.');
    passagesExist(check.articlePassages);
    if (check.status === 'preserved' && !check.articlePassages.length)
      fail('WRITING_INVALID_OUTPUT', 'Um fato marcado como preservado precisa de um trecho literal do artigo que demonstre a cobertura.');
    // A diagnosis may point to text that lost the fact's evidence link; transitions may cite other sources.
    // Only a preserved fact must have at least one passage linked to its original evidence.
    if (check.status === 'preserved' && !check.articlePassages.some(passage =>
      locations.get(passage.blockId)!.evidenceIds.some(key => fact.evidenceIds.includes(key))))
      fail('WRITING_INVALID_OUTPUT', 'Nenhum trecho apontado para preservar o fato referencia sua evidência original.');
  }
  const previousIssues = context.review?.issues ?? [];
  exactCoverage(audit.issueChecks.map(check => check.issueId), previousIssues.map(issue => issue.id),
    'A nova revisão precisa conferir cada apontamento anterior exatamente uma vez; a primeira revisão usa issueChecks vazio.');
  if (previousIssues.length && !context.previousArticle)
    fail('WRITING_INVALID_OUTPUT', 'A conferência das correções precisa da versão anterior do artigo.');
  for (const check of audit.issueChecks) {
    passagesExist(check.articlePassages);
    if (check.status === 'resolved' && context.previousArticle
      && stableStringify(publishableArticle(context.previousArticle)) === stableStringify(publishableArticle(article)))
      fail('WRITING_INVALID_OUTPUT', 'A revisão marcou uma correção como resolvida, mas o conteúdo publicável não foi alterado; mudar apenas identificadores ou referências não comprova uma correção editorial.');
  }
}

/** Parsing and semantic checks run on both provider responses and cached records. */
export function validateWritingOutput(stage: WritingStage, value: unknown, evidence: ReadonlyMap<string, string>, article?: WritingArticle,
  context: ReviewContext = {}): WritingPlan | WritingArticle | WritingReview {
  if (stage === 'plan') {
    const parsed = planSchema.safeParse(value);
    if (!parsed.success) fail('WRITING_INVALID_OUTPUT', 'O planejamento retornou campos inválidos. Confira o contrato e a saída da etapa.');
    const plan = parsed.data;
    if (context.researchSettings?.enabled && (!plan.research || plan.research.queries.length > context.researchSettings.maxQueries))
      fail('WRITING_INVALID_OUTPUT', 'O planejamento precisa registrar as consultas de pesquisa dentro do limite configurado ou explicar por que nenhuma consulta é necessária.');
    if (plan.research) {
      if (!unique(plan.research.queries.map(query => query.query.toLocaleLowerCase('pt-BR'))))
        fail('WRITING_INVALID_OUTPUT', 'O planejamento repetiu a mesma consulta de pesquisa.');
      for (const query of plan.research.queries) checkIds(query.evidenceIds, evidence);
    }
    if (!unique(plan.facts.map(fact => fact.id)) || !unique(plan.essentialFactIds)
      || plan.essentialFactIds.some(key => !plan.facts.some(fact => fact.id === key))) fail('WRITING_INVALID_OUTPUT', 'O planejamento não identificou corretamente os fatos essenciais.');
    for (const fact of plan.facts) {
      checkIds(fact.evidenceIds, evidence);
      if (fact.kind === 'quote' && fact.evidenceIds.some(id => context.statisticEvidence?.has(id)))
        fail('WRITING_INVALID_OUTPUT', 'O plano apresentou um dado estatístico como fala. Confira o tipo da evidência.');
      const allowed = new Map([...evidence].filter(([id]) => !context.statisticEvidence?.has(id)));
      checkQuotes([{ text: fact.kind === 'quote' ? `“${fact.text}”` : fact.text, evidenceIds: fact.evidenceIds.filter(id => allowed.has(id)) }], allowed);
    }
    if (plan.decision === 'ready' && (!plan.angle.trim() || !plan.facts.length || !plan.essentialFactIds.length || !plan.outline.length))
      fail('WRITING_INVALID_OUTPUT', 'O planejamento marcou o conteúdo como pronto sem fornecer ângulo, fatos essenciais e progressão.');
    if (plan.decision === 'needs_reporting' && !plan.issues.length) fail('WRITING_INVALID_OUTPUT', 'O planejamento precisa explicar o que falta apurar.');
    return plan;
  }
  if (stage === 'review') {
    const parsed = reviewSchema.safeParse(value);
    if (!parsed.success || !article) fail('WRITING_INVALID_OUTPUT', 'A revisão retornou campos inválidos. Confira o contrato e a saída da etapa.');
    const review = parsed.data, blocks = new Set(['$article', 'title', 'dek', ...article.blocks.map(block => block.id)]);
    if (!unique(review.issues.map(issue => issue.id)) || review.issues.some(issue => !blocks.has(issue.blockId)))
      fail('WRITING_INVALID_OUTPUT', 'A revisão apontou um trecho que não existe no artigo.');
    for (const issue of review.issues) checkIds(issue.evidenceIds, evidence);
    validateReviewAudit(review.audit, article, evidence, context, review.issues);
    const previousIssues = new Map(context.review?.issues.map(issue => [issue.id, issue]) ?? []);
    const severityRank = { minor: 0, major: 1, critical: 2 };
    if (review.issues.some(issue => {
      const previous = previousIssues.get(issue.id);
      return previous && severityRank[issue.severity] < severityRank[previous.severity];
    })) fail('WRITING_INVALID_OUTPUT', 'A revisão rebaixou a gravidade de um apontamento anterior ainda pendente. Resolva o problema ou preserve sua gravidade original.');
    if (review.decision === 'ready_for_human' && (review.audit.factChecks.some(check => check.status !== 'preserved')
      || review.audit.issueChecks.some(check => check.status !== 'resolved' && previousIssues.get(check.issueId)?.severity !== 'minor')
      || review.audit.editorialChecks.some(check => check.status !== 'pass')))
      fail('WRITING_INVALID_OUTPUT', 'A revisão aprovou o artigo apesar de fatos essenciais incompletos, ausentes ou contraditórios, eixos editoriais pendentes ou correções relevantes ainda não resolvidas.');
    if (review.audit.issueChecks.some(check => check.status === 'resolved' && review.issues.some(issue => issue.id === check.issueId)))
      fail('WRITING_INVALID_OUTPUT', 'A revisão declarou um apontamento resolvido, mas o manteve como pendência.');
    if (review.decision === 'ready_for_human' && review.issues.some(issue => issue.severity !== 'minor')
      || review.decision !== 'ready_for_human' && !review.issues.length)
      fail('WRITING_INVALID_OUTPUT', 'A decisão da revisão contradiz os problemas registrados.');
    return review;
  }
  const parsed = articleSchema.safeParse(value);
  if (!parsed.success) fail('WRITING_INVALID_OUTPUT', 'A redação retornou campos inválidos. Confira o contrato e a saída da etapa.');
  const result = parsed.data;
  if (!unique(result.blocks.map(block => block.id)) || result.blocks.some(block => ['$article', 'title', 'dek'].includes(block.id)))
    fail('WRITING_INVALID_OUTPUT', 'Cada bloco do artigo precisa de um identificador próprio.');
  if (result.dek.trim() && !result.dekEvidenceIds.length) fail('UNKNOWN_EVIDENCE', 'A linha fina precisa de evidência original.');
  checkIds(result.titleEvidenceIds, evidence); checkIds(result.dekEvidenceIds, evidence);
  const quoted = [{ text: result.title, evidenceIds: result.titleEvidenceIds }, { text: result.dek, evidenceIds: result.dekEvidenceIds }];
  for (const block of result.blocks) {
    checkIds(block.evidenceIds, evidence);
    if (block.type === 'list' ? !block.items.length || Boolean(block.text.trim()) : !block.text.trim() || block.items.length > 0)
      fail('WRITING_INVALID_OUTPUT', 'O conteúdo de um bloco não corresponde ao seu tipo.');
    if (block.type !== 'heading' && block.level !== 2) fail('WRITING_INVALID_OUTPUT', 'O nível do bloco não corresponde ao contrato.');
    if (block.type === 'list') quoted.push(...block.items.map(text => ({ text, evidenceIds: block.evidenceIds })));
    else quoted.push({ text: block.type === 'quote' ? `“${block.text}”` : block.text, evidenceIds: block.evidenceIds });
  }
  if (result.blocks.every(block => block.type === 'heading')) fail('WRITING_INVALID_OUTPUT', 'O artigo não contém corpo de texto.');
  const quotationEvidence = context.quotationEvidence ?? evidence;
  checkQuotes(quoted.map(block => ({ ...block, evidenceIds: block.evidenceIds.filter(id => quotationEvidence.has(id)) })), quotationEvidence);
  return result;
}

type Generated = Awaited<ReturnType<typeof generateStructured>>;
export type WritingRunInput = {
  configuration: WritingOrchestration; policy?: EditorialPolicy; source: WritingSource[]; brief: unknown;
  directory: string; signal: AbortSignal; trace: (trace: WritingTrace) => Promise<void>;
  /** Explicit dependency for deterministic provider tests; production uses the direct adapters. */
  generate?: typeof generateStructured;
  /** Direct search adapter injection for deterministic tests; not an extra model stage. */
  search?: typeof searchWebEvidence;
  /** Persisted article gates run in the same visible review/correction budget. */
  validateArticle?: (article: WritingArticle, externalSources: readonly WritingExternalSource[]) => WritingReview['issues'];
};

/** Three normal calls; at most one correction and one independent recheck. */
export async function runWritingOrchestration(input: WritingRunInput): Promise<{ article: WritingArticle; review: WritingReview; inputTokens: number | null; outputTokens: number | null;
  research?: WritingResearchSnapshot; externalSources?: WritingExternalSource[] }> {
  const { configuration, signal } = input;
  if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
  if (!configuration.enabled) fail('WRITING_DISABLED', 'Ative a orquestração antes de iniciar esta execução.');
  if (!input.source.length || input.source.some(source => !source.id || !source.text.trim()) || !unique(input.source.map(source => source.id)))
    fail('EMPTY_EDITORIAL_SOURCE', 'O conteúdo precisa de trechos identificados antes da redação.');
  const size = input.source.reduce((sum, source) => sum + source.text.length + (source.speaker?.length ?? 0) + source.id.length
    + (source.memory ? stableStringify(source.memory).length : 0), 0);
  if (size > configuration.maxSourceCharacters) fail('WRITING_SOURCE_TOO_LARGE', `O conteúdo tem ${size} caracteres e excede o limite de ${configuration.maxSourceCharacters}. Ajuste o limite ou selecione o conteúdo; nenhum trecho foi descartado.`);
  const originalEvidence = new Map(input.source.map(source => [source.id, source.text]));
  const statisticEvidence = new Set(input.source.filter(source => source.memory?.kind === 'statistic').map(source => source.id));
  const evidence = new Map(originalEvidence);
  const researchSettings = effectiveWritingResearch(configuration);
  let research: WritingResearchSnapshot | undefined, researchContext: WritingResearchSnapshot | undefined;
  let externalSources: WritingExternalSource[] = [];
  let inputTokens: number | null = 0, outputTokens: number | null = 0;
  const generate = input.generate ?? generateStructured;
  async function call(stage: WritingStage, attempt: number, context: ReviewContext & { article?: WritingArticle; deterministicChecks?: WritingReview['issues'] }) {
    const step = configuration.stages[stage];
    const parameters: NonNullable<WritingTrace['parameters']> = { maxTokens: step.maxTokens,
      ...(pipelineModelReasons(step.model) ? { effort: step.effort ?? pipelineDefaultEffort(step.model) } : { temperature: step.temperature }) };
    const prompt = composeWritingPrompt(configuration, input.policy, stage, { source: input.source, brief: input.brief, ...context,
      ...(researchContext ? { research: researchContext } : {}) });
    const schema = writingOutputSchema(configuration, stage);
    const validationContext = { ...context, researchSettings, quotationEvidence: originalEvidence, statisticEvidence };
    const hash = contentHash({ compiler: WRITING_COMPILER_VERSION, stage, prompt, schema, model: step.model, parameters });
    const base: WritingTrace = { id: `${stage}-${attempt}`, stage, attempt, status: 'running', startedAt: new Date().toISOString(), model: step.model, hash, prompt, parameters };
    await input.trace(base);
    let generated: Generated | undefined, cached = false;
    try {
      if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
      generated = await cacheRead<Generated>(input.directory, 'writing-' + hash) ?? undefined;
      if (generated) {
        try { validateWritingOutput(stage, generated.value, evidence, context.article, validationContext); cached = true; }
        catch { generated = undefined; }
      }
      if (!generated) generated = await generate('', '', schema, signal, { ...step, ...(parameters.effort ? { effort: parameters.effort } : {}), systemPrompt: prompt.system, userPrompt: prompt.user });
      if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
      const providerOutput = validateWritingOutput(stage, generated.value, evidence, context.article, validationContext);
      let value = providerOutput;
      if (stage === 'review' && context.deterministicChecks?.length) {
        const review = providerOutput as WritingReview, checks = context.deterministicChecks;
        const issues = [...review.issues.filter(issue => !checks.some(check => check.id === issue.id)), ...checks];
        value = validateWritingOutput('review', { ...review, issues,
          audit: { ...review.audit!, issueChecks: review.audit!.issueChecks.map(check => checks.some(issue => issue.id === check.issueId)
            ? { ...check, status: 'unresolved', reason: 'A validação objetiva ainda identifica esta pendência no artigo atual.' } : check) },
          decision: review.decision === 'needs_reporting' ? review.decision : issues.some(issue => issue.severity !== 'minor') ? 'revise' : review.decision,
          summary: review.decision === 'ready_for_human' && issues.some(issue => issue.severity !== 'minor')
            ? 'A validação objetiva encontrou pendências que impedem a aprovação automática desta etapa.' : review.summary }, evidence, context.article, context);
      }
      if (stage === 'review') {
        const review = value as WritingReview;
        const hasPendingSubstantiveCorrection = review.audit!.issueChecks.some(check => check.status !== 'resolved'
          && context.review?.issues.find(issue => issue.id === check.issueId)?.severity !== 'minor');
        // Optional suggestions do not create a correction cycle when the complete audit is consistent.
        // Retain the original provider verdict below so the effective decision remains inspectable.
        if (review.decision === 'revise' && review.issues.length > 0 && review.issues.every(issue => issue.severity === 'minor')
          && review.audit!.factChecks.every(check => check.status === 'preserved')
          && review.audit!.editorialChecks!.every(check => check.status === 'pass') && !hasPendingSubstantiveCorrection)
          value = validateWritingOutput('review', { ...review, decision: 'ready_for_human',
            summary: 'A decisão foi ajustada para revisão humana: a avaliação registrou apenas sugestões opcionais, com fatos essenciais preservados, cinco eixos atendidos e nenhuma correção relevante anterior pendente.' },
          evidence, context.article, context);
      }
      if (!cached) await cacheWrite(input.directory, 'writing-' + hash, { ...generated, value: providerOutput });
      const billedInput = cached ? 0 : generated.input_units, billedOutput = cached ? 0 : generated.output_units;
      inputTokens = inputTokens === null || billedInput === null ? null : inputTokens + billedInput;
      outputTokens = outputTokens === null || billedOutput === null ? null : outputTokens + billedOutput;
      await input.trace({ ...base, status: 'completed', completedAt: new Date().toISOString(), output: value, inputTokens: billedInput, outputTokens: billedOutput, cached,
        provider: generated.provider, requestId: generated.provider_request_id,
        ...(stableStringify(value) === stableStringify(providerOutput) ? {} : { providerOutput }) });
      if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
      return value;
    } catch (error) {
      const code = signal.aborted ? 'JOB_INTERRUPTED' : safeCode(error);
      await input.trace({ ...base, status: 'failed', completedAt: new Date().toISOString(), error: code,
        ...(error instanceof FlowError && error.reason ? { reason: error.reason } : {}),
        ...(generated ? { output: generated.value, inputTokens: cached ? 0 : generated.input_units, outputTokens: cached ? 0 : generated.output_units, cached,
          provider: generated.provider, requestId: generated.provider_request_id } : {}) });
      throw signal.aborted ? new FlowError('JOB_INTERRUPTED', 409) : error;
    }
  }
  const plan = await call('plan', 1, {}) as WritingPlan;
  if (plan.decision === 'needs_reporting') fail('WRITING_NEEDS_REPORTING', 'O planejamento identificou falta de apuração. Confira os problemas registrados antes de gerar novamente.');
  if (researchSettings.enabled) {
    research = await runWritingResearch({ settings: researchSettings, plan: plan.research!, policy: input.policy,
      directory: input.directory, signal, trace: input.trace, search: input.search });
    externalSources = research.status === 'completed' ? research.sources : [];
    researchContext = { ...research, sources: externalSources };
    for (const source of externalSources) {
      if (evidence.has(source.id)) fail('UNKNOWN_EVIDENCE', 'Uma referência da pesquisa colidiu com um identificador original.');
      evidence.set(source.id, source.excerpt);
    }
  }
  let article = await call('write', 1, { plan }) as WritingArticle;
  const checks = (article: WritingArticle) => {
    const memory = writingMemoryChecks(article, input.source), provided = input.validateArticle?.(article, externalSources);
    if (!memory.length) return provided ?? (statisticEvidence.size ? [] : undefined);
    return [...memory, ...(provided ?? []).filter(issue => !memory.some(item => item.code === issue.code && item.blockId === issue.blockId))];
  };
  let review = await call('review', 1, { plan, article, deterministicChecks: checks(article) }) as WritingReview;
  if (review.decision === 'needs_reporting') fail('WRITING_NEEDS_REPORTING', 'A revisão identificou falta de apuração. O artigo permanece no registro da execução para análise.');
  if (review.decision === 'revise' && configuration.maxCorrections > 0) {
    const previousArticle = article;
    article = await call('correct', 1, { plan, article, review }) as WritingArticle;
    review = await call('review', 2, { plan, article, previousArticle, review, deterministicChecks: checks(article) }) as WritingReview;
  }
  if (review.decision !== 'ready_for_human') fail(review.decision === 'needs_reporting' ? 'WRITING_NEEDS_REPORTING' : 'WRITING_REVIEW_UNRESOLVED',
    'A revisão ainda tem pendências. Confira o artigo e os problemas da execução; nenhuma versão foi marcada como pronta.');
  return { article, review, inputTokens, outputTokens, ...(research ? { research, externalSources } : {}) };
}
