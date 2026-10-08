import type { CarouselBody, CarouselTemplate } from '../../../domain/carousel.ts';
import type { AssetId, TemplateId } from '../../../domain/ids.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { RenderCapabilities, RenderedSlide, RenderService, SlideBackground, SlotFit, TemplateInfo } from '../../../ports/render.ts';
import { canDrawImages, drawSlide, offscreenSurface } from './canvas.ts';
import type { Canvas2D, CoverImage, SurfaceFactory } from './canvas.ts';
import { COVER_REASONS } from './cover-image.ts';
import type { CoverLoader } from './cover-image.ts';
import { dataUrl } from './encoding.ts';
import { laySlide } from './slide-layout.ts';
import { cssFont, templateFonts } from './templates.ts';
import type { TemplateRender, Typefaces } from './templates.ts';
import { estimateText } from './text-metrics.ts';
import type { MeasureText } from './text-metrics.ts';

/**
 * Local RenderService: rasterises carousel slides to PNG in the browser (OffscreenCanvas, no
 * backend, no DOM) from template DATA, and reports the approximate text fit per slot. Without a
 * canvas (Node tests, SSR) it still measures, by estimation, and says why there is no image.
 */

export type LocalRenderDeps = {
  /** Template structure (layouts, slots, limits). */
  templates: readonly CarouselTemplate[];
  /** Visual data per template id (fixtures). */
  renders: Readonly<Record<TemplateId, TemplateRender>>;
  /** pt-BR one-liners for the template ChoiceCard. */
  descriptions?: Readonly<Record<TemplateId, string>>;
  /** Drawing surfaces; default: OffscreenCanvas when available. */
  createSurface?: SurfaceFactory;
  /**
   * Template typeface → CSS family the page loaded for it (`{ Inter: interV3.style.fontFamily }`).
   * Without it the canvas asks for "Inter" by name and draws in a system fallback.
   */
  typefaces?: Typefaces;
  /** Resolves when the given web fonts can draw; default: `document.fonts.load` of each, when present. */
  fontsReady?: (fonts: readonly string[]) => Promise<unknown>;
  /** Decodes the article cover for layouts whose data asks for it (`assetCoverLoader`). */
  loadCover?: CoverLoader;
  /** Credit line of the cover ("Foto: Ana Prado"), read at each render (it may change). */
  coverCredit?: (assetId: AssetId) => string | undefined;
};

const NO_COVER = 'O artigo não tem imagem de destaque.';

const NO_CANVAS = 'Prévia em imagem indisponível neste navegador.';
const NO_VISUAL = 'Modelo sem dados visuais para este layout.';

type FontFaceSet = { ready?: Promise<unknown>; load?: (font: string) => Promise<unknown> };

/**
 * A face the document does not use yet (the italic of the quote, say) is not downloaded until
 * asked for: each template face is loaded before drawing, so the PNG never falls back silently.
 */
function defaultFontsReady(fonts: readonly string[]): Promise<unknown> {
  const set = (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
  if (!set) return Promise.resolve();
  const loads = set.load ? fonts.map((font) => set.load?.(font).catch(() => undefined)) : [];
  return Promise.all([...loads, set.ready]);
}

/** Measures with the real font when a canvas exists, by estimation otherwise. */
function canvasMeasure(context: Canvas2D | undefined, typefaces: Typefaces | undefined): MeasureText {
  if (!context) return estimateText;
  return (text, font) => {
    context.font = cssFont({ fontFamily: font.family ?? 'Inter', fontWeight: font.weight, fontSize: font.size, ...(font.italic ? { italic: true } : {}) }, 1, typefaces);
    return context.measureText(text).width;
  };
}

export function createLocalRenderService(deps: LocalRenderDeps): RenderService {
  const createSurface = deps.createSurface ?? offscreenSurface;
  const fontsReady = deps.fontsReady ?? defaultFontsReady;
  const probe = createSurface(1, 1);
  const measurer = canvasMeasure(probe?.context, deps.typefaces);
  const facesOf = (templateId: TemplateId) => templateFonts(deps.renders[templateId], deps.typefaces);
  // Measuring is synchronous (line fit while a run writes): the faces start loading right away.
  if (probe) void fontsReady([...new Set(deps.templates.flatMap((entry) => facesOf(entry.id)))]);
  const template = (id: TemplateId) => deps.templates.find((candidate) => candidate.id === id);

  const fitsOf = (body: CarouselBody, found: CarouselTemplate): SlotFit[] =>
    body.slides.flatMap((slide) => laySlide(slide, found, deps.renders[found.id], measurer).map((slot) => slot.fit));

  return {
    templates(): readonly TemplateInfo[] {
      return deps.templates.map((entry) => ({
        ...entry,
        provisional: deps.renders[entry.id]?.provisional ?? true,
        description: deps.descriptions?.[entry.id] ?? 'Modelo provisório até a chegada dos modelos de Marketing.',
      }));
    },
    capabilities(): RenderCapabilities {
      return probe ? { raster: true } : { raster: false, reason: NO_CANVAS };
    },
    measure(body) {
      const found = template(body.templateId);
      if (!found) return refuse('unknown_template', 'Modelo de carrossel não encontrado.');
      return ok(fitsOf(body, found));
    },
    async render(request) {
      const found = template(request.body.templateId);
      if (!found) return refuse('unknown_template', 'Modelo de carrossel não encontrado.');
      const wanted = request.slideIds;
      if (wanted && wanted.some((id) => !request.body.slides.some((slide) => slide.id === id))) {
        return refuse('unknown_slide', 'Slide não encontrado neste carrossel.');
      }
      const scale = request.scale ?? 1;
      const width = Math.max(1, Math.round(found.width * scale));
      const height = Math.max(1, Math.round(found.height * scale));
      const render = deps.renders[found.id];
      if (probe) await fontsReady(facesOf(found.id));
      const total = request.body.slides.length;
      const slides: RenderedSlide[] = [];
      /** The cover is decoded once per render, only if a drawn layout asks for it. */
      let cover: Promise<{ image?: CoverImage; reason?: string }> | undefined;
      const coverFor = () => {
        cover ??= (async () => {
          if (!request.articleCover) return { reason: NO_COVER };
          if (!deps.loadCover) return { reason: COVER_REASONS.unreadable };
          const loaded = await deps.loadCover(request.articleCover);
          return loaded.ok ? { image: loaded.value } : { reason: loaded.refusal.message };
        })();
        return cover;
      };
      for (const [index, slide] of request.body.slides.entries()) {
        if (wanted && !wanted.includes(slide.id)) continue;
        const laid = laySlide(slide, found, render, measurer);
        const fits = laid.map((slot) => slot.fit);
        const rendered: RenderedSlide = { slideId: slide.id, index, layout: slide.layout, width, height, fits, overflow: fits.some((fit) => fit.overflow) };
        const layoutImage = render?.layouts[slide.layout]?.image;
        const surface = render?.layouts[slide.layout] ? createSurface(width, height) : undefined;
        if (!surface) {
          rendered.unavailableReason = render?.layouts[slide.layout] ? NO_CANVAS : NO_VISUAL;
        } else {
          try {
            const background = layoutImage ? await coverFor() : undefined;
            if (layoutImage) {
              const status: SlideBackground = { source: layoutImage.background, drawn: false };
              const reason = background?.image && !canDrawImages(surface.context) ? COVER_REASONS.unreadable : background?.reason;
              if (reason) status.reason = reason;
              rendered.background = status;
            }
            const credit = background?.image && request.articleCover ? deps.coverCredit?.(request.articleCover) : undefined;
            const drawn = drawSlide(surface.context, {
              template: found,
              render: render as TemplateRender,
              slide,
              index,
              total,
              laid,
              scale,
              ...(background?.image ? { cover: background.image } : {}),
              ...(credit ? { coverCredit: credit } : {}),
              ...(deps.typefaces ? { typefaces: deps.typefaces } : {}),
            });
            if (rendered.background && drawn) rendered.background = { source: rendered.background.source, drawn: true };
            const bytes = await surface.toPng();
            rendered.image = { mimeType: 'image/png', dataUrl: dataUrl('image/png', bytes), bytes: bytes.length };
          } catch {
            rendered.unavailableReason = 'Não foi possível desenhar este slide.';
          }
        }
        slides.push(rendered);
      }
      return ok({ templateId: found.id, slides, approximate: true as const });
    },
  };
}
