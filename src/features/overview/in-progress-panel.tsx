'use client';

import { List, ListItem, ListItemSkeleton, Panel, Section, TextLink } from '@content-ventures/design-system/v3';
import type { DeskView, InProgressItem } from '@/ports';
import { formatCount } from '@/ui/format';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { useNow } from '@/ui/time';
import { inProgressLine } from './desk-copy';
import { ProgressAction } from './next-step-action';

/**
 * "Em andamento" (D1, COPY §1.3): the viewer's own active productions that are not already a row
 * of "Precisa de você" (everyone's when they own none), newest activity first, each with its step
 * in newsroom words and its size while on the article ("Artigo · Rascunho · 1,6 de 2 laudas · há
 * 20 min") and a quiet "Continuar" / "Abrir". The production already offered by the empty queue's
 * "Continuar" card is not repeated here. "Ver todas" opens Produções.
 */
export function InProgressPanel({ desk, featuredId }: { desk: DeskView | undefined; featuredId?: InProgressItem['productionId'] }) {
  const now = useNow();
  const card = featuredId ?? (desk && desk.needsYou === 0 ? desk.continueWith?.productionId : undefined);
  const items = desk?.inProgress.filter((item) => item.productionId !== card) ?? [];
  const total = desk ? desk.inProgressTotal - (card && desk.inProgress.some((item) => item.productionId === card) ? 1 : 0) : 0;
  if (desk && items.length === 0) return null;
  return (
    <Panel>
      <Section
        title="Em andamento"
        meta={desk ? formatCount(total) : undefined}
        action={
          <TextLink size="sm" href={PRODUCTIONS_HREF}>
            Ver todas
          </TextLink>
        }
      >
        <List label="Em andamento" framed={false} bleed>
          {desk
            ? items.map((item) => (
                <ListItem key={item.productionId} title={item.productionTitle} description={inProgressLine(item, now)} trailing={<ProgressAction item={item} />} />
              ))
            : [0, 1, 2].map((index) => <ListItemSkeleton key={index} leading={false} />)}
        </List>
      </Section>
    </Panel>
  );
}
