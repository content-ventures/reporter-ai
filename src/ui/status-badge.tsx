'use client';

import { Badge, Spinner, type Tone } from '@content-ventures/design-system/v3';
import {
  PIECE_STATUS_LABELS,
  PRODUCTION_STATUS_LABELS,
  RUN_STATUS_LABELS,
  type PieceStatus,
  type ProductionStatus,
  type RunStatus,
} from '@/domain';

/**
 * Status = dot + word (DS §2.4, PLAN §3 tones). Rascunho gray · Gerando spinner + word ·
 * Aguardando aprovação violet · Ajustes solicitados orange · Aprovado teal · Desatualizado amber ·
 * Erro red · Concluída gray. Blue is never a status; green is reserved for "no ar" (R2+).
 */

export type StatusKind = 'production' | 'piece' | 'run';

export type StatusPresentation = {
  label: string;
  tone: Tone;
  /** `hollow`: inactive (Bloqueado, Não iniciado, Arquivada, Na fila). */
  dot: true | 'hollow';
  /** Live work: spinner + word instead of a dot. */
  spinner: boolean;
};

type ToneEntry = Omit<StatusPresentation, 'label'>;

const GRAY: ToneEntry = { tone: 'gray', dot: true, spinner: false };
const HOLLOW: ToneEntry = { tone: 'gray', dot: 'hollow', spinner: false };
const WORKING: ToneEntry = { tone: 'gray', dot: true, spinner: true };
const VIOLET: ToneEntry = { tone: 'violet', dot: true, spinner: false };
const ORANGE: ToneEntry = { tone: 'orange', dot: true, spinner: false };
const TEAL: ToneEntry = { tone: 'teal', dot: true, spinner: false };
const AMBER: ToneEntry = { tone: 'amber', dot: true, spinner: false };
const RED: ToneEntry = { tone: 'red', dot: true, spinner: false };

const PRODUCTION_TONES: Record<ProductionStatus, ToneEntry> = {
  draft: GRAY,
  unauthorized: RED,
  generating: WORKING,
  failed: RED,
  in_review: VIOLET,
  changes_requested: ORANGE,
  stale: AMBER,
  approved: TEAL,
  completed: GRAY,
  archived: HOLLOW,
};

const PIECE_TONES: Record<PieceStatus, ToneEntry> = {
  locked: HOLLOW,
  not_started: HOLLOW,
  generating: WORKING,
  failed: RED,
  draft: GRAY,
  in_review: VIOLET,
  changes_requested: ORANGE,
  approved: TEAL,
  stale: AMBER,
};

const RUN_TONES: Record<RunStatus, ToneEntry> = {
  queued: HOLLOW,
  running: WORKING,
  // Waiting for the person at the keyboard: action needed now (orange), not "someone else" (violet).
  awaiting_input: ORANGE,
  completed: GRAY,
  failed: RED,
  cancelled: GRAY,
};

export type StatusRef =
  | { kind: 'production'; status: ProductionStatus }
  | { kind: 'piece'; status: PieceStatus }
  | { kind: 'run'; status: RunStatus };

/** Tone, dot and label of a status (for Badge, CommandItem trailing, chart keys…). */
export function statusPresentation(ref: StatusRef): StatusPresentation {
  switch (ref.kind) {
    case 'production':
      return { ...PRODUCTION_TONES[ref.status], label: PRODUCTION_STATUS_LABELS[ref.status] };
    case 'piece':
      return { ...PIECE_TONES[ref.status], label: PIECE_STATUS_LABELS[ref.status] };
    case 'run':
      return { ...RUN_TONES[ref.status], label: RUN_STATUS_LABELS[ref.status] };
  }
}

export type StatusBadgeProps = StatusRef & {
  /** Overrides the default pt-BR label (e.g. "Gerando · seção 2 de 3"). */
  label?: string;
  /** `soft` badge (headers, cards) or `text` dot + word (table cells, lists). */
  variant?: 'soft' | 'text';
  size?: 'sm' | 'md' | 'lg';
  /** `text` in a table cell: wraps up to two lines instead of overflowing. */
  wrap?: boolean;
};

/**
 * The one status badge of the product. Live work ("Gerando") always shows the spinner in a soft
 * badge (the DS Badge forces a dot in `text`, and a dot next to a spinner would say two things).
 */
export function StatusBadge({ label, variant = 'soft', size = 'md', wrap, ...statusRef }: StatusBadgeProps) {
  const presentation = statusPresentation(statusRef as StatusRef);
  const text = label ?? presentation.label;
  if (presentation.spinner) {
    return (
      <Badge tone={presentation.tone} variant="soft" size={size} title={text}>
        <Spinner size={14} tone="current" delay={0} /> {text}
      </Badge>
    );
  }
  return (
    <Badge tone={presentation.tone} variant={variant} size={size} dot={presentation.dot} wrap={wrap}>
      {text}
    </Badge>
  );
}
