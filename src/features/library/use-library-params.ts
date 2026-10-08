'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { parseLibraryParams, serializeLibraryParams, type LibraryParams } from './library-model';

export type SetLibraryParams = (patch: Partial<LibraryParams>) => void;

/**
 * The "Modelos" page state in the URL (`?format&q&model`, so the caller renders inside
 * `<Suspense>`): a filtered library or an open model can be linked. Writes replace the address
 * through the History API, which Next keeps in sync with `useSearchParams`; other parameters
 * (`reset`) stay.
 */
export function useLibraryParams(): [LibraryParams, SetLibraryParams] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const params = useMemo(() => parseLibraryParams(searchParams), [searchParams]);

  const setParams = useCallback<SetLibraryParams>(
    (patch) => {
      const current = new URLSearchParams(window.location.search);
      const next = { ...parseLibraryParams(current), ...patch };
      const search = new URLSearchParams(serializeLibraryParams(next));
      for (const [key, value] of current) if (!['format', 'category', 'q', 'model'].includes(key)) search.append(key, value);
      const query = search.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
    },
    [pathname],
  );

  return [params, setParams];
}
