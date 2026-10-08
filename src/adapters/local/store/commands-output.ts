import { deliveryIdempotencyKey, EXPORT_CHANNEL } from '../../../domain/delivery.ts';
import type { Delivery, DeliveryAttempt, DeliveryItem, DeliveryStatus } from '../../../domain/delivery.ts';
import { defaultVoteCategory, sameFeedbackTarget, VOTE_RATINGS, voteOf } from '../../../domain/feedback.ts';
import type { FeedbackEntry, FeedbackTarget } from '../../../domain/feedback.ts';
import type { ProductionId } from '../../../domain/ids.ts';
import type { PieceBody } from '../../../domain/piece.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { canExport } from '../../../domain/rules/export.ts';
import { applySlideSuggestion, applySuggestion, isSuggestionPending } from '../../../domain/suggestion.ts';
import type { ApplySuggestionRefusal, Suggestion } from '../../../domain/suggestion.ts';
import type { FeedbackPort, FeedbackRefusal } from '../../../ports/feedback.ts';
import type {
  DecidedSuggestion,
  DecideSuggestionRefusal,
  DeliveryFileOutcome,
  ProductionCommands,
  RecordDeliveryRefusal,
} from '../../../ports/production-commands.ts';
import type { ActivityDraft, LocalStore, Tx } from './local-store.ts';
import { detach } from './queries.ts';
import { assembleRecord, findProduction, locatePiece, withPiece, withProduction } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';

/** AI suggestions, delivery records and feedback (REQ-T.8). */

type OutputCommands = Pick<ProductionCommands, 'decideSuggestion' | 'recordDelivery' | 'recordFeedback'>;

function findSuggestion(state: StoreState, suggestionId: string): { production: ProductionState; suggestion: Suggestion } | undefined {
  for (const production of state.productions) {
    const suggestion = production.suggestions.find((entry) => entry.id === suggestionId);
    if (suggestion) return { production, suggestion };
  }
  return undefined;
}

function withSuggestion(production: ProductionState, suggestion: Suggestion): ProductionState {
  return { ...production, suggestions: production.suggestions.map((entry) => (entry.id === suggestion.id ? suggestion : entry)) };
}

function applyTo(body: PieceBody, suggestion: Suggestion): Result<PieceBody, ApplySuggestionRefusal> {
  return body.type === 'article' ? applySuggestion(body, suggestion) : applySlideSuggestion(body, suggestion);
}

function deliveryStatus(attempts: readonly DeliveryAttempt[], files: readonly string[]): DeliveryStatus {
  const delivered = new Set(attempts.filter((attempt) => attempt.status === 'succeeded').flatMap((attempt) => attempt.items ?? []));
  const count = files.filter((file) => delivered.has(file)).length;
  if (count === files.length) return 'completed';
  return count > 0 ? 'partial' : 'failed';
}

function attemptsFor(files: readonly DeliveryFileOutcome[], at: string): DeliveryAttempt[] {
  const attempts: DeliveryAttempt[] = [];
  const succeeded = files.filter((file) => file.ok).map((file) => file.fileName);
  const failed = files.filter((file) => !file.ok);
  if (succeeded.length > 0) attempts.push({ at, status: 'succeeded', items: succeeded });
  if (failed.length > 0) {
    const error = failed.find((file) => file.error)?.error ?? { code: 'export_failed', message: 'Não foi possível gerar o arquivo.' };
    attempts.push({ at, status: 'failed', items: failed.map((file) => file.fileName), error });
  }
  return attempts;
}

/** Production a feedback target belongs to (for the activity feed). */
function productionOfTarget(state: StoreState, target: FeedbackTarget): ProductionId | undefined {
  switch (target.kind) {
    case 'production':
      return target.productionId;
    case 'version':
      return locatePiece(state, target.pieceId)?.production.production.id;
    case 'run':
      return state.productions.find((entry) => entry.runs.some((run) => run.id === target.runId))?.production.id;
    case 'suggestion':
      return findSuggestion(state, target.suggestionId)?.production.production.id;
    default:
      return undefined;
  }
}

/** The target must exist: a vote on a run or suggestion nobody knows is refused. */
function targetExists(state: StoreState, target: FeedbackTarget): boolean {
  switch (target.kind) {
    case 'production':
      return findProduction(state, target.productionId) !== undefined;
    case 'run':
      return state.productions.some((entry) => entry.runs.some((run) => run.id === target.runId));
    case 'suggestion':
      return findSuggestion(state, target.suggestionId) !== undefined;
    default:
      return true;
  }
}

export function createFeedbackPort(store: LocalStore): FeedbackPort {
  return {
    async record(input) {
      return store.transact((state, ctx): Tx<FeedbackEntry, FeedbackRefusal> => {
        const productionId = productionOfTarget(state, input.target);
        if (input.target.kind === 'production' && !findProduction(state, input.target.productionId)) {
          return refuse('not_found', 'Não encontramos esta produção.');
        }
        const note = input.note?.trim();
        const hasDurations = input.durations !== undefined && Object.keys(input.durations).length > 0;
        if (!input.rating && !input.category && !note && !hasDurations) return refuse('empty_feedback', 'Escolha uma avaliação ou escreva uma nota.');
        const entry: FeedbackEntry = { id: ctx.newId('fb'), target: structuredClone(input.target), by: ctx.actorId, at: ctx.now };
        if (input.rating) entry.rating = input.rating;
        if (input.category) entry.category = input.category;
        if (note) entry.note = note;
        if (hasDurations) entry.durations = { ...input.durations };
        const activity: ActivityDraft = { type: 'feedback.recorded', ...(productionId ? { productionId } : {}), data: { rating: input.rating ?? '' } };
        return ok({
          state: { ...state, feedback: [...state.feedback, entry] },
          value: entry,
          productionIds: productionId ? [productionId] : [],
          activity: [activity],
          scope: 'feedback' as const,
        });
      });
    },
    async vote(input) {
      const result = store.transact((state, ctx): Tx<FeedbackEntry | null, FeedbackRefusal> => {
        if (!targetExists(state, input.target)) return refuse('not_found', 'Não encontramos o que você avaliou.');
        const productionId = productionOfTarget(state, input.target);
        const productionIds = productionId ? [productionId] : [];
        const existing = voteOf(state.feedback, input.target, ctx.actorId);
        const others = state.feedback.filter((entry) => entry !== existing);
        if (input.value === null) {
          if (!existing) return ok({ state, value: null, persist: 'none' as const, silent: true });
          return ok({ state: { ...state, feedback: others }, value: null, productionIds, scope: 'feedback' as const });
        }
        const note = input.note?.trim();
        const category = input.category ?? defaultVoteCategory(input.value);
        const same = existing?.vote === input.value;
        const entry: FeedbackEntry = {
          id: existing?.id ?? ctx.newId('fb'),
          target: structuredClone(input.target),
          vote: input.value,
          rating: VOTE_RATINGS[input.value],
          by: ctx.actorId,
          at: same && existing ? existing.at : ctx.now,
        };
        if (category) entry.category = category;
        // The comment belongs to the vote it was written for: switching the vote drops it.
        const kept = note ?? (same ? existing?.note : undefined);
        if (kept) entry.note = kept;
        if (existing && same && existing.category === entry.category && existing.note === entry.note) {
          return ok({ state, value: existing, persist: 'none' as const, silent: true });
        }
        // A new or switched vote is news for the activity feed; a comment on the same vote is not.
        const activity: ActivityDraft[] = same ? [] : [{ type: 'feedback.recorded', ...(productionId ? { productionId } : {}), data: { rating: entry.rating ?? '' } }];
        return ok({
          state: { ...state, feedback: [...others, entry] },
          value: entry,
          productionIds,
          activity,
          scope: 'feedback' as const,
        });
      });
      return result.ok ? ok(result.value ? detach(result.value) : null) : result;
    },
    async list(query = {}) {
      const actorId = store.state.sessionPersonId;
      const entries = store.state.feedback
        .filter((entry) => !query.target || sameFeedbackTarget(entry.target, query.target))
        .filter((entry) => !query.mine || entry.by === actorId)
        .filter((entry) => query.votes === undefined || (entry.vote !== undefined) === query.votes)
        .filter((entry) => !query.productionId || productionOfTarget(store.state, entry.target) === query.productionId)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return detach(entries);
    },
  };
}

export function createOutputCommands(store: LocalStore, feedback: FeedbackPort): OutputCommands {
  return {
    async decideSuggestion(suggestionId, decision, options = {}) {
      return store.transact((state, ctx): Tx<DecidedSuggestion, DecideSuggestionRefusal> => {
        const found = findSuggestion(state, suggestionId);
        if (!found) return refuse('not_found', 'Sugestão não encontrada.');
        const { suggestion } = found;
        if (decision === 'restore') {
          // "Desfazer": a discarded suggestion is open again, as it was (its target is located anew).
          if (suggestion.state !== 'discarded') return refuse('not_discarded', 'Só uma sugestão descartada volta.');
          const reopened: Suggestion = { ...suggestion, state: 'ready' };
          delete reopened.decidedAt;
          delete reopened.decidedBy;
          const production = withSuggestion(found.production, reopened);
          return ok({
            state: withProduction(state, production),
            value: { suggestionId, outcome: 'restored' as const, state: 'ready' as const },
            productionIds: [found.production.production.id],
          });
        }
        if (!isSuggestionPending(suggestion)) return refuse('not_pending', 'Esta sugestão não está mais disponível.');
        const decided: Suggestion = { ...suggestion, decidedAt: ctx.now, decidedBy: ctx.actorId, ...(options.vote ? { vote: options.vote } : {}) };
        const productionId = found.production.production.id;
        const data: Record<string, string> = suggestion.label ? { label: suggestion.label } : {};
        if (decision === 'discard') {
          const production = withSuggestion(found.production, { ...decided, state: 'discarded' });
          return ok({
            state: withProduction(state, production),
            value: { suggestionId, outcome: 'discarded' as const, state: 'discarded' as const },
            productionIds: [productionId],
            activity: [{ type: 'suggestion.discarded', productionId, data }],
          });
        }
        const location = locatePiece(state, suggestion.pieceId);
        if (!location) return refuse('not_found', 'Não encontramos esta peça.');
        const applied = applyTo(location.piece.draft.body, suggestion);
        if (!applied.ok && applied.refusal.code === 'stale') {
          const production = withSuggestion(found.production, { ...suggestion, state: 'stale' });
          return ok({
            state: withProduction(state, production),
            value: { suggestionId, outcome: 'stale' as const, state: 'stale' as const },
            productionIds: [productionId],
          });
        }
        if (!applied.ok) return refuse(applied.refusal.code as Exclude<ApplySuggestionRefusal, 'stale'>, applied.refusal.message);
        const piece = {
          ...location.piece,
          draft: { ...location.piece.draft, body: applied.value, revision: location.piece.draft.revision + 1, updatedAt: ctx.now, updatedBy: ctx.actorId },
        };
        const production = withSuggestion(withPiece(location.production, piece), { ...decided, state: 'applied' });
        return ok({
          state: withProduction(state, production),
          value: { suggestionId, outcome: 'applied' as const, state: 'applied' as const, revision: piece.draft.revision },
          productionIds: [productionId],
          activity: [{ type: 'suggestion.applied', productionId, data }],
        });
      });
    },

    async recordDelivery(input) {
      return store.transact((state, ctx): Tx<Delivery, RecordDeliveryRefusal> => {
        const production = findProduction(state, input.productionId);
        if (!production) return refuse('not_found', 'Não encontramos esta produção.');
        if (input.files.length === 0) return refuse('no_files', 'Nenhum arquivo foi gerado.');
        const record = assembleRecord(state, production);
        const exported = canExport(record, input.selection);
        if (!exported.ok) return exported;
        const key = deliveryIdempotencyKey(input.productionId, EXPORT_CHANNEL, exported.value.map((item) => item.version));
        const existing = production.deliveries.find((delivery) => delivery.idempotencyKey === key);
        const items: DeliveryItem[] = existing ? [...existing.items] : [];
        for (const file of input.files) {
          const item = exported.value.find((entry) => entry.version.versionId === file.versionId);
          if (!item || items.some((entry) => entry.fileName === file.fileName)) continue;
          items.push({ version: item.version, decisionId: item.decisionId, format: file.format, fileName: file.fileName });
        }
        const attempts = [...(existing?.attempts ?? []), ...attemptsFor(input.files, ctx.now)];
        const fileNames = [...new Set(attempts.flatMap((attempt) => attempt.items ?? []))];
        const status = deliveryStatus(attempts, fileNames);
        const delivery: Delivery = existing
          ? { ...existing, items, attempts, status }
          : {
              id: ctx.newId('del'),
              productionId: input.productionId,
              channel: EXPORT_CHANNEL,
              mode: input.mode ?? 'download',
              items,
              attempts,
              status,
              idempotencyKey: key,
              createdBy: ctx.actorId,
              createdAt: ctx.now,
            };
        const deliveries = existing
          ? production.deliveries.map((entry) => (entry.id === existing.id ? delivery : entry))
          : [...production.deliveries, delivery];
        const failedCount = input.files.filter((file) => !file.ok).length;
        const activity: ActivityDraft =
          status === 'completed'
            ? { type: 'delivery.completed', productionId: input.productionId, data: { files: fileNames.length } }
            : { type: 'delivery.failed', productionId: input.productionId, data: { files: failedCount } };
        return ok({
          state: withProduction(state, { ...production, deliveries }),
          value: delivery,
          productionIds: [input.productionId],
          activity: [activity],
        });
      });
    },

    recordFeedback: (input) => feedback.record(input),
  };
}
