import type { AssetLookup } from '../../../domain/asset.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import type { Decision, GateDefinition, ReviewRequest } from '../../../domain/decision.ts';
import { articleImageRights, emptyArticle } from '../../../domain/article.ts';
import type { Piece, PieceBody, PieceKind, Version } from '../../../domain/piece.ts';
import { toVersionRef } from '../../../domain/piece.ts';
import { activeRun, currentSourceRefs, findPiece, findVersion, isApproved, pendingReview, pendingSuggestions } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { readiness } from '../../../domain/checks.ts';
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
} from '../../../ports/production-commands.ts';
import type { ActivityDraft, LocalStore, Tx } from './local-store.ts';
import { currentMember } from './people.ts';
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
const RUNNING = refuse('run_in_progress', 'Aguarde a geração terminar.');

function versionActivity(production: ProductionState, piece: Piece, version: Version, type: ActivityDraft['type'], extra: ActivityDraft['data'] = {}): ActivityDraft {
  return {
    type,
    productionId: production.production.id,
    subject: toVersionRef(version),
    data: { piece: piece.kind, number: version.number, origin: version.origin, ...extra },
  };
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

/** The first blocking check that fails on the draft (what "Enviar para aprovação" waits for), as a sentence. */
export function requestBlocker(record: ProductionRecord, piece: Piece, options: Pick<PieceCommandOptions, 'templates' | 'assets'>): string | undefined {
  const [blocker] = readiness(evaluatePieceChecks(record, piece, piece.draft.body, options.templates, options.assets)).blockers;
  if (!blocker) return undefined;
  const detail = (blocker.detail ?? `${blocker.label} pendente`).trim();
  return /[.!?…]$/.test(detail) ? detail : `${detail}.`;
}

type PieceCommands = Pick<ProductionCommands, 'saveDraft' | 'createVersion' | 'restoreVersion' | 'requestReview' | 'decide' | 'derive'>;

export function createPieceCommands(store: LocalStore, options: PieceCommandOptions): PieceCommands {
  return {
    async saveDraft(pieceId, body, baseRevision) {
      const result = store.transact((state, ctx): Tx<Omit<SavedDraft, 'persisted'>, SaveDraftRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        const updated = updateDraft(location.piece, structuredClone(body), baseRevision, ctx);
        if (!updated.ok) return updated;
        const { draft } = updated.value;
        return ok({
          state: withProduction(state, withPiece(location.production, updated.value)),
          value: { pieceId, revision: draft.revision, updatedAt: draft.updatedAt },
          productionIds: [location.production.production.id],
          persist: { draft: pieceId },
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

    async requestReview(pieceId, note) {
      return store.transact((state, ctx): Tx<RequestedReview, RequestReviewRefusal> => {
        const location = locatePiece(state, pieceId);
        if (!location) return NOT_FOUND;
        const gate = gateForPiece(location.piece.kind, options.gates);
        if (!gate) return refuse('no_gate', 'Esta peça não passa por aprovação.');
        const record = assembleRecord(state, location.production);
        if (activeRun(record, pieceId)) return RUNNING;
        // The approver decides on a settled text: open AI suggestions are decided first.
        const open = pendingSuggestions(record, pieceId).length;
        if (open > 0) return refuse('suggestion_pending', open === 1 ? 'Decida a sugestão aberta antes de enviar.' : `Decida as ${open} sugestões abertas antes de enviar.`);
        // Nor a text a blocking check stops (an interrupted generation): it could never be approved.
        const blocker = requestBlocker(record, location.piece, options);
        if (blocker) return refuse('checks_blocking', blocker);
        const ensured = ensureVersion(location.piece, record.versions, ctx);
        if (!ensured.ok) return ensured;
        const { version, created } = ensured.value;
        const pending = pendingReview(record, pieceId);
        if (!created && pending?.subject.versionId === version.id) {
          return refuse('already_requested', `A v${version.number} já está aguardando aprovação.`);
        }
        if (!created && isApproved(record, toVersionRef(version))) {
          return refuse('already_approved', `A v${version.number} já está aprovada.`);
        }
        const request: ReviewRequest = {
          id: ctx.newId('rev'),
          gate: gate.id,
          subject: toVersionRef(version),
          requestedBy: ctx.actorId,
          requestedAt: ctx.now,
        };
        if (note?.trim()) request.note = note.trim();
        const withVersion = created ? withVersions(location.production, ensured.value.piece, [version]) : location.production;
        const production: ProductionState = { ...withVersion, reviewRequests: [...withVersion.reviewRequests, request] };
        const next = withProduction(state, production);
        const activity: ActivityDraft[] = [];
        if (created) activity.push(versionActivity(production, location.piece, version, 'version.created'));
        activity.push(versionActivity(production, location.piece, version, 'review.requested'));
        return ok({
          state: next,
          value: { request, version: toVersionView(recordAfter(next, production), version), created },
          productionIds: [production.production.id],
          activity,
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
