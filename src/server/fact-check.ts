import 'server-only';
import { z } from 'zod';
import type { CitationView } from '../domain/citation-library.ts';
import { checkable, recheck } from '../domain/fact-check.ts';
import type { FactCheck } from '../domain/fact-check.ts';
import { can } from '../domain/permissions.ts';
import { pipelineTokenLimit } from '../domain/pipeline.ts';
import type { EditorialCheckpoint } from '../ports/connected-workspace.ts';
import { CITATION_SCOPE, citationRegistry } from './citation-library';
import { editorialTransaction } from './editorial';
import type { EditorialScope } from './editorial-store';
import { FlowError, forbiddenError, logEvent, safeCode } from './errors';
import { runFactCheck } from './fact-check-pipeline.ts';
import { activePipeline } from './pipeline';
import { searchEvidence } from './tavily';
import { generateStructured } from './text-generation';

/**
 * POST /citations/:id/check runs the fact check of one citation; /citations/:id/decision records
 * an editor's verdict on one claim. The model and the search run outside any transaction: the
 * citation is read, checked, then re-read and written, so a slow provider never holds the database.
 */

const MAX_FACT_CHECKS = 5000, MAX_OVERRIDES = 50;
// The check reads the active pipeline too: its quote-selection model is the one that checks.
const CHECK_READ_SCOPE: EditorialScope = { ...CITATION_SCOPE, pipelines: undefined };

function editable(checkpoint: EditorialCheckpoint, id: string): CitationView {
  const member = checkpoint.state.members.find(member => member.personId === checkpoint.state.sessionPersonId);
  if (!can(member, 'library.edit')) throw forbiddenError('library.edit');
  const citation = citationRegistry(checkpoint).items.find(item => item.id === id);
  if (!citation) throw new FlowError('NOT_FOUND', 404);
  if (!citation.authorized) throw new FlowError('SOURCE_NOT_AUTHORIZED', 422);
  return citation;
}

function store(checkpoint: EditorialCheckpoint, check: FactCheck) {
  const saved = checkpoint.factChecks ??= [];
  if (!saved.some(item => item.id === check.id) && saved.length >= MAX_FACT_CHECKS) throw new FlowError('LIBRARY_FULL', 422);
  checkpoint.factChecks = [...saved.filter(item => item.id !== check.id), check];
}

/** Checks one citation now; a citation already checked is returned as is unless `force`. */
export async function checkCitation(id: string, force: boolean): Promise<CitationView> {
  const read = (await editorialTransaction('runtime', async checkpoint => {
    const citation = editable(checkpoint, id);
    return { citation, model: activePipeline(checkpoint).definition.steps.quotes.model };
  }, false, 'reporter.edit', CHECK_READ_SCOPE)).value;
  if (read.citation.factCheck && !force) return read.citation;
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runFactCheck>>;
  try {
    result = await runFactCheck({ id, text: read.citation.text, speaker: read.citation.speaker,
      ...(read.citation.recordedOn ? { recordedOn: read.citation.recordedOn } : {}),
      ...(read.citation.relevance.trim() ? { context: read.citation.relevance.trim() } : {}) }, {
      generate: async (instruction, input, schema, signal) => {
        const output = await generateStructured('', '', schema, signal, { model: read.model, temperature: 0.1, maxTokens: pipelineTokenLimit(read.model),
          systemPrompt: instruction, userPrompt: JSON.stringify(input) });
        return { value: output.value, model: output.model };
      },
      search: searchEvidence,
      now: () => new Date().toISOString(),
    }, AbortSignal.timeout(150000));
  } catch (error) {
    logEvent('fact_check', 'failed', { error_code: safeCode(error), duration_ms: Date.now() - started });
    throw error;
  }
  logEvent('fact_check', 'completed', { duration_ms: Date.now() - started });
  return (await editorialTransaction('runtime', async checkpoint => {
    const citation = editable(checkpoint, id);
    const check = recheck(checkpoint.factChecks?.find(item => item.id === id), result);
    store(checkpoint, check);
    return { ...citation, factCheck: check };
  }, true, 'reporter.edit', CITATION_SCOPE)).value;
}

const decision = z.object({ claim: z.number().int().min(0).max(20), verdict: z.enum(['validated', 'disputed', 'not_validated']),
  reason: z.string().trim().min(3).max(300) }).strict();

/** The editor's verdict prevails over the model's and keeps its reason and author. */
export async function decideClaim(id: string, payload: unknown): Promise<CitationView> {
  const input = decision.parse(payload);
  return (await editorialTransaction('runtime', async checkpoint => {
    const citation = editable(checkpoint, id);
    const current = checkpoint.factChecks?.find(item => item.id === id);
    const claim = current?.claims[input.claim];
    if (!current || !claim || !checkable(claim.kind)) throw new FlowError('FACT_DECISION_INVALID', 422);
    const check: FactCheck = { ...current, overrides: [...current.overrides, { ...input, personId: checkpoint.state.sessionPersonId,
      at: new Date().toISOString() }].slice(-MAX_OVERRIDES) };
    store(checkpoint, check);
    return { ...citation, factCheck: check };
  }, true, 'reporter.edit', CITATION_SCOPE)).value;
}

export async function handleFactCheck(request: Request, path: string[], readJson: (request: Request) => Promise<unknown>) {
  const [id, action] = path;
  if (request.method !== 'POST' || !/^[a-f0-9]{16}$/.test(id ?? '')) throw new FlowError('NOT_FOUND', 404);
  const body = await readJson(request);
  const value = action === 'check' ? await checkCitation(id, z.object({ force: z.boolean().optional() }).strict().parse(body).force === true)
    : action === 'decision' ? await decideClaim(id, body) : undefined;
  if (!value) throw new FlowError('NOT_FOUND', 404);
  return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
}
