import { PIECE_STATUS_LABELS } from '../../domain/index.ts';
import type { PieceKind, PieceStatus, StageView } from '../../domain/index.ts';
import type { PieceApproval } from '../../ports/index.ts';

/**
 * The production journey as the header shows it (D3, §2.6): one quiet menu button in the header
 * line, "Artigo · 2 de 5 ▾", listing every stage with where it stands ("Concluída", "Com Pedro",
 * "Aprovado") or why it is blocked. Pure, so it is tested without React.
 */

/** "Disponível após aprovar o artigo." → the menu's reason: short, without the final period. */
export function stageReason(stage: Pick<StageView, 'state' | 'blockedReason'>): string | undefined {
  if (stage.state !== 'blocked' || !stage.blockedReason) return undefined;
  return stage.blockedReason.trim().replace(/\.$/, '');
}

/** Only reachable stages navigate; a blocked one explains why and stays put. */
export function stageNavigable(stage: Pick<StageView, 'selectable' | 'state'>): boolean {
  return stage.selectable && stage.state !== 'blocked';
}

/** The stage on screen: the one the route names, else the journey's current stage, else the first. */
export function viewedStageIndex(stages: readonly Pick<StageView, 'id'>[], viewedId: string | undefined, currentStageId: string): number {
  const byRoute = viewedId === undefined ? -1 : stages.findIndex((stage) => stage.id === viewedId);
  if (byRoute >= 0) return byRoute;
  return Math.max(0, stages.findIndex((stage) => stage.id === currentStageId));
}

/** The menu trigger: "Artigo · 2 de 5" (stage on screen · its place in the journey). */
export function journeyLabel(stages: readonly Pick<StageView, 'label'>[], viewedIndex: number): string {
  const stage = stages[viewedIndex];
  if (!stage) return '';
  return `${stage.label} · ${viewedIndex + 1} de ${stages.length}`;
}

const PIECE_STATUSES = new Set<string>(Object.keys(PIECE_STATUS_LABELS));

/**
 * Where a stage stands, in the words of COPY §5.3: the blocked reason first, then the approval
 * detail ("Com Pedro", "Aprovado", "Ajustes solicitados", "Aprovação desatualizada"), then
 * "Concluída" / "Em andamento"; a flagged stage says its piece status ("Desatualizado", "Erro").
 * A stage still ahead says nothing. A delivered production has no open work: "Concluída".
 */
export function stageDescription(stage: StageView, completed = false): string | undefined {
  const reason = stageReason(stage);
  if (reason) return reason;
  if (stage.detail) return stage.detail;
  switch (stage.state) {
    case 'done':
      return 'Concluída';
    case 'current':
      return completed ? 'Concluída' : 'Em andamento';
    case 'warn':
    case 'error':
      return PIECE_STATUSES.has(stage.status) ? PIECE_STATUS_LABELS[stage.status as PieceStatus] : undefined;
    default:
      return undefined;
  }
}

export type JourneyMenuItem = {
  id: string;
  label: string;
  /** Where the stage stands ("Concluída", "Com Pedro") or why it is blocked. */
  description?: string;
  disabled: boolean;
  /** The stage on screen. */
  checked: boolean;
};

/** Rows of the journey menu, in journey order. */
export function journeyMenuItems(stages: readonly StageView[], viewedIndex: number, completed = false): JourneyMenuItem[] {
  return stages.map((stage, index) => {
    const item: JourneyMenuItem = { id: stage.id, label: stage.label, disabled: !stageNavigable(stage), checked: index === viewedIndex };
    const description = stageDescription(stage, completed);
    if (description) item.description = description;
    return item;
  });
}

/**
 * Whether the viewer opens the guided review at a piece's approval (`stageHref` `canDecide`):
 * only someone who decides there (never the sender, R3) and only once something was sent. Before
 * the first send, and for everyone else, the approval stage opens the piece's studio.
 */
export function decidesAt(approvals: Partial<Record<PieceKind, PieceApproval>> | undefined, kind: PieceKind | undefined): boolean {
  const approval = kind ? approvals?.[kind] : undefined;
  return Boolean(approval && approval.viewer.canDecide && approval.state !== 'none');
}
