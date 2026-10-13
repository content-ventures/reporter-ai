'use client';

import { Banner, Button } from '@content-ventures/design-system/v3';
import { useTabSync } from '@/state';
import { StatusBanner } from '../status-banner';

/**
 * A10 · "Aberta em outra aba": another tab saved over work in progress here (the same text edited
 * in two tabs), so this tab stopped saving and is read-only. "Usar esta aba" reloads what the
 * other tab saved and lets this one edit again (the other tab then gets this notice).
 *
 * The shell shows it as the page band. On a production it is the production header's notice
 * (`inline`, under the header line, one sentence and one verb, COPY §5.1) when the screen shows
 * no other notice: a band above a docked studio would push the studio past the window.
 */
export function OtherTabNotice({ variant = 'band' }: { variant?: 'band' | 'inline' }) {
  const { readOnly, claim } = useTabSync();
  if (!readOnly) return null;
  if (variant === 'inline') {
    return (
      <StatusBanner kind="other_tab" action={{ label: 'Usar esta aba', onClick: claim }}>
        Esta produção está aberta em outra aba.
      </StatusBanner>
    );
  }
  const action = (
    <Button size="sm" onClick={claim}>
      Usar esta aba
    </Button>
  );
  return (
    <Banner tone="warning" variant="band" title="Aberta em outra aba" action={action}>
      Esta aba ficou só para leitura para não apagar o que foi salvo na outra.
    </Banner>
  );
}
