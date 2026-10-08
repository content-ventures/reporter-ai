'use client';

import { useMemo } from 'react';
import { DiffView, ErrorState, Grid, MediaFrame, MetaList, Section } from '@content-ventures/design-system/v3';
import { imageAlt, type AssetId, type ImageRef, type PieceId, type VersionId } from '@/domain';
import { useCompare } from '@/state';
import { plural } from '@/ui/format';
import { IMAGE_CHANGE_LABELS, IMAGE_ROLE_LABELS, imageCaption, imageChanges, toReviewDiff, type ImageChange } from './review-model';
import { useImageSources, type ImageSources } from './use-image-sources';

/**
 * "Alterações": the version under review against the chosen base (v1 · IA or the last approved
 * one), compared block by block in the domain and drawn by the DS `DiffView` with neutral diff
 * roles. Unchanged runs collapse around each change; the summary counts words and blocks.
 * Images read in the text as "[Imagem] Legenda — Foto: Crédito" (the base reads its credit and
 * rights as they were approved); the pictures that changed (new, removed, swapped, caption,
 * credit or alt text) follow the text, a swap as before and after, figures whole.
 */
export type ReviewChangesProps = {
  pieceId: PieceId;
  from: { id: VersionId; label: string };
  to: { id: VersionId; label: string };
};

export function ReviewChanges({ pieceId, from, to }: ReviewChangesProps) {
  const compare = useCompare(pieceId, from.id, to.id);
  const blocks = useMemo(() => (compare.data ? toReviewDiff(compare.data.blocks) : []), [compare.data]);
  const changes = useMemo(() => (compare.data ? imageChanges(compare.data.blocks) : []), [compare.data]);
  const assetIds = useMemo<AssetId[]>(
    () => changes.flatMap((change) => (change.previous ? [change.previous.assetId, change.image.assetId] : [change.image.assetId])),
    [changes],
  );
  const images = useImageSources(assetIds);

  if (compare.status === 'error') {
    return <ErrorState title="Não foi possível comparar as versões" onRetry={compare.retry} />;
  }

  return (
    <>
      <DiffView
        blocks={blocks}
        before={{ label: from.label }}
        after={{ label: to.label }}
        collapseUnchanged
        context={1}
        loading={compare.status === 'loading'}
      />
      {changes.length > 0 ? (
        <Section title="Imagens" titleAs="h3" meta={plural(changes.length, 'alteração', 'alterações')}>
          <Grid as="ul" columns="auto" min={160} label={`Imagens alteradas desde ${from.label}`}>
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
