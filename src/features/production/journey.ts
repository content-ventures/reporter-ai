import type { StepItem } from '@content-ventures/design-system/v3';
import type { StageView } from '../../domain/index.ts';

/**
 * The production journey as the header shows it (B04): the Stepper on a wide screen and the
 * "Ver etapas" menu next to the compact stepper on a phone. Pure, so it is tested without React.
 */

type StageStepState = Exclude<StepItem['state'], undefined>;

/** "Disponível após aprovar o artigo." → the DS reason: short, without the final period. */
export function stageReason(stage: Pick<StageView, 'state' | 'blockedReason'>): string | undefined {
  if (stage.state !== 'blocked' || !stage.blockedReason) return undefined;
  return stage.blockedReason.trim().replace(/\.$/, '');
}

/**
 * Journey stages → Stepper steps. The stage on screen is the Stepper's `current`; the journey's
 * own current stage, while another one is on screen, stays "em andamento" (`active`), never
 * "a seguir" nor "feita" by position. A delivered production has no open work: its last stage
 * reads as done. Blocked stages carry their reason (Tooltip and `aria-describedby`).
 */
export function journeySteps(stages: readonly StageView[], viewedIndex: number, completed = false): StepItem[] {
  return stages.map((stage, index) => {
    const step: StepItem = { id: stage.id, label: stage.label };
    // A blocked stage reached by its address still reads as blocked (lock and reason), never as current.
    if (index === viewedIndex && stage.state !== 'blocked') return step;
    if (stage.state === 'current') step.state = completed ? 'done' : 'active';
    else step.state = stage.state as StageStepState;
    const reason = stageReason(stage);
    if (reason) step.reason = reason;
    return step;
  });
}

/** The Stepper's `current`: the stage on screen, unless it is blocked (then no stage is "here"). */
export function stepperCurrent(stages: readonly Pick<StageView, 'state'>[], viewedIndex: number): number {
  return stages[viewedIndex]?.state === 'blocked' ? -1 : viewedIndex;
}

/** Only reachable stages navigate; a blocked one explains why and stays put. */
export function stageNavigable(stage: Pick<StageView, 'selectable' | 'state'>): boolean {
  return stage.selectable && stage.state !== 'blocked';
}

const STATE_LABELS: Record<StageStepState | 'current', string> = {
  done: 'Concluída',
  current: 'Em andamento',
  active: 'Em andamento',
  upcoming: 'A seguir',
  warn: 'Com pendência',
  error: 'Com erro',
  blocked: 'Bloqueada',
};

export type StageMenuItem = {
  id: string;
  label: string;
  /** Where the journey is ("Em andamento", "Concluída") or why the stage is blocked. */
  description: string;
  disabled: boolean;
  /** The stage on screen. */
  checked: boolean;
};

/** Rows of the phone "Ver etapas" menu, in journey order. */
export function stageMenuItems(stages: readonly StageView[], viewedIndex: number, completed = false): StageMenuItem[] {
  const steps = journeySteps(stages, -1, completed);
  return stages.map((stage, index) => {
    const state = steps[index]?.state ?? 'upcoming';
    return {
      id: stage.id,
      label: stage.label,
      description: stageReason(stage) ?? STATE_LABELS[state],
      disabled: !stageNavigable(stage),
      checked: index === viewedIndex,
    };
  });
}
