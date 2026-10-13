'use client';

import { useMemo } from 'react';
import { DiffView, ErrorState, Grid, MediaFrame, MetaList, Section } from '@content-ventures/design-system/v3';
import { imageAlt, type AssetId, type ImageRef, type PieceId, type VersionId } from '@/domain';
import { useCompare } from '@/state';
import { plural } from '@/ui/format';
import { changedCount, changedSummary, IMAGE_CHANGE_LABELS, IMAGE_ROLE_LABELS, imageCaption, imageChanges, toReviewDiff, type ImageChange } from './review-model';
import { useImageSources, type ImageSources } from './use-image-sources';

/**
 * "O que mudou" (COPY §4.3): the text of this send against the one decided before it, compared
 * block by block in the domain and drawn by the DS `DiffView` (inline, reading size) with neutral
 * diff roles. Unchanged runs collapse around each change; the summary counts the passages that
 * changed ("3 trechos mudaram desde o envio anterior"). Images read in the text as "[Imagem]
 * Legenda — Foto: Crédito"; the pictures that changed (new, removed, swapped, caption, credit or alt
 * text) follow the text, a swap as before and after, figures whole. No version numbers.
 */
export type ReviewChangesProps = {
  pieceId: PieceId;
  /** The version decided before this send. */
  from: VersionId;
  /** The version under review. */
  to: VersionId;
};

export function ReviewChanges({ pieceId, from, to }: ReviewChangesProps) {
  const compare = useCompare(pieceId, from, to);
  const blocks = useMemo(() => (compare.data ? toReviewDiff(compare.data.blocks) : []), [compare.data]);
  const changes = useMemo(() => (compare.data ? imageChanges(compare.data.blocks) : []), [compare.data]);
  const assetIds = useMemo<AssetId[]>(
    () => changes.flatMap((change) => (change.previous ? [change.previous.assetId, change.image.assetId] : [change.image.assetId])),
    [changes],
  );
  const images = useImageSources(assetIds);

  if (compare.status === 'error') {
    return <ErrorState title="Não foi possível comparar os textos" onRetry={compare.retry} />;
  }

  return (
    <>
      <DiffView
        blocks={blocks}
        mode="inline"
        size="reading"
        collapseUnchanged
        context={1}
        summary={compare.status === 'ready' ? changedSummary(changedCount(blocks)) : undefined}
        label="O que mudou desde o envio anterior"
        loading={compare.status === 'loading'}
      />
      {changes.length > 0 ? (
        <Section title="Imagens" titleAs="h3" meta={plural(changes.length, 'alteração', 'alterações')}>
          <Grid as="ul" columns="auto" min={160} label="Imagens alteradas desde o envio anterior">
            {changes.flatMap((change) =>
              change.previous
                ? [
                    <ChangedImage key={`${change.id}-before`} change={change} image={change.previous} side="Antes" images={images} />,
                    <ChangedImage key={`${change.id}-after`} change={change} image={change.image} side="Depois" images={images} />,
                  ]
                : [<ChangedImage key={change.id} change={change} image={change.image} images={images} />],
            )}
          </Grid>
        </Section>
      ) : null}
    </>
  );
}

function ChangedImage({ change, image, side, images }: { change: ImageChange; image: ImageRef; side?: string; images: ImageSources }) {
  const src = images.url(image.assetId);
  const caption = imageCaption(image.caption, images.asset(image.assetId)?.credit);
  return (
    <MediaFrame
      ratio="16/9"
      fit={change.role === 'cover' ? 'cover' : 'contain'}
      src={src}
      alt={imageAlt(image)}
      state={src || images.ready ? undefined : 'loading'}
      radius="sm"
      caption={<MetaList size="xs" items={[IMAGE_ROLE_LABELS[change.role], side ?? IMAGE_CHANGE_LABELS[change.kind], caption]} />}
    />
  );
}
