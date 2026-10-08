import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAROUSEL_FORMATS } from '../../domain/index.ts';
import type { CarouselFormatId, SlideLayout, TemplateCategory, TemplateSwitchIssue } from '../../domain/index.ts';
import { TEMPLATE_CATALOG } from '../../fixtures/templates/catalog.ts';
import {
  applyFilter,
  coverLayouts,
  DEFAULT_LIBRARY_PARAMS,
  featuredNote,
  formatTabs,
  initialTemplate,
  libraryFilter,
  otherFormatMatch,
  parseLibraryParams,
  serializeLibraryParams,
  shownFormat,
  slotLimit,
  statusBadge,
  switchSummary,
  templateLine,
  type LibraryTemplate,
} from './library-model.ts';

const LAYOUTS: SlideLayout[] = [
  { id: 'cover', label: 'Capa', articleCover: true, slots: [{ id: 'kicker', label: 'Chamada', role: 'kicker', maxChars: 32, maxLines: 1 }, { id: 'title', label: 'Título', role: 'title', maxChars: 70, maxLines: 3, required: true }] },
  { id: 'point', label: 'Ponto principal', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 40, maxLines: 2 }] },
  { id: 'data', label: 'Número', slots: [{ id: 'stat', label: 'Número', role: 'stat', maxChars: 7, maxLines: 1 }] },
];

function template(id: string, name: string, format: CarouselFormatId, category: TemplateCategory, tags: string[] = []): LibraryTemplate {
  const formatInfo = CAROUSEL_FORMATS.find((entry) => entry.id === format);
  assert.ok(formatInfo);
  return { id, name, format, category, description: `${name}.`, tags, status: 'base', formatInfo, layouts: LAYOUTS, minSlides: 3, maxSlides: 10 };
}

const LIBRARY: LibraryTemplate[] = [
  template('tpl-editorial', 'Editorial', 'feed', 'editorial', ['claro']),
  template('tpl-foto', 'Fotografia', 'feed', 'photo', ['foto na capa']),
  template('tpl-noturno', 'Noturno', 'feed', 'editorial', ['escuro']),
  template('tpl-aspas', 'Aspas', 'square', 'quote', ['serifa']),
  template('tpl-pauta', 'Pauta', 'square', 'editorial'),
];

describe('library cards', () => {
  it('say what the model is in the drawer, and carry a badge only when Marketing approved it', () => {
    assert.equal(templateLine(LIBRARY[0]), 'Editorial · Feed 4:5');
    assert.equal(templateLine(LIBRARY[3]), 'Citação · Quadrado 1:1');
    assert.equal(statusBadge('base'), undefined);
    assert.deepEqual(statusBadge('aprovado'), { label: 'Aprovado', tone: 'teal' });
  });

  it('every model of the shipped library has a one-line description and a selectable format; some are approved', () => {
    for (const entry of TEMPLATE_CATALOG) {
      const format = CAROUSEL_FORMATS.find((candidate) => candidate.id === entry.meta.format);
      assert.ok(format?.available, `${entry.template.name} is selectable`);
      assert.match(entry.meta.description, /^\p{Lu}.{8,80}\.$/u, entry.template.name);
    }
    assert.ok(TEMPLATE_CATALOG.some((entry) => entry.meta.status === 'aprovado'));
    assert.equal(TEMPLATE_CATALOG[0].meta.status, 'aprovado', 'the default model is an approved one');
  });
});

describe('library filters', () => {
  it('one format at a time: tabs count what the search leaves; Stories is "Em breve"', () => {
    assert.deepEqual(
      formatTabs(LIBRARY, libraryFilter()).map((tab) => [tab.label, tab.count, tab.disabled]),
      [
        ['Feed 4:5', 3, false],
        ['Quadrado 1:1', 2, false],
        ['Stories 9:16', 'Em breve', true],
      ],
    );
    assert.deepEqual(formatTabs(LIBRARY, { format: 'square', query: 'escuro' }).slice(0, 2).map((tab) => tab.count), [1, 0], 'the format itself does not narrow its own tabs');
  });

  it('applies the format and an accent-free search (category names included) together', () => {
    assert.deepEqual(applyFilter(LIBRARY, libraryFilter('feed')).map((entry) => entry.name), ['Editorial', 'Fotografia', 'Noturno']);
    assert.deepEqual(applyFilter(LIBRARY, { format: 'square', query: 'CITACAO' }).map((entry) => entry.name), ['Aspas']);
    assert.deepEqual(applyFilter(LIBRARY, { format: 'feed', query: 'citacao' }), []);
  });

  it('a search with nothing in this format points at the format that has it', () => {
    assert.equal(otherFormatMatch(LIBRARY, { format: 'feed', query: 'serifa' })?.value, 'square');
    assert.equal(otherFormatMatch(LIBRARY, { format: 'feed', query: 'nada disso' }), undefined);
  });

  it('starts from the carousel own model, then the last used, then the first of the library', () => {
    assert.equal(initialTemplate(LIBRARY, { existing: 'tpl-aspas', lastUsed: 'tpl-foto' }), 'tpl-aspas');
    assert.equal(initialTemplate(LIBRARY, { lastUsed: 'tpl-foto' }), 'tpl-foto');
    assert.equal(initialTemplate(LIBRARY, { lastUsed: 'tpl-removido' }), 'tpl-editorial');
    assert.equal(initialTemplate([], {}), undefined);
  });
});

describe('"Modelos" page URL', () => {
  it('round-trips the format, the search and the open model, leaving the defaults out', () => {
    const params = { format: 'square' as const, query: 'serifa', model: 'tpl-aspas' };
    const query = serializeLibraryParams(params);
    assert.equal(query, 'format=square&q=serifa&model=tpl-aspas');
    assert.deepEqual(parseLibraryParams(new URLSearchParams(query)), params);
    assert.equal(serializeLibraryParams(DEFAULT_LIBRARY_PARAMS), '');
  });

  it('falls back on unknown values and never opens a later format', () => {
    assert.deepEqual(parseLibraryParams(new URLSearchParams('format=stories&category=nada')), DEFAULT_LIBRARY_PARAMS);
  });

  it('shows the address format, else the open model one, else Feed', () => {
    assert.equal(shownFormat({ format: 'square', model: null }, LIBRARY), 'square');
    assert.equal(shownFormat({ format: null, model: 'tpl-aspas' }, LIBRARY), 'square');
    assert.equal(shownFormat({ format: null, model: null }, LIBRARY), 'feed');
  });
});

describe('layouts and limits', () => {
  it('say each slot budget once, with the lines when more than one', () => {
    assert.equal(slotLimit({ label: 'Número', maxChars: 7, maxLines: 1 }), 'Número até 7 caracteres');
    assert.deepEqual(LAYOUTS[0].slots.map(slotLimit), ['Chamada até 32 caracteres', 'Título até 70 caracteres e 3 linhas']);
    assert.equal(coverLayouts(LIBRARY[0]), 'Capa');
    assert.equal(coverLayouts({ layouts: LAYOUTS.slice(1) }), undefined);
    assert.equal(coverLayouts({ layouts: LAYOUTS.map((layout) => ({ ...layout, articleCover: true as const })) }), 'Capa, Ponto principal e Número');
  });

  it('names the layout a featured model may add', () => {
    assert.equal(featuredNote({ layouts: LAYOUTS, featuredLayouts: ['data'] }), 'Com um dado forte, gera um slide de Número.');
    assert.equal(featuredNote({ layouts: LAYOUTS }), undefined);
  });
});

describe('switching the model of a carousel', () => {
  const issue = (kind: TemplateSwitchIssue['kind'], slideId: string, slotId?: string): TemplateSwitchIssue => ({
    slideId,
    position: Number(slideId.slice(1)),
    kind,
    ...(slotId ? { slotId } : {}),
    message: `Slide ${slideId.slice(1)}: ${kind}.`,
  });

  it('says the texts fit when nothing overflows, is left out or goes missing', () => {
    const summary = switchSummary([issue('layout', 's2'), issue('merged', 's3', 'body')]);
    assert.equal(summary.text, 'Os textos cabem no modelo');
    assert.equal(summary.tone, 'ok');
  });

  it('counts a slot once even when the hint and the measure both flag it', () => {
    const summary = switchSummary([issue('over_budget', 's1', 'title'), issue('overflow', 's1', 'title'), issue('overflow', 's4', 'quote'), issue('dropped', 's5', 'cta')]);
    assert.equal(summary.overflow, 2);
    assert.equal(summary.dropped, 1);
    assert.equal(summary.text, '1 texto fica de fora · ≈ 2 textos não cabem');
    assert.equal(summary.tone, 'warning');
  });
});
