'use client';

import {
  EmptyState,
  List,
  ListGroup,
  ListItem,
  ListItemSkeleton,
  NextAction,
  PageStack,
  Panel,
  Section,
  TextLink,
} from '@content-ventures/design-system/v3';
import { CheckCircle2 } from '@content-ventures/design-system/v3/icons';
import type { DeskGroup, DeskGroupId, DeskItem, DeskView } from '@/ports';
import { formatDue } from '@/ui/approval-copy';
import { formatCount } from '@/ui/format';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { PersonAvatar } from '@/ui/person-avatar';
import { StatusBadge } from '@/ui/status-badge';
import { useNow } from '@/ui/time';
import { DESK_GROUP_LABELS, deskItemLine } from './desk-copy';
import { DeskAction } from './next-step-action';

/** Personal pending actions, grouped by their required next step. */

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
      description={<><RowStatus group={group} item={item} /> · {deskItemLine(group, item, now)} <Due dueOn={item.dueOn} now={now} /></>}
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

function MyQueue({ desk, now }: { desk: DeskView; now: Date | undefined }) {
  const groups = desk.groups.filter(group => group.id !== 'waiting_other');
  return (
    <PageStack>
      {desk.needsYou === 0 && <EmptyState size="inline" icon={CheckCircle2} title="Nada esperando você" />}
      {groups.length > 0 && <QueueList groups={groups.map(group => ({ ...group, items: group.items.slice(0, 3) }))} now={now} />}
      {groups.some(group => group.items.length > 3) && <TextLink href={PRODUCTIONS_HREF} size="sm">Ver todas as pendências</TextLink>}
    </PageStack>
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

export function NeedsYouPanel({ desk }: { desk: DeskView | undefined }) {
  const now = useNow();
  return (
    <Panel>
      <Section title="Precisa de você" meta={desk ? formatCount(desk.needsYou) : undefined}>
        {!desk ? <Loading /> : <MyQueue desk={desk} now={now} />}
      </Section>
    </Panel>
  );
}
