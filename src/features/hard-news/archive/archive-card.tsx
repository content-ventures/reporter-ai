'use client';

import {
  AttachedNote,
  AvatarGroup,
  Card,
  CardHeader,
  CardLink,
  Chip,
  CopyButton,
  Grid,
  LinkButton,
  MediaFrame,
  MetaList,
} from '@content-ventures/design-system/v3';
import { Clock, Sparkles, TriangleAlert } from '@content-ventures/design-system/v3/icons';
import type { ArchiveArticle } from '@/domain/hard-news';
import { formatDate, plural } from '@/ui/format';
import { coverOf, shelfCoverOf } from './archive-covers';
import { READING_BADGES, usageLabel } from './archive-model';
import type { ArchiveShelf, ArchiveUse } from './archive-model';

/** The card's id, so focus can come back to it after the article changes state. */
export function archiveCardId(articleId: string): string {
  return `materia-${articleId}`;
}

/**
 * A published article as the portal shows it: cover, headline, editoria and date, byline. The AI
 * tag says in how many stories the AI used it. Only exceptions carry a note under the card: still
 * in the AI's queue, or a failed read with the way to send it back.
 */
export function ArchiveCard({ article, uses, onOpen, onResend }: {
  article: ArchiveArticle;
  uses: readonly ArchiveUse[];
  onOpen: (id: string) => void;
  onResend: (article: ArchiveArticle) => void;
}) {
  const cover = coverOf(article);
  const used = usageLabel(uses);
  const card = (
    <Card as="article" padding="sm" interactive id={archiveCardId(article.id)}>
      <Grid columns="auto" min={10000} gap="sm">
        <MediaFrame src={cover?.src} alt={cover?.alt ?? article.title} ratio="2/1" radius="sm" />
        <CardHeader
          titleAs="h3"
          title={<CardLink onClick={() => onOpen(article.id)}>{article.title}</CardLink>}
          description={`${article.section} · ${formatDate(article.publishedAt)}`}
          actions={<CopyButton text={article.url} label="link da matéria" />}
        />
        <MetaList size="sm" items={[article.author, used ? <Chip size="sm" variant="soft" icon={Sparkles}>{used}</Chip> : null]} />
      </Grid>
    </Card>
  );
  if (article.index === 'pending') return <AttachedNote tone="blue" icon={Clock} note={READING_BADGES.pending.label}>{card}</AttachedNote>;
  if (article.index !== 'failed') return card;
  return (
    <AttachedNote
      tone="red"
      icon={TriangleAlert}
      note={<>{READING_BADGES.failed.label} · <LinkButton onClick={() => onResend(article)}>Reenviar para a IA</LinkButton></>}
    >
      {card}
    </AttachedNote>
  );
}

/**
 * An editoria as a folder of the archive: its photo, its name, how many articles and who signs
 * them (the faces leave room for the name on a phone).
 */
export function ShelfCard({ shelf, selected, compact = false, onSelect }: { shelf: ArchiveShelf; selected: boolean; compact?: boolean; onSelect: () => void }) {
  const cover = shelfCoverOf(shelf.name);
  return (
    <Card padding="sm" interactive selected={selected} as="div">
      <Grid columns="auto" min={10000} gap="sm">
        <MediaFrame src={cover?.src} alt={cover?.alt ?? shelf.name} ratio="2/1" radius="sm" />
        <CardHeader
          titleAs="h3"
          title={<CardLink onClick={onSelect} aria-current={selected ? 'true' : undefined}>{shelf.name}</CardLink>}
          description={plural(shelf.count, 'matéria', 'matérias')}
          actions={compact ? undefined : <AvatarGroup names={shelf.authors} max={3} size="xs" label={`Quem assina ${shelf.name}`} />}
        />
      </Grid>
    </Card>
  );
}
