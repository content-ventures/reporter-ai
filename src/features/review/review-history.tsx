'use client';

import { useMemo } from 'react';
import { MetaList, Timeline, type TimelineEntry } from '@content-ventures/design-system/v3';
import type { ArticleBody, DecisionAnchor } from '@/domain';
import type { PersonSummary, ReviewView } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { Provenance } from '@/ui/provenance';
import { StatusBadge } from '@/ui/status-badge';
import { RelativeTime } from '@/ui/time';
import { sectionMark, shortExcerpt, type HistoryItem } from './review-model';

/**
 * Histórico of the piece at this gate: who generated, saved, sent, approved or returned which
 * version, newest first. Notes read as quotes; returned passages are listed; every AI step shows
 * its provenance (prompt · Simulação local · duração · entradas) with the full record one click
 * away. The side pane pages it (`limit`).
 */

export function personName(people: readonly PersonSummary[] | undefined, id: string | undefined): string {
  if (!id || id === 'system') return 'Reporter IA';
  return people?.find((person) => person.id === id)?.name ?? 'Alguém';
}

function anchorFacts(anchors: readonly DecisionAnchor[], body: ArticleBody | undefined) {
  return (
    <MetaList
      size="xs"
      label="Trechos apontados"
      items={anchors.map((anchor) => {
        const mark = body ? sectionMark(body, anchor.blockId) : undefined;
        const quote = anchor.excerpt ? `“${shortExcerpt(anchor.excerpt, 60)}”` : 'Trecho';
        return mark ? `${mark} ${quote}` : quote;
      })}
    />
  );
}

export type ReviewHistoryProps = {
  review: ReviewView;
  items: readonly HistoryItem[];
  limit: number;
  people: readonly PersonSummary[] | undefined;
};

export function ReviewHistory({ review, items, limit, people }: ReviewHistoryProps) {
  const runs = useMemo(() => new Map(review.runs.map((run) => [run.id, run])), [review.runs]);
  const body = review.version.body.type === 'article' ? review.version.body : undefined;

  const entries: TimelineEntry[] = items.slice(0, limit).map((item) => {
    const run = item.runId ? runs.get(item.runId) : undefined;
    const name = personName(people, item.actorId);
    const entry: TimelineEntry = {
      id: item.id,
      title: item.standalone ? item.action : `${name} ${item.action}`,
      date: <RelativeTime at={item.at} />,
      dateTime: item.at,
      marker: <PersonAvatar personId={item.actorId === 'system' ? null : item.actorId} name={name} size="xs" decorative />,
    };
    if (item.decision === 'approved') entry.badge = <StatusBadge kind="piece" status="approved" variant="text" size="sm" />;
    else if (item.decision === 'changes_requested' || item.decision === 'rejected') {
      entry.badge = <StatusBadge kind="piece" status="changes_requested" variant="text" size="sm" />;
    } else if (item.kind === 'run' && run) entry.badge = <StatusBadge kind="run" status={run.status} variant="text" size="sm" />;
    if (item.note) entry.quote = item.note;
    if (item.anchors && item.anchors.length > 0) entry.extra = anchorFacts(item.anchors, body);
    else if (run) entry.extra = run.error ? <MetaList size="xs" items={[run.error.message]} /> : <Provenance run={run} size="xs" />;
    return entry;
  });

  return <Timeline items={entries} variant="activity" label="Histórico da peça" />;
}
