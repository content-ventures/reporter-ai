'use client';

import { useEffect, useRef } from 'react';

/**
 * In-app navigation guard for a page with unsaved work (Nova produção): a sidebar item, a
 * breadcrumb, a link or a ⌘K jump asks the page first instead of leaving. Reloading or closing
 * the tab is the page's own `beforeunload`. One guard at a time (the page on screen).
 */

type Guard = (href: string) => boolean;

let current: Guard | null = null;

/** True when navigation to `href` may go ahead now; false when the page took over (it asks). */
export function requestLeave(href: string): boolean {
  return current ? current(href) : true;
}

/** While `active`, in-app navigation calls `onBlocked(href)` instead of leaving. */
export function useLeaveGuard(active: boolean, onBlocked: (href: string) => void): void {
  const latest = useRef(onBlocked);
  useEffect(() => {
    latest.current = onBlocked;
  });
  useEffect(() => {
    if (!active) return undefined;
    const guard: Guard = (href) => {
      latest.current(href);
      return false;
    };
    current = guard;
    return () => {
      if (current === guard) current = null;
    };
  }, [active]);
}
