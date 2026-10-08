import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalRenderService } from '../../adapters/local/render/local-render.ts';
import { estimateText } from '../../adapters/local/render/text-metrics.ts';
import type { Canvas2D, SurfaceFactory } from '../../adapters/local/render/canvas.ts';
import { CAROUSEL_FORMATS, findLayout, formatOf, switchTemplate, TEMPLATE_CATEGORIES } from '../../domain/index.ts';
import type { CarouselBody } from '../../domain/index.ts';
import type { LayoutRender, ShapeStyle } from '../../ports/render-template.ts';
import { createFixtures } from '../index.ts';
import {
  CAROUSEL_TEMPLATE_DESCRIPTIONS,
  CAROUSEL_TEMPLATE_LIBRARY,
  CAROUSEL_TEMPLATE_RENDERS,
  CAROUSEL_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  TEMPLATE_CATALOG,
} from './catalog.ts';

/**
 * B05 · every model the library offers is data the renderer can draw, measure and switch to:
 * Marketing's approved models join the catalogue and pass these checks with no code change.
 * D09: no model is called "Provisório" on the screens that show its name.
 */

const CORE_LAYOUTS = ['cover', 'context', 'point', 'data', 'list', 'quote', 'closing'];

function service() {
  return createLocalRenderService({
    templates: CAROUSEL_TEMPLATES,
    renders: CAROUSEL_TEMPLATE_RENDERS,
    descriptions: CAROUSEL_TEMPLATE_DESCRIPTIONS,
    library: CAROUSEL_TEMPLATE_LIBRARY,
    createSurface: () => undefined,
  });
}

// ── Contrast (WCAG relative luminance) ─────────────────────────────────────────────────────

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  assert.match(value, /^[0-9a-f]{6}$/i, `${hex}: colours are #rrggbb`);
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const blend = (top: Rgb, under: Rgb, alpha: number): Rgb => top.map((value, at) => value * alpha + under[at] * (1 - alpha)) as Rgb;

const inside = (shape: Pick<ShapeStyle, 'x' | 'y' | 'width' | 'height'>, x: number, y: number) =>
  x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height;

/** Colour under a point of a layout without the photo: the last shape covering it, else the page. */
function pageUnder(layout: LayoutRender, x: number, y: number): Rgb {
  const shapes = [...(layout.shapes ?? []), ...(layout.overlays ?? [])].filter((shape) => inside(shape, x, y));
  return rgb(shapes.at(-1)?.color ?? layout.background);
}

/** Colours under a point with the photo drawn: a white and a black photo under the scrims (worst cases). */
function photoUnder(layout: LayoutRender, x: number, y: number): Rgb[] {
  const image = layout.image;
  if (!image || !inside(image, x, y)) return [pageUnder(layout, x, y)];
  return [rgb('#ffffff'), rgb('#000000')].map((photo) => {
    let colour = photo;
    for (const scrim of image.scrim) if (inside(scrim, x, y)) colour = blend(rgb(scrim.color), colour, scrim.opacity);
    for (const shape of layout.overlays ?? []) if (inside(shape, x, y)) colour = rgb(shape.color);
    return colour;
  });
}

/** WCAG large text, scaled from a 1080 px slide seen about 400 px wide on a phone. */
const minimum = (size: number, weight: number) => (size >= 64 || (size >= 50 && weight >= 600) ? 3 : 4.5);

describe('carousel template library · metadata', () => {
  it('lists 8 to 10 models once, the default first, each with a short name and a one-line description', () => {
    assert.ok(TEMPLATE_CATALOG.length >= 8 && TEMPLATE_CATALOG.length <= 10, `${TEMPLATE_CATALOG.length} models`);
    assert.equal(CAROUSEL_TEMPLATES[0]?.id, DEFAULT_TEMPLATE_ID);
    const ids = TEMPLATE_CATALOG.map((entry) => entry.template.id);
    const names = TEMPLATE_CATALOG.map((entry) => entry.template.name);
    assert.equal(new Set(ids).size, ids.length, 'unique ids');
    assert.equal(new Set(names).size, names.length, 'unique names');
    for (const { template, render, meta } of TEMPLATE_CATALOG) {
      const words = template.name.trim().split(/\s+/);
      assert.ok(words.length >= 1 && words.length <= 3, `${template.name}: 1 to 3 words`);
      assert.doesNotMatch(template.name, /provis/i, `${template.name}: D09 keeps "Provisório" off approval and delivery`);
      assert.doesNotMatch(meta.description, /provis/i);
      assert.ok(meta.description.trim().length > 0 && meta.description.length <= 70 && !meta.description.includes('\n'), `${template.name}: one line`);
      assert.ok(meta.tags.length > 0 && meta.tags.every((tag) => tag === tag.toLocaleLowerCase('pt-BR') && tag.trim() === tag));
      assert.ok(meta.status === 'base' || meta.status === 'aprovado');
      assert.ok(TEMPLATE_CATEGORIES.some((category) => category.id === meta.category), `${template.name}: known category`);
      assert.equal(render.templateId, template.id);
      assert.equal(CAROUSEL_TEMPLATE_LIBRARY[template.id]?.meta, meta);
    }
  });

  it('covers every category and every available format; later formats have no models yet', () => {
    const metas = TEMPLATE_CATALOG.map((entry) => entry.meta);
    for (const category of TEMPLATE_CATEGORIES) assert.ok(metas.some((meta) => meta.category === category.id), `${category.label}: at least one model`);
    for (const format of CAROUSEL_FORMATS) {
      const count = metas.filter((meta) => meta.format === format.id).length;
      if (format.available) assert.ok(count > 0, `${format.label}: at least one model`);
      else assert.equal(count, 0, `${format.label} arrives in ${format.since}: listed, never selectable`);
    }
  });

  it('says its format from its canvas: Feed 1080 × 1350, Quadrado 1080 × 1080', () => {
    for (const { template, meta } of TEMPLATE_CATALOG) {
      assert.equal(formatOf(template)?.id, meta.format, `${template.name}: canvas matches the format`);
    }
  });
});

describe('carousel template library · structure and render data', () => {
  it('every model has the shared layouts, its featured layouts and the photo where its data draws it', () => {
    for (const { template, render } of TEMPLATE_CATALOG) {
      assert.deepEqual(
        template.layouts.map((layout) => layout.id),
        CORE_LAYOUTS,
        `${template.name}: same layouts, so switching keeps the texts`,
      );
      assert.ok(findLayout(template, template.coverLayoutId));
      assert.ok(template.minSlides >= 1 && template.minSlides <= template.maxSlides);
      for (const featured of template.featuredLayouts ?? []) assert.ok(findLayout(template, featured), `${template.name}: featured ${featured}`);
      for (const layout of template.layouts) {
        assert.equal(Boolean(layout.articleCover), Boolean(render.layouts[layout.id]?.image), `${template.name} · ${layout.label}: photo flag matches its data`);
      }
    }
  });

  it('draws every layout: a box for every slot inside the canvas that holds the lines the slot allows', () => {
    for (const { template, render } of TEMPLATE_CATALOG) {
      for (const layout of template.layouts) {
        const visual = render.layouts[layout.id];
        assert.ok(visual, `${template.name} · ${layout.label}: render data`);
        for (const shape of [...(visual.shapes ?? []), ...(visual.overlays ?? [])]) {
          assert.ok(shape.x >= 0 && shape.y >= 0 && shape.x + shape.width <= template.width && shape.y + shape.height <= template.height, `${template.name} · ${layout.label}: shape inside`);
        }
        for (const slot of layout.slots) {
          const box = visual.slots[slot.id];
          const where = `${template.name} · ${layout.label} · ${slot.label}`;
          assert.ok(box, `${where}: box`);
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= template.width && box.y + box.height <= template.height, `${where}: inside the canvas`);
          const lines = slot.maxLines ?? 1;
          const needed = lines * box.lineHeight + (box.list ? (lines - 1) * box.list.gap : 0);
          assert.ok(box.height >= needed, `${where}: room for ${lines} lines`);
          assert.equal(Boolean(box.list), slot.role === 'list', `${where}: list slots set markers`);
        }
      }
    }
  });

  it('keeps every text legible: slot, marker, counter and credit colours against what is under them, with and without the photo', () => {
    for (const { template, render } of TEMPLATE_CATALOG) {
      for (const layout of template.layouts) {
        const visual = render.layouts[layout.id];
        const check = (label: string, colour: string, x: number, y: number, size: number, weight: number, onPhoto?: string) => {
          const needed = minimum(size, weight);
          const plain = contrast(rgb(colour), pageUnder(visual, x, y));
          assert.ok(plain >= needed, `${template.name} · ${layout.label} · ${label}: ${plain.toFixed(2)} < ${needed}`);
          if (!visual.image) return;
          for (const under of photoUnder(visual, x, y)) {
            const ratio = contrast(rgb(onPhoto ?? colour), under);
            assert.ok(ratio >= needed, `${template.name} · ${layout.label} · ${label} on the photo: ${ratio.toFixed(2)} < ${needed}`);
          }
        };
        for (const slot of layout.slots) {
          const box = visual.slots[slot.id];
          // The first line's left edge: where a bottom-aligned title reaches highest on the photo.
          const top = box.valign === 'bottom' ? box.y + box.height - (slot.maxLines ?? 1) * box.lineHeight + 4 : box.y + 4;
          check(slot.label, box.color, box.x + 4, top, box.fontSize, box.fontWeight, visual.image?.slotColors?.[slot.id]);
          if (box.list) check(`${slot.label} (marcador)`, box.list.color, box.x + 4, top, box.fontSize, box.list.fontWeight);
        }
        if (visual.counter !== false) {
          const counter = visual.counter;
          const colour = counter?.color ?? visual.counterColor ?? visual.accent;
          check('contador', colour, (counter?.x ?? template.width - 96) - 8, (counter?.y ?? template.height - 96) + 4, counter?.fontSize ?? 28, counter?.fontWeight ?? 600, visual.image?.counterColor);
        }
        const credit = visual.image?.credit;
        if (credit) {
          for (const under of photoUnder(visual, credit.x + (credit.align === 'right' ? -8 : 8), credit.y + 4)) {
            assert.ok(contrast(rgb(credit.color), under) >= 4.5, `${template.name}: photo credit legible`);
          }
        }
      }
    }
  });
});

describe('carousel template library · sample copy and switching', () => {
  it('sample copy fills every required slot of every layout, within its budgets and lines', () => {
    const render = service();
    for (const template of render.templates()) {
      const sample = render.sample(template.id);
      assert.ok(sample.ok);
      assert.deepEqual(
        sample.value.slides.map((slide) => slide.layout),
        template.layouts.map((layout) => layout.id),
      );
      for (const slide of sample.value.slides) {
        const layout = findLayout(template, slide.layout);
        for (const slot of layout?.slots ?? []) {
          const value = slide.slots[slot.id] ?? '';
          if (slot.required) assert.ok(value.trim(), `${template.name} · ${layout?.label} · ${slot.label}: sample`);
          assert.ok(value.length <= slot.maxChars, `${template.name} · ${slot.label}: within ${slot.maxChars}`);
        }
      }
      const measured = render.measure(sample.value);
      assert.ok(measured.ok);
      const over = measured.value.filter((fit) => fit.overflow).map((fit) => `${fit.slideId}·${fit.label}`);
      assert.deepEqual(over, [], `${template.name}: the sample fits its lines`);
    }
  });

  it('the seeded carousels fit their model, and switching any carousel between any two models keeps every text', () => {
    const fixtures = createFixtures({ now: '2026-10-08T12:00:00.000Z' });
    const render = service();
    const bodies: CarouselBody[] = fixtures.records.flatMap((record) => record.versions.flatMap((version) => (version.body.type === 'carousel' ? [version.body] : [])));
    assert.ok(bodies.length > 0);
    for (const body of bodies) {
      const measured = render.measure(body);
      assert.ok(measured.ok && measured.value.every((fit) => !fit.overflow), `${body.templateId}: seeded copy fits`);
    }
    const samples = CAROUSEL_TEMPLATES.map((template) => {
      const sample = render.sample(template.id);
      assert.ok(sample.ok);
      return sample.value;
    });
    for (const body of [...bodies, ...samples]) {
      for (const to of CAROUSEL_TEMPLATES) {
        const switched = render.switchTemplate(body, to.id);
        assert.ok(switched.ok);
        assert.equal(switched.value.body.templateId, to.id);
        assert.deepEqual(
          switched.value.body.slides.map((slide) => [slide.id, slide.layout, slide.slots]),
          body.slides.map((slide) => [slide.id, slide.layout, slide.slots]),
          `${body.templateId} → ${to.name}: every text in its slot`,
        );
        assert.ok(!switched.value.issues.some((issue) => issue.kind === 'dropped' || issue.kind === 'merged' || issue.kind === 'layout'));
        if (samples.includes(body)) assert.deepEqual(switched.value.issues, [], `sample → ${to.name}: fits`);
      }
    }
    assert.deepEqual(
      switchTemplate(samples[0], CAROUSEL_TEMPLATES[0], CAROUSEL_TEMPLATES[0]).issues,
      [],
      'same model: nothing to report',
    );
  });
});

describe('carousel template library · render smoke (Node, recording canvas)', () => {
  type Call = { op: string; text?: string };

  function recording(calls: Call[]): SurfaceFactory {
    return () => {
      const context: Canvas2D = {
        fillStyle: '',
        font: '',
        textAlign: 'left',
        textBaseline: 'top',
        globalAlpha: 1,
        fillRect: () => calls.push({ op: 'fillRect' }),
        fillText: (text) => calls.push({ op: 'fillText', text }),
        measureText(text) {
          const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 16);
          const weight = Number(/(\d{3}) /.exec(this.font)?.[1] ?? 400);
          return { width: estimateText(text, { size, weight }) };
        },
        drawImage: () => calls.push({ op: 'drawImage' }),
      };
      return { context, toPng: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) };
    };
  }

  it('previews every layout of every model, draws the library thumbnail once per request and reuses it', async () => {
    const calls: Call[] = [];
    const render = createLocalRenderService({
      templates: CAROUSEL_TEMPLATES,
      renders: CAROUSEL_TEMPLATE_RENDERS,
      library: CAROUSEL_TEMPLATE_LIBRARY,
      createSurface: recording(calls),
      fontsReady: async () => undefined,
    });
    for (const template of render.templates()) {
      const preview = await render.preview({ templateId: template.id, scale: 0.25 });
      assert.ok(preview.ok);
      assert.equal(preview.value.slides.length, template.layouts.length);
      for (const slide of preview.value.slides) {
        assert.ok(slide.image?.dataUrl.startsWith('data:image/png;base64,'), `${template.name} · ${slide.layout}: drawn`);
        assert.equal(slide.overflow, false, `${template.name} · ${slide.layout}: sample fits`);
        assert.deepEqual([slide.width, slide.height], [Math.round(template.width * 0.25), Math.round(template.height * 0.25)]);
      }
      const before = calls.length;
      const thumbnail = await render.thumbnail({ templateId: template.id });
      assert.ok(thumbnail.ok && thumbnail.value.image && thumbnail.value.layout === template.coverLayoutId);
      const drawn = calls.length;
      assert.ok(drawn > before);
      const again = await render.thumbnail({ templateId: template.id });
      assert.ok(again.ok);
      assert.equal(again.value, thumbnail.value, 'cached: the same image, nothing redrawn');
      assert.equal(calls.length, drawn);
    }
    const listed = render.templates()[0];
    const own = await render.thumbnail({ templateId: listed.id, slots: { kicker: 'Podcast', title: 'Um título do próprio artigo' } });
    assert.ok(own.ok);
    assert.ok(calls.some((call) => call.text === 'Podcast'), 'the cover with the article texts');
    const unknown = await render.thumbnail({ templateId: 'nao-existe' });
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_template');
  });

  it('lists the library with its metadata and format', () => {
    const offered = service().templates();
    assert.deepEqual(
      offered.map((entry) => entry.id),
      CAROUSEL_TEMPLATES.map((entry) => entry.id),
    );
    for (const entry of offered) {
      const meta = CAROUSEL_TEMPLATE_LIBRARY[entry.id].meta;
      assert.equal(entry.category, meta.category);
      assert.equal(entry.description, meta.description);
      assert.equal(entry.formatInfo.id, meta.format);
      assert.equal(entry.provisional, meta.status === 'base');
      assert.equal(entry.usesArticleCover, entry.layouts.some((layout) => layout.articleCover));
    }
  });
});
