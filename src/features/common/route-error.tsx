'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { ButtonLink, ErrorState, type StateSize } from '@content-ventures/design-system/v3';

/**
 * Route error boundary content (Next `error.tsx`): what failed and "Tentar de novo", which
 * re-renders the segment. The digest, when present, is the code shown in the caption. `back` adds
 * a recovery action next to the retry (inside a production: "Ver produções").
 */
export function RouteError({
  error,
  retry,
  size = 'page',
  back,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  size?: Exclude<StateSize, 'inline'>;
  back?: { label: string; href: string };
}) {
  const workspaceHrefFor = useWorkspaceHref();
  return (
    <ErrorState
      title="Não foi possível abrir esta tela"
      code={error.digest}
      onRetry={retry}
      size={size}
      actions={
        back ? (
          <ButtonLink href={workspaceHrefFor(back.href)} size={size === 'page' ? 'md' : 'sm'}>
            {back.label}
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
