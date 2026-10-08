import type { PieceStatus, ProductionStatus } from '../domain/rules/status.ts';
import type { RunStatus } from '../domain/run.ts';

/**
 * How each status looks (DS §2.4, D10): one tone per state, a hollow dot for what is not active
 * yet, a spinner instead of the dot while the AI writes. Words live with the status rules
 * (`src/domain/rules/status.ts`); this file only says how they are drawn, so the badge, the
 * queues and the banners agree.
 *
 * Rascunho gray · A IA está escrevendo spinner · Erro red · Aguardando aprovação violet ·
 * Ajustes solicitados orange · Aprovado teal · Aprovação desatualizada amber · Desatualizado
 * amber · Falta autorização red · Concluída gray · Não iniciado / Bloqueado / Arquivada hollow
 * gray. Blue is never a status (it is the action colour); green is kept for "no ar" (R2+).
 */

export type StatusTone = 'gray' | 'violet' | 'orange' | 'teal' | 'amber' | 'red';

export type StatusLook = {
  tone: StatusTone;
  /** `hollow`: not active (Não iniciado, Bloqueado, Arquivada, Na fila). */
  dot: true | 'hollow';
  /** Live work: a spinner takes the dot's place. */
  spinner: boolean;
};

const GRAY: StatusLook = { tone: 'gray', dot: true, spinner: false };
const HOLLOW: StatusLook = { tone: 'gray', dot: 'hollow', spinner: false };
const WRITING: StatusLook = { tone: 'gray', dot: true, spinner: true };
const VIOLET: StatusLook = { tone: 'violet', dot: true, spinner: false };
const ORANGE: StatusLook = { tone: 'orange', dot: true, spinner: false };
const TEAL: StatusLook = { tone: 'teal', dot: true, spinner: false };
const AMBER: StatusLook = { tone: 'amber', dot: true, spinner: false };
const RED: StatusLook = { tone: 'red', dot: true, spinner: false };

export const PIECE_STATUS_LOOK: Readonly<Record<PieceStatus, StatusLook>> = {
  locked: HOLLOW,
  not_started: HOLLOW,
  generating: WRITING,
  failed: RED,
  draft: GRAY,
  in_review: VIOLET,
  changes_requested: ORANGE,
  approved: TEAL,
  stale: AMBER,
  approval_outdated: AMBER,
};

export const PRODUCTION_STATUS_LOOK: Readonly<Record<ProductionStatus, StatusLook>> = {
  draft: GRAY,
  unauthorized: RED,
  generating: WRITING,
  failed: RED,
  in_review: VIOLET,
  changes_requested: ORANGE,
  stale: AMBER,
  approved: TEAL,
  completed: GRAY,
  archived: HOLLOW,
};

export const RUN_STATUS_LOOK: Readonly<Record<RunStatus, StatusLook>> = {
  queued: HOLLOW,
  running: WRITING,
  // Waiting for the person at the keyboard: their move now (orange), not someone else's (violet).
  awaiting_input: ORANGE,
  completed: GRAY,
  failed: RED,
  cancelled: GRAY,
};

/** Tones of the DS `Banner` (the task notice above the text). */
export type BannerTone = 'neutral' | 'info' | 'success' | 'warning' | 'attention' | 'danger';

/**
 * The task notices of the product (one sentence, at most one verb; two only for `outdated`):
 * - `writing` the AI writes · `error` it stopped;
 * - `sent` the writer waits for a decision · `awaiting_you` the approver is asked;
 * - `changes` adjustments requested · `approved` · `approval_outdated` the approved text was edited;
 * - `decided` the approver just decided · `outdated` the carousel/delivery follow an older text;
 * - `unauthorized` the material lacks the speakers' consent · `needs_fix` something to fix before
 *   going on (speakers without a person) · `ready` all set (Entrega) · `delivered` · `other_tab`.
 */
export type BannerKind =
  | 'writing'
  | 'error'
  | 'sent'
  | 'awaiting_you'
  | 'changes'
  | 'approved'
  | 'approval_outdated'
  | 'decided'
  | 'outdated'
  | 'unauthorized'
  | 'needs_fix'
  | 'ready'
  | 'delivered'
  | 'other_tab';

export const BANNER_TONE: Readonly<Record<BannerKind, BannerTone>> = {
  writing: 'neutral',
  error: 'danger',
  sent: 'info',
  awaiting_you: 'info',
  changes: 'attention',
  approved: 'success',
  approval_outdated: 'warning',
  decided: 'success',
  outdated: 'warning',
  unauthorized: 'danger',
  needs_fix: 'attention',
  ready: 'success',
  delivered: 'success',
  other_tab: 'warning',
};

/** Verbs a notice may carry: one, except "Atualizar carrossel · Entregar assim mesmo". */
export const BANNER_MAX_ACTIONS: Readonly<Record<BannerKind, 0 | 1 | 2>> = {
  writing: 1,
  error: 1,
  sent: 1,
  awaiting_you: 0,
  changes: 1,
  approved: 0,
  approval_outdated: 1,
  decided: 1,
  outdated: 2,
  unauthorized: 1,
  needs_fix: 1,
  ready: 0,
  delivered: 0,
  other_tab: 1,
};
