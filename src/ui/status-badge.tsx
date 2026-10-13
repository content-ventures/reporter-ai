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
import { PIECE_STATUS_LOOK, PRODUCTION_STATUS_LOOK, RUN_STATUS_LOOK } from '@/registries';

/**
 * Status = dot + word. The look of each status (tone, hollow dot, spinner) comes from the status
 * vocabulary (`src/registries/status-vocabulary.ts`); the words from the status rules. Rascunho
 * gray · A IA está escrevendo spinner · Aguardando aprovação violet · Ajustes solicitados orange ·
 * Aprovado teal · Aprovação desatualizada / Desatualizado amber · Erro red · Concluída gray.
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

export type StatusRef =
  | { kind: 'production'; status: ProductionStatus }
  | { kind: 'piece'; status: PieceStatus }
  | { kind: 'run'; status: RunStatus };

/** Tone, dot and label of a status (for Badge, CommandItem trailing, chart keys…). */
export function statusPresentation(ref: StatusRef): StatusPresentation {
  switch (ref.kind) {
    case 'production':
      return { ...PRODUCTION_STATUS_LOOK[ref.status], label: PRODUCTION_STATUS_LABELS[ref.status] };
    case 'piece':
      return { ...PIECE_STATUS_LOOK[ref.status], label: PIECE_STATUS_LABELS[ref.status] };
    case 'run':
      return { ...RUN_STATUS_LOOK[ref.status], label: RUN_STATUS_LABELS[ref.status] };
  }
}

export type StatusBadgeProps = StatusRef & {
  /** Overrides the default pt-BR label (e.g. "Aguardando sua aprovação" for the decider). */
  label?: string;
  /** `soft` badge (headers, cards) or `text` dot + word (table cells, lists). */
  variant?: 'soft' | 'text';
  size?: 'sm' | 'md' | 'lg';
  /** `text` in a table cell: wraps up to two lines instead of overflowing. */
  wrap?: boolean;
};

/**
 * The one status badge of the product. Live work ("A IA está escrevendo") always shows the spinner in a soft
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
