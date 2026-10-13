'use client';

import type { ReactNode } from 'react';
import { MediaFrame, Skeleton, type MediaRatio } from '@content-ventures/design-system/v3';
import { formatOf, type CarouselTemplate } from '@/domain';
import type { SlideRender } from './use-slide-renders';

/**
 * A rendered slide PNG in the DS frame. The image is the creative itself (content, not UI):
 * while it is being drawn the frame pulses, and a drawing failure shows "Imagem indisponível".
 * Frames follow the template's format (Feed 4:5, Quadrado 1:1), never a fixed proportion.
 */

/** The template's proportion for `MediaFrame` ("4/5", "1/1"); Feed while the template is unknown. */
export function slideRatio(template: Pick<CarouselTemplate, 'width' | 'height'> | undefined): MediaRatio {
  if (!template) return '4/5';
  return formatOf(template)?.ratio ?? `${template.width}/${template.height}`;
}

export function SlideThumb({ render, ratio = '4/5' }: { render: SlideRender | undefined; ratio?: MediaRatio }) {
  if (render?.src) return <MediaFrame ratio={ratio} src={render.src} alt="" radius="none" />;
  if (render?.status === 'error') return <MediaFrame ratio={ratio} alt="" radius="none" state="error" />;
  return <Skeleton shape="block" width="100%" height="100%" radius={0} />;
}

export function SlideImage({
  render,
  ratio,
  alt,
  caption,
  fitHeight = false,
}: {
  render: SlideRender | undefined;
  /** Frame proportion (the slide's own format on the stage); the slide is contained in it. */
  ratio: MediaRatio;
  alt: string;
  caption?: ReactNode;
  /** Studio stage: the frame and its caption fit the visible height of the stage (DS `MediaFrame fitHeight`). */
  fitHeight?: boolean;
}) {
  const state = render?.src ? undefined : render?.status === 'error' ? 'error' : 'loading';
  return <MediaFrame ratio={ratio} src={render?.src} alt={alt} fit="contain" radius="lg" state={state} caption={caption} fitHeight={fitHeight} />;
}
