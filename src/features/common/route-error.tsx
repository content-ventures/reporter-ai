'use client';

import { ErrorState, type StateSize } from '@content-ventures/design-system/v3';

/**
 * Route error boundary content (Next `error.tsx`): what failed and "Tentar de novo", which
 * re-renders the segment. The digest, when present, is the code shown in the caption.
 */
export function RouteError({
  error,
  retry,
  size = 'page',
}: {
  error: Error & { digest?: string };
  retry: () => void;
  size?: Exclude<StateSize, 'inline'>;
}) {
  return <ErrorState title="Não foi possível abrir esta tela" code={error.digest} onRetry={retry} size={size} />;
}
