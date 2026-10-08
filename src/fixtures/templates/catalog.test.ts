import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalRenderService } from '../../adapters/local/render/local-render.ts';
import { findLayout } from '../../domain/carousel.ts';
import type { CarouselBody } from '../../domain/carousel.ts';
import { CAROUSEL_TEMPLATE_DESCRIPTIONS, CAROUSEL_TEMPLATE_RENDERS, CAROUSEL_TEMPLATES, TEMPLATE_CATALOG } from './catalog.ts';

/**
 * B05 · every template the studio offers is data the renderer can draw: Marketing's models join
 * the catalogue and pass these checks with no code change. D09 plan B: no template is called
 * "Provisório" on the screens that show its name (Revisão, Entrega).
 */

describe('carousel template catalogue', () => {
  it('lists every entry once, with a name and a pt-BR one-liner', () => {
    const ids = TEMPLATE_CATALOG.map((entry) => entry.template.id);
    assert.equal(new Set(ids).size, ids.length, 'unique ids');
    const names = TEMPLATE_CATALOG.map((entry) => entry.template.name);
    assert.equal(new Set(names).size, names.length, 'unique names');
    for (const entry of TEMPLATE_CATALOG) {
      assert.ok(entry.template.name.trim().length > 0);
      assert.doesNotMatch(entry.template.name, /provis/i, `${entry.template.name}: D09 keeps "Provisório" off approval and delivery`);
      assert.ok(entry.description.trim().length > 0);
      assert.equal(entry.render.templateId, entry.template.id);
    }
  });

  it('draws every layout: 4:5 canvas, cover layout present, a box for every slot that holds its lines', () => {
    for (const { template, render } of TEMPLATE_CATALOG) {
      assert.equal(template.width / template.height, 1080 / 1350, `${template.name}: 4:5`);
      assert.ok(findLayout(template, template.coverLayoutId), `${template.name}: cover layout`);
      assert.ok(template.minSlides >= 1 && template.minSlides <= template.maxSlides);
      for (const layout of template.layouts) {
        const visual = render.layouts[layout.id];
        assert.ok(visual, `${template.name} · ${layout.label}: render data`);
        for (const slot of layout.slots) {
          const box = visual.slots[slot.id];
          assert.ok(box, `${template.name} · ${layout.label} · ${slot.label}: box`);
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= template.width && box.y + box.height <= template.height, `${slot.label}: inside the canvas`);
          assert.ok(Math.floor(box.height / box.lineHeight) >= (slot.maxLines ?? 1), `${template.name} · ${layout.label} · ${slot.label}: room for its lines`);
        }
      }
    }
  });

  it('reaches the studio through the RenderService, selectable and measurable', () => {
    const service = createLocalRenderService({
      templates: CAROUSEL_TEMPLATES,
      renders: CAROUSEL_TEMPLATE_RENDERS,
      descriptions: CAROUSEL_TEMPLATE_DESCRIPTIONS,
      createSurface: () => undefined,
    });
    const offered = service.templates();
    assert.deepEqual(
      offered.map((entry) => entry.id),
      CAROUSEL_TEMPLATES.map((entry) => entry.id),
    );
    for (const template of offered) {
      const body: CarouselBody = {
        type: 'carousel',
        templateId: template.id,
        slides: template.layouts.map((layout, index) => ({
          id: `s${index}`,
          layout: layout.id,
          slots: Object.fromEntries(layout.slots.map((slot) => [slot.id, slot.label])),
          sourceBlockIds: [],
        })),
      };
      const measured = service.measure(body);
      assert.ok(measured.ok && measured.value.every((fit) => !fit.overflow), `${template.name}: short texts fit every slot`);
    }
  });
});
