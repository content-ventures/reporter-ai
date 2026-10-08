import { approvalStateOf, isValidDue, requestRound } from '../../../domain/approval.ts';
import type { AssetLookup } from '../../../domain/asset.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import type { Decision, GateDefinition, ReviewRequest } from '../../../domain/decision.ts';
import { articleImageRights, emptyArticle, reviewFlips } from '../../../domain/article.ts';
import type { Piece, PieceBody, PieceKind, Version } from '../../../domain/piece.ts';
import { bodyHash, toVersionRef } from '../../../domain/piece.ts';
import { activeRun, currentSourceRefs, findPiece, findVersion, isApproved, pendingReview } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import { ok, refuse } from '../../../domain/result.ts';
import { decide } from '../../../domain/rules/decide.ts';
import { canDerive } from '../../../domain/rules/derive.ts';
import { PIECE_PARENTS } from '../../../domain/rules/status.ts';
import { ensureVersion, restoreVersion, saveVersion, updateDraft } from '../../../domain/rules/versions.ts';
import { evaluatePieceChecks, toVersionView } from '../../../domain/views.ts';
import type {
  DecideCommandRefusal,
  DeriveCommandRefusal,
  ProductionCommands,
  RequestedReview,
  RequestReviewRefusal,
  RestoreRefusal,
  SavedDraft,
  SavedVersion,
  SaveDraftRefusal,
  VersionRefusal,
  WithdrawnReview,
  WithdrawReviewRefusal,
} from '../../../ports/production-commands.ts';
import type { ActivityDraft, LocalStore, Tx } from './local-store.ts';
import { currentMember, firstNameOf } from './people.ts';
import { alreadyRequestedMessage, lockedMessage, lockOf, sendItemsOf, sendRefusal, suggestedAssignee } from './send-check.ts';
import { assembleRecord, findProduction, locatePiece, withPiece, withProduction } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';

/** Studio, review and derivative commands, all enforced with the domain rules. */

export type PieceCommandOptions = {
  templates: readonly CarouselTemplate[];
  gates: readonly GateDefinition[];
  /** Image metadata, so the checks stored with a decision include the image checks. */
  assets?: AssetLookup;
};

const NOT_FOUND = refuse('not_found', 'Não encontramos esta peça.');
const RUNNING = refuse('run_in_progress', 'Aguarde a IA terminar.');

function versionActivity(production: ProductionState, piece: Piece, version: Version, type: ActivityDraft['type'], extra: ActivityDraft['data'] = {}): ActivityDraft {
  return {
    type,
    productionId: production.production.id,
    subject: toVersionRef(version),
    data: { piece: piece.kind, number: version.number, origin: version.origin, ...extra },
  };
}

/**
 * "marcou o texto como revisado" / "desfez a revisão do texto": the person's click on the review of
 * the whole text reaches the store as a save of the draft whose AI blocks flipped their flag (the
 * review lives in the blocks), so the save is where it is told. Typing, deleting and AI text never
 * flip a flag on the same text, so they never log one.
 */
function reviewActivity(production: ProductionState, piece: Piece, before: PieceBody, after: PieceBody): ActivityDraft[] {
  if (before.type !== 'article' || after.type !== 'article') return [];
  const { marked, reopened } = reviewFlips(before, after);
  if ((marked > 0) === (reopened > 0)) return [];
  return [{ type: marked > 0 ? 'text.reviewed' : 'text.review_reopened', productionId: production.production.id, data: { piece: piece.kind } }];
}

function withVersions(production: ProductionState, piece: Piece, versions: readonly Version[]): ProductionState {
  return { ...withPiece(production, piece), versions: [...production.versions, ...versions] };
}

function recordAfter(state: StoreState, production: ProductionState): ProductionRecord {
  return assembleRecord(state, production);
}

function emptyBody(kind: PieceKind, templateId: string): PieceBody | undefined {
  if (kind === 'article') return emptyArticle();
  if (kind === 'carousel') return { type: 'carousel', templateId, slides: [] };
  return undefined;
}

type PieceCommands = Pick<ProductionCommands, 'saveDraft' | 'createVersion' | 'restoreVersion' | 'requestReview' | 'withdrawReview' | 'decide' | 'derive'>;

export function createPieceCommands(store: LocalStore, options: PieceCommandOptions): PieceCommands {
  return {
    async saveDraft(pieceId, body, baseRevision) {
      const result = store.transact((state, ctx): Tx<Omit<SavedDraft, 'persisted'>, SaveDraftRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        // Locked while it waits for a decision (D8): an autosave of the same text still goes through.
        const lock = lockOf(assembleRecord(state, location.production), location.piece);
        if (lock && bodyHash(body) !== bodyHash(location.piece.draft.body)) return refuse('locked', lockedMessage(state, lock));
        const updated = updateDraft(location.piece, structuredClone(body), baseRevision, ctx);
        if (!updated.ok) return updated;
        const { draft } = updated.value;
        const activity = reviewActivity(location.production, location.piece, location.piece.draft.body, body);
        return ok({
          state: withProduction(state, withPiece(location.production, updated.value)),
          value: { pieceId, revision: draft.revision, updatedAt: draft.updatedAt },
          productionIds: [location.production.production.id],
          ...(activity.length > 0 ? { activity, persist: 'full' as const } : { persist: { draft: pieceId } }),
        });
      });
      // Not saved when the write failed, or while another tab owns the workspace (read-only tab).
      return result.ok ? ok({ ...result.value, persisted: store.saveState().status !== 'error' && store.tabState().status === 'active' }) : result;
    },

    async createVersion(pieceId) {
      return store.transact((state, ctx): Tx<SavedVersion, VersionRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        const record = assembleRecord(state, location.production);
        if (activeRun(record, pieceId)) return RUNNING;
        const lock = lockOf(record, location.piece);
        if (lock) return refuse('locked', lockedMessage(state, lock));
        const saved = saveVersion(location.piece, record.versions, ctx);
        if (!saved.ok) return saved;
        const production = withVersions(location.production, saved.value.piece, [saved.value.version]);
        const next = withProduction(state, production);
        return ok({
          state: next,
          value: { version: toVersionView(recordAfter(next, production), saved.value.version), revision: saved.value.piece.draft.revision },
          productionIds: [production.production.id],
          activity: [versionActivity(production, location.piece, saved.value.version, 'version.created')],
        });
      });
    },

    async restoreVersion(pieceId, versionId) {
      return store.transact((state, ctx): Tx<SavedVersion, RestoreRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        const record = assembleRecord(state, location.production);
        if (activeRun(record, pieceId)) return RUNNING;
        const lock = lockOf(record, location.piece);
        if (lock) return refuse('locked', lockedMessage(state, lock));
        const restored = restoreVersion(location.piece, record.versions, versionId, ctx);
        if (!restored.ok) return restored;
        const from = findVersion(record, versionId);
        const production = withVersions(location.production, restored.value.piece, [restored.value.version]);
        const next = withProduction(state, production);
        return ok({
          state: next,
          value: { version: toVersionView(recordAfter(next, production), restored.value.version), revision: restored.value.piece.draft.revision },
          productionIds: [production.production.id],
          activity: [versionActivity(production, location.piece, restored.value.version, 'version.restored', from ? { from: from.number } : {})],
        });
      });
    },

    async requestReview(pieceId, input = {}) {
      return store.transact((state, ctx): Tx<RequestedReview, RequestReviewRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        const gate = gateForPiece(location.piece.kind, options.gates);
        if (!gate) return refuse('no_gate', 'Esta peça não passa por aprovação.');
        const record = assembleRecord(state, location.production);
        // The text is locked while a send waits: nothing changed since, so it is the same send.
        const pending = pendingReview(record, pieceId);
        if (pending) return refuse('already_requested', alreadyRequestedMessage(state, pending));
        if (activeRun(record, pieceId)) return RUNNING;
        // "Falta" items block the send (the dialog lists them; "Aviso" items never block).
        const refusal = sendRefusal(sendItemsOf(record, location.piece, options));
        if (refusal) return refuse(refusal.code, refusal.message);

        const assigneeId = input.assigneeId ?? suggestedAssignee(state, record, location.piece, gate, ctx.actorId);
        if (assigneeId !== undefined) {
          const assignee = state.people.find((person) => person.id === assigneeId);
          const member = state.members.find((entry) => entry.personId === assigneeId);
          if (!assignee || !member) return refuse('unknown_assignee', 'Pessoa não encontrada.');
          if (assigneeId === ctx.actorId) return refuse('self_assign', 'Escolha outra pessoa para aprovar.');
          if (!hasAnyRole(member, gate.roles)) return refuse('assignee_cannot_approve', `${firstNameOf(state, assigneeId)} não aprova esta peça.`);
        }
        const dueOn = input.dueOn?.trim() || undefined;
        if (dueOn !== undefined && !isValidDue(dueOn, ctx.now)) return refuse('invalid_due', 'Escolha hoje ou uma data futura.');

        // The approved text as it is (also after "Desfazer mudanças" restored it as a new version).
        if (approvalStateOf(record, pieceId) === 'approved') return refuse('already_approved', 'Este texto já está aprovado.');
        const ensured = ensureVersion(location.piece, record.versions, ctx);
        if (!ensured.ok) return refuse('empty', 'O texto está vazio.');
        const { version, created } = ensured.value;
        if (!created && isApproved(record, toVersionRef(version))) return refuse('already_approved', 'Este texto já está aprovado.');
        const request: ReviewRequest = {
          id: ctx.newId('rev'),
          gate: gate.id,
          subject: toVersionRef(version),
          requestedBy: ctx.actorId,
          requestedAt: ctx.now,
        };
        const note = input.note?.trim();
        if (note) request.note = note;
        if (assigneeId) request.assigneeId = assigneeId;
        if (dueOn) request.dueOn = dueOn;
        const withVersion = created ? withVersions(location.production, ensured.value.piece, [version]) : location.production;
        const production: ProductionState = { ...withVersion, reviewRequests: [...withVersion.reviewRequests, request] };
        const next = withProduction(state, production);
        const activity: ActivityDraft[] = [];
        if (created) activity.push(versionActivity(production, location.piece, version, 'version.created'));
        const sent: Record<string, string | number> = { round: requestRound(production, request) };
        if (assigneeId) {
          sent.assigneeId = assigneeId;
          sent.assigneeName = state.people.find((person) => person.id === assigneeId)?.name ?? assigneeId;
        }
        if (dueOn) sent.dueOn = dueOn;
        activity.push(versionActivity(production, location.piece, version, 'review.requested', sent));
        return ok({
          state: next,
          value: { request, version: toVersionView(recordAfter(next, production), version), created },
          productionIds: [production.production.id],
          activity,
        });
      });
    },

    /** "Retirar envio para editar": the sender (or an admin) takes the text back while it waits. */
    async withdrawReview(pieceId) {
      return store.transact((state, ctx): Tx<WithdrawnReview, WithdrawReviewRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        const record = assembleRecord(state, location.production);
        const pending = pendingReview(record, pieceId);
        if (!pending) return refuse('not_awaiting', 'Este texto não está aguardando aprovação.');
        if (pending.requestedBy !== ctx.actorId && !hasAnyRole(currentMember(state), ['admin'])) {
          return refuse('forbidden', 'Só quem enviou ou um admin retira o envio.');
        }
        const request: ReviewRequest = { ...pending, withdrawnAt: ctx.now, withdrawnBy: ctx.actorId };
        const production: ProductionState = {
          ...location.production,
          reviewRequests: location.production.reviewRequests.map((entry) => (entry.id === pending.id ? request : entry)),
        };
        const version = findVersion(record, pending.subject.versionId);
        return ok({
          state: withProduction(state, production),
          value: { pieceId, request },
          productionIds: [production.production.id],
          activity: version ? [versionActivity(production, location.piece, version, 'review.withdrawn')] : [],
        });
      });
    },

    async decide(command) {
      return store.transact((state, ctx): Tx<Decision, DecideCommandRefusal> => {
        const location = locatePiece(state, command.pieceId);
        if (!location || command.subject.pieceId !== command.pieceId) return NOT_FOUND;
        const gate = gateForPiece(location.piece.kind, options.gates);
        if (!gate) return refuse('no_gate', 'Esta peça não passa por aprovação.');
        const record = assembleRecord(state, location.production);
        const version = findVersion(record, command.subject.versionId);
        if (!version || version.pieceId !== command.pieceId) return refuse('unknown_version', 'Versão não encontrada.');
        const member = currentMember(state);
        const checks = evaluatePieceChecks(record, location.piece, version.body, options.templates, options.assets);
        // Credit and rights belong to the images, not to the version: the decision keeps them as they are now.
        const images = version.body.type === 'article' && options.assets ? articleImageRights(version.body, options.assets) : [];
        const decided = decide(
          member ? { ...record, member } : record,
          {
            gate,
            subject: command.subject,
            decision: command.decision,
            checks,
            ...(images.length > 0 ? { images } : {}),
            ...(command.note !== undefined ? { note: command.note } : {}),
            ...(command.anchors ? { anchors: command.anchors } : {}),
            ...(command.displayedHash !== undefined ? { displayedHash: command.displayedHash } : {}),
          },
          ctx,
        );
        if (!decided.ok) return decided;
        const production: ProductionState = { ...location.production, decisions: [...location.production.decisions, decided.value] };
        return ok({
          state: withProduction(state, production),
          value: decided.value,
          productionIds: [production.production.id],
          activity: [versionActivity(production, location.piece, version, 'decision.recorded', { decision: decided.value.decision })],
        });
      });
    },

    async derive(command) {
      return store.transact((state, ctx): Tx<{ pieceId: string; created: boolean }, DeriveCommandRefusal> => {
        const production = findProduction(state, command.productionId);
        if (!production) return refuse('not_found', 'Não encontramos esta produção.');
        const record = assembleRecord(state, production);
        if (!record.production.plan.includes(command.kind)) return refuse('not_planned', 'Esta peça não faz parte da produção.');
        const parentPiece = findPiece(record, command.from.pieceId);
        const parents = (PIECE_PARENTS[command.kind] ?? []).filter((kind) => record.production.plan.includes(kind));
        if (!parentPiece || !parents.includes(parentPiece.kind)) return refuse('not_derivable', 'Esta peça não deriva da versão escolhida.');
        const derivable = canDerive(record, command.from);
        if (!derivable.ok) return derivable;
        const templateId = command.templateId ?? options.templates[0]?.id ?? 'default';
        if (command.kind === 'carousel' && options.templates.length > 0 && !options.templates.some((template) => template.id === templateId)) {
          return refuse('unknown_template', 'Modelo de carrossel desconhecido.');
        }
        const existing = record.pieces.find((piece) => piece.kind === command.kind);
        if (existing) {
          if (!command.rebase) return refuse('already_derived', 'Esta peça já existe. Use “Atualizar” para trocar a versão de origem.');
          const piece: Piece = {
            ...existing,
            draft: { ...existing.draft, inputs: [command.from], revision: existing.draft.revision + 1, updatedAt: ctx.now, updatedBy: ctx.actorId },
          };
          return ok({
            state: withProduction(state, withPiece(production, piece)),
            value: { pieceId: piece.id, created: false },
            productionIds: [production.production.id],
          });
        }
        const body = emptyBody(command.kind, templateId);
        if (!body) return refuse('not_derivable', 'Este tipo de peça ainda não está disponível.');
        const piece: Piece = {
          id: ctx.newId('piece'),
          productionId: production.production.id,
          kind: command.kind,
          slug: command.kind,
          draft: { body, revision: 0, inputs: [command.from], sources: currentSourceRefs(record), updatedAt: ctx.now, updatedBy: ctx.actorId },
          createdAt: ctx.now,
          createdBy: ctx.actorId,
        };
        return ok({
          state: withProduction(state, { ...production, pieces: [...production.pieces, piece] }),
          value: { pieceId: piece.id, created: true },
          productionIds: [production.production.id],
        });
      });
    },
  };
}
