import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageSlotBlock, paragraphBlock } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { toVersionRef } from '../../../domain/piece.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { addCarouselPiece, baseRecord, commitVersion, createKit, recordDecision, sampleArticle, sampleCarousel } from '../../../domain/testing/scenario.ts';
import type { RenderService } from '../../../ports/render.ts';
import { articleToHtml } from './html.ts';
import { createLocalExportService } from './local-export.ts';
import { articleToMarkdown } from './markdown.ts';

const SLOTTED: ArticleBody = {
  type: 'article',
  title: 'Ateliê Sul',
  coverSlot: { subject: 'Marina Lopes na fábrica' },
  blocks: [paragraphBlock('p1', 'Abertura.'), imageSlotBlock('s1', { subject: 'Esteira da fábrica', orientation: 'landscape' }), paragraphBlock('p2', 'Fecho.')],
};

/** Article-only packages never render slides: a service that only reports its capabilities. */
const NO_RENDER = { capabilities: () => ({ raster: false, reason: 'Sem canvas.' }) } as unknown as RenderService;

describe('export · image slots', () => {
  it('the .md and the .html leave open slots and the cover suggestion out', () => {
    assert.equal(articleToMarkdown(SLOTTED), '# Ateliê Sul\n\nAbertura.\n\nFecho.\n');
    const html = articleToHtml(SLOTTED, { versionLabel: 'v1', hash: 'h' });
    assert.ok(html.includes('<p>Abertura.</p>\n<p>Fecho.</p>'));
    assert.ok(!/figure|Sugestão|Esteira|Marina/.test(html));
  });

  it('an approved version with open slots exports; the manifest lists them as suggestions, never as files', async () => {
    const kit = createKit();
    const record: ProductionRecord = baseRecord(kit);
    const base = sampleArticle(record.sources[0]);
    const body: ArticleBody = { ...base, coverSlot: SLOTTED.coverSlot, blocks: [base.blocks[0], imageSlotBlock('slot-1', { subject: 'Esteira da fábrica' }), ...base.blocks.slice(1)] };
    const article = commitVersion(record, kit, 'article', body, { origin: 'generation' });
    recordDecision(record, kit, article, 'approved');
    addCarouselPiece(record, kit);
    const carousel = commitVersion(record, kit, 'carousel', sampleCarousel(), { origin: 'generation', inputs: [toVersionRef(article)] });
    recordDecision(record, kit, carousel, 'approved');
    const exports = createLocalExportService({ clock: { now: () => kit.now() }, getRecord: () => record, render: NO_RENDER });
    const built = await exports.build({ productionId: record.production.id });
    assert.ok(built.ok, built.ok ? '' : built.refusal.message);
    assert.equal(built.value.status, 'completed', 'slots never block the package');
    assert.ok(!built.value.files.some((file) => file.kind === 'image'));
    const manifest = JSON.parse(built.value.files.find((file) => file.fileName === 'manifesto.json')?.text ?? '{}');
    assert.deepEqual(manifest.imageSuggestions, [
      { versionId: article.id, role: 'cover', blockId: 'cover', subject: 'Marina Lopes na fábrica' },
      { versionId: article.id, role: 'figure', blockId: 'slot-1', afterBlockId: base.blocks[0].id, subject: 'Esteira da fábrica' },
    ]);
    const md = built.value.files.find((file) => file.format === 'md')?.text ?? '';
    assert.ok(md.length > 0 && !md.includes('Esteira'));
  });
});
