/** Local carousel renderer (OffscreenCanvas PNGs + approximate fit): imported only by src/runtime and tests. */

export { createLocalRenderService } from './local-render.ts';
export type { LocalRenderDeps } from './local-render.ts';
export { offscreenSurface } from './canvas.ts';
export type { Canvas2D, Surface, SurfaceFactory } from './canvas.ts';
export type { LayoutRender, SlotStyle, TemplateRender } from './templates.ts';
export { estimateText } from './text-metrics.ts';
export { assetCoverLoader, COVER_REASONS, decodeBitmap } from './cover-image.ts';
export type { CoverLoader, CoverRefusal } from './cover-image.ts';
export { coverFit } from './canvas.ts';
export type { CoverImage } from './canvas.ts';
export type { LayoutImage, ScrimStyle } from './templates.ts';
