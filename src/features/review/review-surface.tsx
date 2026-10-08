'use client';

import type { ReactNode } from 'react';
import { WorkspaceLayout } from '@content-ventures/design-system/v3';
import { ProductionHeader } from '@/features/production/production-frame';
import type { ProductionHeaderProps } from '@/features/production/production-header';

/**
 * Surface of the guided review (COPY §4, REQ-T.6): the production header line, the document read
 * in one column and the decision bar always at hand. No side pane: the checks are one line above
 * the text, the history opens from the header's ⋯. It knows nothing about the subject: the article
 * and the carousel pass their own body.
 *
 * Studio frame (`WorkspaceLayout docked`): the body scrolls on its own and the decision bar stays
 * in view while reading a long piece; on a phone it keeps the bottom edge.
 */
export type ReviewSurfaceProps = {
  /** The header line: back link, status, the screen's ⋯ items. */
  header: ProductionHeaderProps;
  /** Name of the main region ("Texto", "Slides"). */
  mainLabel: string;
  /** The subject: task card, toolbar and diff, read-only prose or rendered creatives. */
  children: ReactNode;
  /** Decision bar (`ActionBar`), or a function of the narrow layout. */
  footer?: ReactNode | ((narrow: boolean) => ReactNode);
};

export function ReviewSurface({ header, mainLabel, children, footer }: ReviewSurfaceProps) {
  return (
    <WorkspaceLayout
      docked
      storageKey="reporter:review"
      header={<ProductionHeader {...header} />}
      mainLabel={mainLabel}
      viewsLabel="Revisão"
      footer={footer}
    >
      {children}
    </WorkspaceLayout>
  );
}
