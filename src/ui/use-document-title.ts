'use client';

import { useEffect } from 'react';

export const PRODUCT_NAME = 'Reporter IA';

/**
 * Titles that depend on client data ("Ateliê Sul · Artigo · Reporter IA"). Static routes use the
 * `metadata` export of their page; this refines it once the runtime answers. Next streams route
 * metadata after the page commits, so the hook keeps its title while mounted (it re-applies it
 * when the head's `<title>` changes) and lets the route title back on unmount.
 * `null`/`undefined` leaves the route title as it is.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return undefined;
    const wanted = `${title} · ${PRODUCT_NAME}`;
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
