import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { articleHash } from '../domain/index.ts';
import { createFixtures } from '../fixtures/index.ts';
import { articleSchema } from './extensions.ts';
import { articleDocNode, docBody } from './nodes.ts';
import { articleToDoc, blockToJSON, docToArticle, inlinesToJSON, jsonToBlock, jsonToInlines } from './pm-json.ts';
import type { PmNodeJSON } from './pm-json.ts';
import { FIGURE_BODY, REF_A, RICH_BODY } from './test-support.ts';

describe('domain ⇄ ProseMirror JSON', () => {
  test('round-trips every block type, mark, link, hard break, sourceRefs and ai state', () => {
    const json = articleToDoc(RICH_BODY);
    assert.deepEqual(docToArticle(json, { title: RICH_BODY.title }), RICH_BODY);
  });

  test('produces JSON the article schema accepts, and survives the schema round trip', () => {
    const schema = articleSchema();
    const node = schema.nodeFromJSON(articleToDoc(RICH_BODY));
    node.check();
    assert.deepEqual(docBody(node, { title: RICH_BODY.title }), RICH_BODY);
    assert.deepEqual(docToArticle(node.toJSON() as PmNodeJSON, { title: RICH_BODY.title }), RICH_BODY);
  });

  test('emits marks in schema rank order, so the JSON matches what the editor serialises', () => {
    const schema = articleSchema();
    const json = blockToJSON(RICH_BODY.blocks[0]);
    const normalized = schema.nodeFromJSON(json).toJSON() as PmNodeJSON;
    const types = (node: PmNodeJSON) => (node.content ?? []).map((child) => (child.marks ?? []).map((mark) => mark.type));
    assert.deepEqual(types(json), types(normalized));
  });

  test('maps block attributes and node types', () => {
    const [paragraph, heading, , quote, ordered, bullet, divider] = RICH_BODY.blocks.map((block) => blockToJSON(block));
    assert.deepEqual(paragraph.attrs, { blockId: 'b1', sourceRefs: [REF_A], ai: 'unreviewed' });
    assert.equal(heading.type, 'heading');
    assert.equal(heading.attrs?.level, 2);
    assert.equal(quote.type, 'blockquote');
    assert.equal(ordered.type, 'orderedList');
    assert.equal(bullet.type, 'bulletList');
    assert.equal(bullet.content?.[0].type, 'listItem');
    assert.equal(bullet.content?.[0].content?.[0].type, 'paragraph');
    assert.deepEqual(divider, { type: 'horizontalRule', attrs: { blockId: 'b7', sourceRefs: null, ai: null } });
  });

  test('a line break becomes a hard break that carries the run marks', () => {
    const nodes = inlinesToJSON([{ text: 'a\nb', marks: ['bold'] }]);
    assert.deepEqual(nodes, [
      { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
    ]);
    assert.deepEqual(jsonToInlines(nodes), [{ text: 'a\nb', marks: ['bold'] }]);
  });

  test('an empty body becomes one empty paragraph (optionally with an id)', () => {
    assert.deepEqual(articleToDoc({ blocks: [] }), { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: null, sourceRefs: null, ai: null } }] });
    assert.equal(articleToDoc({ blocks: [] }, { emptyBlockId: 'blk-x' }).content?.[0].attrs?.blockId, 'blk-x');
  });
});

describe('images ⇄ ProseMirror JSON', () => {
  test('round-trips figures and the cover (JSON and schema)', () => {
    assert.deepEqual(docToArticle(articleToDoc(FIGURE_BODY), { title: FIGURE_BODY.title }), FIGURE_BODY);
    const node = articleSchema().nodeFromJSON(articleToDoc(FIGURE_BODY));
    node.check();
    assert.deepEqual(docBody(node, { title: FIGURE_BODY.title }), FIGURE_BODY);
    assert.equal(articleHash(docBody(node, { title: FIGURE_BODY.title })), articleHash(FIGURE_BODY));
  });

  test('a figure is an atom with the ImageRef as attrs; the cover is a document attribute', () => {
    const json = articleToDoc(FIGURE_BODY);
    assert.deepEqual(json.attrs, { cover: FIGURE_BODY.cover });
    assert.deepEqual(json.content?.[1], {
      type: 'figure',
      attrs: {
        blockId: 'f1',
        sourceRefs: [REF_A],
        ai: 'unreviewed',
        assetId: 'ast-1',
        alt: 'Ana na bancada',
        caption: 'Ana Prado corta o couro',
        credit: null,
        src: null,
        width: null,
        height: null,
      },
    });
    assert.equal(articleToDoc(RICH_BODY).attrs, undefined);
  });

  test('display data fills the figures and never comes back into the body', () => {
    const sources = new Map([['ast-1', { src: 'blob:http://localhost/1', credit: 'Ana Prado', width: 1200, height: 800 }]]);
    const json = articleToDoc(FIGURE_BODY, { figureSources: sources });
    assert.equal(json.content?.[1].attrs?.src, 'blob:http://localhost/1');
    assert.equal(json.content?.[1].attrs?.credit, 'Ana Prado');
    assert.equal(json.content?.[1].attrs?.width, 1200);
    assert.equal(json.content?.[3].attrs?.src, null);
    assert.deepEqual(docToArticle(json, { title: FIGURE_BODY.title }), FIGURE_BODY);
  });

  test('a figure without an asset (pasted from another page, not adopted) is not content', () => {
    const doc: PmNodeJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: 'Texto' }] },
        { type: 'figure', attrs: { blockId: 'f9', assetId: null, src: 'https://example.com/a.jpg' } },
      ],
    };
    assert.deepEqual(docToArticle(doc, { keepEmpty: true }).blocks.map((block) => block.id), ['p1']);
  });

  test('blank alt and caption are dropped; a malformed cover is ignored', () => {
    const block = jsonToBlock({ type: 'figure', attrs: { blockId: 'f', assetId: 'ast-1', alt: '  ', caption: ' Legenda  longa ' } }, 0);
    assert.deepEqual(block, { id: 'f', type: 'figure', image: { assetId: 'ast-1', caption: 'Legenda longa' } });
    assert.equal(docToArticle({ type: 'doc', attrs: { cover: { alt: 'sem asset' } }, content: [] }).cover, undefined);
    assert.equal('cover' in docToArticle({ type: 'doc', content: [] }), false);
  });
});

describe('ProseMirror JSON → domain', () => {
  test('keeps only safe links and normalises them', () => {
    const inlines = jsonToInlines([
      { type: 'text', text: 'bom', marks: [{ type: 'link', attrs: { href: 'example.com' } }] },
      { type: 'text', text: 'ruim', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }] },
    ]);
    assert.deepEqual(inlines, [
      { text: 'bom', marks: ['link'], href: 'https://example.com/' },
      { text: 'ruim', marks: ['bold'] },
    ]);
  });

  test('drops empty textblocks unless asked to keep them (the caret paragraph is not content)', () => {
    const doc: PmNodeJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: 'Texto' }] },
        { type: 'heading', attrs: { blockId: 'h1', level: 2 } },
        { type: 'paragraph', attrs: { blockId: 'p2' } },
      ],
    };
    assert.deepEqual(docToArticle(doc).blocks.map((block) => block.id), ['p1']);
    assert.deepEqual(docToArticle(doc, { keepEmpty: true }).blocks.map((block) => block.id), ['p1', 'h1', 'p2']);
  });

  test('a draft equal to v1 plus a trailing caret paragraph hashes like v1', () => {
    const json = articleToDoc(RICH_BODY);
    json.content?.push({ type: 'paragraph', attrs: { blockId: 'trailing', sourceRefs: null, ai: null } });
    assert.equal(articleHash(docToArticle(json, { title: RICH_BODY.title })), articleHash(RICH_BODY));
  });

  test('clamps heading levels, flattens legacy wrappers and falls back to text for unknown nodes', () => {
    assert.deepEqual(jsonToBlock({ type: 'heading', attrs: { blockId: 'h', level: 1 }, content: [{ type: 'text', text: 'T' }] }, 0), {
      id: 'h',
      type: 'heading',
      level: 2,
      inlines: [{ text: 'T' }],
    });
    assert.equal((jsonToBlock({ type: 'heading', attrs: { blockId: 'h', level: 5 }, content: [{ type: 'text', text: 'T' }] }, 0) as { level: number }).level, 3);
    const legacyQuote = jsonToBlock(
      {
        type: 'blockquote',
        attrs: { blockId: 'q' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'um' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'dois' }] },
        ],
      },
      0,
    );
    assert.deepEqual(legacyQuote, { id: 'q', type: 'quote', inlines: [{ text: 'um\ndois' }] });
    const codeBlock = jsonToBlock({ type: 'codeBlock', attrs: { blockId: 'c' }, content: [{ type: 'text', text: 'x = 1' }] }, 0);
    assert.deepEqual(codeBlock, { id: 'c', type: 'paragraph', inlines: [{ text: 'x = 1' }] });
  });

  test('flattens list items with several paragraphs or nested lists into lines', () => {
    const list = jsonToBlock(
      {
        type: 'bulletList',
        attrs: { blockId: 'l' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph' }] },
        ],
      },
      0,
    );
    assert.deepEqual(list, { id: 'l', type: 'list', ordered: false, items: [[{ text: 'a\nb' }], []] });
  });

  test('ignores malformed block attributes and fills a missing id', () => {
    const block = jsonToBlock({ type: 'paragraph', attrs: { sourceRefs: [], ai: 'maybe' }, content: [{ type: 'text', text: 'x' }] }, 4, { fallbackId: (index) => `tmp-${index}` });
    assert.deepEqual(block, { id: 'tmp-4', type: 'paragraph', inlines: [{ text: 'x' }] });
  });
});

describe('fixtures', () => {
  test('every article version and draft in the fixtures round-trips exactly', () => {
    const fixtures = createFixtures({ now: '2026-10-07T12:00:00.000Z' });
    const schema = articleSchema();
    let checked = 0;
    for (const record of fixtures.records) {
      const bodies = [...record.versions.map((version) => version.body), ...record.pieces.map((piece) => piece.draft.body)];
      for (const body of bodies) {
        if (body.type !== 'article') continue;
        const node = articleDocNode(schema, body);
        node.check();
        assert.deepEqual(docBody(node, { title: body.title }), body);
        checked += 1;
      }
    }
    assert.ok(checked > 5, `expected several article bodies, got ${checked}`);
  });
});
