'use client';

import { useMemo } from 'react';
import {
  Button,
  CardHeader,
  Disclosure,
  Grid,
  List,
  ListItem,
  MediaFrame,
  MetaList,
  Panel,
  Section,
  Seal,
  Skeleton,
  type MediaRatio,
} from '@content-ventures/design-system/v3';
import { BookOpen, ImagePlus } from '@content-ventures/design-system/v3/icons';
import { articleImageSlots, IMAGE_ORIENTATION_LABELS, imageAlt, type ImageSlotUse } from '@/domain';
import type { DeliveryItemView, PackageFile } from '@/ports';
import { useRuntime, useVersion } from '@/state';
import { formatCount, formatListDateTime } from '@/ui/format';
import { imageUseLabel } from './delivery-model';
import type { PackageController } from './use-package';

/**
 * The reward of Entrega, first on the page: what leaves — the approved article by its headline
 * (with its images: the cover first, then the figures; "Ler artigo" reads it whole) and the
 * carousel as its slides, each with one approval seal and who approved it when. Images the
 * generation suggested and nobody filled are listed under the article ("Sugestões não
 * preenchidas"): informative, they never block the package — they stay out of the .md and the
 * .html and the manifest lists them. The file list (formats, sizes, retries) comes after.
 */

/** "Carrossel v2 · Modelo Editorial · aprovado por Pedro · 07/10 14:32" (`model` for a carousel). */
function approval(item: DeliveryItemView, model?: string): string {
  return [`${item.label} v${item.version.number}`, model ? `Modelo ${model}` : null, item.approvedBy ? `aprovado por ${item.approvedBy.name}` : 'aprovado', item.approvedAt ? formatListDateTime(item.approvedAt) : null]
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

const NO_SLOTS: ImageSlotUse[] = [];

function ArticleLine({ item, pkg, onRead }: { item: DeliveryItemView; pkg: PackageController; onRead?: () => void }) {
  const version = useVersion(item.version.versionId);
  const body = version.data?.body.type === 'article' ? version.data.body : undefined;
  const title = body?.title;
  const slots = useMemo(() => (body ? articleImageSlots(body) : NO_SLOTS), [body]);
  const images = (pkg.plan?.files ?? []).filter((file) => file.kind === 'image' && file.image && file.versionId === item.version.versionId);
  return (
    <>
      <CardHeader
        titleAs="h2"
        size="md"
        leading={<Seal size="sm" label="" still />}
        title={title ?? <Skeleton width={320} height={18} />}
        description={approval(item)}
        actions={
          onRead ? (
            <Button size="sm" variant="ghost" icon={BookOpen} onClick={onRead}>
              Ler artigo
            </Button>
          ) : undefined
        }
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
      {slots.length > 0 ? <OpenSuggestions slots={slots} /> : null}
    </>
  );
}

/** "Vertical", "Quadrada": said when the image is not the column's usual horizontal one. */
function orientationOf(use: ImageSlotUse): string | undefined {
  const orientation = use.slot.orientation;
  return orientation && orientation !== 'landscape' ? IMAGE_ORIENTATION_LABELS[orientation] : undefined;
}

/** "Sugestões não preenchidas": what each suggested image should show (they leave as a list, not as pictures). */
function OpenSuggestions({ slots }: { slots: readonly ImageSlotUse[] }) {
  return (
    <Disclosure summary="Sugestões não preenchidas" meta={formatCount(slots.length)}>
      <MetaList size="sm" items={['Fora do .md e do .html', 'Listadas no manifesto']} />
      <List label="Sugestões de imagem não preenchidas" framed={false} dividers={false}>
        {slots.map((use) => (
          <ListItem
            key={use.blockId}
            icon={ImagePlus}
            density="sm"
            titleLines={2}
            title={use.slot.subject}
            description={use.role === 'cover' ? 'Imagem de destaque' : orientationOf(use)}
          />
        ))}
      </List>
    </Disclosure>
  );
}

function CarouselLine({ item, pkg, slideRatio }: { item: DeliveryItemView; pkg: PackageController; slideRatio: MediaRatio }) {
  const { runtime } = useRuntime();
  const template = item.templateId ? runtime?.render.templates().find((entry) => entry.id === item.templateId) : undefined;
  const slides = (pkg.plan?.files ?? [])
    .filter((file) => file.kind === 'carousel' && file.format === 'png' && file.available && file.versionId === item.version.versionId)
    .sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
  return (
    <>
      <CardHeader titleAs="h2" size="md" leading={<Seal size="sm" label="" still />} title={item.label} description={approval(item, template?.name)} />
      <Grid as="ul" columns="auto" min={112} label="Slides do carrossel">
        {slides.map((file) => {
          const progress = pkg.progress[file.fileName];
          return (
            <MediaFrame
              key={file.fileName}
              ratio={template?.formatInfo.ratio ?? slideRatio}
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

export function DeliveredPieces({
  items,
  pkg,
  slideRatio = '4/5',
  onReadArticle,
}: {
  items: readonly DeliveryItemView[];
  pkg: PackageController;
  slideRatio?: MediaRatio;
  /** "Ler artigo": the approved article read whole, before downloading. */
  onReadArticle?: () => void;
}) {
  return (
    <Panel padding="lg">
      {items.map((item) => (
        <Section key={item.version.versionId}>
          {item.kind === 'carousel' ? (
            <CarouselLine item={item} pkg={pkg} slideRatio={slideRatio} />
          ) : (
            <ArticleLine item={item} pkg={pkg} {...(onReadArticle ? { onRead: onReadArticle } : {})} />
          )}
        </Section>
      ))}
    </Panel>
  );
}
