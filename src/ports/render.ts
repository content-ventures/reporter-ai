import type { CarouselBody, CarouselTemplate } from '../domain/carousel.ts';
import type { CarouselFormat, TemplateMeta } from '../domain/carousel-library.ts';
import type { TemplateSwitch } from '../domain/carousel-switch.ts';
import type { AssetId, SlideId, TemplateId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';

/**
 * Carousel render port (F1.5, D07). Creatives are CONTENT rendered from template data, never DS
 * components: the local adapter rasterises slides to PNG in the browser; a vendor adapter
 * (Canva, Bannerbear…) replaces it later. Text fit is always reported as APPROXIMATE, measured
 * with the template font and the slot box.
 */

/**
 * A template as the library and the studio show it: structure (layouts, slots, limits), library
 * metadata (category, format, tags, status, one-liner) and what the canvas is.
 */
export type TemplateInfo = CarouselTemplate &
  TemplateMeta & {
    /** `status === 'base'`: shipped with the product until Marketing's models arrive (D07). Data only, never a word on screen (D09). */
    provisional: boolean;
    /** The canvas format ("Feed", ratio "4/5" for `MediaFrame`, 1080 × 1350). */
    formatInfo: CarouselFormat;
    /** A layout draws the article's featured image (photo templates). */
    usesArticleCover: boolean;
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
  /** Output scale: 1 = template size (1080 × 1350 Feed, 1080 × 1080 Quadrado); 0.25 for strip thumbnails. */
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

/** Library card image: the template's cover with its sample copy, or with `slots` over it. */
export type ThumbnailRequest = {
  templateId: TemplateId;
  /** Default 0.4 (432 px wide). */
  scale?: number;
  /** The article's featured image, for templates that draw it. */
  articleCover?: AssetId;
  /** Cover texts by slot id (the article's own title and call) instead of the sample copy. */
  slots?: Readonly<Record<string, string>>;
};

/** Every layout of a template with its sample copy (the library's preview of a model). */
export type PreviewRequest = {
  templateId: TemplateId;
  /** Default 0.5. */
  scale?: number;
  articleCover?: AssetId;
};

/**
 * A carousel moved to another template: texts kept by slot id and role (domain `switchTemplate`),
 * with the line fit in the new template. `issues` adds one `overflow` per slot whose text passes
 * its lines (approximate), so the screen can say what does not fit before or after applying.
 */
export type TemplateSwitchResult = TemplateSwitch & { fits: SlotFit[] };

export type RenderRefusal = 'unknown_template' | 'unknown_slide' | 'render_failed';

export interface RenderService {
  /**
   * A sample photo for the library's previews: pass it as `articleCover` where no article image
   * exists and the models that use an image draw it, credited "Foto de exemplo".
   */
  readonly samplePhoto?: AssetId;
  /** The library, default first: every selectable template (formats of later releases have none). */
  templates(): readonly TemplateInfo[];
  capabilities(): RenderCapabilities;
  /** Approximate text fit per slot, synchronous for live field counters. */
  measure(body: CarouselBody): Result<SlotFit[], RenderRefusal>;
  render(request: RenderRequest): Promise<Result<RenderResult, RenderRefusal>>;
  /** Sample copy of a template as a carousel: one slide per layout, in the template's order. */
  sample(templateId: TemplateId): Result<CarouselBody, RenderRefusal>;
  /** Library card image (cover slide), cached per template, scale, image and texts. */
  thumbnail(request: ThumbnailRequest): Promise<Result<RenderedSlide, RenderRefusal>>;
  /** Every layout with sample copy, cached: the library's preview of a template. */
  preview(request: PreviewRequest): Promise<Result<RenderResult, RenderRefusal>>;
  /** The carousel in another template, texts kept, with what moved, joined, was left out or does not fit. */
  switchTemplate(body: CarouselBody, templateId: TemplateId): Result<TemplateSwitchResult, RenderRefusal>;
}
