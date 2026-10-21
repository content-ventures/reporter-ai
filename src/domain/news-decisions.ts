/** Decisions on imported material. Selecting it does not create or generate a production. */
export type NewsDecisionInput = { revision: number } & (
  | { action: 'select' | 'restore' }
  | { action: 'postpone'; hours: number }
  | { action: 'discard'; reason: string }
);

export const NEWS_DECISION_LIMITS = { postponeHours: 720, reasonChars: 500 } as const;
