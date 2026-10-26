'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import type { ReactNode } from 'react';
import { AccessState, ButtonLink, ErrorState, SkeletonText } from '@content-ventures/design-system/v3';
import { usePlatformOperator } from '@/state';
import { PlatformShell } from './platform-shell';

/**
 * The console opens only for its operator. The cloud build already answered 404 to anyone else
 * (`platformAccess`); this covers the local database and a session that lost the role meanwhile.
 */
export function PlatformGate({ children }: { children: ReactNode }) {
  const workspaceHrefFor = useWorkspaceHref();
  const operator = usePlatformOperator();
  if (operator.status === 'error' && operator.error?.code === 'restricted') {
    return <AccessState kind="restricted" heading="h1" title="Console restrito ao operador da plataforma" actions={<ButtonLink href={workspaceHrefFor("/")} variant="primary">Ir para o workspace</ButtonLink>} />;
  }
  if (operator.status === 'error') return <ErrorState heading="h1" title="Console indisponível" description={operator.error?.message} onRetry={operator.retry} />;
  if (operator.status === 'loading') return <SkeletonText lines={3} />;
  return <PlatformShell>{children}</PlatformShell>;
}
