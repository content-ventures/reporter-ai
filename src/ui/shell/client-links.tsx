'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { requestLeave } from './leave-guard';

/**
 * Next/Link behaviour for every DS anchor (NavItem, Crumb, ButtonLink, CardLink, ListItem href,
 * Metric href…): a plain left click on a same-origin link becomes `router.push`, so the runtime
 * and its live runs survive navigation. Modifier clicks, `target`, `download`, other origins,
 * same-page hashes and handlers that already called `preventDefault()` keep the browser default.
 */
export function useClientLinks(): void {
  const router = useRouter();
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
      if (samePage && url.hash) return;
      event.preventDefault();
      const href = `${url.pathname}${url.search}${url.hash}`;
      if (requestLeave(href)) router.push(href);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router]);
}
