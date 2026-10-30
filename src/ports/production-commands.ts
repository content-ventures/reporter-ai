import type { DecisionAnchor, Decision, DecisionKind, ReviewRequest } from '../domain/decision.ts';
import type { Delivery, DeliveryFormat, DeliveryMode } from '../domain/delivery.ts';
import type { FeedbackEntry } from '../domain/feedback.ts';
import type { IsoDateTime, PersonId, PieceId, ProductionId, SourceId, SuggestionId, TemplateId, VersionId } from '../domain/ids.ts';
import type { PieceBody, PieceKind } from '../domain/piece.ts';
import type { Brief } from '../domain/production.ts';
import type { ArticleSize } from '../domain/sizing.ts';
import type { EditorialFormat, EventContext } from '../domain/formats.ts';
import type { VersionRef } from '../domain/refs.ts';
import type { Result } from '../domain/result.ts';
import type { DecideRefusal } from '../domain/rules/decide.ts';
import type { DeriveRefusal } from '../domain/rules/derive.ts';
import type { ExportRefusal } from '../domain/rules/export.ts';
import type { SourceOrigin, SpeakerPresentation } from '../domain/source.ts';
import type { SuggestionState } from '../domain/suggestion.ts';
import type { TranscriptFormat } from '../domain/text/transcript-parse.ts';
import type { VersionView } from '../domain/views.ts';
import type { ForbiddenRefusal, NotFoundRefusal, PersonSummary } from './common.ts';
import type { FeedbackRefusal, NewFeedback } from './feedback.ts';
import type { SourceDetail } from './production-queries.ts';

/**
 * Write side of the production workflow. Every command returns a domain `Result`: a refusal
 * carries a stable code plus a pt-BR message, and a refused command changes NOTHING (contract).
 * The acting person comes from the SessionPort; time and ids from the Clock/IdGenerator ports.
 */

// ── Nova produção ────────────────────────────────────────────────────────────────────────

/** "Participantes" (wireframe R1·1): who a person is in the text. */
export type PersonDetails = { name: string; title?: string; organization?: string };

export type SpeakerAssignment = {
  label: string;
  presentation?: SpeakerPresentation;
  /** Existing person, or… */
  personId?: PersonId;
  /** …a new one created with the production ("Falantes"), or… */
  newPerson?: PersonDetails;
  /** …"Sem atribuição": quoted without a name. */
  unattributed?: true;
};

/** One recording of a material sent in several files. */
export type MaterialPartInput = { fileName: string; transcriptId?: string };

export type NewProductionInput = {
  /** "Título interno". */
  title: string;
  material: {
    text: string;
    /** Uploaded transcript already persisted by the server. */
    transcriptId?: string;
    fileName?: string;
    format?: TranscriptFormat | 'auto';
    /** Material title; defaults to the production title. */
    title?: string;
    origin: SourceOrigin;
    /** YYYY-MM-DD. */
    recordedOn?: string;
    programName?: string;
    sourceUrl?: string;
    location?: string;
    /** "Material autorizado": generation stays blocked while false (REQ-T.1). */
    authorized: boolean;
    /** 2+ recordings, in the order of a `joinTranscriptParts` text. */
    parts?: readonly MaterialPartInput[];
  };
  /** Reuse a saved source instead of creating one (duplicate material, REQ-2.1 prep). */
  reuseSourceId?: SourceId;
  speakers?: SpeakerAssignment[];
  brief: BriefInput;
  /** Article is mandatory; carousel optional. */
  plan: PieceKind[];
  ownerId?: PersonId;
  /** Radar item linked atomically to a connected Hard News production. */
  newsItemId?: string;
};

export type CreateProductionRefusal =
  | 'empty_title'
  | 'empty_material'
  | 'sections_out_of_range'
  | 'unknown_size'
  | 'unknown_format'
  | 'article_required'
  | 'unknown_person'
  | 'unknown_source'
  | 'invalid_parts'
  | ForbiddenRefusal;

export type CreatedProduction = {
  productionId: ProductionId;
  sourceId: SourceId;
  pieces: { kind: PieceKind; pieceId: PieceId }[];
  /** The same radar item already had a production; do not queue another first draft. */
  reusedNewsLink?: true;
};

/** Opens an owned, empty article in the existing studio; no material or AI run is created. */
export type BlankProductionInput = { title: string; brief: BriefInput };
export type CreatedBlankProduction = { productionId: ProductionId; pieceId: PieceId };
export type CreateBlankRefusal = 'empty_title' | 'sections_out_of_range' | 'unknown_size' | 'unknown_format' | 'forbidden';

// ── Estúdio ──────────────────────────────────────────────────────────────────────────────

/** `locked`: the text waits for a decision ("O texto está com Pedro para aprovação. Retire o envio para editar."). */
export type SaveDraftRefusal = NotFoundRefusal | ForbiddenRefusal | 'conflict' | 'kind_mismatch' | 'locked';

export type SavedDraft = {
  pieceId: PieceId;
  revision: number;
  updatedAt: IsoDateTime;
  /** False when the write failed (e.g. browser quota): SaveStatusPort has the error, scope and retry. */
  persisted: boolean;
};

export type VersionRefusal = NotFoundRefusal | ForbiddenRefusal | 'unchanged' | 'empty' | 'run_in_progress' | 'locked';
export type RestoreRefusal = NotFoundRefusal | ForbiddenRefusal | 'unknown_version' | 'nothing_to_restore' | 'run_in_progress' | 'locked';

export type SavedVersion = { version: VersionView; revision: number };

/** The pauta a person sets: an event format (formats.ts) is optional; without it, the article of R1. */
export type BriefInput = { angle?: string; sections: number; size: ArticleSize; format?: EditorialFormat; formatSize?: string; event?: EventContext };
export type BriefRefusal = NotFoundRefusal | ForbiddenRefusal | 'conflict' | 'sections_out_of_range' | 'unknown_size' | 'unknown_format';

/** `personId: null` with `unattributed` is "Sem atribuição"; without it, the label is left undecided. */
export type SpeakerMapping = { label: string; personId: PersonId | null; newPerson?: PersonDetails; unattributed?: true };
export type SpeakersRefusal = NotFoundRefusal | ForbiddenRefusal | 'unknown_speaker' | 'unknown_person';
export type SourceDateRefusal = NotFoundRefusal | ForbiddenRefusal | 'invalid_date' | 'conflict';

/** Name, role and organisation of a person; `null` clears a field. */
export type PersonPatch = { name?: string; title?: string | null; organization?: string | null };
export type PersonRefusal = NotFoundRefusal | ForbiddenRefusal | 'empty_name';

// ── Revisão ──────────────────────────────────────────────────────────────────────────────

/**
 * "Enviar para aprovação": who approves ("Quem aprova"; default `PieceApproval.send.suggestedAssigneeId`),
 * the "Recado" and "Para quando" (local date `YYYY-MM-DD`, today or later).
 */
export type RequestReviewInput = { assigneeId?: PersonId; note?: string; dueOn?: string };

/**
 * `checks_blocking`: a blocking check fails on the text (an interrupted generation not yet continued or edited).
 * `send_blocked`: a "Falta" item of the pre-send checklist (message = its text).
 */
export type RequestReviewRefusal =
  | NotFoundRefusal
  | ForbiddenRefusal
  | 'empty'
  | 'run_in_progress'
  | 'suggestion_pending'
  | 'checks_blocking'
  | 'send_blocked'
  | 'memory_not_ready'
  | 'already_requested'
  | 'already_approved'
  | 'no_gate'
  | 'unknown_assignee'
  | 'assignee_cannot_approve'
  | 'self_assign'
  | 'invalid_due';

/** "Retirar envio": only the sender or an admin, only while the request waits. */
export type WithdrawReviewRefusal = NotFoundRefusal | 'not_awaiting' | 'forbidden';

export type WithdrawnReview = { pieceId: PieceId; request: ReviewRequest };

export type RequestedReview = { request: ReviewRequest; version: VersionView; created: boolean };

export type DecideCommand = {
  pieceId: PieceId;
  subject: VersionRef;
  decision: DecisionKind;
  note?: string;
  anchors?: DecisionAnchor[];
  /** Hash of the version rendered on screen; must equal `subject.hash`. */
  displayedHash?: string;
};

export type DecideCommandRefusal = NotFoundRefusal | 'no_gate' | 'memory_not_ready' | DecideRefusal;

// ── Carrossel ────────────────────────────────────────────────────────────────────────────

export type DeriveCommand = {
  productionId: ProductionId;
  kind: PieceKind;
  /** The exact approved parent version (REQ-1.3, REQ-T.6). */
  from: VersionRef;
  templateId?: TemplateId;
  /** When the derivative already exists, point its draft at `from` ("Atualizar carrossel"). */
  rebase?: boolean;
};

export type DeriveCommandRefusal = NotFoundRefusal | ForbiddenRefusal | DeriveRefusal | 'not_planned' | 'not_derivable' | 'already_derived' | 'unknown_template';

/** `restore` undoes a discard ("Desfazer" right after "Descartar"): the suggestion is open again. */
export type SuggestionDecision = 'accept' | 'discard' | 'restore';

export type DecideSuggestionRefusal = NotFoundRefusal | ForbiddenRefusal | 'not_pending' | 'not_discarded' | 'unsupported' | 'invalid_target' | 'locked';

export type DecidedSuggestion = {
  suggestionId: SuggestionId;
  /** `stale` = the target changed: nothing applied, show "Trecho mudou · Reaplicar". */
  outcome: 'applied' | 'discarded' | 'restored' | 'stale';
  state: SuggestionState;
  /** New draft revision when the suggestion was applied. */
  revision?: number;
};

// ── Entrega ──────────────────────────────────────────────────────────────────────────────

export type DeliveryFileOutcome = {
  fileName: string;
  format: DeliveryFormat;
  versionId?: VersionId;
  ok: boolean;
  error?: { code: string; message: string };
};

export type RecordDeliveryInput = {
  productionId: ProductionId;
  selection: VersionRef[];
  mode?: DeliveryMode;
  files: DeliveryFileOutcome[];
};

export type RecordDeliveryRefusal = NotFoundRefusal | ForbiddenRefusal | ExportRefusal | 'no_files' | 'memory_not_ready';

export type ArchiveRefusal = NotFoundRefusal | ForbiddenRefusal | 'run_in_progress';

// ── Port ─────────────────────────────────────────────────────────────────────────────────

export interface ProductionCommands {
  /** Saves the source and the production BEFORE any run starts (REQ-1.1, REQ-1.2). */
  createFromSource(input: NewProductionInput): Promise<Result<CreatedProduction, CreateProductionRefusal>>;
  createBlank(input: BlankProductionInput): Promise<Result<CreatedBlankProduction, CreateBlankRefusal>>;
  rename(productionId: ProductionId, title: string): Promise<Result<{ title: string }, NotFoundRefusal | ForbiddenRefusal | 'empty_title'>>;
  /** Pass `baseRevision` to detect a concurrent edit. */
  updateBrief(productionId: ProductionId, brief: BriefInput, baseRevision?: number): Promise<Result<Brief, BriefRefusal>>;
  updateSpeakers(sourceId: SourceId, mapping: SpeakerMapping[]): Promise<Result<SourceDetail, SpeakersRefusal>>;
  /** Only the supplied source date changes; null clears it. The opening value detects concurrent edits. */
  updateSourceRecordedOn(sourceId: SourceId, recordedOn: string | null, baseRecordedOn: string | null): Promise<Result<{ recordedOn: string | null }, SourceDateRefusal>>;
  /** "Participantes": name, "Cargo ou função" and "Organização" of a person (every production sees it). */
  updatePerson(personId: PersonId, patch: PersonPatch): Promise<Result<PersonSummary, PersonRefusal>>;
  setMaterialAuthorization(sourceId: SourceId, authorized: boolean): Promise<Result<{ authorized: boolean }, NotFoundRefusal | ForbiddenRefusal>>;

  /** Autosave: overwrites the draft slot; a stale `baseRevision` is a conflict, never a silent overwrite. */
  saveDraft(pieceId: PieceId, body: PieceBody, baseRevision: number): Promise<Result<SavedDraft, SaveDraftRefusal>>;
  /** ⌘S: freezes the draft as an immutable version. */
  createVersion(pieceId: PieceId): Promise<Result<SavedVersion, VersionRefusal>>;
  /** Creates a NEW version with the old body; decisions are never touched. */
  restoreVersion(pieceId: PieceId, versionId: VersionId): Promise<Result<SavedVersion, RestoreRefusal>>;

  /** Locks the text until a decision or a withdrawal. Existing callers pass only `pieceId`. */
  requestReview(pieceId: PieceId, input?: RequestReviewInput): Promise<Result<RequestedReview, RequestReviewRefusal>>;
  /** "Retirar envio para editar": the pending request stops waiting and the text is editable again. */
  withdrawReview(pieceId: PieceId): Promise<Result<WithdrawnReview, WithdrawReviewRefusal>>;
  decide(command: DecideCommand): Promise<Result<Decision, DecideCommandRefusal>>;

  derive(command: DeriveCommand): Promise<Result<{ pieceId: PieceId; created: boolean }, DeriveCommandRefusal>>;
  decideSuggestion(
    suggestionId: SuggestionId,
    decision: SuggestionDecision,
    options?: { vote?: 'up' | 'down' },
  ): Promise<Result<DecidedSuggestion, DecideSuggestionRefusal>>;

  /** Records an export attempt; the same package (idempotency key) adds an attempt, never a duplicate. */
  recordDelivery(input: RecordDeliveryInput): Promise<Result<Delivery, RecordDeliveryRefusal>>;
  archive(productionIds: ProductionId[]): Promise<Result<{ archived: number }, ArchiveRefusal>>;
  recordFeedback(input: NewFeedback): Promise<Result<FeedbackEntry, FeedbackRefusal>>;
}
