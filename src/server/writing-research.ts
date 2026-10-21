import 'server-only';
import { z } from 'zod';
import type { EditorialPolicy } from '../domain/editorial-policy.ts';
import type { WritingTrace } from '../domain/writing-orchestration.ts';
import { excludedResearchUrl, researchUrlKey, writingResearchExclusions } from '../domain/writing-research.ts';
import type { WritingExternalSource, WritingResearchPlan, WritingResearchQueryTrace, WritingResearchSettings, WritingResearchSnapshot } from '../domain/writing-research.ts';
import { contentHash, stableStringify } from '../domain/text/hash.ts';
import { cacheRead, cacheWrite } from './storage';
import { FlowError, safeCode } from './errors';
import { searchWebEvidence } from './tavily';

const sourceSchema = z.object({ id: z.string(), kind: z.literal('external'), provider: z.literal('tavily'), query: z.string(),
  title: z.string(), url: z.string(), site: z.string(), excerpt: z.string().min(1).max(1200), publishedOn: z.string().nullable(), retrievedAt: z.string() });
const snapshotSchema = z.object({ status: z.enum(['completed', 'partial', 'failed', 'skipped']), startedAt: z.string(), completedAt: z.string(),
  queries: z.array(z.object({ query: z.string(), purpose: z.string(), evidenceIds: z.array(z.string()), status: z.enum(['completed', 'failed']),
    startedAt: z.string(), completedAt: z.string(), sourceIds: z.array(z.string()), requestId: z.string().nullable().optional(),
    credits: z.number().nonnegative().nullable().optional(), error: z.string().optional(), reason: z.string().optional() })).max(3),
  sources: z.array(sourceSchema).max(10), excludedDomains: z.array(z.string()), excludedUrls: z.array(z.string()), reason: z.string().optional() });

export type WritingResearchInput = { settings: WritingResearchSettings; plan: WritingResearchPlan; policy?: EditorialPolicy;
  directory: string; signal: AbortSignal; trace: (trace: WritingTrace) => Promise<void>; search?: typeof searchWebEvidence; now?: () => string };

/** One bounded supplementary search batch; original facts and interview metadata are never changed. */
export async function runWritingResearch(input: WritingResearchInput): Promise<WritingResearchSnapshot> {
  const { settings, plan, signal } = input, now = input.now ?? (() => new Date().toISOString());
  if (!settings.enabled || !Number.isInteger(settings.maxQueries) || settings.maxQueries < 1 || settings.maxQueries > 3
    || plan.queries.length > settings.maxQueries || !Number.isInteger(settings.maxResults) || settings.maxResults < 1 || settings.maxResults > 5
    || !Number.isInteger(settings.maxSources) || settings.maxSources < 1 || settings.maxSources > 10
    || !Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 5000 || settings.timeoutMs > 30000)
    throw new FlowError('WRITING_RESEARCH_INVALID', 422);
  const exclusions = writingResearchExclusions(settings, input.policy);
  const request = { settings, plan, ...exclusions };
  const hash = contentHash({ version: 'writing-research-v1', request });
  const base: WritingTrace = { id: 'research-1', stage: 'research', attempt: 1, status: 'running', startedAt: now(),
    model: 'tavily/search-basic', provider: 'tavily', hash,
    prompt: { system: 'Pesquisa complementar Tavily Search basic. Consultas do plano, sem nova chamada a um modelo.', user: stableStringify(request) } };
  await input.trace(base);
  let snapshot: WritingResearchSnapshot | undefined, cached = false;
  try {
    if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
    const stored = snapshotSchema.safeParse(await cacheRead(input.directory, 'writing-research-' + hash));
    if (stored.success && stored.data.queries.length === plan.queries.length && stored.data.sources.length <= settings.maxSources
      && stored.data.queries.every((query, index) => query.query === plan.queries[index].query
        && stableStringify(query.evidenceIds) === stableStringify(plan.queries[index].evidenceIds))
      && stored.data.sources.every(source => !excludedResearchUrl(source.url, exclusions))) {
      snapshot = stored.data; cached = true;
    }
    if (!snapshot) {
      const batches = await Promise.all(plan.queries.map(async (query) => {
        const startedAt = now();
        try {
          const result = await (input.search ?? searchWebEvidence)(query.query, signal,
            { maxResults: settings.maxResults, timeoutMs: settings.timeoutMs, excludeDomains: exclusions.excludedDomains, maxExcerptCharacters: 1200 });
          if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
          const completedAt = now();
          const sources: WritingExternalSource[] = result.sources.filter(source => !excludedResearchUrl(source.url, exclusions))
            .slice(0, settings.maxResults).map(source => ({ id: 'web-' + contentHash({ url: researchUrlKey(source.url), excerpt: source.excerpt }),
              kind: 'external', provider: 'tavily', query: query.query, title: source.title, url: source.url, site: source.site,
              excerpt: source.excerpt.slice(0, 1200), publishedOn: source.publishedOn ?? null, retrievedAt: completedAt }));
          const trace: WritingResearchQueryTrace = { ...query, status: 'completed', startedAt, completedAt,
            sourceIds: [], requestId: result.requestId, credits: result.credits,
            ...(!sources.length ? { reason: 'Nenhum resultado utilizável após aplicar as exclusões.' } : {}) };
          return { trace, sources };
        } catch (error) {
          if (signal.aborted || error instanceof FlowError && error.code === 'JOB_INTERRUPTED') throw new FlowError('JOB_INTERRUPTED', 409);
          const trace: WritingResearchQueryTrace = { ...query, status: 'failed', startedAt, completedAt: now(), sourceIds: [], error: safeCode(error),
            reason: 'A busca não foi concluída. Confira a disponibilidade e as credenciais da Tavily, ou escolha continuar somente com o conteúdo original.' };
          return { trace, sources: [] as WritingExternalSource[] };
        }
      }));
      if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
      const failures = batches.filter(batch => batch.trace.status === 'failed').length;
      const sources: WritingExternalSource[] = [], urls = new Set<string>();
      for (const batch of batches) for (const source of batch.sources) {
        const key = researchUrlKey(source.url)!;
        const existing = sources.find(item => researchUrlKey(item.url) === key);
        if (existing && !batch.trace.sourceIds.includes(existing.id)) batch.trace.sourceIds.push(existing.id);
        else if (sources.length < settings.maxSources && !urls.has(key)) { sources.push(source); urls.add(key); batch.trace.sourceIds.push(source.id); }
      }
      // Continuing after a failed search is an explicit original-only fallback, not silent partial enrichment.
      const fallback = failures > 0 && settings.failureMode === 'continue_original';
      snapshot = { status: !plan.queries.length ? 'skipped' : failures === batches.length ? 'failed' : failures ? 'partial' : 'completed',
        startedAt: base.startedAt, completedAt: now(), queries: batches.map(batch => batch.trace), sources,
        ...exclusions, ...(!plan.queries.length ? { reason: plan.reason } : failures ? { reason: fallback
          ? 'Uma ou mais buscas falharam. Pela configuração, a redação continuará apenas com o conteúdo original; os resultados parciais ficam registrados, sem uso no artigo.'
          : 'Uma ou mais buscas falharam. A configuração exige interromper antes da redação; revise a pesquisa e tente novamente.' }
          : !sources.length ? { reason: 'A pesquisa não retornou contexto utilizável. O artigo segue com o conteúdo original, sem preencher as lacunas.' } : {}) };
      await cacheWrite(input.directory, 'writing-research-' + hash, snapshot);
    }
    const failed = snapshot.queries.some(query => query.status === 'failed');
    await input.trace({ ...base, status: failed ? 'failed' : 'completed', completedAt: now(), cached, research: snapshot, output: snapshot,
      ...(failed ? { error: 'WRITING_RESEARCH_FAILED', reason: snapshot.reason } : {}) });
    if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
    if (failed && settings.failureMode === 'stop') {
      const error = new FlowError('WRITING_RESEARCH_FAILED', 502); error.reason = snapshot.reason; throw error;
    }
    return snapshot;
  } catch (error) {
    if (!(error instanceof FlowError && error.code === 'WRITING_RESEARCH_FAILED'))
      await input.trace({ ...base, status: 'failed', completedAt: now(), error: signal.aborted ? 'JOB_INTERRUPTED' : safeCode(error),
        ...(snapshot ? { research: snapshot, output: snapshot, cached } : {}) });
    throw error;
  }
}
