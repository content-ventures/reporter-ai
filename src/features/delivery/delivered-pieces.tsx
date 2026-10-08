'use client';

import { CardHeader, Grid, MediaFrame, Panel, Section, Seal, Skeleton, type MediaRatio } from '@content-ventures/design-system/v3';
import { imageAlt } from '@/domain';
import type { DeliveryItemView, PackageFile } from '@/ports';
import { useVersion } from '@/state';
import { formatListDateTime } from '@/ui/format';
import { imageUseLabel } from './delivery-model';
import type { PackageController } from './use-package';

/**
 * The reward of Entrega, first on the page: what leaves — the approved article by its headline
 * (with its images: the cover first, then the figures) and the carousel as its slides, each with
 * one approval seal and who approved it when. The file list (formats, sizes, retries) comes after.
 */

function approval(item: DeliveryItemView): string {
  return [`${item.label} v${item.version.number}`, item.approvedBy ? `aprovado por ${item.approvedBy.name}` : 'aprovado', item.approvedAt ? formatListDateTime(item.approvedAt) : null]
    .filter(Boolean)
    .join(' · ');
}

/** A package image as it leaves: the stored file once prepared, or the linked address. */
function imageSrc(file: PackageFile, pkg: PackageController): string | undefined {
  const progress = pkg.progress[file.fileName];
  if (progress?.state === 'ready') return progress.href;
  const origin = file.image?.asset?.origin;
  return origin?.type === 'url' ? origin.url : undefined;
}

function ArticleLine({ item, pkg }: { item: DeliveryItemView; pkg: PackageController }) {
  const version = useVersion(item.version.versionId);
  const title = version.data?.body.type === 'article' ? version.data.body.title : undefined;
  const images = (pkg.plan?.files ?? []).filter((file) => file.kind === 'image' && file.image && file.versionId === item.version.versionId);
  return (
    <>
      <CardHeader
        titleAs="h2"
        size="md"
        leading={<Seal size="sm" label="" still />}
        title={title ?? <Skeleton width={320} height={18} />}
        description={approval(item)}
      />
      {images.length > 0 ? (
        <Grid as="ul" columns="auto" min={136} label="Imagens do artigo">
          {images.map((file) => {
            const src = imageSrc(file, pkg);
            const progress = pkg.progress[file.fileName]?.state;
            const use = file.image?.uses[0];
            return (
              <MediaFrame
                key={file.fileName}
                ratio="16/9"
                src={src}
                alt={imageAlt(use)}
                state={src ? undefined : progress === 'pending' || progress === 'building' ? 'loading' : 'error'}
                radius="sm"
                caption={file.image ? imageUseLabel(file.image) : undefined}
              />
            );
          })}
        </Grid>
      ) : null}
    </>
  );
}

function CarouselLine({ item, pkg, slideRatio }: { item: DeliveryItemView; pkg: PackageController; slideRatio: MediaRatio }) {
  const slides = (pkg.plan?.files ?? [])
    .filter((file) => file.kind === 'carousel' && file.format === 'png' && file.available && file.versionId === item.version.versionId)
    .sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
  return (
    <>
      <CardHeader titleAs="h2" size="md" leading={<Seal size="sm" label="" still />} title={item.label} description={approval(item)} />
      <Grid as="ul" columns="auto" min={112} label="Slides do carrossel">
        {slides.map((file) => {
          const progress = pkg.progress[file.fileName];
          return (
            <MediaFrame
              key={file.fileName}
              ratio={slideRatio}
              src={progress?.state === 'ready' ? progress.href : undefined}
              alt={`Slide ${(file.slideIndex ?? 0) + 1} do carrossel`}
              state={progress?.state === 'ready' ? undefined : progress?.state === 'failed' ? 'error' : 'loading'}
              radius="sm"
            />
          );
        })}
      </Grid>
    </>
  );
}

export function DeliveredPieces({ items, pkg, slideRatio = '4/5' }: { items: readonly DeliveryItemView[]; pkg: PackageController; slideRatio?: MediaRatio }) {
  return (
    <Panel padding="lg">
      {items.map((item) => (
        <Section key={item.version.versionId}>
          {item.kind === 'carousel' ? <CarouselLine item={item} pkg={pkg} slideRatio={slideRatio} /> : <ArticleLine item={item} pkg={pkg} />}
        </Section>
      ))}
    </Panel>
  );
}
