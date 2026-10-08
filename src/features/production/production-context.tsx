'use client';

import { createContext, use } from 'react';
import type { ProductionId } from '@/domain';
import type { ProductionDetail } from '@/ports';
import type { QueryState } from '@/state';
import type { ProductionRoute } from '@/ui/routes';

/**
 * What every screen under `/productions/[id]` can read from the persistent frame: the id, the
 * production read model (already loading), the sub-route, and the hook that lets a screen host
 * the production header inside its own layout (studios put it in `WorkspaceLayout header`).
 */
export type ProductionFrameState = {
  productionId: ProductionId;
  production: QueryState<ProductionDetail>;
  route: ProductionRoute;
  /** A screen renders the header itself; the frame stops drawing its own while it is mounted. */
  hostHeader: () => () => void;
};

export const ProductionFrameContext = createContext<ProductionFrameState | null>(null);

/** The frame of the current production. Only valid under `app/(workspace)/productions/[id]`. */
export function useProductionFrame(): ProductionFrameState {
  const frame = use(ProductionFrameContext);
  if (!frame) throw new Error('useProductionFrame must be used under ProductionFrame.');
  return frame;
}
