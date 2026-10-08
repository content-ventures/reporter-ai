import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assetLookupOf, diffArticles, formatLaudasOf } from '../../domain/index.ts';
import type { ArticleBody, CheckResult, DiffBlock, ImageAsset } from '../../domain/index.ts';
import type { ApprovalDecisionView, ApprovalRequestView, PersonSummary, VersionView } from '../../ports/index.ts';
import {
  addAnchors,
  anchorsFromRanges,
  anchorsLabel,
  approveLabel,
  approveTitle,
  changedCount,
  changedSummary,
  checksSummary,
  decisionFactList,
  decisionFacts,
  finalLabel,
  hasAiText,
  historyEvents,
  imageCaption,
  imageChanges,
  originBody,
  resolveMode,
  returnDescription,
  shortExcerpt,
  toReviewDiff,
} from './review-model.ts';

const body: ArticleBody = {
  type: 'article',
  title: 'Couro vegetal na Francal',
  blocks: [
    { id: 'b1', type: 'paragraph', inlines: [{ text: 'A marca apostou no couro vegetal em 2026.' }] },
    { id: 'b2', type: 'heading', level: 2, inlines: [{ text: 'O que mudou' }] },
    { id: 'b3', type: 'quote', inlines: [{ text: 'Foi a melhor decisão que tomamos.' }] },
  ],
};

function version(partial: Partial<VersionView> & Pick<VersionView, 'id' | 'number'>): VersionView {
  return {
    ref: { kind: 'version', pieceId: 'piece-1', versionId: partial.id, number: partial.number, hash: `h${partial.number}` },
    label: `v${partial.number}`,
    origin: 'edit',
    createdAt: '2026-10-07T10:00:00.000Z',
    createdBy: 'person-joao',
    interrupted: false,
    words: 100,
    characters: 600,
    inputs: [],
    isLatest: false,
    isCurrentApproved: false,
    ...partial,
  };
}

describe('the view of the review', () => {
  it('opens the review default when there was a previous send, unless the URL asks otherwise', () => {
    assert.equal(resolveMode(undefined, { hasPrevious: true, defaultView: 'changes' }), 'changes');
    assert.equal(resolveMode(null, { hasPrevious: true, defaultView: 'final' }), 'final');
    assert.equal(resolveMode('final', { hasPrevious: true, defaultView: 'changes' }), 'final');
    assert.equal(resolveMode('changes', { hasPrevious: true, defaultView: 'final' }), 'changes');
    assert.equal(resolveMode('qualquer', { hasPrevious: true, defaultView: 'changes' }), 'changes');
  });

  it('is the final text when there is nothing to compare', () => {
    assert.equal(resolveMode('changes', { hasPrevious: false, defaultView: 'changes' }), 'final');
    assert.equal(resolveMode(undefined, { hasPrevious: false, defaultView: 'final' }), 'final');
  });

  it('names the final view by the piece and counts what changed since the previous send', () => {
    assert.equal(finalLabel('article'), 'Texto final');
    assert.equal(finalLabel('carousel'), 'Slides');
    assert.equal(changedSummary(0), 'Nada mudou desde o envio anterior.');
    assert.equal(changedSummary(1), '1 trecho mudou desde o envio anterior');
    assert.equal(changedSummary(3), '3 trechos mudaram desde o envio anterior');
  });
});

describe('checksSummary', () => {
  const check = (id: string, label: string, status: CheckResult['status'], extra: Partial<CheckResult> = {}): CheckResult =>
    ({ id, label, status, blocking: false, ...extra }) as CheckResult;
  const range = (blockId: string) => ({ blockId, from: 0, to: 1 });

  it('says everything is checked when nothing is missing or in warning', () => {
    assert.deepEqual(checksSummary({ kind: 'article', checks: [check('article.title', 'Título', 'pass')] }), { level: 'ok', text: 'Tudo conferido' });
    assert.deepEqual(checksSummary({ kind: 'carousel', checks: [check('carousel.limits', 'Limites de texto', 'pass')] }), { level: 'ok', text: 'Tudo conferido' });
  });

  it('names what is missing first and the warnings otherwise (article)', () => {
    const quotes = check('article.quotes', 'Citações', 'warn', { progress: { current: 2, total: 3 } });
    const slots = check('article.image-slots', 'Imagens sugeridas', 'warn', { targets: [range('b1'), range('b2')] });
    assert.deepEqual(checksSummary({ kind: 'article', checks: [slots, quotes] }), { level: 'missing', text: 'Falta: 1 citação não confere com a entrevista' });
    assert.deepEqual(checksSummary({ kind: 'article', checks: [slots] }), { level: 'warning', text: 'Aviso: 2 imagens sugeridas sem arquivo' });
  });

  it('names the checks of a carousel as phrases', () => {
    const limits = check('carousel.limits', 'Limites de texto', 'fail', { detail: '1 slide passa do limite' });
    assert.deepEqual(checksSummary({ kind: 'carousel', checks: [limits] }), { level: 'missing', text: 'Falta: Limites de texto: 1 slide passa do limite' });
    assert.deepEqual(checksSummary({ kind: 'carousel', checks: [{ ...limits, status: 'warn' }] }), { level: 'warning', text: 'Aviso: Limites de texto: 1 slide passa do limite' });
  });
});

describe('the decision bar and its dialogs', () => {
  it('names the verbs by the piece', () => {
    assert.equal(approveLabel('article'), 'Aprovar artigo');
    assert.equal(approveLabel('carousel'), 'Aprovar carrossel');
    assert.equal(approveTitle('article'), 'Aprovar o artigo');
    assert.equal(approveTitle('carousel'), 'Aprovar o carrossel');
  });

  it('reads the facts of the piece and who sent it, without a version number', () => {
    assert.deepEqual(decisionFactList({ kind: 'article', characters: 2400, size: 'standard', requesterName: 'Juliana Prates' }), [
      'Artigo',
      formatLaudasOf(2400, 'standard'),
      'enviado por Juliana',
    ]);
    assert.equal(decisionFacts({ kind: 'article', characters: 2400, size: 'standard', requesterName: 'Juliana Prates' }), `Artigo · ${formatLaudasOf(2400, 'standard')} · enviado por Juliana`);
    assert.equal(decisionFacts({ kind: 'carousel', slides: 5, requesterName: 'Rafael' }), 'Carrossel · 5 slides · enviado por Rafael');
    assert.equal(decisionFacts({ kind: 'carousel', slides: 1 }), 'Carrossel · 1 slide');
  });

  it('tells who receives the note', () => {
    assert.equal(returnDescription('Juliana Prates'), 'Juliana recebe a nota e os trechos apontados.');
    assert.equal(returnDescription(null), 'Quem enviou recebe a nota e os trechos apontados.');
  });
});

describe('toReviewDiff', () => {
  it('maps block types to reading typography and drops dividers', () => {
    const blocks: DiffBlock[] = [
      { id: 'title', change: 'modified', hunks: [{ kind: 'delete', text: 'A' }, { kind: 'insert', text: 'B' }], blockType: 'title' },
      { id: 'h', change: 'unchanged', hunks: [{ kind: 'equal', text: 'Seção' }], blockType: 'heading', level: 3 },
      { id: 'd', change: 'added', hunks: [], blockType: 'divider' },
      { id: 'l', change: 'added', hunks: [{ kind: 'insert', text: 'um\ndois' }], blockType: 'list' },
    ];
    assert.deepEqual(
      toReviewDiff(blocks).map((block) => [block.id, block.type]),
      [
        ['title', 'title'],
        ['h', 'h3'],
        ['l', 'item'],
      ],
    );
    assert.equal(changedCount(toReviewDiff(blocks)), 2);
  });
});

describe('images in the comparison', () => {
  const asset = (id: string, credit?: string): ImageAsset => ({
    id,
    workspaceId: 'ws',
    kind: 'image',
    origin: { type: 'upload', fileName: `${id}.jpg` },
    ...(credit ? { credit } : {}),
    rights: { authorized: true },
    createdAt: '2026-10-07T10:00:00.000Z',
    createdBy: 'person-joao',
  });
  const assets = assetLookupOf([asset('img-a', 'Ana Prado'), asset('img-b', 'Ilustração: Leo'), asset('img-x'), asset('img-y', 'Rui')]);
  const paragraph = { id: 'p1', type: 'paragraph' as const, inlines: [{ text: 'A feira abriu cedo.' }] };
  const before: ArticleBody = {
    type: 'article',
    title: 'Feira',
    cover: { assetId: 'img-a', alt: 'Praça cheia', caption: 'Abertura da feira' },
    blocks: [
      paragraph,
      { id: 'f1', type: 'figure', image: { assetId: 'img-x', caption: 'Estande' } },
      { id: 'f2', type: 'figure', image: { assetId: 'img-y', alt: 'Sapato' } },
      { id: 'f3', type: 'figure', image: { assetId: 'img-x', caption: 'Saída' } },
    ],
  };
  const after: ArticleBody = {
    ...before,
    cover: { assetId: 'img-b', alt: 'Desenho da praça', caption: 'Abertura da feira' },
    blocks: [
      paragraph,
      { id: 'f1', type: 'figure', image: { assetId: 'img-x', caption: 'Estande principal' } },
      { id: 'f2', type: 'figure', image: { assetId: 'img-y', alt: 'Sapato de couro vegetal' } },
      { id: 'f4', type: 'figure', image: { assetId: 'img-a', caption: 'Fila na entrada' } },
    ],
  };
  const diff = diffArticles(before, after, { assets });

  it('reads the cover and figures as captions in the DS diff', () => {
    const blocks = toReviewDiff(diff);
    const cover = blocks.find((block) => block.id === 'cover');
    assert.equal(cover?.type, 'caption');
    assert.equal(blocks.find((block) => block.id === 'f1')?.type, 'caption');
    assert.ok(blocks.some((block) => block.hunks.some((hunk) => hunk.kind === 'insert' && hunk.text.includes('Fila na entrada'))));
  });

  it('names each image change: swapped cover, caption, alt text, removed and new figures', () => {
    const changes = imageChanges(diff);
    assert.deepEqual(
      changes.map((change) => [change.id, change.role, change.kind]),
      [
        ['cover', 'cover', 'swapped'],
        ['f1', 'figure', 'caption'],
        ['f2', 'figure', 'alt'],
        ['f3', 'figure', 'removed'],
        ['f4', 'figure', 'added'],
      ],
    );
    assert.equal(changes[0]?.previous?.assetId, 'img-a');
    assert.equal(changes[0]?.image.assetId, 'img-b');
    assert.equal(changes[3]?.image.caption, 'Saída');
  });

  it('ignores unchanged images and text blocks', () => {
    assert.deepEqual(imageChanges(diffArticles(before, before, { assets })), []);
  });

  it('writes the caption line with the credit kind', () => {
    assert.equal(imageCaption('Abertura da feira', 'Ana Prado'), 'Abertura da feira — Foto: Ana Prado');
    assert.equal(imageCaption(undefined, 'Ilustração: Leo'), 'Ilustração: Leo');
    assert.equal(imageCaption('  Só legenda ', undefined), 'Só legenda');
    assert.equal(imageCaption(' ', ' '), undefined);
  });
});

describe('anchors', () => {
  it('keeps the exact excerpt of each selected range', () => {
    const [anchor] = anchorsFromRanges(body, [{ blockId: 'b1', from: 2, to: 7 }]);
    assert.deepEqual(anchor, { blockId: 'b1', from: 2, to: 7, excerpt: 'marca' });
    const [cut] = anchorsFromRanges(body, [{ blockId: 'b1', from: 4, to: 10 }]);
    assert.equal(cut?.excerpt, 'marca apostou');
    assert.deepEqual(anchorsFromRanges(body, [{ blockId: 'missing', from: 0, to: 3 }]), []);
  });

  it('merges overlapping passages and keeps document order', () => {
    const first = anchorsFromRanges(body, [{ blockId: 'b3', from: 0, to: 6 }]);
    const merged = addAnchors(body, first, anchorsFromRanges(body, [{ blockId: 'b3', from: 4, to: 12 }]));
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.excerpt, 'Foi a melhor');
    const two = addAnchors(body, merged, anchorsFromRanges(body, [{ blockId: 'b1', from: 0, to: 1 }]));
    assert.deepEqual(
      two.map((anchor) => anchor.blockId),
      ['b1', 'b3'],
    );
    assert.equal(anchorsLabel(1), '1 trecho apontado');
    assert.equal(anchorsLabel(2), '2 trechos apontados');
  });

  it('shortens long excerpts on a word boundary', () => {
    assert.equal(shortExcerpt('palavra '.repeat(30), 20), 'palavra palavra…');
    assert.equal(shortExcerpt('curto'), 'curto');
  });
});

describe('origin of the text', () => {
  const withAi: ArticleBody = {
    ...body,
    blocks: [
      { id: 'b1', type: 'paragraph', inlines: [{ text: 'Escrito pela IA.' }], ai: 'reviewed' },
      { id: 'b2', type: 'paragraph', inlines: [{ text: 'Escrito por gente.' }] },
    ],
  };

  it('marks every block the AI wrote, reviewed or not, and nothing else', () => {
    assert.equal(hasAiText(body), false);
    assert.equal(originBody(body), body);
    assert.equal(hasAiText(withAi), true);
    const marked = originBody(withAi);
    assert.equal(marked.blocks[0]?.ai, 'unreviewed');
    assert.equal(marked.blocks[1]?.ai, undefined);
  });
});

describe('historyEvents', () => {
  const people = [
    { id: 'person-joao', name: 'João Vitor' },
    { id: 'person-pedro', name: 'Pedro Alves' },
  ] as unknown as PersonSummary[];
  const versions = [
    version({ id: 'v1', number: 1, origin: 'generation', createdBy: 'system', createdAt: '2026-10-01T12:00:00.000Z' }),
    version({ id: 'v2', number: 2, createdAt: '2026-10-02T12:00:00.000Z' }),
    version({ id: 'v3', number: 3, origin: 'restore', restoredFrom: 'v1', createdAt: '2026-10-06T12:00:00.000Z' }),
  ];
  const requests = [
    { id: 'r1', requester: people[0], assignee: people[1], requestedAt: '2026-10-02T15:00:00.000Z', note: ' Pedro, pode revisar hoje? ', due: 'none', round: 1, version: versions[1] },
    { id: 'r0', requester: people[0], assignee: people[1], requestedAt: '2026-10-01T15:00:00.000Z', due: 'none', round: 1, version: versions[0], withdrawnAt: '2026-10-01T16:00:00.000Z' },
  ] as unknown as ApprovalRequestView[];
  const decisions = [
    { kind: 'changes_requested', decider: people[1], at: '2026-10-03T12:00:00.000Z', note: 'Encurte a abertura.', anchors: [], version: versions[1] },
  ] as unknown as ApprovalDecisionView[];

  it('names each event by what happened, newest first, without version numbers', () => {
    const events = historyEvents({ kind: 'article', versions, requests, decisions, people });
    assert.deepEqual(
      events.map((event) => event.title),
      ['Restaurado de 01/10', 'Ajustes pedidos por Pedro', 'Enviado a Pedro', 'Editado por João', 'Texto da IA'],
    );
    assert.deepEqual(
      events.map((event) => event.kind),
      ['version', 'decision', 'request', 'version', 'version'],
    );
    assert.equal(
      events.some((event) => /\bv\d/.test(event.title)),
      false,
    );
  });

  it('keeps the notes as written, who did it and the version each event is about', () => {
    const events = historyEvents({ kind: 'article', versions, requests, decisions, people });
    const send = events.find((event) => event.kind === 'request');
    assert.equal(send?.note, 'Pedro, pode revisar hoje?');
    assert.equal(send?.personId, 'person-joao');
    assert.equal(send?.versionId, 'v2');
    const decision = events.find((event) => event.kind === 'decision');
    assert.equal(decision?.note, 'Encurte a abertura.');
    assert.equal(decision?.decision, 'changes_requested');
    assert.equal(decision?.personId, 'person-pedro');
    assert.equal(events.find((event) => event.title === 'Texto da IA')?.personId, null);
  });

  it('leaves withdrawn sends out and shows the size only for an article', () => {
    const events = historyEvents({ kind: 'article', versions, requests, decisions, people });
    assert.equal(events.filter((event) => event.kind === 'request').length, 1);
    assert.ok(events.filter((event) => event.kind === 'version').every((event) => event.meta.includes(' · ')));
    const carousel = historyEvents({ kind: 'carousel', versions: [versions[0]!], requests: [], decisions: [], people });
    assert.equal(carousel[0]?.meta.includes(' · '), false);
  });
});
