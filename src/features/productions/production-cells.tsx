'use client';

import { Avatar, Badge, Button, ButtonLink, CardHeader, Highlight, TextLink, Tooltip } from '@content-ventures/design-system/v3';
import type { PersonSummary, ProductionListItem } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { productionHref, stageHref, stepTargetHref } from '@/ui/routes';
import { statusPresentation, StatusBadge } from '@/ui/status-badge';
import { situationStatus } from './list-model';

/**
 * Cells of the "Produções" table (D12): the production, where it stands in one newsroom line
 * ("Artigo · Aguardando aprovação de Pedro") and the next step for the person looking ("Revisar",
 * "Continuar"). Each cell reads only the list item, so a live run updates its row in place.
 */

/** Where the next step lands ("Revisar" → the review, "Montar estrutura" → Nova produção step 3). */
export function nextStepHref(item: Pick<ProductionListItem, 'id' | 'nextStep'>): string {
  return item.nextStep ? stepTargetHref(item.id, item.nextStep.target) : productionHref(item.id);
}

/**
 * Where a row opens: where the person's next step is (a decider lands on the review), else the
 * stage the journey is on (the author waiting for a decision reads the piece in its studio).
 */
export function rowHref(item: ProductionListItem): string {
  if (item.nextStep) return stepTargetHref(item.id, item.nextStep.target);
  const stage = item.stages.find((entry) => entry.id === item.currentStageId);
  return stage ? stageHref(item.id, stage) : productionHref(item.id);
}

/** "Entrevista · Marina Lopes +2": origin and who speaks in the material. */
export function productionMeta(item: ProductionListItem): string {
  const origin = item.material ? SOURCE_ORIGIN_LABELS[item.material.origin] : 'Sem material';
  const names = item.participants.map((participant) => participant.person?.name ?? participant.label);
  const people = names.length === 0 ? null : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
  return [origin, people].filter(Boolean).join(' · ');
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

/**
 * "Situação": the line in the tone of its status. Live work (the AI writing) keeps a pulsing dot in
 * the cell instead of the spinner badge, so the whole line wraps inside the column like the others.
 */
export function SituationCell({ item, size }: { item: ProductionListItem; size?: 'sm' | 'md' }) {
  const ref = situationStatus(item.situation);
  const look = statusPresentation(ref);
  if (look.spinner) {
    return (
      <Badge tone={look.tone} variant="text" size={size} dot live wrap>
        {item.situation.line}
      </Badge>
    );
  }
  return <StatusBadge {...ref} label={item.situation.line} variant="text" size={size} wrap />;
}

/** "Próximo passo": the verb for the person looking; nothing when the move is someone else's. */
export function NextStepCell({ item }: { item: ProductionListItem }) {
  const step = item.nextStep;
  if (!step) return null;
  return (
    <TextLink href={nextStepHref(item)} size="sm">
      {step.label}
    </TextLink>
  );
}

/** The next step as the row's button on a phone (the row is a link; its control sits beside it). */
export function NextStepButton({ item }: { item: ProductionListItem }) {
  const step = item.nextStep;
  if (!step) return null;
  return (
    <ButtonLink href={nextStepHref(item)} size="sm">
      {step.label}
    </ButtonLink>
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
