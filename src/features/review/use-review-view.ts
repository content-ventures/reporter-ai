'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CompareOption, CompareTarget, ResolvedView, ReviewMode } from './review-model';
import { resolveView } from './review-model';

/**
 * The review view lives in the URL (`?view=changes|final&compare=ai|approved`, PLAN §4.6), so a
 * link to "what changed since v3" opens exactly that. Replacing the entry keeps Back meaningful.
 * Callers render under a `Suspense` boundary (`useSearchParams`).
 */
export function useReviewView(options: readonly CompareOption[]): ResolvedView & {
  setMode: (mode: ReviewMode) => void;
  setCompare: (target: CompareTarget) => void;
} {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const view = params.get('view');
  const compare = params.get('compare');
  const resolved = useMemo(() => resolveView(options, { view, compare }), [options, view, compare]);

  const replace = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const setMode = useCallback((mode: ReviewMode) => replace({ view: mode }), [replace]);
  const setCompare = useCallback((target: CompareTarget) => replace({ view: 'changes', compare: target }), [replace]);
  return { ...resolved, setMode, setCompare };
}
