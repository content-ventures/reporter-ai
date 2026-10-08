'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { formatRelative, NotificationDot, NotificationsButton, type MenuSection } from '@content-ventures/design-system/v3';
import { CheckCheck } from '@content-ventures/design-system/v3/icons';
import { NOTIFYING_ACTIVITY, type ActivityType } from '@/domain';
import type { ActivityItem } from '@/ports';
import { useActivity } from '@/state';
import { PersonAvatar } from '../person-avatar';
import { productionHref } from '../routes';
import { useNow } from '../time';

/**
 * The bell (dot only, never a number) fed by the semantic activity feed. "Agora" lists what
 * happened since the person last looked (selecting an item or "Marcar tudo como visto");
 * "Antes" the rest. Each item opens its production on the current stage.
 */

const SEEN_KEY = 'reporter:ui:notifications-seen';
const QUERY = { types: [...NOTIFYING_ACTIVITY], page: 1, size: 12 };

const SYSTEM_TONE: Partial<Record<ActivityType, 'red' | 'gray'>> = {
  'run.failed': 'red',
  'delivery.failed': 'red',
};

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(value: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, value);
  } catch {
    // Storage unavailable (private window): the dot simply resets on reload.
  }
}

/** Last time the person looked at the bell (per browser). First visit: now. */
let seen: string | undefined;
const seenListeners = new Set<() => void>();

function getSeen(): string {
  if (seen === undefined) {
    seen = readSeen() ?? new Date().toISOString();
    writeSeen(seen);
  }
  return seen;
}

function markSeen(): void {
  seen = new Date().toISOString();
  writeSeen(seen);
  for (const listener of [...seenListeners]) listener();
}

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener);
  return () => {
    seenListeners.delete(listener);
  };
}

const getServerSeen = (): string | null => null;

export function ShellNotifications() {
  const router = useRouter();
  const activity = useActivity(QUERY);
  const now = useNow();
  const seenAt = useSyncExternalStore<string | null>(subscribeSeen, getSeen, getServerSeen);

  const items = useMemo(() => activity.data?.items ?? [], [activity.data]);
  const fresh = useMemo(() => (seenAt ? items.filter((item) => item.at > seenAt) : []), [items, seenAt]);
  const earlier = useMemo(() => (seenAt ? items.filter((item) => item.at <= seenAt) : items), [items, seenAt]);

  const sections = useMemo<MenuSection[]>(() => {
    const toItem = (item: ActivityItem) => ({
      label: item.summary,
      description: [item.productionTitle, now ? formatRelative(item.at, now) : null].filter(Boolean).join(' · '),
      leading: item.actor ? (
        <PersonAvatar person={item.actor} size="xs" decorative />
      ) : (
        <NotificationDot tone={SYSTEM_TONE[item.type] ?? 'gray'} />
      ),
      onSelect: () => {
        markSeen();
        if (item.productionId) router.push(productionHref(item.productionId));
      },
    });
    const result: MenuSection[] = [];
    if (fresh.length > 0) result.push({ label: 'Agora', items: fresh.map(toItem) });
    if (earlier.length > 0) result.push({ label: 'Antes', items: earlier.map(toItem) });
    if (result.length === 0) {
      result.push({ items: [{ label: activity.status === 'loading' ? 'Carregando…' : 'Tudo em dia', disabled: true }] });
    }
    if (fresh.length > 0) result.push({ items: [{ label: 'Marcar tudo como visto', icon: CheckCheck, onSelect: markSeen }] });
    return result;
  }, [activity.status, earlier, fresh, now, router]);

  return <NotificationsButton sections={sections} unread={fresh.length > 0} />;
}
