import type { DecisionAnchor, Decision, DecisionKind, ReviewRequest } from '../domain/decision.ts';
import type { Delivery, DeliveryFormat, DeliveryMode } from '../domain/delivery.ts';
import type { FeedbackEntry } from '../domain/feedback.ts';
import type { IsoDateTime, PersonId, PieceId, ProductionId, SourceId, SuggestionId, TemplateId, VersionId } from '../domain/ids.ts';
import type { PieceBody, PieceKind } from '../domain/piece.ts';
import type { Brief } from '../domain/production.ts';
import type { ArticleSize } from '../domain/sizing.ts';
import type { VersionRef } from '../domain/refs.ts';
import type { Result } from '../domain/result.ts';
import type { DecideRefusal } from '../domain/rules/decide.ts';
import type { DeriveRefusal } from '../domain/rules/derive.ts';
import type { ExportRefusal } from '../domain/rules/export.ts';
import type { SourceOrigin } from '../domain/source.ts';
import type { SuggestionState } from '../domain/suggestion.ts';
import type { TranscriptFormat } from '../domain/text/transcript-parse.ts';
import type { VersionView } from '../domain/views.ts';
import type { NotFoundRefusal, PersonSummary } from './common.ts';
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
  /** Existing person, or… */
  personId?: PersonId;
  /** …a new one created with the production ("Falantes"), or… */
  newPerson?: PersonDetails;
  /** …"Sem atribuição": quoted without a name. */
  unattributed?: true;
};

export type NewProductionInput = {
  /** "Título interno". */
  title: string;
  material: {
    text: string;
    fileName?: string;
    format?: TranscriptFormat | 'auto';
    /** Material title; defaults to the production title. */
    title?: string;
    origin: SourceOrigin;
    /** YYYY-MM-DD. */
    recordedOn?: string;
    /** "Material autorizado": generation stays blocked while false (REQ-T.1). */
    authorized: boolean;
  };
  /** Reuse a saved source instead of creating one (duplicate material, REQ-2.1 prep). */
  reuseSourceId?: SourceId;
  speakers?: SpeakerAssignment[];
  brief: { angle?: string; sections: number; size: ArticleSize };
  /** Article is mandatory; carousel optional. */
  plan: PieceKind[];
  ownerId?: PersonId;
};

export type CreateProductionRefusal =
  | 'empty_title'
  | 'empty_material'
  | 'sections_out_of_range'
  | 'unknown_size'
  | 'article_required'
  | 'unknown_person'
  | 'unknown_source';

export type CreatedProduction = {
  productionId: ProductionId;
  sourceId: SourceId;
  pieces: { kind: PieceKind; pieceId: PieceId }[];
};

/** Opens an owned, empty article in the existing studio; no material or AI run is created. */
export type BlankProductionInput = { title: string; brief: BriefInput };
export type CreatedBlankProduction = { productionId: ProductionId; pieceId: PieceId };
export type CreateBlankRefusal = 'empty_title' | 'sections_out_of_range' | 'unknown_size' | 'forbidden';

// ── Estúdio ──────────────────────────────────────────────────────────────────────────────

/** `locked`: the text waits for a decision ("O texto está com Pedro para aprovação. Retire o envio para editar."). */
export type SaveDraftRefusal = NotFoundRefusal | 'conflict' | 'kind_mismatch' | 'locked';

export type SavedDraft = {
  pieceId: PieceId;
  revision: number;
  updatedAt: IsoDateTime;
  /** False when the write failed (e.g. browser quota): SaveStatusPort has the error, scope and retry. */
  persisted: boolean;
};

export type VersionRefusal = NotFoundRefusal | 'unchanged' | 'empty' | 'run_in_progress' | 'locked';
export type RestoreRefusal = NotFoundRefusal | 'unknown_version' | 'nothing_to_restore' | 'run_in_progress' | 'locked';

export type SavedVersion = { version: VersionView; revision: number };

export type BriefInput = { angle?: string; sections: number; size: ArticleSize };
export type BriefRefusal = NotFoundRefusal | 'conflict' | 'sections_out_of_range' | 'unknown_size';

/** `personId: null` with `unattributed` is "Sem atribuição"; without it, the label is left undecided. */
export type SpeakerMapping = { label: string; personId: PersonId | null; newPerson?: PersonDetails; unattributed?: true };
export type SpeakersRefusal = NotFoundRefusal | 'unknown_speaker' | 'unknown_person';

/** Name, role and organisation of a person; `null` clears a field. */
export type PersonPatch = { name?: string; title?: string | null; organization?: string | null };
export type PersonRefusal = NotFoundRefusal | 'empty_name';

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
  | 'empty'
  | 'run_in_progress'
  | 'suggestion_pending'
  | 'checks_blocking'
  | 'send_blocked'
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

export type DecideCommandRefusal = NotFoundRefusal | 'no_gate' | DecideRefusal;

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

export type DeriveCommandRefusal = NotFoundRefusal | DeriveRefusal | 'not_planned' | 'not_derivable' | 'already_derived' | 'unknown_template';

/** `restore` undoes a discard ("Desfazer" right after "Descartar"): the suggestion is open again. */
export type SuggestionDecision = 'accept' | 'discard' | 'restore';

export type DecideSuggestionRefusal = NotFoundRefusal | 'not_pending' | 'not_discarded' | 'unsupported' | 'invalid_target' | 'locked';

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

export type RecordDeliveryRefusal = NotFoundRefusal | ExportRefusal | 'no_files';

export type ArchiveRefusal = NotFoundRefusal | 'run_in_progress';

// ── Port ─────────────────────────────────────────────────────────────────────────────────

export interface ProductionCommands {
  /** Saves the source and the production BEFORE any run starts (REQ-1.1, REQ-1.2). */
  createFromSource(input: NewProductionInput): Promise<Result<CreatedProduction, CreateProductionRefusal>>;
  createBlank(input: BlankProductionInput): Promise<Result<CreatedBlankProduction, CreateBlankRefusal>>;
  rename(productionId: ProductionId, title: string): Promise<Result<{ title: string }, NotFoundRefusal | 'empty_title'>>;
  /** Pass `baseRevision` to detect a concurrent edit. */
  updateBrief(productionId: ProductionId, brief: BriefInput, baseRevision?: number): Promise<Result<Brief, BriefRefusal>>;
  updateSpeakers(sourceId: SourceId, mapping: SpeakerMapping[]): Promise<Result<SourceDetail, SpeakersRefusal>>;
  /** "Participantes": name, "Cargo ou função" and "Organização" of a person (every production sees it). */
  updatePerson(personId: PersonId, patch: PersonPatch): Promise<Result<PersonSummary, PersonRefusal>>;
  setMaterialAuthorization(sourceId: SourceId, authorized: boolean): Promise<Result<{ authorized: boolean }, NotFoundRefusal>>;

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
