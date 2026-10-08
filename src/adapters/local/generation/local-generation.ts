import type { ArticleBody } from '../../../domain/article.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import type { ActorId, ProductionId, RunId, StepId } from '../../../domain/ids.ts';
import { isRunActive, RUN_KIND_LABELS, SIMULATED_MODEL } from '../../../domain/run.ts';
import type { GenerationRun, ModelInfo, PromptRef, RunKind } from '../../../domain/run.ts';
import type { RunEventPayload, RunFold } from '../../../domain/run-events.ts';
import { findVersion, latestApproved, pieceOfKind } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { personLine } from '../../../domain/workspace.ts';
import type { Person } from '../../../domain/workspace.ts';
import { dedupeRefs, sameVersionRef } from '../../../domain/refs.ts';
import type { Ref, VersionRef } from '../../../domain/refs.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { canGenerate } from '../../../domain/rules/generate.ts';
import { briefHash } from '../../../domain/production.ts';
import { contentHash } from '../../../domain/text/hash.ts';
import { mainOrganization } from '../../../domain/text/kicker.ts';
import { currentSourceVersion } from '../../../domain/source.ts';
import type { Unsubscribe } from '../../../ports/common.ts';
import { GENERATION_LABELS, REWRITE_TONE_LABELS, RUN_KIND_OF, SLIDE_ASSIST_LABELS } from '../../../ports/generation.ts';
import type {
  GenerationInputs,
  GenerationKind,
  GenerationRequest,
  GenerationService,
  RunAttachment,
  RunMeta,
  RunSnapshot,
  StartOptions,
  StartRefusal,
} from '../../../ports/generation.ts';
import type { ScriptBook } from '../../../ports/script-book.ts';
import type { Clock, IdGenerator } from '../../../ports/system.ts';
import { planCarouselAssist } from './carousel-assist.ts';
import type { SlotMeasure } from './carousel-assist.ts';
import { planApplyNote, planAsk, planExpand, planRewrite, planShorten, planSubheadings, planTitles, planToList } from './assist-plan.ts';
import type { AssistContext, AssistPlan } from './assist-plan.ts';
import { extractiveCarouselPlan, planFromCarouselScript } from './carousel-plan.ts';
import type { CarouselPlan } from './carousel-plan.ts';
import { extractivePlan, planFromScript } from './draft-plan.ts';
import type { DraftPlan } from './draft-plan.ts';
import type { SpeakerInfo } from './editorial.ts';
import { CHILD_STEP, createRegistry, createRunApi, isTerminal, liveEvents } from './engine.ts';
import type { ChildOpener, Reuse, RunApi, RunChannel } from './engine.ts';
import { createPacing, realtimeSleep } from './pacing.ts';
import type { Sleep } from './pacing.ts';
import { createRng } from './random.ts';
import { planMatchesFold, settledFold, stepOutputsFromFold } from './rehydrate.ts';
import { failingStep, LOCAL_SCENARIOS, promptRef, recipeSteps, sectionPromptRef } from './recipes.ts';
import type { ConcreteStep } from './recipes.ts';
import { runAssist } from './run-assist.ts';
import { runCarousel } from './run-carousel.ts';
import { runDraft } from './run-draft.ts';

/**
 * Local simulated GenerationService ("Simulação local"). Runs live in this browser session;
 * outputs are deterministic (seeded), never invent facts and never carry usage or cost.
 * The store records runs and settles their outputs by applying every `watch` update with
 * `applyRunUpdate` (record-sync.ts); this service never writes the record itself.
 */

export type LocalGenerationDeps = {
  clock: Clock;
  ids: IdGenerator;
  /** Current record of a production (the store's `records.record`), for validation and planning. */
  getRecord: (productionId: ProductionId) => ProductionRecord | undefined;
  /** Acting person (SessionPort.current), recorded as `createdBy`. */
  actorId: () => ActorId | Promise<ActorId>;
  /** Hand-written outputs for fixture material (fixtures module). */
  scripts?: ScriptBook;
  /** Carousel templates (structure), usually `RenderService.templates()`. */
  templates?: () => readonly CarouselTemplate[];
  /** People of the workspace (name and role line), for attribution in extractive drafts. */
  people?: () => readonly Person[];
  /** Approximate slot fit of a carousel body (`RenderService.measure`), for "Encurtar para caber". */
  measure?: SlotMeasure;
  /** Delay function; tests inject an instant one. */
  sleep?: Sleep;
  /** Multiplies every simulated delay (1 = natural pace). */
  pace?: number;
  /** Seed of the deterministic PRNG. */
  seed?: string;
  /**
   * Persisted stream snapshot of a run (the store's `runs.fold`). With it, a run of an earlier
   * session (a failed fixture run, a run a reload interrupted) can be attached and retried from
   * a step like a live one.
   */
  persistedFold?: (runId: RunId) => RunFold | undefined;
};

export type AdoptRefusal = StartRefusal | 'not_running' | 'unsupported' | 'plan_changed';

/**
 * `strict`: continue only when the plan computed again matches what the run already wrote (a run
 * a reload left behind); seeded fixture runs are adopted as they are.
 */
export type AdoptOptions = { strict?: boolean };

/** The port plus what only the runtime uses: taking over runs that are mid-stream. */
export type LocalGenerationService = GenerationService & {
  adopt(fold: RunFold, options?: AdoptOptions): Promise<Result<{ runId: RunId }, AdoptRefusal>>;
};

type Prepared = {
  plan: DraftPlan | AssistPlan | CarouselPlan;
  steps: ConcreteStep[];
  inputs: Ref[];
  promptVariant?: string;
  label: string;
  execute: (api: RunApi) => Promise<void>;
};

const BLOCKING_KINDS = new Set<GenerationKind>(['article.draft', 'carousel.copy']);

type RunStartedPayload = Extract<RunEventPayload, { type: 'run.started' }>;

function labelOf(request: GenerationRequest): string {
  if (request.kind === 'article.rewrite') return REWRITE_TONE_LABELS[request.input.tone];
  if (request.kind === 'article.draft') return RUN_KIND_LABELS['article.generate'];
  if (request.kind === 'carousel.assist') return SLIDE_ASSIST_LABELS[request.input.action];
  return GENERATION_LABELS[request.kind];
}

export function createLocalGenerationService(deps: LocalGenerationDeps): LocalGenerationService {
  const now = () => deps.clock.now();
  const newId = (prefix: string) => deps.ids.next(prefix);
  const registry = createRegistry(now);
  const sleep = deps.sleep ?? realtimeSleep;
  const seed = deps.seed ?? 'reporter-sim';

  const generationInputs = (record: ProductionRecord, kind: 'article' | 'carousel'): Result<Ref[], StartRefusal> => {
    const context = canGenerate(record, kind);
    return context.ok ? ok(context.value.inputs) : refuse(context.refusal.code, context.refusal.message, context.refusal.details);
  };

  const assistContext = (record: ProductionRecord): AssistContext => ({
    sources: record.sources,
    newId,
    ...(deps.scripts ? { scripts: deps.scripts } : {}),
  });

  const planAssist = (record: ProductionRecord, request: GenerationRequest, body: ArticleBody): Result<AssistPlan, StartRefusal> => {
    const context = assistContext(record);
    switch (request.kind) {
      case 'article.rewrite':
        return planRewrite(body, request.input.target, request.input.tone, context);
      case 'article.shorten':
        return planShorten(body, request.input.target, request.input.targetWords, context);
      case 'article.expand-from-source':
        return planExpand(body, request.input.target, context);
      case 'article.to-list':
        return planToList(body, request.input.target, context);
      case 'article.titles':
        return planTitles(body, context);
      case 'article.subheadings':
        return planSubheadings(body, context);
      case 'article.ask':
        return planAsk(body, request.input.prompt, request.input.target, context);
      case 'article.apply-note':
        return planApplyNote(body, request.input.note, request.input.anchors, context);
      default:
        return refuse('invalid_target', 'Ação desconhecida.');
    }
  };

  /**
   * Ids of a plan's blocks and slides, derived from what the plan is computed from. Re-planning
   * the same run later (after a reload) yields the same ids, so its persisted snapshot still
   * matches the plan and a retry continues it.
   */
  const planIds = (key: string) => {
    const tag = contentHash(key).slice(0, 8);
    let counter = 0;
    return (prefix: string) => {
      counter += 1;
      return `${prefix}-${tag}-${counter.toString(36)}`;
    };
  };

  /** Speaker label → person (name and role line), from the source's "Falantes" mapping. */
  const speakerInfo = (record: ProductionRecord): Record<string, SpeakerInfo> => {
    const people = deps.people?.() ?? [];
    const info: Record<string, SpeakerInfo> = {};
    for (const source of record.sources) {
      for (const speaker of source.speakers) {
        const person = speaker.personId ? people.find((candidate) => candidate.id === speaker.personId) : undefined;
        const line = person ? personLine(person) : undefined;
        if (person) info[speaker.label] = line ? { name: person.name, title: line } : { name: person.name };
      }
    }
    return info;
  };

  /** Organisation of the people linked to the speakers, weighted by how much each one speaks. */
  const brandOf = (record: ProductionRecord): string | undefined => {
    const people = deps.people?.() ?? [];
    return mainOrganization(
      record.sources.flatMap((source) => {
        const segments = currentSourceVersion(source).content.segments;
        return source.speakers.map((speaker) => ({
          organization: people.find((person) => person.id === speaker.personId)?.organization,
          weight: segments.filter((segment) => segment.speaker === speaker.label).length,
        }));
      }),
    );
  };

  const prepareDraft = (record: ProductionRecord, pieceId: string, options: StartOptions): Result<Prepared, StartRefusal> => {
    const inputs = generationInputs(record, 'article');
    if (!inputs.ok) return inputs;
    let plan: DraftPlan | undefined;
    for (const source of record.sources) {
      const script = deps.scripts?.draft(source.id);
      plan = script ? planFromScript(script, record.sources, newId, record.production.brief) : undefined;
      if (plan) break;
    }
    if (!plan) {
      const attempt = record.runs.filter((run) => run.kind === 'article.generate' && run.pieceId === pieceId && !run.retryOfRunId).length;
      const sourceKey = record.sources.map((source) => source.versions[source.versions.length - 1].hash).join(',');
      const planKey = `${seed}:${sourceKey}:${briefHash(record.production.brief)}:${attempt}`;
      const extracted = extractivePlan({
        sources: record.sources,
        brief: record.production.brief,
        fallbackTitle: record.production.title,
        speakers: speakerInfo(record),
        rng: createRng(planKey),
        newId: planIds(`article:${pieceId}:${planKey}`),
      });
      if (!extracted.ok) return extracted;
      plan = extracted.value;
    }
    const draft = plan;
    const steps = recipeSteps('article.draft', draft.sections.length);
    const reviewOutline = options.reviewOutline === true || options.simulation === 'review-outline';
    return ok({
      plan: draft,
      steps,
      inputs: inputs.value,
      label: RUN_KIND_LABELS['article.generate'],
      execute: (api) => runDraft({ api, plan: draft, steps, sources: record.sources, inputs: inputs.value, reviewOutline }),
    });
  };

  const prepareCarousel = (record: ProductionRecord, request: Extract<GenerationRequest, { kind: 'carousel.copy' }>): Result<Prepared, StartRefusal> => {
    const inputs = generationInputs(record, 'carousel');
    if (!inputs.ok) return inputs;
    const piece = record.pieces.find((candidate) => candidate.id === request.input.pieceId);
    const pieceTemplate = piece?.draft.body.type === 'carousel' ? piece.draft.body.templateId : undefined;
    const templateId = request.input.templateId ?? pieceTemplate;
    if (pieceTemplate && templateId !== pieceTemplate) {
      return refuse('unknown_template', 'O carrossel usa outro modelo; troque o modelo da peça antes de gerar.');
    }
    const template = deps.templates?.().find((candidate) => candidate.id === templateId);
    if (!template) return refuse('unknown_template', 'Modelo de carrossel não encontrado.');
    const article = pieceOfKind(record, 'article');
    const approved = article ? latestApproved(record, article.id) : undefined;
    if (!approved) return refuse('parent_not_ready', 'Disponível após aprovar o artigo.');
    const from: VersionRef = request.input.from ?? approved.ref;
    if (!sameVersionRef(from, approved.ref)) {
      return refuse('parent_not_ready', `Use a versão aprovada mais recente do artigo (v${approved.ref.number}).`);
    }
    const version = findVersion(record, from.versionId);
    if (!version || version.body.type !== 'article') return refuse('parent_not_ready', 'Versão do artigo não encontrada.');
    const body = version.body;
    const slides = Math.min(template.maxSlides, Math.max(template.minSlides, request.input.slides ?? 5));
    const attempt = record.runs.filter((run) => run.kind === 'carousel.generate' && run.pieceId === request.input.pieceId && !run.retryOfRunId).length;
    const slideIds = planIds(`carousel:${request.input.pieceId}:${from.versionId}:${template.id}:${slides}:${attempt}`);
    let plan: CarouselPlan | undefined;
    for (const source of record.sources) {
      const copy = deps.scripts?.carousel(source.id);
      plan = copy ? planFromCarouselScript(copy, { article: body, template, slides, newId: slideIds }) : undefined;
      if (plan) break;
    }
    const brand = brandOf(record);
    const carousel =
      plan ?? extractiveCarouselPlan({ article: body, template, slides, sources: record.sources, ...(brand ? { brand } : {}), subject: record.production.title, newId: slideIds });
    return ok({
      plan: carousel,
      steps: recipeSteps('carousel.copy'),
      inputs: inputs.value,
      label: GENERATION_LABELS['carousel.copy'],
      execute: (api) => runCarousel({ api, plan: carousel, article: body, parent: from, template, ...(deps.measure ? { measure: deps.measure } : {}) }),
    });
  };

  const prepareCarouselAssist = (record: ProductionRecord, request: Extract<GenerationRequest, { kind: 'carousel.assist' }>): Result<Prepared, StartRefusal> => {
    const inputs = generationInputs(record, 'carousel');
    if (!inputs.ok) return inputs;
    const piece = record.pieces.find((candidate) => candidate.id === request.input.pieceId);
    const { body, action } = request.input;
    const template = deps.templates?.().find((candidate) => candidate.id === body.templateId);
    const from = piece?.draft.inputs[0];
    const source = from ? findVersion(record, from.versionId) : undefined;
    const articlePiece = pieceOfKind(record, 'article');
    const approved = articlePiece ? latestApproved(record, articlePiece.id) : undefined;
    const plan = planCarouselAssist(action, request.input.slideIds, {
      body,
      template,
      article: source?.body.type === 'article' ? source.body : undefined,
      approved: approved?.version.body.type === 'article' ? approved.version.body : undefined,
      measure: deps.measure,
      newId,
    });
    if (!plan.ok) return plan;
    const steps = recipeSteps(request.kind);
    const assist = plan.value;
    return ok({
      plan: assist,
      steps,
      inputs: [...inputs.value, ...(action === 'update' && approved ? [approved.ref] : from ? [from] : [])],
      promptVariant: action,
      label: SLIDE_ASSIST_LABELS[action],
      execute: (api) => runAssist(api, assist, steps),
    });
  };

  /** Validates a request against the current record and computes the run's full output. */
  const prepare = (record: ProductionRecord, request: GenerationRequest, options: StartOptions): Result<Prepared, StartRefusal> => {
    const piece = record.pieces.find((candidate) => candidate.id === request.input.pieceId);
    const wantedKind = request.kind === 'carousel.copy' || request.kind === 'carousel.assist' ? 'carousel' : 'article';
    if (!piece || piece.kind !== wantedKind) return refuse('unknown_piece', 'Peça não encontrada nesta produção.');
    if (request.kind === 'article.draft') return prepareDraft(record, piece.id, options);
    if (request.kind === 'carousel.copy') return prepareCarousel(record, request);
    if (request.kind === 'carousel.assist') return prepareCarouselAssist(record, request);

    const inputs = generationInputs(record, 'article');
    if (!inputs.ok) return inputs;
    const assist = planAssist(record, request, request.input.body);
    if (!assist.ok) return assist;
    const steps = recipeSteps(request.kind);
    const plan = assist.value;
    return ok({
      plan,
      steps,
      inputs: inputs.value,
      ...(request.kind === 'article.rewrite' ? { promptVariant: request.input.tone } : {}),
      label: labelOf(request),
      execute: (api) => runAssist(api, plan, steps),
    });
  };

  const busy = (pieceId: string): boolean =>
    [...registry.runs.values()].some(
      (channel) => !channel.meta.child && channel.meta.pieceId === pieceId && !isTerminal(channel) && BLOCKING_KINDS.has(channel.meta.request.kind),
    );

  /** The `run.started` payload of a run (child runs pass their own kind, prompt and steps). */
  const startedPayload = (
    request: GenerationRequest,
    prepared: Prepared,
    actor: ActorId,
    extra: { retryOfRunId?: RunId; parentRunId?: RunId; kind?: RunKind; prompt?: PromptRef; steps?: { id: string; label: string }[]; inputs?: Ref[] },
  ): RunStartedPayload => {
    const started: RunStartedPayload = {
      type: 'run.started',
      kind: extra.kind ?? RUN_KIND_OF[request.kind],
      productionId: request.input.productionId,
      pieceId: request.input.pieceId,
      prompt: extra.prompt ?? promptRef(request.kind, prepared.promptVariant),
      model: SIMULATED_MODEL,
      inputs: dedupeRefs(extra.inputs ?? prepared.inputs),
      steps: extra.steps ?? prepared.steps.map((step) => ({ id: step.id, label: step.label })),
      createdBy: actor,
    };
    if (extra.parentRunId) started.parentRunId = extra.parentRunId;
    if (extra.retryOfRunId) started.retryOfRunId = extra.retryOfRunId;
    return started;
  };

  const launch = async (
    request: GenerationRequest,
    options: StartOptions,
    retry?: { of: RunChannel; reuse: Reuse; prepared: Prepared },
  ): Promise<Result<{ runId: RunId }, StartRefusal>> => {
    if (options.modelAlias && options.modelAlias !== SIMULATED_MODEL.alias) {
      return refuse('unknown_model', 'Modelo indisponível nesta simulação.');
    }
    const record = deps.getRecord(request.input.productionId);
    if (!record) return refuse('unknown_production', 'Produção não encontrada.');
    if (busy(request.input.pieceId)) return refuse('run_in_progress', 'Já existe uma geração em andamento.');
    let prepared: Prepared;
    if (retry) {
      const allowed = generationInputs(record, request.kind === 'carousel.copy' || request.kind === 'carousel.assist' ? 'carousel' : 'article');
      if (!allowed.ok) return allowed;
      prepared = retry.prepared;
    } else {
      const result = prepare(record, request, options);
      if (!result.ok) return result;
      prepared = result.value;
    }

    const actor = await deps.actorId();
    const runId = newId('run');
    const started = startedPayload(request, prepared, actor, retry ? { retryOfRunId: retry.of.meta.runId } : {});
    const meta: RunMeta = { runId, productionId: request.input.productionId, pieceId: request.input.pieceId, request, label: prepared.label };
    const channel = registry.open(meta, started, options, prepared);
    drive(channel, prepared, actor, options, retry?.reuse);
    return ok({ runId });
  };

  /** Runs the executor of a channel: child runs, pacing, scenario failures, reuse of a previous attempt. */
  const drive = (channel: RunChannel, prepared: Prepared, actor: ActorId, options: StartOptions, reuse?: Reuse): void => {
    const { meta } = channel;
    const runId = meta.runId;
    const rng = createRng(`${seed}:${runId}`);
    const pace = (deps.pace ?? 1) * (options.simulation === 'slow' ? 3 : 1);
    const openChild: ChildOpener = (stepId, label, evidence) => {
      const childId = newId('run');
      const childStarted = startedPayload(meta.request, prepared, actor, {
        parentRunId: runId,
        kind: 'article.section',
        prompt: sectionPromptRef(),
        steps: [{ id: CHILD_STEP, label }],
        inputs: [...prepared.inputs, ...evidence],
      });
      const childMeta: RunMeta = { ...meta, runId: childId, label, child: { parentRunId: runId, stepId } };
      const child = registry.open(childMeta, childStarted, {}, undefined);
      registry.emit(child, { type: 'step.started', stepId: CHILD_STEP });
      return child;
    };
    const failAt = failingStep(options.simulation, prepared.steps);
    const api = createRunApi({
      registry,
      channel,
      rng,
      pacing: createPacing(rng, pace),
      sleep,
      openChild,
      ...(reuse ? { reuse } : {}),
      ...(failAt ? { failAt } : {}),
    });
    void (async () => {
      try {
        await prepared.execute(api);
      } catch {
        if (!isTerminal(channel)) {
          registry.emit(channel, { type: 'run.failed', error: { code: 'internal', message: 'Erro inesperado na simulação.', retryable: true } });
        }
      }
    })();
  };

  /**
   * Continues a run that is already in progress but driven by nobody (a seeded fixture run, the
   * "uau" of the overview, a run a reload or a closed tab left behind): finished steps stay as
   * they are and the stream goes on in place.
   */
  const adopt = async (fold: RunFold, options: AdoptOptions = {}): Promise<Result<{ runId: RunId }, AdoptRefusal>> => {
    const { run } = fold;
    if (!isRunActive(run)) return refuse('not_running', 'A geração já terminou.');
    if (registry.runs.has(run.id)) return ok({ runId: run.id });
    if (run.parentRunId || !run.pieceId) return refuse('unsupported', 'Seções são retomadas pela geração principal.');
    const request: GenerationRequest | undefined =
      run.kind === 'article.generate'
        ? { kind: 'article.draft', input: { productionId: run.productionId, pieceId: run.pieceId } }
        : run.kind === 'carousel.generate'
          ? { kind: 'carousel.copy', input: { productionId: run.productionId, pieceId: run.pieceId } }
          : undefined;
    if (!request) return refuse('unsupported', 'Só gerações de artigo e de carrossel são retomadas.');
    const record = deps.getRecord(run.productionId);
    if (!record) return refuse('unknown_production', 'Produção não encontrada.');
    // The run itself is the "run in progress" the rules would refuse; plan as if it were not there.
    const others = { ...record, runs: record.runs.filter((entry) => entry.id !== run.id && entry.parentRunId !== run.id) };
    const prepared = prepare(options.strict ? recordBefore(record, run) : others, request, {});
    if (!prepared.ok) return prepared;
    if (options.strict) {
      const plan = prepared.value.plan as DraftPlan | CarouselPlan;
      if (!planMatchesFold(plan, prepared.value.steps.map((step) => step.id), fold)) {
        return refuse('plan_changed', 'O material ou a pauta mudaram desde esta geração.');
      }
    }
    const meta: RunMeta = { runId: run.id, productionId: run.productionId, pieceId: run.pieceId, request, label: prepared.value.label };
    const channel = registry.adopt(meta, fold, { ...prepared.value, inputs: run.inputs });
    drive(channel, { ...prepared.value, inputs: run.inputs }, run.createdBy, {});
    return ok({ runId: run.id });
  };

  /** The record as it was when `run` was planned: only the runs before its first attempt. */
  const recordBefore = (record: ProductionRecord, run: GenerationRun): ProductionRecord => {
    let root = run;
    for (let guard = 0; root.retryOfRunId && guard < record.runs.length; guard += 1) {
      const previous = record.runs.find((entry) => entry.id === root.retryOfRunId);
      if (!previous) break;
      root = previous;
    }
    const index = record.runs.findIndex((entry) => entry.id === root.id);
    return { ...record, runs: index < 0 ? record.runs.filter((entry) => entry.id !== run.id) : record.runs.slice(0, index) };
  };

  /**
   * Reopens a finished run of an earlier session from its persisted snapshot: same steps and
   * text, and the outputs of its finished steps, so attach shows it and retry continues it. The
   * plan is computed again (deterministic); when it no longer matches the run (material or brief
   * changed), the run can be attached but not continued.
   */
  const rehydrate = (runId: RunId): RunChannel | undefined => {
    const persisted = deps.persistedFold?.(runId);
    if (!persisted) return undefined;
    const record = deps.getRecord(persisted.run.productionId);
    if (!record) return undefined;
    const fold = settledFold(persisted, record.runs.find((entry) => entry.id === runId));
    if (!fold) return undefined;
    const { run } = fold;
    if (!run.pieceId) return undefined;
    if (run.parentRunId) {
      const parent = channelFor(run.parentRunId);
      if (!parent) return undefined;
      const label = run.steps[0]?.label ?? '';
      const stepId = parent.fold.run.steps.find((step) => step.label === label)?.id ?? run.steps[0]?.id ?? CHILD_STEP;
      const meta: RunMeta = { ...parent.meta, runId, label, child: { parentRunId: parent.meta.runId, stepId } };
      return registry.adopt(meta, fold, undefined);
    }
    const request: GenerationRequest | undefined =
      run.kind === 'article.generate'
        ? { kind: 'article.draft', input: { productionId: run.productionId, pieceId: run.pieceId } }
        : run.kind === 'carousel.generate'
          ? { kind: 'carousel.copy', input: { productionId: run.productionId, pieceId: run.pieceId } }
          : undefined;
    if (!request) return undefined;
    const prepared = prepare(recordBefore(record, run), request, {});
    const plan = prepared.ok ? (prepared.value.plan as DraftPlan | CarouselPlan) : undefined;
    const usable = prepared.ok && plan !== undefined && planMatchesFold(plan, prepared.value.steps.map((step) => step.id), fold);
    const meta: RunMeta = { runId, productionId: run.productionId, pieceId: run.pieceId, request, label: prepared.ok ? prepared.value.label : RUN_KIND_LABELS[run.kind] };
    if (!usable) meta.canRetry = false;
    const channel = registry.adopt(meta, fold, usable ? { ...prepared.value, inputs: run.inputs } : undefined);
    if (usable && plan) for (const [stepId, outputs] of stepOutputsFromFold(plan, fold)) channel.stepOutputs.set(stepId, outputs);
    return channel;
  };

  /** A run of this session, or a finished run of an earlier one reopened from its snapshot. */
  function channelFor(runId: RunId): RunChannel | undefined {
    return registry.runs.get(runId) ?? rehydrate(runId);
  }

  const parentOf = (channel: RunChannel): RunChannel => {
    const parentId = channel.meta.child?.parentRunId;
    return (parentId ? channelFor(parentId) : undefined) ?? channel;
  };

  const notInSession = () => refuse('unknown_run' as const, 'Esta geração não está ativa nesta sessão.');

  return {
    adopt,
    async models(): Promise<ModelInfo[]> {
      return [SIMULATED_MODEL];
    },
    scenarios() {
      return LOCAL_SCENARIOS;
    },
    start<K extends GenerationKind>(kind: K, input: GenerationInputs[K], options: StartOptions = {}) {
      return launch({ kind, input } as GenerationRequest, options);
    },
    async attach(runId) {
      const channel = channelFor(runId);
      if (!channel) return notInSession();
      const snapshot = channel.fold;
      const attachment: RunAttachment = {
        meta: channel.meta,
        snapshot,
        events: liveEvents(registry, channel, snapshot.seq),
        subscribe: (listener) => registry.subscribe(channel, listener),
      };
      return ok(attachment);
    },
    async cancel(runId) {
      const found = channelFor(runId);
      if (!found) return notInSession();
      const channel = parentOf(found);
      if (isTerminal(channel)) return refuse('not_running', 'A geração já terminou.');
      channel.controller.abort();
      await channel.done;
      return ok(channel.fold);
    },
    async resume(runId, input) {
      const channel = registry.runs.get(runId);
      if (!channel) return notInSession();
      const awaiting = channel.awaiting;
      if (!awaiting) return refuse('not_awaiting', 'A geração não está esperando por você.');
      if (!awaiting.validate(input)) return refuse('invalid_input', 'Revise a estrutura: cada seção precisa de um título.');
      awaiting.resolve(input);
      return ok(true);
    },
    async retry(runId, fromStepId?: StepId) {
      const found = channelFor(runId);
      if (!found) return notInSession();
      const channel = parentOf(found);
      if (!isTerminal(channel)) return refuse('still_running', 'A geração ainda está em andamento.');
      if (!channel.plan) return refuse('plan_changed', 'O material ou a pauta mudaram desde esta geração. Use “Gerar nova versão”.');
      const steps = channel.fold.run.steps;
      const firstUnfinished = steps.findIndex((step) => step.state !== 'done');
      const from = fromStepId ?? found.meta.child?.stepId;
      if (firstUnfinished < 0) return refuse('nothing_to_retry', 'A geração terminou sem erros; use "Gerar nova versão".');
      const requested = from === undefined ? firstUnfinished : steps.findIndex((step) => step.id === from);
      if (requested < 0) return refuse('unknown_step', 'Etapa não encontrada nesta geração.');
      const startAt = Math.min(requested, firstUnfinished);
      const reuse: Reuse = { previousRunId: channel.meta.runId, steps: new Map() };
      for (const step of steps.slice(0, startAt)) reuse.steps.set(step.id, channel.stepOutputs.get(step.id) ?? []);
      const options: StartOptions = { ...channel.options };
      delete options.simulation;
      delete options.signal;
      return launch(channel.meta.request, options, { of: channel, reuse, prepared: channel.plan as Prepared });
    },
    snapshots(filter = {}): RunSnapshot[] {
      const list: RunSnapshot[] = [];
      for (const channel of registry.runs.values()) {
        if (filter.productionId && channel.meta.productionId !== filter.productionId) continue;
        if (filter.activeOnly && isTerminal(channel)) continue;
        list.push({ meta: channel.meta, fold: channel.fold });
      }
      return list.reverse();
    },
    watch(listener): Unsubscribe {
      registry.watchers.add(listener);
      return () => {
        registry.watchers.delete(listener);
      };
    },
  };
}
