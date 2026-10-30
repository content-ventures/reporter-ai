/** Score inputs captured with an editor decision, for later calibration. */
export type NewsScoreSnapshot = {
  score: number;
  topic: string;
  mapVersion: number;
  reasons: Array<{ criterion: string; effect: 'up' | 'down'; detail: string }>;
};

/** Decisions on imported material. */
export type NewsDecisionInput = { revision: number } & (
  | { action: 'select'; scoreSnapshot?: NewsScoreSnapshot }
  | { action: 'restore' }
  | { action: 'postpone'; hours: number; scoreSnapshot?: NewsScoreSnapshot }
  | { action: 'discard'; reason: string; scoreSnapshot?: NewsScoreSnapshot }
);

export const NEWS_DECISION_LIMITS = { postponeHours: 720, reasonChars: 500 } as const;
