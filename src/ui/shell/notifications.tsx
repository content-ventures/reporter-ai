'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import { NotificationDot, NotificationsButton, type MenuSection } from '@content-ventures/design-system/v3';
import { CheckCheck } from '@content-ventures/design-system/v3/icons';
import { NOTIFYING_ACTIVITY, type ActivityType } from '@/domain';
import type { ActivityItem } from '@/ports';
import {useWorkspaceStorageKey} from '@/state/workspace-storage';
import {useBrowserPreference} from '@/state/browser-preference';
import { useActivity } from '@/state';
import { formatAgo } from '../approval-copy';
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

export function ShellNotifications() {
  const router = useRouter();
  const activity = useActivity(QUERY);
  const now = useNow();
  const key=useWorkspaceStorageKey(SEEN_KEY),[seenAt,setSeen]=useBrowserPreference(key);
  useEffect(()=>{if(key&&seenAt===null&&now)setSeen(new Date(now).toISOString());},[key,seenAt,now,setSeen]);
  const markSeen=useCallback(()=>setSeen(new Date().toISOString()),[setSeen]);

  const items = useMemo(() => activity.data?.items ?? [], [activity.data]);
  const fresh = useMemo(() => (seenAt ? items.filter((item) => item.at > seenAt) : []), [items, seenAt]);
  const earlier = useMemo(() => (seenAt ? items.filter((item) => item.at <= seenAt) : items), [items, seenAt]);

  const sections = useMemo<MenuSection[]>(() => {
    const toItem = (item: ActivityItem) => ({
      label: item.summary,
      description: [item.productionTitle, now ? formatAgo(item.at, now) : null].filter(Boolean).join(' · '),
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
  }, [activity.status, earlier, fresh, now, router,markSeen]);

  return <NotificationsButton sections={sections} unread={fresh.length > 0} />;
}
