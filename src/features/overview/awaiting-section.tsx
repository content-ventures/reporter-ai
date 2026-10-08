'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LinkButton, List, ListItem, ListItemSkeleton, Section, TextLink, toast } from '@content-ventures/design-system/v3';
import type { AwaitingItem } from '@/ports';
import { useCommands } from '@/state';
import { formatCount } from '@/ui/format';
import { PersonAvatar } from '@/ui/person-avatar';
import { pieceHref, PRODUCTIONS_HREF, reviewHref } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { useRelativeTime } from '@/ui/time';

/**
 * "Aguardando você" (PLAN §3.1): what needs the viewer now. A version sent for approval reads
 * "Aguardando aprovação" (violet) and opens the review gate; a returned one reads "Ajustes
 * solicitados" (orange) and opens the studio; a generation that failed reads "Erro" (red) with
 * "Tentar de novo", which starts the article again and opens the studio. Who sent, returned or
 * started it is the row's avatar. Titles wrap to two lines (the column is narrow). A section, not
 * a panel: it shares the panel of "Gerando agora" (`OverviewScreen`).
 */

const VISIBLE = 5;

const STATUS = { review: 'in_review', changes_requested: 'changes_requested', failed: 'failed' } as const;

function RetryLink({ item }: { item: AwaitingItem }) {
  const commands = useCommands();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <LinkButton
      size="sm"
      disabled={busy}
      aria-label={`Tentar de novo: ${item.pieceLabel.toLowerCase()} de ${item.productionTitle}`}
      onClick={() => {
        setBusy(true);
        void commands.generation.start('article.draft', { productionId: item.productionId, pieceId: item.pieceId }).then((result) => {
          setBusy(false);
          if (!result.ok) {
            toast('Geração não iniciada', { tone: 'error', description: result.refusal.message });
            return;
          }
          router.push(pieceHref(item.productionId, item.kind));
        });
      }}
    >
      Tentar de novo
    </LinkButton>
  );
}

function AwaitingRow({ item }: { item: AwaitingItem }) {
  const when = useRelativeTime(item.at);
  const piece = item.version ? `${item.pieceLabel} v${item.version.number}` : item.pieceLabel;
  // The sender is the avatar (named for screen readers); the status is the line under the title
  // and the piece with its time is the meta — under the status in the narrow column, never cut.
  const facts = [piece, when].filter(Boolean).join(' · ');
  const verb = item.reason === 'review' ? 'Revisar' : 'Ajustar';
  return (
    <ListItem
      leading={<PersonAvatar person={item.from} name="Sistema" size="sm" />}
      title={item.productionTitle}
      titleLines={2}
      description={<StatusBadge kind="piece" status={STATUS[item.reason]} variant="text" size="sm" />}
      meta={facts}
      trailing={
        item.reason === 'failed' ? (
          <RetryLink item={item} />
        ) : (
          <TextLink
            size="sm"
            href={item.reason === 'review' ? reviewHref(item.productionId, item.kind) : pieceHref(item.productionId, item.kind)}
            aria-label={`${verb} ${item.pieceLabel.toLowerCase()} de ${item.productionTitle}`}
          >
            {verb}
          </TextLink>
        )
      }
    />
  );
}

export function AwaitingSection({ items, loading }: { items: readonly AwaitingItem[] | undefined; loading: boolean }) {
  const shown = items?.slice(0, VISIBLE) ?? [];
  const more = (items?.length ?? 0) > VISIBLE;
  return (
    <Section
      title="Aguardando você"
      meta={!loading && items && items.length > 0 ? formatCount(items.length) : undefined}
      action={
        more ? (
          <TextLink size="sm" href={PRODUCTIONS_HREF}>
            Ver todas
          </TextLink>
        ) : undefined
      }
    >
      <List label="Aguardando você" framed={false} bleed empty="Nada aguardando você">
        {loading
          ? [0, 1, 2].map((index) => <ListItemSkeleton key={index} />)
          : shown.map((item) => <AwaitingRow key={`${item.pieceId}-${item.reason}`} item={item} />)}
      </List>
    </Section>
  );
}
