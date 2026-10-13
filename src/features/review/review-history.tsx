'use client';

import { useMemo } from 'react';
import { Drawer, Timeline, type TimelineEntry } from '@content-ventures/design-system/v3';
import type { PieceKind } from '@/domain';
import type { PersonSummary, PieceApproval, VersionView } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { useNow } from '@/ui/time';
import { historyEvents } from './review-model';

/**
 * "Histórico de versões" (⋯ of the review, COPY §2.7): the piece's story newest first, each event
 * named by what happened — "Texto da IA", "Editado por Juliana", "Enviado a Pedro", "Aprovado por
 * Pedro" — with when, the text's size and the note as it was written. No version numbers, no
 * hashes. Read-only: restoring a version is the studio's.
 */
export type ReviewHistoryProps = {
  open: boolean;
  onClose: () => void;
  kind: PieceKind;
  versions: readonly VersionView[];
  approval: Pick<PieceApproval, 'requests' | 'decisions'>;
  people: readonly PersonSummary[] | undefined;
};

export function ReviewHistory({ open, onClose, kind, versions, approval, people }: ReviewHistoryProps) {
  const now = useNow();
  const entries = useMemo<TimelineEntry[]>(
    () =>
      historyEvents({ kind, versions, requests: approval.requests, decisions: approval.decisions, ...(people ? { people } : {}), ...(now ? { now } : {}) }).map((event) => {
        const entry: TimelineEntry = {
          id: event.id,
          title: event.title,
          date: event.meta,
          dateTime: event.at,
          marker: <PersonAvatar personId={event.personId} name={event.personId ? 'Alguém' : 'Reporter IA'} size="xs" decorative />,
        };
        if (event.note) entry.quote = event.note;
        return entry;
      }),
    [kind, versions, approval.requests, approval.decisions, people, now],
  );

  return (
    <Drawer open={open} onClose={onClose} size="lg" title="Histórico de versões">
      <Timeline items={entries} variant="activity" label="Histórico de versões" />
    </Drawer>
  );
}
