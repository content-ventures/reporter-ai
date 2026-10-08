'use client';

import { AccessState, ButtonLink } from '@content-ventures/design-system/v3';
import { OVERVIEW_HREF } from '@/ui/routes';

/** Unknown URL inside the workspace (global 404 and `notFound()` from a route). */
export function NotFoundState() {
  return (
    <AccessState
      kind="not-found"
      heading="h1"
      title="Página não encontrada"
      actions={
        <ButtonLink href={OVERVIEW_HREF} variant="primary">
          Ir para a visão geral
        </ButtonLink>
      }
    />
  );
}
