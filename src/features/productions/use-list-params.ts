'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { parseListParams, patchListParams, serializeListParams, type ListParams } from './list-params';

const LIST_KEYS = new Set(['status', 'q', 'owner', 'origin', 'from', 'to', 'sort', 'page', 'size']);

export type SetListParams = (patch: Partial<ListParams>, options?: { history?: 'push' | 'replace' }) => void;

/**
 * The list state from the URL (`useSearchParams`, so the caller renders inside `<Suspense>`).
 * Writes go through the native History API, which Next keeps in sync with `useSearchParams`
 * without a server round trip. Each write starts from the current address, so two changes in
 * the same tick both land.
 */
export function useListParams(): [ListParams, SetListParams] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const params = useMemo(() => parseListParams(searchParams), [searchParams]);

  const setParams = useCallback<SetListParams>(
    (patch, options = {}) => {
      const current = parseListParams(new URLSearchParams(window.location.search));
      const query = serializeListParams(patchListParams(current, patch));
      const url = query ? `${pathname}?${query}` : pathname;
      if (url === `${window.location.pathname}${window.location.search}`) return;
      if (options.history === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [pathname],
  );

  // An address the list does not support (`?size=5`, an unknown tab) is rewritten to what is on
  // screen, so a shared link never shows one thing and says another. Other parameters (`reset`)
  // are left alone.
  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams();
    for (const [key, value] of current) if (!LIST_KEYS.has(key)) next.append(key, value);
    for (const [key, value] of new URLSearchParams(serializeListParams(params))) next.append(key, value);
    const sorted = (search: URLSearchParams) => [...search.entries()].map(([key, value]) => `${key}=${value}`).sort().join('&');
    if (sorted(next) === sorted(current)) return;
    const query = next.toString();
    window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
  }, [params, pathname, searchParams]);

  return [params, setParams];
}
