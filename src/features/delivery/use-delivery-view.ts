'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * What Entrega shows lives in the URL (`?view=article`), so a link to the final article opens it:
 * "Pacote" (the files and what leaves, by default) or "Artigo final" (the approved article read as
 * it leaves). Replacing the entry keeps Back meaningful. Callers render under a `Suspense` boundary
 * (`useSearchParams`).
 */
export type DeliveryTab = 'package' | 'article';

export function useDeliveryView(): { tab: DeliveryTab; setTab: (tab: DeliveryTab) => void } {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tab: DeliveryTab = params.get('view') === 'article' ? 'article' : 'package';
  const setTab = useCallback(
    (next: DeliveryTab) => {
      const query = new URLSearchParams(params.toString());
      if (next === 'article') query.set('view', 'article');
      else query.delete('view');
      const search = query.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { tab, setTab };
}
