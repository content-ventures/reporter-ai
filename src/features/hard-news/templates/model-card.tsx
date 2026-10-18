'use client';

import { Badge, Card, CardHeader, CardLink, Grid, MediaFrame, SkeletonText } from '@content-ventures/design-system/v3';
import type { MediaState } from '@content-ventures/design-system/v3';
import type { AssetId } from '@/domain';
import type { TemplateInfo } from '@/ports';
import { statusBadge } from '@/features/library/library-model';
import { useTemplatePreview, type TemplatePreview } from '@/features/library/use-template-images';
import { pickPages, spreadLayouts } from './templates-model';

/**
 * A model as a contact sheet: three real pages of its sample (the cover, its signature page and
 * the quote) drawn by the R1 RenderService, its name, "Aprovado" when Marketing approved it and
 * "Padrão" when the next carousel starts from it. The whole card opens the model's page. On a phone
 * only the cover shows. The render (one per model at 0.4) is shared with "Outros modelos".
 */

/** 432 px wide pages: sharp on a page of up to ~210 px at 2×. */
export const CARD_SCALE = 0.4;
const DEFAULT_NOTE = 'Padrão';

function frameState(preview: TemplatePreview, src: string | undefined): MediaState | undefined {
  if (src) return undefined;
  return preview.status === 'loading' ? 'loading' : 'error';
}

function Page({ template, preview, layout }: { template: TemplateInfo; preview: TemplatePreview; layout: string }) {
  const [page] = pickPages(preview.slides, [layout]);
  const src = page?.image?.dataUrl;
  return <MediaFrame ratio={template.formatInfo.ratio} src={src} alt="" fit="contain" radius="sm" state={frameState(preview, src)} />;
}

function ApprovedBadge({ template }: { template: TemplateInfo }) {
  const badge = statusBadge(template.status);
  return badge ? (
    <Badge variant="text" tone={badge.tone} size="sm">
      {badge.label}
    </Badge>
  ) : null;
}

export function ModelCard({
  template,
  href,
  articleCover,
  isDefault,
  compact,
}: {
  template: TemplateInfo;
  href: string;
  /** The sample photo the photo models draw. */
  articleCover?: AssetId;
  isDefault: boolean;
  /** Phone: the cover and the name only. */
  compact: boolean;
}) {
  const preview = useTemplatePreview(template.id, { articleCover, scale: CARD_SCALE });
  const layouts = spreadLayouts(template, compact ? 1 : 3);
  // On a phone the name takes the card's width; the page header already names the default.
  const note = isDefault && !compact ? DEFAULT_NOTE : undefined;
  return (
    <Card as="div" padding="sm" interactive>
      {compact ? (
        <Page template={template} preview={preview} layout={layouts[0] ?? template.coverLayoutId} />
      ) : (
        <Grid columns="1:1:1" collapseBelow={false} gap="sm">
          {layouts.map((layout) => (
            <Page key={layout} template={template} preview={preview} layout={layout} />
          ))}
        </Grid>
      )}
      <CardHeader
        size="sm"
        titleAs="h2"
        title={<CardLink href={href}>{template.name}</CardLink>}
        badge={<ApprovedBadge template={template} />}
        meta={note}
        description={compact ? undefined : template.description}
      />
    </Card>
  );
}

/** The card while the library loads, with the same geometry. */
export function ModelCardSkeleton({ ratio, compact }: { ratio: string; compact: boolean }) {
  return (
    <Card as="div" padding="sm" loading>
      {compact ? (
        <MediaFrame ratio={ratio} alt="" radius="sm" state="loading" />
      ) : (
        <Grid columns="1:1:1" collapseBelow={false} gap="sm">
          <MediaFrame ratio={ratio} alt="" radius="sm" state="loading" />
          <MediaFrame ratio={ratio} alt="" radius="sm" state="loading" />
          <MediaFrame ratio={ratio} alt="" radius="sm" state="loading" />
        </Grid>
      )}
      <SkeletonText lines={compact ? 1 : 2} />
    </Card>
  );
}

/** One page of a model (its cover), for "Outros modelos". */
export function ModelCover({ template, href, articleCover }: { template: TemplateInfo; href: string; articleCover?: AssetId }) {
  const preview = useTemplatePreview(template.id, { articleCover, scale: CARD_SCALE });
  return (
    <Card as="div" padding="sm" interactive>
      <Page template={template} preview={preview} layout={template.coverLayoutId} />
      <CardHeader size="sm" titleAs="h4" title={<CardLink href={href}>{template.name}</CardLink>} badge={<ApprovedBadge template={template} />} />
    </Card>
  );
}
