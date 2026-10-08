'use client';

import { createContext, use, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Crumb } from '@content-ventures/design-system/v3';

/**
 * The TopBar trail. Screens declare their trail with `useBreadcrumb(crumbs)`; the shell shows
 * the registration with the highest `priority` (ties: the latest). The production frame uses
 * priority 1 for "Produções › Ateliê Sul › Artigo", so a screen inside it only overrides it with
 * priority 2. Links are plain `href`s: the shell turns same-origin clicks into client navigation.
 */

type Entry = { crumbs: Crumb[]; priority: number; order: number };

type BreadcrumbApi = {
  set(id: string, crumbs: Crumb[], priority: number): void;
  remove(id: string): void;
};

const ApiContext = createContext<BreadcrumbApi | null>(null);
const TrailContext = createContext<Crumb[] | undefined>(undefined);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map());
  const order = useRef(0);

  const set = useCallback((id: string, crumbs: Crumb[], priority: number) => {
    order.current += 1;
    const at = order.current;
    setEntries((previous) => new Map(previous).set(id, { crumbs, priority, order: at }));
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const api = useMemo(() => ({ set, remove }), [set, remove]);
  const trail = useMemo(() => {
    let best: Entry | undefined;
    for (const entry of entries.values()) {
      if (!best || entry.priority > best.priority || (entry.priority === best.priority && entry.order > best.order)) best = entry;
    }
    return best?.crumbs;
  }, [entries]);

  return (
    <ApiContext value={api}>
      <TrailContext value={trail}>{children}</TrailContext>
    </ApiContext>
  );
}

const crumbKey = (crumbs: readonly Crumb[]) => crumbs.map((crumb) => `${crumb.label}\u0000${crumb.href ?? ''}`).join('\u0001');

/**
 * Declares the trail of the screen while it is mounted (`null`: nothing yet, e.g. loading).
 * The last crumb is the current page (text); earlier ones carry `href`.
 */
export function useBreadcrumb(crumbs: Crumb[] | null | undefined, options: { priority?: number } = {}): void {
  const api = use(ApiContext);
  const priority = options.priority ?? 0;
  const id = useId();
  const key = crumbs ? crumbKey(crumbs) : null;
  const latest = useRef(crumbs);
  useLayoutEffect(() => {
    latest.current = crumbs;
  });
  useLayoutEffect(() => {
    if (!api || key === null || !latest.current) return undefined;
    api.set(id, latest.current, priority);
    return () => api.remove(id);
  }, [api, id, key, priority]);
}

/** The trail declared by the screens; `undefined` when none did (the shell derives a default). */
export function useDeclaredBreadcrumb(): Crumb[] | undefined {
  return use(TrailContext);
}
