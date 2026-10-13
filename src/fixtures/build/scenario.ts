import {
  articleBodyFromRun,
  bodyHash,
  canDerive,
  canExport,
  canGenerate,
  decide,
  deliveryIdempotencyKey,
  EXPORT_CHANNEL,
  evaluatePieceChecks,
  foldRun,
  gateForPiece,
  hasAnyRole,
  latestApproved,
  latestVersion,
  pendingReview,
  plannedExportFiles,
  resolveExport,
  settleGeneration,
  toVersionRef,
} from '../../domain/index.ts';
import type {
  ActorId,
  Brief,
  CarouselBody,
  CarouselTemplate,
  CommandContext,
  Decision,
  DecisionAnchor,
  DecisionKind,
  Delivery,
  FeedbackEntry,
  GenerationRun,
  IsoDateTime,
  Piece,
  PieceBody,
  PieceKind,
  PersonId,
  ProductionRecord,
  ReviewRequest,
  RunEvent,
  RunId,
  Source,
  SourceVersionRef,
  Suggestion,
  TemplateId,
  Version,
  VersionOrigin,
  VersionRef,
} from '../../domain/index.ts';
import { FIXTURE_MEMBERS, WORKSPACE_ID } from '../people.ts';
import { after } from '../time.ts';
import { articleRunEvents, completedRun, runFromEvents } from './runs.ts';
import type { ArticleStreamPlan } from './runs.ts';

/**
 * Composes one production record step by step THROUGH THE DOMAIN RULES (canGenerate, canDerive,
 * decide, canExport). A fixture that breaks a rule fails at build time, so every seeded state
 * is one the product could really reach.
 */

export type ScenarioInit = {
  key: string;
  title: string;
  source: Source;
  ownerId: PersonId;
  /** REQ-T.1: only these people (plus the owner and admins) open the production. */
  restrictedTo?: PersonId[];
  createdAt: IsoDateTime;
  brief: Brief;
  plan: PieceKind[];
  templates: readonly CarouselTemplate[];
};

export type Scenario = {
  key: string;
  record: ProductionRecord;
  runEvents: Record<RunId, RunEvent[]>;
  feedback: FeedbackEntry[];
};

export type RequestOptions = { note?: string; assigneeId?: PersonId; dueOn?: string };

export type GenerateOptions = {
  body: PieceBody;
  /** When the run finished (the version is born at this instant). */
  endedAt: IsoDateTime;
  durationMs: number;
  by: PersonId;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function startScenario(init: ScenarioInit) {
  let counter = 0;
  const newId = (prefix: string) => `${prefix}-${init.key}-${++counter}`;
  const ctx = (now: IsoDateTime, actorId: ActorId): CommandContext => ({ now, newId, actorId });

  const record: ProductionRecord = {
    production: {
      id: `prod-${init.key}`,
      workspaceId: WORKSPACE_ID,
      flowId: 'transcript-article',
      title: init.title,
      sourceIds: [init.source.id],
      brief: init.brief,
      plan: init.plan,
      relations: [],
      ownerId: init.ownerId,
      ...(init.restrictedTo ? { restrictedTo: [...init.restrictedTo] } : {}),
      createdAt: init.createdAt,
      createdBy: init.ownerId,
      updatedAt: init.createdAt,
    },
    sources: [init.source],
    pieces: [],
    versions: [],
    decisions: [],
    reviewRequests: [],
    runs: [],
    suggestions: [],
    deliveries: [],
  };
  const scenario: Scenario = { key: init.key, record, runEvents: {}, feedback: [] };

  function addPiece(kind: PieceKind, body: PieceBody, at: IsoDateTime, by: PersonId): Piece {
    const piece: Piece = {
      id: `piece-${init.key}-${kind}`,
      productionId: record.production.id,
      kind,
      slug: kind,
      draft: { body, revision: 0, inputs: [], sources: [], updatedAt: at, updatedBy: by },
      createdAt: at,
      createdBy: by,
    };
    record.pieces.push(piece);
    return piece;
  }

  function piece(kind: PieceKind): Piece {
    const found = record.pieces.find((candidate) => candidate.kind === kind);
    if (!found) throw new Error(`${init.key}: no ${kind} piece`);
    return found;
  }

  function replaceDraft(kind: PieceKind, patch: Partial<Piece['draft']>, at: IsoDateTime, by: ActorId): void {
    const current = piece(kind);
    const next: Piece = { ...current, draft: { ...current.draft, ...patch, revision: current.draft.revision + 1, updatedAt: at, updatedBy: by } };
    record.pieces = record.pieces.map((candidate) => (candidate.id === next.id ? next : candidate));
  }

  function pushVersion(kind: PieceKind, body: PieceBody, origin: VersionOrigin, at: IsoDateTime, by: ActorId, extra: Partial<Version> = {}): Version {
    const current = piece(kind);
    const previous = latestVersion(record, current.id);
    const version: Version = {
      id: `ver-${init.key}-${kind}-${(previous?.number ?? 0) + 1}`,
      pieceId: current.id,
      number: (previous?.number ?? 0) + 1,
      body: clone(body),
      hash: bodyHash(body),
      origin,
      inputs: clone(extra.inputs ?? current.draft.inputs),
      sources: clone(extra.sources ?? current.draft.sources),
      createdBy: by,
      createdAt: at,
    };
    if (previous) version.basedOn = previous.id;
    if (extra.runId) version.runId = extra.runId;
    record.versions.push(version);
    replaceDraft(kind, { body: clone(body), basedOn: version.id, inputs: clone(version.inputs), sources: clone(version.sources) }, at, by);
    return version;
  }

  function touch(at: IsoDateTime): void {
    if (Date.parse(at) > Date.parse(record.production.updatedAt)) record.production = { ...record.production, updatedAt: at };
  }

  /** A finished generation: run (completed, simulated, no cost) + "v{n} · IA". */
  function generate(kind: PieceKind, options: GenerateOptions): Version {
    const allowed = canGenerate(record, kind);
    if (!allowed.ok) throw new Error(`${init.key}: cannot generate ${kind}: ${allowed.refusal.message}`);
    const startedAt = after(options.endedAt, { seconds: -options.durationMs / 1000 });
    const runId = newId('run');
    const target = piece(kind);
    const sources = allowed.value.inputs.filter((input): input is SourceVersionRef => input.kind === 'source-version');
    const version = pushVersion(kind, options.body, 'generation', options.endedAt, options.by, {
      runId,
      inputs: allowed.value.parents,
      sources,
    });
    const sections = options.body.type === 'article' ? record.production.brief.sections : undefined;
    record.runs.push(
      completedRun({
        id: runId,
        kind: kind === 'article' ? 'article.generate' : 'carousel.generate',
        productionId: record.production.id,
        pieceId: target.id,
        createdBy: options.by,
        inputs: allowed.value.inputs,
        startedAt,
        durationMs: options.durationMs,
        output: toVersionRef(version),
        ...(sections ? { sections } : {}),
      }),
    );
    touch(options.endedAt);
    return version;
  }

  /** ⌘S / "Enviar para aprovação" on an edited draft: a new `edit` version. */
  function saveEdit(kind: PieceKind, body: PieceBody, at: IsoDateTime, by: PersonId): Version {
    const version = pushVersion(kind, body, 'edit', at, by);
    touch(at);
    return version;
  }

  /** Autosave of the working draft (overwritten slot, no version). */
  function editDraft(kind: PieceKind, body: PieceBody, at: IsoDateTime, by: PersonId): void {
    replaceDraft(kind, { body: clone(body) }, at, by);
    touch(at);
  }

  /**
   * "Enviar para aprovação": "Quem aprova" must hold the gate's role and never be the sender;
   * "Para quando" is a local date (`localDateOf`). A string is the "Recado" alone.
   */
  function requestReview(kind: PieceKind, at: IsoDateTime, by: PersonId, send: string | RequestOptions = {}): ReviewRequest {
    const options: RequestOptions = typeof send === 'string' ? { note: send } : send;
    const target = piece(kind);
    const version = latestVersion(record, target.id);
    const gate = gateForPiece(kind);
    if (!version || !gate) throw new Error(`${init.key}: nothing to review in ${kind}`);
    if (options.assigneeId) {
      const assignee = FIXTURE_MEMBERS.find((member) => member.personId === options.assigneeId);
      if (!assignee || !hasAnyRole(assignee, gate.roles) || options.assigneeId === by) throw new Error(`${init.key}: ${options.assigneeId} cannot approve ${kind}`);
    }
    const request: ReviewRequest = { id: newId('rev'), gate: gate.id, subject: toVersionRef(version), requestedBy: by, requestedAt: at };
    if (options.note) request.note = options.note;
    if (options.assigneeId) request.assigneeId = options.assigneeId;
    if (options.dueOn) request.dueOn = options.dueOn;
    record.reviewRequests.push(request);
    touch(at);
    return request;
  }

  /** "Retirar envio para editar": the pending send of the piece stops waiting. */
  function withdrawReview(kind: PieceKind, at: IsoDateTime, by: PersonId): ReviewRequest {
    const target = piece(kind);
    const pending = pendingReview(record, target.id);
    if (!pending) throw new Error(`${init.key}: no pending send in ${kind}`);
    const withdrawn: ReviewRequest = { ...pending, withdrawnAt: at, withdrawnBy: by };
    record.reviewRequests = record.reviewRequests.map((request) => (request.id === pending.id ? withdrawn : request));
    touch(at);
    return withdrawn;
  }

  function decideOn(
    kind: PieceKind,
    decision: DecisionKind,
    at: IsoDateTime,
    by: PersonId,
    options: { note?: string; anchors?: DecisionAnchor[]; version?: Version } = {},
  ): Decision {
    const target = piece(kind);
    const version = options.version ?? latestVersion(record, target.id);
    const gate = gateForPiece(kind);
    if (!version || !gate) throw new Error(`${init.key}: nothing to decide in ${kind}`);
    const member = FIXTURE_MEMBERS.find((candidate) => candidate.personId === by);
    const checks = evaluatePieceChecks(record, target, version.body, init.templates);
    const result = decide(
      { ...record, ...(member ? { member } : {}) },
      {
        gate,
        subject: toVersionRef(version),
        decision,
        displayedHash: version.hash,
        checks,
        ...(options.note ? { note: options.note } : {}),
        ...(options.anchors ? { anchors: options.anchors } : {}),
      },
      ctx(at, by),
    );
    if (!result.ok) throw new Error(`${init.key}: decision refused: ${result.refusal.message}`);
    record.decisions.push(result.value);
    touch(at);
    return result.value;
  }

  /** Creates the carousel piece from the approved article (REQ-1.3: exact approved version). */
  function startCarousel(templateId: TemplateId, at: IsoDateTime, by: PersonId): VersionRef {
    const article = piece('article');
    const approved = latestApproved(record, article.id);
    if (!approved) throw new Error(`${init.key}: the article is not approved`);
    const derivable = canDerive(record, approved.ref);
    if (!derivable.ok) throw new Error(`${init.key}: ${derivable.refusal.message}`);
    const empty: CarouselBody = { type: 'carousel', templateId, slides: [] };
    addPiece('carousel', empty, at, by);
    return approved.ref;
  }

  function addRun(run: GenerationRun, events?: RunEvent[]): void {
    record.runs.push(run);
    if (events) scenario.runEvents[run.id] = events;
    touch(run.endedAt ?? run.startedAt ?? run.createdAt);
  }

  /**
   * An article run captured mid-stream (live on load) or failed at a step. The record's run is
   * the fold of its event log. A live run leaves the draft empty (the partial lives in the log);
   * a failed run settles exactly as the live path does (`settleRun`): its finished sections
   * become "v1 · interrompida" and the working draft, and the run points at that version.
   */
  function streamArticle(plan: Pick<ArticleStreamPlan, 'script' | 'stopAt' | 'outcome' | 'error' | 'startedAt'> & { by: PersonId }): GenerationRun {
    const allowed = canGenerate(record, 'article');
    if (!allowed.ok) throw new Error(`${init.key}: cannot generate article: ${allowed.refusal.message}`);
    const events = articleRunEvents({
      ...plan,
      id: newId('run'),
      productionId: record.production.id,
      pieceId: piece('article').id,
      createdBy: plan.by,
      inputs: allowed.value.inputs,
      source: init.source,
      brief: record.production.brief,
    });
    let run = runFromEvents(events);
    addRun(run, events);
    const fold = foldRun(events);
    const output = fold && plan.outcome === 'failed' ? articleBodyFromRun(fold) : undefined;
    if (output && output.blocks.length > 0) {
      const target = piece('article');
      // Same id pattern as `pushVersion` (`ver-{key}-article-{n}`).
      const versionId = `ver-${init.key}-article-${(latestVersion(record, target.id)?.number ?? 0) + 1}`;
      const settled = settleGeneration(
        {
          piece: target,
          versions: record.versions,
          output,
          runId: run.id,
          runStartedAt: run.startedAt ?? run.createdAt,
          interrupted: true,
          inputs: run.inputs.filter((input): input is VersionRef => input.kind === 'version'),
          sources: run.inputs.filter((input): input is SourceVersionRef => input.kind === 'source-version'),
        },
        { now: run.endedAt ?? run.createdAt, actorId: plan.by, newId: () => versionId },
      );
      record.versions.push(...settled.versions);
      record.pieces = record.pieces.map((candidate) => (candidate.id === settled.piece.id ? settled.piece : candidate));
      run = { ...run, output: toVersionRef(settled.versions[0]) };
      record.runs = record.runs.map((candidate) => (candidate.id === run.id ? run : candidate));
    }
    return run;
  }

  function addSuggestion(suggestion: Omit<Suggestion, 'id'>): Suggestion {
    const entry: Suggestion = { ...suggestion, id: newId('sug') };
    record.suggestions.push(entry);
    return entry;
  }

  /** Exports the default package (latest approved versions), refusing incoherent pairs. */
  function deliver(at: IsoDateTime, by: PersonId): Delivery {
    const { selection, result } = resolveExport(record);
    if (!result.ok) throw new Error(`${init.key}: export refused: ${result.refusal.message}`);
    const checked = canExport(record, selection);
    if (!checked.ok) throw new Error(`${init.key}: export refused: ${checked.refusal.message}`);
    const files = plannedExportFiles(record, checked.value);
    const delivery: Delivery = {
      id: newId('del'),
      productionId: record.production.id,
      channel: EXPORT_CHANNEL,
      mode: 'download',
      items: files
        .filter((file) => file.kind !== 'manifest' && file.available)
        .map((file) => {
          const item = checked.value.find((entry) => entry.version.versionId === file.versionId);
          if (!item) throw new Error(`${init.key}: file without item`);
          return { version: item.version, decisionId: item.decisionId, format: file.format, fileName: file.fileName };
        }),
      attempts: [{ at, status: 'succeeded', items: files.filter((file) => file.available).map((file) => file.fileName) }],
      status: 'completed',
      idempotencyKey: deliveryIdempotencyKey(record.production.id, EXPORT_CHANNEL, selection),
      createdBy: by,
      createdAt: at,
    };
    record.deliveries.push(delivery);
    touch(at);
    return delivery;
  }

  addPiece('article', { type: 'article', title: '', blocks: [] }, init.createdAt, init.ownerId);

  return {
    scenario,
    record,
    newId,
    piece,
    generate,
    saveEdit,
    editDraft,
    requestReview,
    withdrawReview,
    decide: decideOn,
    startCarousel,
    addRun,
    streamArticle,
    addSuggestion,
    deliver,
    touch,
  };
}

export type ScenarioBuilder = ReturnType<typeof startScenario>;
