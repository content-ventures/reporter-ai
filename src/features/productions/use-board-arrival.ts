'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAnnouncer } from '@content-ventures/design-system/v3';
import { firstName } from '@/domain';
import type { ProductionListItem } from '@/ports';
import { usePeople } from '@/state';
import { BOARD_HIGHLIGHT_PARAM } from '@/ui/routes';
import { MOVED_TOAST_MS } from '@/ui/use-stage-move';

/** How far the board widens its first page, once, to find the moved card. */
const ARRIVAL_REACH = 200;

type Arrival = { id: string; glowing: boolean; widened: boolean };

export type BoardArrivalInput = {
  /** The board's loaded productions (archived ones aside), in the list order. */
  items: readonly ProductionListItem[];
  /** Productions matching the board across all pages. */
  total: number;
  /** The current page answered (not the loading state of a new page size). */
  ready: boolean;
  /** Raises the page size (never lowers it). */
  widen: (size: number) => void;
  /** Column title of a card ("Aprovação"). */
  laneOf: (item: ProductionListItem) => string;
  viewerId: string | undefined;
};

export type BoardArrival = {
  /** `items` with the moved card first, so it leads its column. */
  rows: ProductionListItem[];
  /** The card to mark `arrived` (while the move toast is up). */
  arrivedId: string | null;
  /** The live region of the announcement; render it once, near the board. */
  region: ReactNode;
};

/**
 * The card that just moved (`?destaque=<id>`, from `boardHref` after a send, an approval or a
 * request for changes). The board loads it even beyond the first page (one bounded widening), puts
 * it first in its column, marks it `arrived` while the move toast is up and announces it once
 * ("Aurora: Aprovação · com Pedro"). The parameter then leaves the address, with no new history
 * entry, so a reload or a shared link shows the plain board.
 */
export function useBoardArrival({ items, total, ready, widen, laneOf, viewerId }: BoardArrivalInput): BoardArrival {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const people = usePeople();
  const { announce, region } = useAnnouncer();
  const announced = useRef('');
  const requested = searchParams.get(BOARD_HIGHLIGHT_PARAM);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const item = arrival ? items.find((entry) => entry.id === arrival.id) : undefined;
  if (requested && requested !== arrival?.id) {
    setArrival({ id: requested, glowing: true, widened: false });
  } else if (arrival && ready && !item && !arrival.widened && total > items.length) {
    // Beyond the first page: widen once, as far as the reach allows; past it, only the toast tells.
    setArrival({ ...arrival, widened: true });
    widen(Math.min(total, ARRIVAL_REACH));
  }
  const settled = Boolean(arrival && ready && (item || arrival.widened || total <= items.length));

  const actor = item?.situation.nextActor;
  const person = actor?.personId ? people.data?.find((entry) => entry.id === actor.personId) : undefined;
  const naming = Boolean(actor?.personId && !person && people.status === 'loading');
  const who = !actor?.personId ? '' : actor.personId === viewerId ? 'você' : firstName(person?.name);
  const message = item ? [`${item.title}: ${laneOf(item)}`, who ? `com ${who}` : ''].filter(Boolean).join(' · ') : '';
  const glowing = Boolean(item && arrival?.glowing);
  const arrivedId = glowing && arrival ? arrival.id : null;

  // After the reveal (the card's own effect ran in this commit): drop the parameter and announce.
  // A stale answer swapped for a fresh one re-announces the new column while the card glows.
  useEffect(() => {
    if (!settled) return;
    const search = new URLSearchParams(window.location.search);
    if (search.has(BOARD_HIGHLIGHT_PARAM)) {
      search.delete(BOARD_HIGHLIGHT_PARAM);
      const query = search.toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
    }
    if (!glowing || naming || !message || announced.current === message) return;
    announced.current = message;
    announce(message);
  }, [settled, glowing, naming, message, pathname, announce]);

  // The highlight lasts as long as the toast that explains it (with reduced motion it holds still).
  useEffect(() => {
    if (!arrivedId) return undefined;
    const timer = window.setTimeout(() => setArrival((current) => current && { ...current, glowing: false }), MOVED_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [arrivedId]);

  const index = item ? items.indexOf(item) : -1;
  const rows = index > 0 ? [items[index], ...items.slice(0, index), ...items.slice(index + 1)] : [...items];
  return { rows, arrivedId, region };
}
