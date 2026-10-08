'use client';

import {
  Avatar,
  Button,
  CardHeader,
  Count,
  Highlight,
  Meter,
  Popover,
  PopoverHeader,
  StepList,
  TextLink,
  Tooltip,
  type StepItem,
} from '@content-ventures/design-system/v3';
import { ChevronDown } from '@content-ventures/design-system/v3/icons';
import { PIECE_STATUS_LABELS, type PieceStatus, type StageView } from '@/domain';
import type { PersonSummary, ProductionListItem } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { plural } from '@/ui/format';
import { StatusBadge } from '@/ui/status-badge';

/**
 * Cells of the "Produções" table (PLAN §3.2). Each one reads only the list item, so the table
 * re-renders a row when the runtime refreshes it (live "Gerando · seção 2 de 3").
 */

/** "Entrevista · Marina Lopes +2": origin and who speaks in the material. */
export function productionMeta(item: ProductionListItem): string {
  const origin = item.material ? SOURCE_ORIGIN_LABELS[item.material.origin] : 'Sem material';
  const names = item.participants.map((participant) => participant.person?.name ?? participant.label);
  const people = names.length === 0 ? null : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
  return [origin, people].filter(Boolean).join(' · ');
}

/** "Gerando · seção 2 de 3" while a run writes the piece; `undefined` otherwise. */
export function generatingLabel(item: ProductionListItem): string | undefined {
  const run = item.liveRun;
  if (!run) return undefined;
  const step = run.step?.trim();
  return step ? `Gerando · ${step.charAt(0).toLocaleLowerCase('pt-BR')}${step.slice(1)}` : 'Gerando';
}

export function ProductionCell({ item, href, query }: { item: ProductionListItem; href: string; query: string }) {
  return (
    <CardHeader
      titleAs="h2"
      title={
        <TextLink href={href} tone="inherit">
          <Highlight text={item.title} query={query} />
        </TextLink>
      }
      description={<Highlight text={productionMeta(item)} query={query} />}
    />
  );
}

export function StatusCell({ item }: { item: ProductionListItem }) {
  const label = item.status === 'generating' ? generatingLabel(item) : undefined;
  return <StatusBadge kind="production" status={item.status} label={label} variant="text" wrap />;
}

/** Readiness of the piece the journey is on; nothing while a run is still writing it. */
export function ReadinessCell({ item }: { item: ProductionListItem }) {
  const readiness = item.readiness;
  if (!readiness || readiness.total === 0 || item.status === 'generating') return null;
  const blockers = readiness.blockers.length;
  const summary = [
    `${readiness.passed} de ${plural(readiness.total, 'conferência', 'conferências')}`,
    blockers > 0 ? `${plural(blockers, 'bloqueia', 'bloqueiam')} a aprovação` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Tooltip content={summary}>
      <Meter
        inline
        value={readiness.passed}
        max={readiness.total}
        tone={blockers > 0 ? 'amber' : 'neutral'}
        label={`Prontidão: ${summary}`}
      />
    </Tooltip>
  );
}

/**
 * Owner orb + name; a click filters the list by that person (again: shows everyone). No pressed
 * look: with the filter on, every row would turn blue (one blue per area).
 */
export function OwnerCell({ owner, active, onToggle }: { owner: PersonSummary; active: boolean; onToggle: () => void }) {
  return (
    <Tooltip content={active ? 'Mostrar todos os responsáveis' : `Filtrar por ${owner.name}`}>
      <Button variant="ghost" size="sm" onClick={onToggle}>
        <Avatar name={owner.name} src={owner.avatarUrl} size="xs" decorative />
        {owner.name}
      </Button>
    </Tooltip>
  );
}

/** One line under each journey stage: its status, or why it is not open yet. */
export function stageDetail(stage: StageView, item: ProductionListItem): string | undefined {
  if (stage.state === 'blocked' && stage.blockedReason) return stage.blockedReason.replace(/\.$/, '');
  if (stage.kind === 'source') {
    if (!item.material) return 'Sem material';
    return item.material.authorized ? 'Material autorizado' : 'Falta autorizar o material';
  }
  if (stage.kind === 'delivery') {
    if (stage.status === 'completed') return 'Concluída';
    // An approved piece that went out of date (a newer article) must be settled before exporting.
    const stale = item.stages.find((entry) => entry.kind === 'piece' && entry.status === 'stale');
    if (stage.status === 'ready' && stale) return `${stale.label} desatualizado`;
    return stage.status === 'ready' ? 'Pronta para exportar' : 'Aguardando aprovações';
  }
  if (stage.status === 'generating' && item.liveRun?.pieceKind === stage.pieceKind) return generatingLabel(item);
  return stage.status in PIECE_STATUS_LABELS ? PIECE_STATUS_LABELS[stage.status as PieceStatus] : undefined;
}

/** Journey stages → StepList steps; the production's current stage is the list's current one. */
export function stageSteps(item: ProductionListItem, currentIndex: number): StepItem[] {
  return item.stages.map((stage, index) => {
    const step: StepItem = { id: stage.id, label: stage.label };
    const detail = stageDetail(stage, item);
    if (detail) step.description = detail;
    if (index !== currentIndex) step.state = stage.state === 'current' ? 'upcoming' : stage.state;
    return step;
  });
}

export type StageCellProps = {
  item: ProductionListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a stage of the production (done, flagged or upcoming; never a blocked one). */
  onSelectStage: (stage: StageView) => void;
};

/**
 * "Artigo 2/4": the current stage, opening the whole journey (status of each stage, why a
 * stage is still blocked) with a jump to any reachable stage. Compact on purpose: the full
 * pipeline strip does not fit a table row next to the other columns.
 */
export function StageCell({ item, open, onOpenChange, onSelectStage }: StageCellProps) {
  const found = item.stages.findIndex((stage) => stage.id === item.currentStageId);
  const index = Math.max(0, found);
  const stage = item.stages[index];
  if (!stage) return null;
  const total = item.stages.length;
  return (
    <Popover
      label={`Etapas de ${item.title}`}
      width={320}
      open={open}
      onOpenChange={onOpenChange}
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown} aria-label={`Etapa ${index + 1} de ${total}: ${stage.label}`}>
          {stage.label}
          <Count>{`${index + 1}/${total}`}</Count>
        </Button>
      )}
    >
      {({ close }) => (
        <>
          <PopoverHeader title={item.title} meta={`${index + 1} de ${total}`} />
          <StepList
            label={`Jornada de ${item.title}`}
            tone="plain"
            steps={stageSteps(item, index)}
            current={index}
            canSelect={(position, state) => state !== 'blocked' && Boolean(item.stages[position]?.selectable)}
            onStepSelect={(position) => {
              const target = item.stages[position];
              if (!target) return;
              close();
              onSelectStage(target);
            }}
          />
        </>
      )}
    </Popover>
  );
}
