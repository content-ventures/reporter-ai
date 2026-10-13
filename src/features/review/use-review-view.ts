'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { resolveMode, type ReviewMode } from './review-model';

/**
 * The view of the review lives in the URL (`?ver=changes|final`), so a link opens exactly what it
 * names. Without it the review's own default applies ("O que mudou" when a previous send was
 * decided). Replacing the entry keeps Back meaningful. Callers render under a `Suspense` boundary
 * (`useSearchParams`).
 */
export function useReviewView(review: { hasPrevious: boolean; defaultView: ReviewMode }): {
  mode: ReviewMode;
  setMode: (mode: ReviewMode) => void;
} {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const mode = resolveMode(params.get('ver'), review);

  const setMode = useCallback(
    (next: ReviewMode) => {
      const query = new URLSearchParams(params.toString());
      query.set('ver', next);
      router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  return { mode, setMode };
}
