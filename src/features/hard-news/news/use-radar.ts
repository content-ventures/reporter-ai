'use client';

import { useEffect, useRef } from 'react';
import { toast, useAnnouncer } from '@content-ventures/design-system/v3';
import { priorityOf } from '@/domain/hard-news';
import { arrivalsFor } from '../preview/arrivals';
import { useHardNews } from '../state/hard-news-provider';

const READ_EVERY_MS = 60_000;
const RETURN_EVERY_MS = 30_000;

/**
 * Keeps the radar alive while the desk is open (the backend later pushes the same changes):
 * plays this visit's pending arrivals, reads the source that is due every minute, brings
 * postponed stories back when their time comes, and tells the person what landed — a toast for
 * a high-priority story, the screen reader for every arrival. Only the news desk calls it.
 */
export function useRadar(onOpen: (id: string) => void, server = false) {
  const { state, ready, actions } = useHardNews();
  const { announce, region } = useAnnouncer();
  const latest = useRef({ state, onOpen, announce });
  useEffect(() => {
    latest.current = { state, onOpen, announce };
  });

  // The pending arrivals, each at its time after the desk opens (each happens once per desk).
  // News on the server (F2.1) arrive by the server's reads: nothing is simulated.
  useEffect(() => {
    if (!ready || server) return undefined;
    const radar = latest.current.state.radar;
    const released = new Set(radar?.released ?? []);
    const timers = arrivalsFor(radar?.round ?? 0)
      .filter((arrival) => !released.has(arrival.id))
      .map((arrival) => setTimeout(() => actions.arrive(arrival), arrival.afterSeconds * 1000));
    return () => timers.forEach(clearTimeout);
  }, [actions, ready, server]);

  // Sources are read on their schedule; postponed stories come back on theirs.
  useEffect(() => {
    if (!ready || server) return undefined;
    // Opening the radar reads the source that is due right away.
    actions.readFeed();
    actions.returnDue();
    const reads = setInterval(() => actions.readFeed(), READ_EVERY_MS);
    const returns = setInterval(() => actions.returnDue(), RETURN_EVERY_MS);
    return () => {
      clearInterval(reads);
      clearInterval(returns);
    };
  }, [actions, ready, server]);

  // What landed since the desk opened: announced; a high-priority story also gets a toast.
  const known = useRef<{ news: Set<string>; read: Set<string>; outlets: Map<string, number> } | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!known.current) {
      known.current = {
        news: new Set(state.news.map((item) => item.id)),
        read: new Set(state.news.filter((item) => item.classification).map((item) => item.id)),
        outlets: new Map(state.news.map((item) => [item.id, item.duplicates.length])),
      };
      return;
    }
    const seen = known.current;
    const say = latest.current.announce;
    for (const item of state.news) {
      if (!seen.news.has(item.id)) {
        seen.news.add(item.id);
        say(`Chegou: ${item.title}`);
      }
      const outlets = seen.outlets.get(item.id) ?? item.duplicates.length;
      if (item.duplicates.length > outlets) say(`${item.duplicates.at(-1)?.source ?? 'Outro veículo'} também publicou: ${item.title}`);
      seen.outlets.set(item.id, item.duplicates.length);
      if (item.classification && !seen.read.has(item.id)) {
        seen.read.add(item.id);
        if (item.status === 'new' && priorityOf(item) === 'high') {
          toast('Nova notícia com prioridade alta', {
            tone: 'info',
            description: item.title,
            action: { label: 'Abrir', onClick: () => latest.current.onOpen(item.id) },
          });
        }
      }
    }
  }, [ready, state.news]);

  return { region };
}
