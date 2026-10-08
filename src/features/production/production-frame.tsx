'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import { AccessState, ButtonLink, ErrorState, PageStack, WorkspaceLayout, type Crumb } from '@content-ventures/design-system/v3';
import type { ProductionId } from '@/domain';
import type { ProductionDetail } from '@/ports';
import { pieceKind } from '@/registries';
import { useProduction } from '@/state';
import { useBreadcrumb } from '@/ui/shell';
import { pieceHref, productionHref, productionRoute, PRODUCTIONS_HREF, type ProductionRoute } from '@/ui/routes';
import { useDocumentTitle } from '@/ui/use-document-title';
import { ProductionFrameContext, type ProductionFrameState } from './production-context';
import { ProductionHeaderView } from './production-header';

export { useProductionFrame, type ProductionFrameState } from './production-context';
export { ProductionHeader } from './production-header';

/**
 * A stage that is a page (Material, Entrega) in the studios' docked frame (B02): the header line at
 * the same place and size on every stage, the page scrolling under it with the frame's own margins.
 */
export function StagePage({ header, label, children }: { header: ReactNode; label: string; children: ReactNode }) {
  return (
    <WorkspaceLayout docked header={header} mainLabel={label}>
      <PageStack>{children}</PageStack>
    </WorkspaceLayout>
  );
}

const ROUTE_LABEL: Partial<Record<ProductionRoute['kind'], string>> = {
  source: 'Material',
  delivery: 'Entrega',
};

/** "Produções › Ateliê Sul › Artigo › Revisão". */
function frameCrumbs(production: ProductionDetail | undefined, route: ProductionRoute): Crumb[] | null {
  if (!production) return null;
  const root: Crumb = { label: 'Produções', href: PRODUCTIONS_HREF };
  const title: Crumb = { label: production.title, href: productionHref(production.id) };
  if (route.kind === 'studio') return [root, title, { label: pieceKind(route.pieceKind)?.label ?? 'Peça' }];
  if (route.kind === 'review') {
    return [root, title, { label: pieceKind(route.pieceKind)?.label ?? 'Peça', href: pieceHref(production.id, route.pieceKind) }, { label: 'Revisão' }];
  }
  const label = ROUTE_LABEL[route.kind];
  return label ? [root, title, { label }] : [root, { label: production.title }];
}

function documentTitle(production: ProductionDetail | undefined, route: ProductionRoute): string | null {
  if (!production) return null;
  const stage = route.kind === 'studio' || route.kind === 'review' ? pieceKind(route.pieceKind)?.label : ROUTE_LABEL[route.kind];
  return [production.title, stage, route.kind === 'review' ? 'Revisão' : null].filter(Boolean).join(' · ');
}

/**
 * Persistent frame of `/productions/[id]/**` (PLAN §3.4): production header with the journey
 * Stepper above Material, Revisão and Entrega; studios host the same header inside their
 * docked `WorkspaceLayout` (no double scroll). Unknown id → AccessState not-found; a production
 * restricted to another team (REQ-T.1, B06) → AccessState restricted with who to ask. Screens read
 * the production from `useProductionFrame()`.
 */
export function ProductionFrame({ productionId, children }: { productionId: ProductionId; children: ReactNode }) {
  const production = useProduction(productionId);
  const segments = useSelectedLayoutSegments();
  const route = useMemo(() => productionRoute(segments), [segments]);
  const [hosts, setHosts] = useState(0);

  const hostHeader = useCallback(() => {
    setHosts((count) => count + 1);
    return () => setHosts((count) => count - 1);
  }, []);

  const value = useMemo<ProductionFrameState>(
    () => ({ productionId, production, route, hostHeader }),
    [hostHeader, production, productionId, route],
  );

  // A refusal may keep the last answer (another person just switched in): never show its title.
  const shown = production.status === 'error' ? undefined : production.data;
  useBreadcrumb(frameCrumbs(shown, route), { priority: 1 });
  useDocumentTitle(documentTitle(shown, route));

  if (production.status === 'error') {
    const code = production.error?.code;
    if (code === 'not_found' || code === 'restricted') {
      return (
        <AccessState
          kind={code === 'not_found' ? 'not-found' : 'restricted'}
          heading="h1"
          title={code === 'not_found' ? 'Produção não encontrada' : 'Sem acesso a esta produção'}
          // REQ-T.1 (B06): who to ask, from the adapter ("Peça acesso a João.").
          description={code === 'restricted' ? production.error?.message : undefined}
          actions={
            <ButtonLink href={PRODUCTIONS_HREF} variant="primary">
              Ver produções
            </ButtonLink>
          }
        />
      );
    }
    return <ErrorState title="Não foi possível abrir a produção" onRetry={production.retry} size="page" />;
  }

  return (
    <ProductionFrameContext value={value}>
      <PageStack>
        {/* Every stage screen hosts the header in its own layout; only the redirecting index and an
            unknown sub-route need the frame's. Decided by the route, so the server HTML and the first
            client render agree (no second, skeleton header that jumps away after hydration). */}
        {(route.kind === 'index' || route.kind === 'unknown') && hosts === 0 ? <ProductionHeaderView production={production.data} route={route} /> : null}
        {children}
      </PageStack>
    </ProductionFrameContext>
  );
}
