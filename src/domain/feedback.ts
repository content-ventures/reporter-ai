import type { FeedbackId, IsoDateTime, PersonId, ProductionId, RunId, SuggestionId } from './ids.ts';
import type { Ref } from './refs.ts';
import { stableStringify } from './text/hash.ts';

/** REQ-T.8: feedback, failures and corrections from real pilot cases. */

export type FeedbackTarget =
  | Ref
  | { kind: 'production'; productionId: ProductionId }
  | { kind: 'run'; runId: RunId }
  | { kind: 'suggestion'; suggestionId: SuggestionId };

/** Thumbs on AI output map to positive/negative; the pilot outcome uses all three. */
export type FeedbackRating = 'positive' | 'mixed' | 'negative';

export type FeedbackCategory = 'error' | 'blocker' | 'improvement';

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  error: 'Erro',
  blocker: 'Bloqueio',
  improvement: 'Melhoria',
};

/** 👍/👎 on an AI output (a generation, an assistant answer, a suggestion). */
export type FeedbackVote = 'up' | 'down';

export type FeedbackEntry = {
  id: FeedbackId;
  target: FeedbackTarget;
  /** Present on thumbs votes: one per person and target; a new vote replaces it. */
  vote?: FeedbackVote;
  rating?: FeedbackRating;
  category?: FeedbackCategory;
  note?: string;
  /** Automatic stage timings recorded with the pilot outcome (ms per stage id). */
  durations?: Record<string, number>;
  by: PersonId;
  at: IsoDateTime;
};

export const FEEDBACK_RATING_LABELS: Record<FeedbackRating, string> = {
  positive: 'Funcionou',
  mixed: 'Com ressalvas',
  negative: 'Não funcionou',
};

export const VOTE_RATINGS: Record<FeedbackVote, FeedbackRating> = { up: 'positive', down: 'negative' };

/**
 * Category a vote is filed under when the person does not choose one: a 👎 on AI output is an
 * improvement to make (REQ-T.8); a 👍 needs none.
 */
export function defaultVoteCategory(vote: FeedbackVote): FeedbackCategory | undefined {
  return vote === 'down' ? 'improvement' : undefined;
}

export function sameFeedbackTarget(a: FeedbackTarget, b: FeedbackTarget): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** The person's current vote on a target, if any. */
export function voteOf(entries: readonly FeedbackEntry[], target: FeedbackTarget, by: PersonId): FeedbackEntry | undefined {
  return entries.find((entry) => entry.vote !== undefined && entry.by === by && sameFeedbackTarget(entry.target, target));
}
