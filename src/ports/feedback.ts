import type { FeedbackCategory, FeedbackEntry, FeedbackRating, FeedbackTarget, FeedbackVote } from '../domain/feedback.ts';
import type { ProductionId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';

/**
 * REQ-T.8: thumbs on AI output, "Retorno do piloto" (Funcionou · Com ressalvas · Não funcionou)
 * with automatic stage timings, and reported failures. Recorded as data, never as a toast only.
 */

export type NewFeedback = {
  target: FeedbackTarget;
  rating?: FeedbackRating;
  category?: FeedbackCategory;
  note?: string;
  /** Stage timings in ms (DeliveryView.stageDurations), recorded with the pilot outcome. */
  durations?: Record<string, number>;
};

export type FeedbackRefusal = 'empty_feedback' | 'not_found';

/** 👍/👎: `value: null` takes the vote back; `note` is the optional comment after voting. */
export type VoteInput = {
  target: FeedbackTarget;
  value: FeedbackVote | null;
  /** Defaults to `defaultVoteCategory(value)` ("Melhoria" for 👎). */
  category?: FeedbackCategory;
  note?: string;
};

export type FeedbackQuery = {
  productionId?: ProductionId;
  target?: FeedbackTarget;
  /** Only what the acting person recorded. */
  mine?: boolean;
  /** Only thumbs votes (or only the other entries, with `false`). */
  votes?: boolean;
};

export interface FeedbackPort {
  record(input: NewFeedback): Promise<Result<FeedbackEntry, FeedbackRefusal>>;
  /**
   * One vote per person and target: voting again replaces the previous vote (never a second
   * entry), the same vote with a `note` adds the comment, `null` removes it. Resolves with the
   * vote now stored, or `null` when there is none.
   */
  vote(input: VoteInput): Promise<Result<FeedbackEntry | null, FeedbackRefusal>>;
  /** Newest first. */
  list(query?: FeedbackQuery): Promise<FeedbackEntry[]>;
}
