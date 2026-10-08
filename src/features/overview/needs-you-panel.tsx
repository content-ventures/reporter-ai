'use client';

import { useState } from 'react';
import {
  ButtonLink,
  EmptyState,
  List,
  ListGroup,
  ListItem,
  ListItemSkeleton,
  NextAction,
  PageStack,
  Panel,
  Section,
  Segmented,
} from '@content-ventures/design-system/v3';
import { CheckCircle2, PenLine } from '@content-ventures/design-system/v3/icons';
import type { DeskGroup, DeskGroupId, DeskItem, DeskView, InProgressItem } from '@/ports';
import { formatDue } from '@/ui/approval-copy';
import { formatCount } from '@/ui/format';
import { PersonAvatar } from '@/ui/person-avatar';
import { stepTargetHref } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { useNow } from '@/ui/time';
import { continueLine, continueTitle, DESK_GROUP_LABELS, deskItemLine, TEAM_STAGE_LABELS, teamLine } from './desk-copy';
import { DeskAction, ProgressAction } from './next-step-action';

/**
 * "Precisa de você" (D1, COPY §1.2–§1.5): the viewer's queue as one list, a group per urgency and
 * role (Para aprovar → Devolvidos para ajuste → Com erro → Material sem autorização → Aguardando
 * outra pessoa). Each row says who asked, when, the recado and the due date, with the verb as a
 * button ("Aguardando outra pessoa" has none: the move is someone else's). Nothing waiting: "Nada
 * esperando você" and the wide "Continuar" card. "Equipe" turns the same area into every
 * production by stage, for the panorama, without turning the page into a board.
 */

type View = 'mine' | 'team';

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'mine', label: 'Para mim' },
  { value: 'team', label: 'Equipe' },
];

/** Due date of a row (`NextAction`): "prazo: hoje" orange, "atrasado · prazo era 07/10" red. */
function Due({ dueOn, now }: { dueOn?: string; now: Date | undefined }) {
  if (!dueOn || !now) return null;
  const { text, due } = formatDue(dueOn, now);
  if (!text || due === 'none') return null;
  return <NextAction label={text} due={due} />;
}

/** "Artigo ● Aguardando aprovação" (the piece is already in the line of "Aguardando outra pessoa"). */
function RowStatus({ group, item }: { group: DeskGroupId; item: DeskItem }) {
  const badge =
    item.status === 'unauthorized' ? (
      <StatusBadge kind="production" status="unauthorized" variant="text" size="sm" />
    ) : (
      <StatusBadge kind="piece" status={item.status} variant="text" size="sm" />
    );
  if (group === 'waiting_other' || !item.pieceLabel) return badge;
  return (
    <>
      {item.pieceLabel} {badge}
    </>
  );
}

function DeskRow({ group, item, now }: { group: DeskGroupId; item: DeskItem; now: Date | undefined }) {
  return (
    <ListItem
      leading={<PersonAvatar person={item.from} name="Sistema" size="sm" />}
      title={item.productionTitle}
      titleLines={2}
      description={deskItemLine(group, item, now)}
      meta={<RowStatus group={group} item={item} />}
      trailing={<Due dueOn={item.dueOn} now={now} />}
      actions={<DeskAction item={item} />}
    />
  );
}

function QueueList({ groups, now }: { groups: readonly DeskGroup[]; now: Date | undefined }) {
  return (
    <List label="Precisa de você" framed={false} bleed>
      {groups.map((group) => (
        <ListGroup key={group.id} label={DESK_GROUP_LABELS[group.id]} meta={formatCount(group.items.length)}>
          {group.items.map((item) => (
            <DeskRow key={`${item.productionId}-${item.pieceId ?? 'source'}`} group={group.id} item={item} now={now} />
          ))}
        </ListGroup>
      ))}
    </List>
  );
}

/** The wide card of an empty queue: the viewer's own next move (brief §3, borrowed from C). */
function ContinueCard({ item }: { item: InProgressItem }) {
  const href = item.nextStep ? stepTargetHref(item.productionId, item.nextStep.target) : undefined;
  return (
    <List label="Continuar">
      <ListItem
        icon={PenLine}
        title={continueTitle(item)}
        description={continueLine(item)}
        actions={
          href && (
            <ButtonLink variant="secondary" size="sm" href={href} aria-label={`Continuar: ${item.productionTitle}`}>
              Continuar
            </ButtonLink>
          )
        }
      />
    </List>
  );
}

function MyQueue({ desk, now }: { desk: DeskView; now: Date | undefined }) {
  if (desk.needsYou > 0) return <QueueList groups={desk.groups} now={now} />;
  // Nothing needs the viewer: say so, offer their own next move, then what they wait on.
  return (
    <PageStack>
      <EmptyState size="inline" icon={CheckCircle2} title="Nada esperando você" />
      {desk.continueWith && <ContinueCard item={desk.continueWith} />}
      {desk.groups.length > 0 && <QueueList groups={desk.groups} now={now} />}
    </PageStack>
  );
}

function TeamRow({ item }: { item: InProgressItem }) {
  return (
    <ListItem
      leading={<PersonAvatar person={item.owner} size="sm" />}
      title={item.productionTitle}
      description={teamLine(item)}
      trailing={<ProgressAction item={item} />}
    />
  );
}

function TeamList({ team }: { team: DeskView['team'] }) {
  return (
    <List label="Equipe" framed={false} bleed>
      {team.map((stage) => (
        <ListGroup key={stage.stage} label={TEAM_STAGE_LABELS[stage.stage]} meta={formatCount(stage.items.length)}>
          {stage.items.length > 0 ? (
            stage.items.map((item) => <TeamRow key={item.productionId} item={item} />)
          ) : (
            <ListItem title="Nada aqui" density="sm" disabled />
          )}
        </ListGroup>
      ))}
    </List>
  );
}

function Loading() {
  return (
    <List label="Carregando" framed={false} bleed>
      {[0, 1, 2].map((index) => (
        <ListItemSkeleton key={index} />
      ))}
    </List>
  );
}

/** `team`: the "Equipe" view is released (dashboard registry); without it there is no switch. */
export function NeedsYouPanel({ desk, team }: { desk: DeskView | undefined; team: boolean }) {
  const [view, setView] = useState<View>('mine');
  const now = useNow();
  const shown: View = team ? view : 'mine';
  const teamTotal = desk?.team.reduce((total, stage) => total + stage.items.length, 0) ?? 0;
  const meta = !desk ? undefined : shown === 'team' ? formatCount(teamTotal) : desk.needsYou > 0 ? formatCount(desk.needsYou) : undefined;
  return (
    <Panel>
      <Section
        title={shown === 'team' ? 'Equipe' : 'Precisa de você'}
        meta={meta}
        action={team ? <Segmented label="Mostrar" size="sm" options={VIEW_OPTIONS} value={view} onChange={setView} /> : undefined}
      >
        {!desk ? <Loading /> : shown === 'team' ? <TeamList team={desk.team} /> : <MyQueue desk={desk} now={now} />}
      </Section>
    </Panel>
  );
}
