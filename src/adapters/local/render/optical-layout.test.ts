import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CarouselTemplate, Slide } from '../../../domain/carousel.ts';
import type { TemplateRender } from '../../../ports/render-template.ts';
import { balancedLines, estimateText, wrapLines } from './text-metrics.ts';
import { laySlide } from './slide-layout.ts';
import { coverFit } from './canvas.ts';

const measure = (text: string) => estimateText(text, { size: 40, weight: 600 });
const spread = (lines: string[]) => Math.max(...lines.map(measure)) - Math.min(...lines.map(measure));

test('balanced headlines preserve words, punctuation and the line count while reducing raggedness', () => {
  for (const text of ['Mais eficiência no processamento do pescado', 'Pessoas, processos e tecnologia no pescado', 'O que a conversa revela sobre o setor?']) {
    const greedy = wrapLines(text, 440, measure), balanced = balancedLines(text, 440, measure);
    assert.equal(balanced.length, greedy.length);
    assert.equal(balanced.join(' '), text);
    assert.ok(balanced.every(line => measure(line) <= 440));
    assert.ok(spread(balanced) <= spread(greedy));
  }
});

test('balancing respects hard breaks and empty paragraphs and leaves oversized-word handling unchanged', () => {
  assert.deepEqual(balancedLines('Primeira linha\n\nSegunda', 900, measure), ['Primeira linha', '', 'Segunda']);
  const oversized = 'WWWWWWWWWWWWWWW';
  assert.deepEqual(balancedLines(oversized, 70, measure), wrapLines(oversized, 70, measure));
  assert.deepEqual(balancedLines('', 100, measure), ['']);
  const large = Array.from({ length: 70 }, () => 'palavra').join(' ');
  assert.deepEqual(balancedLines(large, 100, measure), wrapLines(large, 100, measure));
});

const template: CarouselTemplate = { id: 'optical', name: 'Optical test', width: 1080, height: 1350, minSlides: 1, maxSlides: 10, coverLayoutId: 'cover', layouts: [{ id: 'cover', label: 'Capa', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 70, maxLines: 2 }] }] };
const render: TemplateRender = { templateId: template.id, layouts: { cover: { background: '#FFFFFF', accent: '#000000', slots: { title: { x: 80, y: 240, width: 500, height: 240, fontFamily: 'Inter', fontWeight: 600, fontSize: 100, lineHeight: 120, color: '#000000', align: 'left', minFontSize: 50, balanced: true } } } } };
const slide = (title: string): Slide => ({ id: 'cover', layout: 'cover', slots: { title }, sourceBlockIds: [] });

test('optical fit uses large type for a short headline and shrinks a long one within the declared floor without modifying template or text', () => {
  const before = structuredClone(render);
  const short = laySlide(slide('Pescado'), template, render, estimateText)[0];
  assert.equal(short.style.fontSize, 100);
  const title = 'Pessoas, processos e tecnologia';
  const longSlide = slide(title), long = laySlide(longSlide, template, render, estimateText)[0];
  assert.ok(long.style.fontSize >= 50 && long.style.fontSize < 100);
  assert.equal(long.fit.overflow, false);
  assert.equal(long.lines.join(' '), title);
  assert.equal(longSlide.slots.title, title);
  assert.deepEqual(render, before);
});

test('optical fit reports overflow at the minimum instead of silently shrinking indefinitely or truncating text', () => {
  const title = Array.from({ length: 12 }, () => 'processamento').join(' ');
  const laid = laySlide(slide(title), template, render, estimateText)[0];
  assert.equal(laid.style.fontSize, 50);
  assert.equal(laid.fit.overflow, true);
  assert.equal(laid.lines.join(' '), title);
});

test('optical balancing can reduce a short orphan within a bounded size adjustment, retaining every headline word', () => {
  const headline = 'Mais eficiência no processamento do pescado';
  const cover = structuredClone(render);
  cover.layouts.cover.slots.title = { ...cover.layouts.cover.slots.title, width: 912, height: 484, fontSize: 114, lineHeight: 121, minFontSize: 86 };
  const fourLines = { ...template, layouts: [{ ...template.layouts[0], slots: [{ ...template.layouts[0].slots[0], maxLines: 4 }] }] };
  const laid = laySlide(slide(headline), fourLines, cover, estimateText)[0];
  assert.ok(laid.style.fontSize >= 98 && laid.style.fontSize <= 114);
  assert.equal(laid.lines.join(' '), headline);
  assert.equal(laid.fit.overflow, false);
  assert.ok(laid.lines.every(line => line.includes(' ') || estimateText(line, { size: laid.style.fontSize, weight: 600 }) >= 912 * 0.4));
});

test('legacy layouts opt out of optical sizing and balancing completely', () => {
  const legacy = structuredClone(render);
  delete legacy.layouts.cover.slots.title.minFontSize;
  delete legacy.layouts.cover.slots.title.balanced;
  const laid = laySlide(slide('Pessoas, processos e tecnologia'), template, legacy, estimateText)[0];
  assert.equal(laid.style.fontSize, 100);
  assert.deepEqual(laid.lines, wrapLines(laid.text, 500, text => estimateText(text, { size: 100, weight: 600, family: 'Inter' })));
});

test('photo framing defaults to centre and clamps opt-in crop anchors without distorting the image', () => {
  const source = { width: 1000, height: 2000 }, box = { width: 1000, height: 500 };
  assert.deepEqual(coverFit(source, box), { sx: 0, sy: 750, sw: 1000, sh: 500 });
  assert.deepEqual(coverFit(source, box, { x: -4, y: 0 }), { sx: 0, sy: 0, sw: 1000, sh: 500 });
  assert.deepEqual(coverFit(source, box, { x: 4, y: 1.5 }), { sx: 0, sy: 1500, sw: 1000, sh: 500 });
  assert.deepEqual(coverFit(source, box, { x: NaN, y: NaN }), coverFit(source, box));
});
