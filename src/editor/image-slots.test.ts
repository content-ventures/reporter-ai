import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { undo } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { TagParseRule } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import {
  articleBodyFromRun,
  articleHash,
  COVER_BLOCK_ID,
  foldRun,
  imageSlotBlock,
  paragraphBlock,
  SIMULATED_MODEL,
} from '../domain/index.ts';
import type { ArticleBody, RunEventPayload } from '../domain/index.ts';
import { articleSchema } from './extensions.ts';
import {
  coverOf,
  coverSlotOf,
  dismissImageSlotTransaction,
  figureDOMSpec,
  fillImageSlotTransaction,
  findImageSlot,
  imageSlotAt,
  imageSlotsIn,
  setCoverTransaction,
  updateFigureTransaction,
} from './figures.ts';
import { withoutForeignFigures } from './image-input.ts';
import { blockNode, docBody } from './nodes.ts';
import { articleToDoc, docToArticle, readImageSlot } from './pm-json.ts';
import { blockEntries } from './ranges.ts';
import { settleRunInEditor } from './streaming.ts';
import { articleState, REF_A, runEvents, testView } from './test-support.ts';

const schema = articleSchema();

const BODY: ArticleBody = {
  type: 'article',
  title: 'Ateliê Sul',
  coverSlot: { subject: 'Marina Lopes na fábrica', suggestedCaption: 'Marina Lopes, fundadora do Ateliê Sul', orientation: 'landscape' },
  blocks: [
    paragraphBlock('p1', 'Abertura.'),
    imageSlotBlock('s1', { subject: 'Esteira e sala de modelagem', suggestedAlt: 'Esteira', orientation: 'portrait' }, { sourceRefs: [REF_A] }),
    paragraphBlock('p2', 'Fecho.'),
  ],
};

function select(state: EditorState, blockId: string): EditorState {
  const entry = blockEntries(state.doc).find((candidate) => candidate.id === blockId);
  assert.ok(entry, blockId);
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, entry.pos)));
}

type FakeElement = { nodeName: string; getAttribute: (name: string) => string | null; querySelector: (selector: string) => FakeElement | null; textContent: string };

function element(nodeName: string, attrs: Record<string, string>, children: FakeElement[] = [], text = ''): FakeElement {
  return {
    nodeName: nodeName.toUpperCase(),
    getAttribute: (name) => attrs[name] ?? null,
    querySelector: (selector) => children.find((child) => child.nodeName === selector.toUpperCase()) ?? null,
    get textContent() {
      return text + children.map((child) => child.textContent).join('');
    },
  };
}

describe('image slots ⇄ ProseMirror', () => {
  test('a slot is a figure with its suggestion in `slot` and no asset; the cover suggestion is a document attribute', () => {
    const json = articleToDoc(BODY);
    assert.deepEqual(json.attrs, { coverSlot: BODY.coverSlot });
    assert.deepEqual(json.content?.[1].attrs, {
      blockId: 's1',
      sourceRefs: [REF_A],
      ai: null,
      assetId: null,
      alt: null,
      caption: null,
      slot: { subject: 'Esteira e sala de modelagem', suggestedAlt: 'Esteira', orientation: 'portrait' },
      credit: null,
      src: null,
      width: null,
      height: null,
    });
    const back = docToArticle(json, { title: BODY.title });
    assert.deepEqual(back, BODY);
    const state = articleState(BODY);
    assert.deepEqual(docBody(state.doc, { title: BODY.title }), BODY, 'survives the schema');
    assert.equal(articleHash(docBody(state.doc, { title: BODY.title })), articleHash(BODY));
  });

  test('a cover wins over its suggestion; an asset wins over a slot; a slot without subject is not content', () => {
    assert.equal(articleToDoc({ ...BODY, cover: { assetId: 'ast-capa' } }).attrs?.coverSlot, undefined);
    const both = docToArticle({ type: 'doc', content: [{ type: 'figure', attrs: { blockId: 'f1', assetId: 'ast-1', slot: { subject: 'X' } } }] });
    assert.deepEqual(both.blocks[0], { id: 'f1', type: 'figure', image: { assetId: 'ast-1' } });
    const empty = docToArticle({ type: 'doc', content: [{ type: 'figure', attrs: { blockId: 'f1', slot: { subject: '  ' } } }] });
    assert.deepEqual(empty.blocks, []);
    assert.deepEqual(readImageSlot({ subject: ' A  b ', orientation: 'diagonal', suggestedCaption: '' }), { subject: 'A b' });
    assert.equal(readImageSlot('Retrato'), null);
  });

  test('renders figure[data-slot][data-missing] as one line named for screen readers, the frame sized by the orientation and the subject as caption', () => {
    const spec = (slot: unknown) => figureDOMSpec({ slot }, { 'data-block-id': 's1' });
    assert.deepEqual(spec({ subject: 'Esteira' }), [
      'figure',
      {
        'data-block-id': 's1',
        'data-slot': '',
        'data-missing': '',
        'data-display': 'line',
        'aria-roledescription': 'Sugestão de imagem',
        'aria-label': 'Imagem sugerida: Esteira. Arraste uma imagem ou pressione Enter para escolher.',
      },
      ['img', { alt: '', draggable: 'false', 'data-missing': '' }],
      ['figcaption', 'Esteira'],
    ]);
    const portrait = spec({ subject: 'Retrato', orientation: 'portrait' }) as readonly unknown[];
    assert.equal((portrait[1] as Record<string, string>)['data-orientation'], 'portrait');
    assert.deepEqual(portrait[2], ['img', { alt: '', draggable: 'false', 'data-missing': '', width: '448', height: '560' }]);
    const square = spec({ subject: 'Lote', orientation: 'square' }) as readonly unknown[];
    assert.deepEqual((square[2] as [string, Record<string, string>])[1].width, '560');
  });

  test('a slot copied from this editor pastes back as a slot; a paste keeps slots', () => {
    const rule = ((schema.nodes.figure.spec.parseDOM ?? []) as TagParseRule[]).find((candidate) => candidate.tag === 'figure');
    const copied = element('figure', { 'data-slot': '', 'data-orientation': 'square' }, [element('img', { 'data-missing': '' }), element('figcaption', {}, [], 'Lote de couro')]);
    assert.deepEqual(rule?.getAttrs?.(copied as unknown as HTMLElement), { assetId: null, slot: { subject: 'Lote de couro', orientation: 'square' } });
    const slotNode = blockNode(schema, imageSlotBlock('s9', { subject: 'Lote' }));
    const slice = new Slice(Fragment.from(slotNode), 0, 0);
    assert.equal(withoutForeignFigures(slice), slice);
  });
});

describe('image slot commands', () => {
  test('lists the open slots (cover first) and the selected one', () => {
    const state = articleState(BODY);
    assert.deepEqual(
      imageSlotsIn(state.doc).map((slot) => [slot.role, slot.blockId, slot.slot.subject]),
      [
        ['cover', COVER_BLOCK_ID, 'Marina Lopes na fábrica'],
        ['figure', 's1', 'Esteira e sala de modelagem'],
      ],
    );
    assert.equal(imageSlotAt(state.selection), null);
    assert.equal(imageSlotAt(select(state, 's1').selection)?.blockId, 's1');
    assert.equal(findImageSlot(state.doc, COVER_BLOCK_ID)?.slot.subject, 'Marina Lopes na fábrica');
    assert.equal(findImageSlot(state.doc, 'p1'), null);
  });

  test('"Escolher imagem" fills the figure in one undoable step: id and evidence kept, suggestion gone', () => {
    const view = testView(articleState(BODY, { history: true }));
    const tr = fillImageSlotTransaction(view.state, 's1', { assetId: 'ast-1', alt: 'Esteira de produção', caption: 'A esteira', src: 'blob:x', credit: 'Ana' });
    assert.ok(tr);
    view.dispatch(tr);
    const body = docBody(view.state.doc, { title: BODY.title });
    assert.deepEqual(body.blocks[1], { id: 's1', type: 'figure', image: { assetId: 'ast-1', alt: 'Esteira de produção', caption: 'A esteira' }, sourceRefs: [REF_A] });
    assert.deepEqual(imageSlotsIn(view.state.doc).map((slot) => slot.blockId), [COVER_BLOCK_ID]);
    assert.equal(fillImageSlotTransaction(view.state, 's1', { assetId: 'ast-2' }), null, 'no slot there anymore');
    undo(view.state, view.dispatch);
    assert.deepEqual(docBody(view.state.doc, { title: BODY.title }), BODY, '⌘Z brings the suggestion back');
  });

  test('the cover suggestion becomes the cover; setting a cover answers it', () => {
    const view = testView(articleState(BODY, { history: true }));
    const tr = fillImageSlotTransaction(view.state, COVER_BLOCK_ID, { assetId: 'ast-capa', caption: 'Fachada' });
    assert.ok(tr);
    view.dispatch(tr);
    assert.deepEqual([coverOf(view.state.doc), coverSlotOf(view.state.doc)], [{ assetId: 'ast-capa', caption: 'Fachada' }, null]);
    assert.equal(docBody(view.state.doc).coverSlot, undefined);
    const direct = setCoverTransaction(articleState(BODY), { assetId: 'ast-capa' });
    assert.ok(direct);
    assert.equal(direct.doc.attrs.coverSlot, null);
  });

  test('"Dispensar" removes the slot or the cover suggestion, one undoable step each', () => {
    const view = testView(articleState(BODY, { history: true }));
    const figure = dismissImageSlotTransaction(view.state, 's1');
    assert.ok(figure);
    view.dispatch(figure);
    assert.deepEqual(docBody(view.state.doc).blocks.map((block) => block.id), ['p1', 'p2']);
    const cover = dismissImageSlotTransaction(view.state, COVER_BLOCK_ID);
    assert.ok(cover);
    view.dispatch(cover);
    assert.equal(docBody(view.state.doc).coverSlot, undefined);
    assert.equal(dismissImageSlotTransaction(view.state, 'p1'), null);
    undo(view.state, view.dispatch);
    assert.deepEqual(docBody(view.state.doc).coverSlot, BODY.coverSlot);
  });

  test('giving a slot an asset through the image toolbar ("Trocar imagem") fills it too', () => {
    const state = articleState(BODY);
    const tr = updateFigureTransaction(state, 's1', { assetId: 'ast-1' });
    assert.ok(tr);
    const body = docBody(state.apply(tr).doc);
    assert.deepEqual(body.blocks[1], { id: 's1', type: 'figure', image: { assetId: 'ast-1' }, sourceRefs: [REF_A] });
  });
});

describe('image slots while a generation streams', () => {
  test('the outline cover suggestion lands once, slots arrive whole, the draft equals "v1 · IA"', () => {
    const slot = imageSlotBlock('g2', { subject: 'Esteira' }, { sourceRefs: [REF_A] });
    const payloads: RunEventPayload[] = [
      {
        type: 'run.started',
        kind: 'article.generate',
        productionId: 'prod-1',
        pieceId: 'piece-1',
        prompt: { key: 'article.draft', version: '1', hash: 'h' },
        model: SIMULATED_MODEL,
        inputs: [],
        steps: [{ id: 'intro', label: 'Introdução' }],
        createdBy: 'joao',
      },
      { type: 'outline', title: 'Ateliê Sul', sections: [], cover: { subject: 'Marina Lopes na fábrica' } },
      { type: 'block.started', block: { id: 'g1', type: 'paragraph' } },
      { type: 'text.delta', blockId: 'g1', delta: 'Abertura.' },
      { type: 'block.completed', block: paragraphBlock('g1', 'Abertura.', { ai: 'unreviewed' }) },
      { type: 'block.completed', block: slot },
      { type: 'run.completed' },
    ];
    const fold = foldRun(runEvents('run-1', payloads));
    assert.ok(fold);
    const view = testView(articleState({ blocks: [] }));
    settleRunInEditor(view, fold, { mode: 'replace' });
    const draft = docBody(view.state.doc, { title: 'Ateliê Sul' });
    assert.deepEqual(draft.coverSlot, { subject: 'Marina Lopes na fábrica' });
    assert.deepEqual(draft.blocks[1], slot);
    assert.equal(articleHash(draft), articleHash(articleBodyFromRun(fold)));
    const covered = testView(articleState({ blocks: [], cover: { assetId: 'ast-capa' } }));
    settleRunInEditor(covered, fold, { mode: 'replace' });
    assert.equal(docBody(covered.state.doc).coverSlot, undefined, 'a text with a cover keeps it, without a suggestion');
    const older = { blocks: [paragraphBlock('x1', 'Versão anterior.')], coverSlot: { subject: 'Sugestão antiga' } };
    const regenerated = testView(articleState(older));
    settleRunInEditor(regenerated, fold, { mode: 'replace' });
    assert.deepEqual(docBody(regenerated.state.doc).coverSlot, { subject: 'Marina Lopes na fábrica' }, '"Gerar nova versão" brings its own suggestion');
    const appended = testView(articleState(older));
    settleRunInEditor(appended, fold, { mode: 'append' });
    assert.deepEqual(docBody(appended.state.doc).coverSlot, { subject: 'Sugestão antiga' }, 'appending never replaces a suggestion in place');
  });
});
