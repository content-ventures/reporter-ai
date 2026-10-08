'use client';

import { useMemo, useState } from 'react';
import { Card, CardHeader, CardLink, EmptyState, Grid, LinkButton, MetaList } from '@content-ventures/design-system/v3';
import { Images } from '@content-ventures/design-system/v3/icons';
import { findLayout, type AssetId, type CarouselBody, type CarouselTemplate, type SlideId } from '@/domain';
import { SlideImage, SlideThumb } from './slide-media';
import { clearSlideRenders, useSlideRenders, type SlideRender } from './use-slide-renders';

/**
 * Main canvas of the carousel studio: the selected slide as the rendered PNG (Slide) or the whole
 * carousel side by side as it will be posted (Sequência: every slide drawn, a click puts it on
 * stage). The 4:5 frame fits the stage by height (DS `MediaFrame fitHeight`): the visible height
 * left under the alert, the trace and the proposal switch decides its width, so the whole slide
 * shows without an inner scroll from 1280 to 1920; on a phone it takes the full width.
 */

export type StageView = 'slide' | 'sequence';

export type SlideStageProps = {
  body: CarouselBody | undefined;
  template: CarouselTemplate | undefined;
  selectedIndex: number;
  onSelect: (id: SlideId) => void;
  view: StageView;
  narrow: boolean;
  /** Generating: the next slide is still being written. */
  writing: boolean;
  /** Cover of the article the slides come from, for layouts that draw it. */
  articleCover?: AssetId;
};

const SIZE_META = '1080 × 1350 px · PNG';

export function SlideStage({ body, template, selectedIndex, onSelect, view, narrow, writing, articleCover }: SlideStageProps) {
  const slides = useMemo(() => body?.slides ?? [], [body]);
  const current = slides[selectedIndex];
  const only = useMemo(() => (current ? [current.id] : []), [current]);
  const renders = useSlideRenders(body, { scale: 1, slideIds: only, delay: writing ? 0 : 220, articleCover });
  // Sequência draws every slide at half size: sharp in a grid cell, cheap to keep in the cache.
  const sequence = useSlideRenders(view === 'sequence' ? body : undefined, { scale: 0.5, articleCover });
  // While slides stream in, the last drawn slide stays on stage until the new one is drawn.
  const drawn = current ? renders[current.id] : undefined;
  const [shown, setShown] = useState<SlideRender | undefined>(undefined);
  if (drawn?.src && drawn !== shown) setShown(drawn);
  const label = (index: number) => findLayout(template, slides[index]?.layout ?? '')?.label ?? 'Slide';

  if (!current) {
    return writing ? (
      <SlideImage render={undefined} ratio="4/5" alt="Escrevendo a capa" fitHeight />
    ) : (
      <EmptyState icon={Images} title="Nenhum slide" size="panel" />
    );
  }

  if (view === 'sequence' && slides.length > 0) {
    return (
      <Grid as="ul" columns="auto" min={narrow ? 140 : 180} label="Sequência do carrossel">
        {slides.map((slide, index) => (
          <Card key={slide.id} as="div" padding="sm" interactive selected={index === selectedIndex}>
            <SlideThumb render={sequence[slide.id]} />
            <CardHeader
              size="sm"
              titleAs="h3"
              title={
                <CardLink onClick={() => onSelect(slide.id)} aria-current={index === selectedIndex ? 'true' : undefined}>
                  {`Slide ${index + 1}`}
                </CardLink>
              }
              description={label(index)}
            />
          </Card>
        ))}
      </Grid>
    );
  }

  const render = drawn?.src || !writing ? drawn : shown;
  return (
    <SlideImage
      render={render}
      ratio="4/5"
      fitHeight
      alt={`Slide ${selectedIndex + 1}: ${label(selectedIndex)}`}
      caption={
        <MetaList
          size="xs"
          items={[
            `Slide ${selectedIndex + 1} de ${slides.length}`,
            label(selectedIndex),
            SIZE_META,
            // The article has a cover this layout draws, but not here (linked image, other browser).
            articleCover && render?.background && !render.background.drawn ? render.background.reason : null,
            render?.status === 'error' ? (
              <LinkButton key="retry" tone="quiet" size="inherit" onClick={() => clearSlideRenders(current.id)}>
                Desenhar de novo
              </LinkButton>
            ) : null,
          ]}
        />
      }
    />
  );
}
