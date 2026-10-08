import type { CarouselBody, CarouselTemplate, Slide } from '../../../domain/carousel.ts';
import { CAROUSEL_FORMATS, formatOf, usesArticleCover } from '../../../domain/carousel-library.ts';
import type { TemplateMeta } from '../../../domain/carousel-library.ts';
import { switchTemplate } from '../../../domain/carousel-switch.ts';
import type { TemplateSwitchIssue } from '../../../domain/carousel-switch.ts';
import type { AssetId, TemplateId } from '../../../domain/ids.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import type {
  RenderCapabilities,
  RenderedSlide,
  RenderRefusal,
  RenderRequest,
  RenderResult,
  RenderService,
  SlideBackground,
  SlotFit,
  TemplateInfo,
} from '../../../ports/render.ts';
import type { TemplateLibraryData } from '../../../ports/render-template.ts';
import { canDrawImages, drawSlide, offscreenSurface } from './canvas.ts';
import type { Canvas2D, CoverImage, SurfaceFactory } from './canvas.ts';
import { COVER_REASONS } from './cover-image.ts';
import type { CoverLoader, CoverRefusal } from './cover-image.ts';
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
 * It also serves the template library: metadata and format of each model, its sample copy, the
 * cached cover thumbnails and layout previews, and the switch of a carousel to another model.
 */

export type LocalRenderDeps = {
  /** Template structure (layouts, slots, limits). */
  templates: readonly CarouselTemplate[];
  /** Visual data per template id (fixtures). */
  renders: Readonly<Record<TemplateId, TemplateRender>>;
  /** pt-BR one-liners for the template ChoiceCard (the library meta's description wins). */
  descriptions?: Readonly<Record<TemplateId, string>>;
  /** Library metadata and sample copy per template id (fixtures). */
  library?: Readonly<Record<TemplateId, TemplateLibraryData>>;
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
  /**
   * The library's sample photo: `articleCover` set to `assetId` draws it, credited `credit`
   * ("Foto de exemplo"), so a photo model shows a photo under the sample copy.
   */
  samplePhoto?: { assetId: AssetId; credit: string; load: () => Promise<Result<CoverImage, CoverRefusal>> };
};

const NO_COVER = 'O artigo não tem imagem de destaque.';

const NO_CANVAS = 'Prévia em imagem indisponível neste navegador.';
const NO_VISUAL = 'Modelo sem dados visuais para este layout.';
const NO_TEMPLATE = 'Modelo de carrossel não encontrado.';

/** Slides of a library thumbnail: the cover and the pages after it, so its counter reads "1/5". */
const THUMBNAIL_PAGES = 5;
/** Library images kept in memory (thumbnails and previews, any scale). */
const LIBRARY_CACHE_LIMIT = 64;

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
    if (!font.tracking) return context.measureText(text).width;
    context.letterSpacing = `${font.tracking}px`;
    const width = context.measureText(text).width;
    context.letterSpacing = '0px';
    return width;
  };
}

/** Library metadata of a template the catalogue does not describe (a test template, a new model). */
function defaultMeta(template: CarouselTemplate, description: string | undefined): TemplateMeta {
  return {
    category: 'editorial',
    format: formatOf(template)?.id ?? 'feed',
    description: description ?? 'Modelo base.',
    tags: [],
    status: 'base',
  };
}

/** Sample copy when the library has none: each slot shows its own label. */
function labelSample(template: CarouselTemplate): Record<string, Record<string, string>> {
  return Object.fromEntries(template.layouts.map((layout) => [layout.id, Object.fromEntries(layout.slots.map((slot) => [slot.id, slot.label]))]));
}

function slotsKey(slots: Readonly<Record<string, string>> | undefined): string {
  if (!slots) return '';
  return Object.keys(slots)
    .sort()
    .map((id) => `${id}=${slots[id]}`)
    .join('\u0001');
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
  const sampleOf = (assetId: AssetId) => (deps.samplePhoto && deps.samplePhoto.assetId === assetId ? deps.samplePhoto : undefined);
  const creditOf = (assetId: AssetId) => sampleOf(assetId)?.credit ?? deps.coverCredit?.(assetId);

  const fitsOf = (body: CarouselBody, found: CarouselTemplate): SlotFit[] =>
    body.slides.flatMap((slide) => laySlide(slide, found, deps.renders[found.id], measurer).map((slot) => slot.fit));

  const infos: readonly TemplateInfo[] = deps.templates.map((entry) => {
    const meta = deps.library?.[entry.id]?.meta ?? defaultMeta(entry, deps.descriptions?.[entry.id]);
    const formatInfo = CAROUSEL_FORMATS.find((format) => format.id === meta.format) ?? formatOf(entry) ?? CAROUSEL_FORMATS[0];
    return {
      ...entry,
      ...meta,
      tags: [...meta.tags],
      provisional: meta.status === 'base',
      formatInfo: { ...formatInfo },
      usesArticleCover: usesArticleCover(entry),
    };
  });

  async function render(request: RenderRequest): Promise<Result<RenderResult, RenderRefusal>> {
    const found = template(request.body.templateId);
    if (!found) return refuse('unknown_template', NO_TEMPLATE);
    const wanted = request.slideIds;
    if (wanted && wanted.some((id) => !request.body.slides.some((slide) => slide.id === id))) {
      return refuse('unknown_slide', 'Slide não encontrado neste carrossel.');
    }
    const scale = request.scale ?? 1;
    const width = Math.max(1, Math.round(found.width * scale));
    const height = Math.max(1, Math.round(found.height * scale));
    const visual = deps.renders[found.id];
    if (probe) await fontsReady(facesOf(found.id));
    const total = request.body.slides.length;
    const slides: RenderedSlide[] = [];
    /** The cover is decoded once per render, only if a drawn layout asks for it. */
    let cover: Promise<{ image?: CoverImage; reason?: string }> | undefined;
    const coverFor = () => {
      cover ??= (async () => {
        if (!request.articleCover) return { reason: NO_COVER };
        const sample = sampleOf(request.articleCover);
        if (!sample && !deps.loadCover) return { reason: COVER_REASONS.unreadable };
        const loaded = sample ? await sample.load() : await (deps.loadCover as CoverLoader)(request.articleCover);
        return loaded.ok ? { image: loaded.value } : { reason: loaded.refusal.message };
      })();
      return cover;
    };
    for (const [index, slide] of request.body.slides.entries()) {
      if (wanted && !wanted.includes(slide.id)) continue;
      const laid = laySlide(slide, found, visual, measurer);
      const fits = laid.map((slot) => slot.fit);
      const rendered: RenderedSlide = { slideId: slide.id, index, layout: slide.layout, width, height, fits, overflow: fits.some((fit) => fit.overflow) };
      const layoutImage = visual?.layouts[slide.layout]?.image;
      const surface = visual?.layouts[slide.layout] ? createSurface(width, height) : undefined;
      if (!surface) {
        rendered.unavailableReason = visual?.layouts[slide.layout] ? NO_CANVAS : NO_VISUAL;
      } else {
        try {
          const background = layoutImage ? await coverFor() : undefined;
          if (layoutImage) {
            const status: SlideBackground = { source: layoutImage.background, drawn: false };
            const reason = background?.image && !canDrawImages(surface.context) ? COVER_REASONS.unreadable : background?.reason;
            if (reason) status.reason = reason;
            rendered.background = status;
          }
          const credit = background?.image && request.articleCover ? creditOf(request.articleCover) : undefined;
          const drawn = drawSlide(surface.context, {
            template: found,
            render: visual as TemplateRender,
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
  }

  function sample(templateId: TemplateId): Result<CarouselBody, RenderRefusal> {
    const found = template(templateId);
    if (!found) return refuse('unknown_template', NO_TEMPLATE);
    const copy = deps.library?.[found.id]?.sample ?? labelSample(found);
    const slides: Slide[] = found.layouts.map((layout) => ({
      id: `sample-${layout.id}`,
      layout: layout.id,
      slots: Object.fromEntries(layout.slots.flatMap((slot) => (copy[layout.id]?.[slot.id] ? [[slot.id, copy[layout.id][slot.id]]] : []))),
      sourceBlockIds: [],
    }));
    return ok({ type: 'carousel', templateId: found.id, slides });
  }

  /** Library images by what they draw; a result without an image is not kept (retried next time). */
  const library = new Map<string, Promise<Result<RenderResult, RenderRefusal>>>();
  const cached = (key: string, draw: () => Promise<Result<RenderResult, RenderRefusal>>) => {
    const hit = library.get(key);
    if (hit) return hit;
    const pending = draw();
    library.set(key, pending);
    if (library.size > LIBRARY_CACHE_LIMIT) library.delete(library.keys().next().value as string);
    void pending.then((result) => {
      if (!result.ok || result.value.slides.some((slide) => !slide.image)) library.delete(key);
    });
    return pending;
  };
  const imageKey = (articleCover: AssetId | undefined) => `${articleCover ?? ''}\u0002${articleCover ? (creditOf(articleCover) ?? '') : ''}`;

  return {
    ...(deps.samplePhoto ? { samplePhoto: deps.samplePhoto.assetId } : {}),
    templates(): readonly TemplateInfo[] {
      return infos.map((info) => ({ ...info, tags: [...info.tags], formatInfo: { ...info.formatInfo } }));
    },
    capabilities(): RenderCapabilities {
      return probe ? { raster: true } : { raster: false, reason: NO_CANVAS };
    },
    measure(body) {
      const found = template(body.templateId);
      if (!found) return refuse('unknown_template', NO_TEMPLATE);
      return ok(fitsOf(body, found));
    },
    render,
    sample,
    async thumbnail(request) {
      const sampled = sample(request.templateId);
      if (!sampled.ok) return sampled;
      const found = template(request.templateId) as CarouselTemplate;
      const scale = request.scale ?? 0.4;
      const coverId = `sample-${found.coverLayoutId}`;
      const pages = sampled.value.slides.filter((slide) => slide.id !== coverId).slice(0, THUMBNAIL_PAGES - 1);
      const base = sampled.value.slides.find((slide) => slide.id === coverId) ?? { id: coverId, layout: found.coverLayoutId, slots: {}, sourceBlockIds: [] };
      const cover: Slide = request.slots ? { ...base, slots: { ...request.slots } } : base;
      const body: CarouselBody = { ...sampled.value, slides: [cover, ...pages] };
      const key = ['thumbnail', found.id, scale, imageKey(request.articleCover), slotsKey(request.slots)].join('\u0003');
      const result = await cached(key, () => render({ body, slideIds: [cover.id], scale, ...(request.articleCover ? { articleCover: request.articleCover } : {}) }));
      if (!result.ok) return result;
      const [slide] = result.value.slides;
      return slide ? ok(slide) : refuse('render_failed', 'Não foi possível desenhar a capa do modelo.');
    },
    async preview(request) {
      const sampled = sample(request.templateId);
      if (!sampled.ok) return sampled;
      const scale = request.scale ?? 0.5;
      const key = ['preview', request.templateId, scale, imageKey(request.articleCover)].join('\u0003');
      return cached(key, () => render({ body: sampled.value, scale, ...(request.articleCover ? { articleCover: request.articleCover } : {}) }));
    },
    switchTemplate(body, templateId) {
      const to = template(templateId);
      if (!to) return refuse('unknown_template', NO_TEMPLATE);
      const switched = switchTemplate(body, template(body.templateId), to);
      const fits = fitsOf(switched.body, to);
      const position = new Map(switched.body.slides.map((slide, index) => [slide.id, index + 1]));
      const over = fits.filter((fit) => fit.overflow);
      const measured = new Set(over.map((fit) => `${fit.slideId}\u0001${fit.slotId}`));
      // One fit issue per slot: the measured lines replace the character hint.
      const issues: TemplateSwitchIssue[] = switched.issues.filter((issue) => issue.kind !== 'over_budget' || !measured.has(`${issue.slideId}\u0001${issue.slotId}`));
      for (const fit of over) {
        const at = position.get(fit.slideId) ?? 0;
        issues.push({ slideId: fit.slideId, position: at, kind: 'overflow', slotId: fit.slotId, message: `Slide ${at}: ${fit.message ?? `≈ ${fit.label} não cabe`}` });
      }
      issues.sort((a, b) => a.position - b.position);
      return ok({ body: switched.body, issues, fits });
    },
  };
}
