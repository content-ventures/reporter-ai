import type { CarouselBody, CarouselTemplate } from '../domain/carousel.ts';
import type { AssetId, SlideId, TemplateId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';

/**
 * Carousel render port (F1.5, D07). Creatives are CONTENT rendered from template data, never DS
 * components: the local adapter rasterises slides to PNG in the browser; a vendor adapter
 * (Canva, Bannerbear…) replaces it later. Text fit is always reported as APPROXIMATE, measured
 * with the template font and the slot box.
 */

export type TemplateInfo = CarouselTemplate & {
  /** Placeholder until Marketing's approved templates arrive (D07). */
  provisional: boolean;
  /** pt-BR one-liner for the template ChoiceCard. */
  description: string;
};

export type SlotFit = {
  slideId: SlideId;
  slotId: string;
  /** Slot label from the template ("Título", "Texto"). */
  label: string;
  lines: number;
  maxLines: number;
  overflow: boolean;
  approximate: true;
  /** pt-BR warning when it overflows: "≈ Título excede 2 linhas". */
  message?: string;
};

export type RenderedImage = { mimeType: 'image/png'; dataUrl: string; bytes: number };

/**
 * A layout whose template data asks for the article cover as background (`'article-cover'`):
 * whether it was drawn, and why not (no cover, linked image, unreadable file).
 */
export type SlideBackground = { source: 'article-cover'; drawn: boolean; reason?: string };

export type RenderedSlide = {
  slideId: SlideId;
  index: number;
  layout: string;
  width: number;
  height: number;
  /** Absent when this environment cannot rasterise (see `unavailableReason`). */
  image?: RenderedImage;
  unavailableReason?: string;
  fits: SlotFit[];
  overflow: boolean;
  /** Present on layouts that use the article cover as background. */
  background?: SlideBackground;
};

export type RenderRequest = {
  body: CarouselBody;
  /** Only these slides (thumbnails of the edited slide); default: all. */
  slideIds?: SlideId[];
  /** Output scale: 1 = template size (1080×1350); 0.25 for strip thumbnails. */
  scale?: number;
  /**
   * Cover image of the article version the carousel was made from (`DraftView.articleCover` /
   * `VersionDetail.articleCover`). Drawn only on layouts whose template data asks for it; text
   * fit is unchanged.
   */
  articleCover?: AssetId;
};

export type RenderResult = {
  templateId: TemplateId;
  slides: RenderedSlide[];
  approximate: true;
};

export type RenderCapabilities = { raster: boolean; reason?: string };

export type RenderRefusal = 'unknown_template' | 'unknown_slide' | 'render_failed';

export interface RenderService {
  templates(): readonly TemplateInfo[];
  capabilities(): RenderCapabilities;
  /** Approximate text fit per slot, synchronous for live field counters. */
  measure(body: CarouselBody): Result<SlotFit[], RenderRefusal>;
  render(request: RenderRequest): Promise<Result<RenderResult, RenderRefusal>>;
}
