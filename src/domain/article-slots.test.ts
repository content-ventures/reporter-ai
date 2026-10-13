import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  articleHash,
  articleImages,
  articleStats,
  COVER_BLOCK_ID,
  figureBlock,
  headingBlock,
  imageSlotBlock,
  isImageSlot,
  normalizeArticle,
  paragraphBlock,
  setCover,
} from './article.ts';
import type { ArticleBody } from './article.ts';
import {
  articleImageSlots,
  dismissImageSlot,
  fillImageSlot,
  imageSlotBlockIds,
  imageSlotDefaults,
  imageSlotText,
  withoutImageSlots,
} from './article-slots.ts';
import { assetLookupOf } from './asset.ts';
import type { ImageAsset } from './asset.ts';
import { ARTICLE_CHECKS, readiness, runChecks } from './checks.ts';
import type { ArticleCheckContext } from './checks.ts';
import { diffArticles } from './diff.ts';
import { exportImageFiles, manifestImageSuggestions } from './manifest.ts';
import { segmentRef } from './refs.ts';
import { articleBodyFromRun, foldRun, stampRunEvent } from './run-events.ts';
import { SIMULATED_MODEL } from './run.ts';
import type { RunEventPayload } from './run-events.ts';

const REF = segmentRef('src-1', 1, 'seg-2', { from: 0, to: 20 });

const SLOTTED: ArticleBody = {
  type: 'article',
  title: 'Lume na Europa',
  coverSlot: { subject: 'Renata Vidal com peças da coleção', suggestedCaption: 'Renata Vidal, fundadora da Lume', orientation: 'landscape' },
  blocks: [
    paragraphBlock('p1', 'A Lume chegou à Europa por uma loja de museu em Lisboa.', { ai: 'unreviewed' }),
    imageSlotBlock('s1', { subject: '  Peças da coleção   inspirada em azulejos ', suggestedAlt: 'Bijuterias', orientation: 'portrait' }, { sourceRefs: [REF] }),
    headingBlock('h1', 'Laudo e frete'),
    paragraphBlock('p2', 'Os pedidos seguem juntos uma vez por mês.'),
    imageSlotBlock('s2', { subject: 'Embarque mensal' }),
  ],
};

const asset = (id: string): ImageAsset => ({
  id,
  workspaceId: 'ws',
  kind: 'image',
  origin: { type: 'upload', fileName: `${id}.jpg` },
  mime: 'image/jpeg',
  credit: 'Ana Prado',
  rights: { authorized: true },
  createdAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'p-joao',
});

function context(body: ArticleBody): ArticleCheckContext {
  return {
    body,
    brief: { sections: 2, size: 'short', revision: 1 },
    sources: [],
    generation: { running: false, interrupted: false },
    assets: assetLookupOf([asset('ast-1'), asset('ast-capa')]),
  };
}

describe('image slots in the article', () => {
  test('a slot is a figure without an image: normalised, no text, no image use, no review flag', () => {
    const slot = SLOTTED.blocks[1];
    assert.ok(isImageSlot(slot));
    assert.deepEqual(slot, {
      id: 's1',
      type: 'figure',
      slot: { subject: 'Peças da coleção inspirada em azulejos', suggestedAlt: 'Bijuterias', orientation: 'portrait' },
      sourceRefs: [REF],
    });
    assert.equal(isImageSlot(figureBlock('f1', { assetId: 'ast-1' })), false);
    assert.deepEqual(articleImages(SLOTTED), [], 'slots are not images yet');
    const text = { ...SLOTTED, blocks: SLOTTED.blocks.filter((block) => !isImageSlot(block)) };
    assert.equal(articleStats(SLOTTED).words, articleStats(text).words, 'word count ignores slots');
  });

  test('lists open slots in reading order, the cover suggestion first (only while there is no cover)', () => {
    assert.deepEqual(
      articleImageSlots(SLOTTED).map((use) => [use.role, use.blockId, use.slot.subject, use.sourceRefs?.length ?? 0]),
      [
        ['cover', COVER_BLOCK_ID, 'Renata Vidal com peças da coleção', 0],
        ['figure', 's1', 'Peças da coleção inspirada em azulejos', 1],
        ['figure', 's2', 'Embarque mensal', 0],
      ],
    );
    assert.deepEqual(imageSlotBlockIds(SLOTTED), ['s1', 's2']);
    const covered = setCover(SLOTTED, { assetId: 'ast-capa' });
    assert.equal(covered.coverSlot, undefined, 'a cover answers its suggestion');
    assert.deepEqual(articleImageSlots({ ...SLOTTED, cover: { assetId: 'ast-capa' } }).map((use) => use.role), ['figure', 'figure']);
    assert.equal(normalizeArticle({ ...SLOTTED, cover: { assetId: 'ast-capa' } }).coverSlot, undefined);
  });

  test('"Escolher imagem": the figure keeps its id and evidence; the cover suggestion becomes the cover', () => {
    const filled = fillImageSlot(SLOTTED, 's1', { assetId: 'ast-1', caption: ' Coleção azulejo ', alt: 'Pulseiras' });
    assert.ok(filled.ok);
    assert.deepEqual(filled.value.blocks[1], { id: 's1', type: 'figure', image: { assetId: 'ast-1', alt: 'Pulseiras', caption: 'Coleção azulejo' }, sourceRefs: [REF] });
    assert.deepEqual(articleImages(filled.value).map((use) => use.blockId), ['s1']);
    const cover = fillImageSlot(SLOTTED, COVER_BLOCK_ID, { assetId: 'ast-capa' });
    assert.ok(cover.ok);
    assert.deepEqual([cover.value.cover, cover.value.coverSlot], [{ assetId: 'ast-capa' }, undefined]);
    const gone = fillImageSlot(SLOTTED, 'p1', { assetId: 'ast-1' });
    assert.equal(!gone.ok && gone.refusal.code, 'unknown_slot');
    assert.equal(fillImageSlot(filled.value, 's1', { assetId: 'ast-2' }).ok, false, 'a filled slot is a figure now');
    assert.equal(fillImageSlot(cover.value, COVER_BLOCK_ID, { assetId: 'ast-2' }).ok, false);
  });

  test('"Dispensar" removes the slot (or the cover suggestion); the publishable body has none', () => {
    const dismissed = dismissImageSlot(SLOTTED, 's2');
    assert.ok(dismissed.ok);
    assert.deepEqual(dismissed.value.blocks.map((block) => block.id), ['p1', 's1', 'h1', 'p2']);
    const noCover = dismissImageSlot(SLOTTED, COVER_BLOCK_ID);
    assert.ok(noCover.ok && noCover.value.coverSlot === undefined);
    assert.equal(dismissImageSlot(SLOTTED, 'p1').ok, false);
    const publishable = withoutImageSlots(SLOTTED);
    assert.deepEqual(publishable.blocks.map((block) => block.id), ['p1', 'h1', 'p2']);
    assert.equal('coverSlot' in publishable, false);
  });

  test('defaults for the form come from the suggestion; the comparison reads "[Sugestão de imagem] …"', () => {
    assert.deepEqual(imageSlotDefaults({ subject: 'X', suggestedCaption: ' Legenda ', suggestedAlt: 'Alt' }), { caption: 'Legenda', alt: 'Alt' });
    assert.deepEqual(imageSlotDefaults({ subject: 'X' }), {});
    assert.equal(imageSlotText({ subject: 'Retrato de Marina Lopes' }), '[Sugestão de imagem] Retrato de Marina Lopes');
  });

  test('slots enter the hash (filling or dismissing one is a change); bodies without slots keep theirs', () => {
    const plain: ArticleBody = { type: 'article', title: 'T', blocks: [paragraphBlock('p1', 'Texto.')] };
    assert.equal(articleHash({ ...plain, coverSlot: undefined }), articleHash(plain));
    assert.notEqual(articleHash({ ...plain, coverSlot: { subject: 'Capa' } }), articleHash(plain));
    const dismissed = dismissImageSlot(SLOTTED, 's2');
    assert.ok(dismissed.ok);
    assert.notEqual(articleHash(dismissed.value), articleHash(SLOTTED));
    const respaced = structuredClone(SLOTTED);
    respaced.blocks[4] = { id: 's2', type: 'figure', slot: { subject: ' Embarque   mensal ' } };
    assert.equal(articleHash(respaced), articleHash(SLOTTED), 'whitespace is normalised');
    const reviewed = structuredClone(SLOTTED);
    reviewed.blocks[1] = { ...reviewed.blocks[1], sourceRefs: [] };
    assert.equal(articleHash(reviewed), articleHash(SLOTTED), 'evidence is provenance');
  });
});

describe('checks with image slots', () => {
  test('"Imagens sugeridas" warns with a jump per open slot and never blocks; the cover stays optional (D04)', () => {
    const results = runChecks(ARTICLE_CHECKS, context(SLOTTED));
    const slots = results.find((result) => result.id === 'article.image-slots');
    assert.deepEqual([slots?.label, slots?.status, slots?.detail, slots?.blocking], ['Imagens sugeridas', 'warn', '2 a preencher', false]);
    assert.deepEqual(slots?.targets?.map((target) => target.blockId), ['s1', 's2']);
    const cover = results.find((result) => result.id === 'article.cover');
    assert.deepEqual([cover?.status, cover?.detail], ['info', 'Sem capa · 1 sugestão']);
    assert.equal(results.find((result) => result.id === 'article.image-alt')?.status, 'na', 'slots are not images without alt text');
    assert.equal(results.find((result) => result.id === 'article.image-credits')?.status, 'na');
    assert.equal(readiness(results).ready, true);
  });

  test('without slots the check is not applicable', () => {
    const publishable = withoutImageSlots(SLOTTED);
    const slots = runChecks(ARTICLE_CHECKS, context(publishable)).find((result) => result.id === 'article.image-slots');
    assert.equal(slots?.status, 'na');
    const filled = fillImageSlot(SLOTTED, 's1', { assetId: 'ast-1', alt: 'Pulseiras' });
    assert.ok(filled.ok);
    const after = runChecks(ARTICLE_CHECKS, context(filled.value));
    assert.equal(after.find((result) => result.id === 'article.image-slots')?.detail, '1 a preencher');
    assert.equal(after.find((result) => result.id === 'article.image-alt')?.status, 'pass');
  });
});

describe('comparison with image slots', () => {
  test('a filled slot reads as a new image (with the suggestion it answered); dismissed and new slots read as such', () => {
    const filled = fillImageSlot(SLOTTED, 's1', { assetId: 'ast-1', caption: 'Coleção' });
    assert.ok(filled.ok);
    const covered = setCover(filled.value, { assetId: 'ast-capa', caption: 'Vitrine' });
    const dismissed = dismissImageSlot(covered, 's2');
    assert.ok(dismissed.ok);
    const assets = assetLookupOf([asset('ast-1'), asset('ast-capa')]);
    const blocks = diffArticles(SLOTTED, dismissed.value, { assets });
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const s1 = byId.get('s1');
    assert.deepEqual([s1?.change, s1?.hunks, s1?.image?.assetId, s1?.previousSlot?.subject], [
      'added',
      [{ kind: 'insert', text: '[Imagem] Coleção — Foto: Ana Prado' }],
      'ast-1',
      'Peças da coleção inspirada em azulejos',
    ]);
    const cover = byId.get(COVER_BLOCK_ID);
    assert.deepEqual([cover?.change, cover?.image?.assetId, cover?.previousSlot?.subject], ['added', 'ast-capa', 'Renata Vidal com peças da coleção']);
    const s2 = byId.get('s2');
    assert.deepEqual([s2?.change, s2?.hunks, s2?.slot?.subject], ['removed', [{ kind: 'delete', text: '[Sugestão de imagem] Embarque mensal' }], 'Embarque mensal']);
    const fresh = diffArticles(withoutImageSlots(SLOTTED), SLOTTED);
    assert.deepEqual(
      fresh.filter((block) => block.change === 'added').map((block) => [block.id, block.hunks[0]?.text]),
      [
        [COVER_BLOCK_ID, '[Sugestão de imagem de destaque] Renata Vidal com peças da coleção'],
        ['s1', '[Sugestão de imagem] Peças da coleção inspirada em azulejos'],
        ['s2', '[Sugestão de imagem] Embarque mensal'],
      ],
    );
    assert.ok(diffArticles(SLOTTED, structuredClone(SLOTTED)).every((block) => block.change === 'unchanged'));
    const restored = diffArticles(covered, SLOTTED, { assets });
    const back = new Map(restored.map((block) => [block.id, block]));
    assert.deepEqual([back.get('s1')?.change, back.get('s1')?.image?.assetId, back.get('s1')?.slot?.subject], ['removed', 'ast-1', 'Peças da coleção inspirada em azulejos'], 'back to a suggestion: the image left');
    assert.deepEqual([back.get(COVER_BLOCK_ID)?.change, back.get(COVER_BLOCK_ID)?.image?.assetId], ['removed', 'ast-capa']);
  });
});

describe('export with image slots', () => {
  test('slots never become files; the manifest lists them as suggestions with their place', () => {
    assert.deepEqual(exportImageFiles(SLOTTED, 'ver-1'), []);
    assert.deepEqual(manifestImageSuggestions(SLOTTED, 'ver-1'), [
      { versionId: 'ver-1', role: 'cover', blockId: COVER_BLOCK_ID, subject: 'Renata Vidal com peças da coleção', suggestedCaption: 'Renata Vidal, fundadora da Lume', orientation: 'landscape' },
      { versionId: 'ver-1', role: 'figure', blockId: 's1', afterBlockId: 'p1', subject: 'Peças da coleção inspirada em azulejos', suggestedAlt: 'Bijuterias', orientation: 'portrait' },
      { versionId: 'ver-1', role: 'figure', blockId: 's2', afterBlockId: 'p2', subject: 'Embarque mensal' },
    ]);
    assert.deepEqual(manifestImageSuggestions(withoutImageSlots(SLOTTED), 'ver-1'), []);
  });
});

describe('run stream with image slots', () => {
  test('the outline carries the cover suggestion into the output; a slot arrives whole and never as a partial', () => {
    const payloads: RunEventPayload[] = [
      {
        type: 'run.started',
        kind: 'article.generate',
        productionId: 'prod-1',
        prompt: { key: 'article.generate', version: '1', hash: 'h' },
        model: SIMULATED_MODEL,
        inputs: [],
        steps: [{ id: 'outline', label: 'Montando estrutura' }],
        createdBy: 'p-joao',
      },
      { type: 'outline', title: 'Lume', sections: [], cover: { subject: 'Retrato de Renata Vidal' } },
      { type: 'block.completed', block: paragraphBlock('p1', 'Texto.', { ai: 'unreviewed' }) },
      { type: 'block.completed', block: imageSlotBlock('s1', { subject: 'Peças' }) },
      { type: 'block.started', block: { id: 's2', type: 'figure' } },
      { type: 'run.cancelled' },
    ];
    const fold = foldRun(payloads.map((payload, index) => stampRunEvent(payload, 'run-1', index + 1, `2026-10-07T12:00:0${index}.000Z`)));
    assert.ok(fold);
    assert.deepEqual(fold.coverSlot, { subject: 'Retrato de Renata Vidal' });
    const body = articleBodyFromRun(fold, { includePartial: true });
    assert.deepEqual(body.coverSlot, { subject: 'Retrato de Renata Vidal' });
    assert.deepEqual(body.blocks.map((block) => block.id), ['p1', 's1'], 'an unfinished slot is dropped');
  });
});
