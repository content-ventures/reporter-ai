'use client';

import { useCallback, useMemo, useState } from 'react';
import { sameFeedbackTarget } from '../domain/feedback.ts';
import type { FeedbackCategory, FeedbackEntry, FeedbackTarget, FeedbackVote } from '../domain/feedback.ts';
import { stableStringify } from '../domain/text/hash.ts';
import type { FeedbackRefusal } from '../ports/feedback.ts';
import type { QueryError } from './query-state.ts';
import { feedbackQuery } from './query-specs.ts';
import { useQuery } from './use-queries.ts';
import { useCommands } from './use-runtime.ts';

/**
 * 👍/👎 on an AI output (REQ-T.8), persisted through the FeedbackPort: one vote per person and
 * target, so switching replaces it and a reload shows it again. The vote on screen follows the
 * click at once and settles on what the store answers.
 */

export type VoteState = {
  /** The acting person's vote (after a click: the vote being saved). */
  value: FeedbackVote | null;
  /** The stored entry (category and comment), once loaded. */
  entry: FeedbackEntry | undefined;
  /** False until the stored vote is known (the buttons can show, unpressed). */
  ready: boolean;
  saving: boolean;
  error: QueryError | undefined;
  /** `null` takes the vote back; call again with the same value and a `note` to add the comment. */
  vote(value: FeedbackVote | null, note?: string, category?: FeedbackCategory): Promise<void>;
};

type Pending = { key: string; value: FeedbackVote | null };

export function useVote(target: FeedbackTarget | null | undefined): VoteState {
  const commands = useCommands();
  const key = target ? stableStringify(target) : '';
  // The query key is the target itself, so a stable object is not required of callers.
  const query = useMemo(() => (key ? { target: JSON.parse(key) as FeedbackTarget, mine: true, votes: true } : undefined), [key]);
  const spec = useMemo(() => (query ? feedbackQuery(query) : null), [query]);
  const stored = useQuery(spec);
  const entry = query && stored.data ? stored.data.find((candidate) => sameFeedbackTarget(candidate.target, query.target)) : undefined;
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<QueryError | undefined>();

  const vote = useCallback(
    async (value: FeedbackVote | null, note?: string, category?: FeedbackCategory) => {
      if (!query) return;
      setPending({ key, value });
      setSaving(true);
      setError(undefined);
      const result = await commands.feedback.vote({
        target: query.target,
        value,
        ...(note ? { note } : {}),
        ...(category ? { category } : {}),
      });
      setSaving(false);
      setPending((current) => (current?.key === key && current.value === value ? null : current));
      if (!result.ok) setError({ code: result.refusal.code satisfies FeedbackRefusal, message: result.refusal.message });
    },
    [commands, key, query],
  );

  const optimistic = pending && pending.key === key ? pending : null;
  return {
    value: optimistic ? optimistic.value : (entry?.vote ?? null),
    entry,
    ready: !query || stored.status === 'ready',
    saving,
    error,
    vote,
  };
}
