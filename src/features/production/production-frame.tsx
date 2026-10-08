'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import { AccessState, ButtonLink, ErrorState, PageStack, WorkspaceLayout } from '@content-ventures/design-system/v3';
import type { ProductionId } from '@/domain';
import type { ProductionDetail } from '@/ports';
import { pieceKind } from '@/registries';
import { useProduction } from '@/state';
import { productionRoute, PRODUCTIONS_HREF, type ProductionRoute } from '@/ui/routes';
import { useDocumentTitle } from '@/ui/use-document-title';
import { ProductionFrameContext, type ProductionFrameState } from './production-context';
import { ProductionHeaderView, ProductionPrimaryBar, type HeaderPrimary } from './production-header';

export { useProductionFrame, type ProductionFrameState } from './production-context';
export {
  ProductionHeader,
  ProductionPrimaryBar,
  useJourneyLabel,
  type HeaderBack,
  type HeaderPrimary,
  type HeaderSecondary,
  type ProductionHeaderProps,
} from './production-header';

/** Below this width a stage page moves its primary from the header line to the bottom bar. */
const STAGE_PAGE_NARROW = 640;

/**
 * A stage that is a page (Material, Entrega) in the studios' docked frame (B02): the header line at
 * the same place and size on every stage, the page scrolling under it with the frame's own margins.
 * With `primary`, a phone (≤640) gets it in `ProductionPrimaryBar` at the bottom; pass `header` as a
 * function of `narrow` to leave the primary out of the header line there.
 */
export function StagePage({
  header,
  label,
  primary,
  children,
}: {
  header: ReactNode | ((narrow: boolean) => ReactNode);
  label: string;
  primary?: HeaderPrimary;
  children: ReactNode;
}) {
  return (
    <WorkspaceLayout
      docked
      header={header}
      mainLabel={label}
      // Pages that hand over their primary switch at a phone's width; the others keep the default.
      narrowBelow={primary ? STAGE_PAGE_NARROW : undefined}
      footer={primary ? (narrow: boolean) => (narrow ? <ProductionPrimaryBar primary={primary} /> : null) : undefined}
    >
      <PageStack>{children}</PageStack>
    </WorkspaceLayout>
  );
}

const ROUTE_LABEL: Partial<Record<ProductionRoute['kind'], string>> = {
  source: 'Material',
  delivery: 'Entrega',
};

function documentTitle(production: ProductionDetail | undefined, route: ProductionRoute): string | null {
  if (!production) return null;
  const stage = route.kind === 'studio' || route.kind === 'review' ? pieceKind(route.pieceKind)?.label : ROUTE_LABEL[route.kind];
  return [production.title, stage, route.kind === 'review' ? 'Aprovação' : null].filter(Boolean).join(' · ');
}

/**
 * Persistent frame of `/productions/[id]/**` (PLAN §3.4): an immersive area (no app menu, no top
 * bar, no trail; the shell decides) where every stage hosts the one-line production header in its
 * own docked layout (no double scroll). Unknown id → AccessState not-found; a production
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
    // No app menu inside a production (immersive): the state offers the way back.
    return (
      <ErrorState
        title="Não foi possível abrir a produção"
        onRetry={production.retry}
        size="page"
        actions={<ButtonLink href={PRODUCTIONS_HREF}>Ver produções</ButtonLink>}
      />
    );
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
