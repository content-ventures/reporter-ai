'use client';

import type { ReactNode } from 'react';
import { PageStack, WorkspaceLayout } from '@content-ventures/design-system/v3';
import { ProductionHeader } from '@/features/production/production-frame';
import { usePhone } from '@/ui/use-phone';

/**
 * Generic gate surface (PLAN §3.6, REQ-T.6): the production header line, the subject's body, a
 * side pane with Checagem · Fonte · Histórico and the decision bar always at hand. It knows
 * nothing about the subject: the article and the carousel pass their own body; later gates
 * (pauta, ativos, cortes) reuse it as is.
 *
 * One chrome row (B02): the version's status and the view switch ("Alterações / Texto final")
 * live in the production header line — the trail already ends in "Revisão". Studio frame
 * (`WorkspaceLayout docked`): body and pane scroll on their own, the decision bar stays in view
 * while reading a long piece; at ≤1024 px the regions become tabs and the bar stays. On a phone
 * the view switch scrolls with the text, so the reading area keeps the screen.
 */
export type ReviewSurfaceProps = {
  /** The version's status, in the header line instead of the production's. */
  status?: ReactNode;
  /** View switch (Segmented, "Comparar com"): header line on desktop, top of the text on a phone. */
  view?: ReactNode;
  /** Name of the main region and of its tab on narrow screens ("Texto", "Slides"). */
  mainLabel: string;
  /** The subject: diff, read-only prose or rendered creatives (with alerts above). */
  children: ReactNode;
  /** Side pane sections (Checagem · Fonte · Histórico). */
  aside?: ReactNode;
  asideLabel?: string;
  /** Decision bar (`ActionBar position="static"`), or a function of the narrow layout. */
  footer?: ReactNode | ((narrow: boolean) => ReactNode);
};

export function ReviewSurface({ status, view, mainLabel, children, aside, asideLabel = 'Detalhes', footer }: ReviewSurfaceProps) {
  const phone = usePhone();
  return (
    <WorkspaceLayout
      docked
      storageKey="reporter:review"
      header={<ProductionHeader status={status} actions={phone ? undefined : view} />}
      mainLabel={mainLabel}
      viewsLabel="Revisão"
      end={aside ? { label: asideLabel, content: aside, defaultSize: 352, min: 288, max: 480 } : undefined}
      footer={footer}
    >
      {phone && view ? (
        <PageStack>
          {view}
          {children}
        </PageStack>
      ) : (
        children
      )}
    </WorkspaceLayout>
  );
}
