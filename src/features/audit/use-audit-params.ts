'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { AUDIT_PARAM_KEYS, parseAuditParams, patchAuditParams, serializeAuditParams, type AuditParams } from './audit-params';

export type SetAuditParams = (patch: Partial<AuditParams>, options?: { history?: 'push' | 'replace' }) => void;

/**
 * The Logs state from the URL (`useSearchParams`, so the caller renders inside `<Suspense>`).
 * Writes go through the History API, which Next keeps in sync with `useSearchParams` without a
 * server round trip; each write starts from the current address, so two changes in one tick land.
 */
export function useAuditParams(): [AuditParams, SetAuditParams] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const params = useMemo(() => parseAuditParams(searchParams), [searchParams]);

  const setParams = useCallback<SetAuditParams>(
    (patch, options = {}) => {
      const current = parseAuditParams(new URLSearchParams(window.location.search));
      const query = serializeAuditParams(patchAuditParams(current, patch));
      const url = query ? `${pathname}?${query}` : pathname;
      if (url === `${window.location.pathname}${window.location.search}`) return;
      if (options.history === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [pathname],
  );

  // An address the screen does not support (`?size=7`, an unknown type) is rewritten to what is on
  // screen, so a shared link never shows one thing and says another. Other parameters stay.
  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams();
    for (const [key, value] of current) if (!AUDIT_PARAM_KEYS.has(key)) next.append(key, value);
    for (const [key, value] of new URLSearchParams(serializeAuditParams(params))) next.append(key, value);
    const sorted = (search: URLSearchParams) => [...search.entries()].map(([key, value]) => `${key}=${value}`).sort().join('&');
    if (sorted(next) === sorted(current)) return;
    const query = next.toString();
    window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
  }, [params, pathname, searchParams]);

  return [params, setParams];
}
