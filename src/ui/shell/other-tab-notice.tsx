'use client';

import { Banner, Button } from '@content-ventures/design-system/v3';
import { useTabSync } from '@/state';

/**
 * A10 · "Aberta em outra aba": another tab saved over work in progress here (the same text edited
 * in two tabs), so this tab stopped saving and is read-only. "Usar esta aba" reloads what the
 * other tab saved and lets this one edit again (the other tab then gets this notice).
 *
 * The shell shows it as the page band. On a production it sits inside the production header
 * instead (`inline`, below the header line): a band above a docked studio would push the studio
 * past the window, and every stage keeps it in the same place.
 */
export function OtherTabNotice({ variant = 'band' }: { variant?: 'band' | 'inline' }) {
  const { readOnly, claim } = useTabSync();
  if (!readOnly) return null;
  return (
    <Banner
      tone="warning"
      variant={variant}
      title="Aberta em outra aba"
      action={
        <Button size="sm" onClick={claim}>
          Usar esta aba
        </Button>
      }
    >
      Esta aba ficou só para leitura para não apagar o que foi salvo na outra.
    </Banner>
  );
}
