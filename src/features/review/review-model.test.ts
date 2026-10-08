import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assetLookupOf, diffArticles } from '../../domain/index.ts';
import type { ArticleBody, DiffBlock, ImageAsset } from '../../domain/index.ts';
import type { ReviewView, VersionView } from '../../ports/index.ts';
import {
  addAnchors,
  anchorsFromRanges,
  compareOptions,
  groupEvidence,
  imageCaption,
  imageChanges,
  resolveView,
  reviewHistory,
  sectionMark,
  shortExcerpt,
  toReviewDiff,
  versionStatus,
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
    inputs: [],
    isLatest: false,
    isCurrentApproved: false,
    ...partial,
  };
}

describe('compareOptions / resolveView', () => {
  it('offers the last approved version first, then the pure AI output', () => {
    const ai = version({ id: 'v1', number: 1, label: 'v1 · IA', origin: 'generation' });
    const approved = version({ id: 'v3', number: 3 });
    const options = compareOptions({ compareWith: { ai, lastApproved: approved } });
    assert.deepEqual(
      options.map((option) => option.label),
      ['desde v3 · aprovada', 'desde v1 · IA'],
    );
    assert.equal(resolveView(options, {}).mode, 'changes');
    assert.equal(resolveView(options, { compare: 'ai' }).option?.target, 'ai');
  });

  it('opens the final text on a first approval and when nothing compares', () => {
    const ai = version({ id: 'v1', number: 1, label: 'v1 · IA', origin: 'generation' });
    assert.equal(resolveView(compareOptions({ compareWith: { ai } }), {}).mode, 'final');
    assert.deepEqual(resolveView([], { view: 'changes' }), { mode: 'final' });
    assert.equal(resolveView(compareOptions({ compareWith: { ai } }), { view: 'changes' }).mode, 'changes');
  });
});

describe('versionStatus', () => {
  const base = {
    version: { ...version({ id: 'v4', number: 4 }), pieceId: 'piece-1' } as ReviewView['version'],
    freshness: { state: 'fresh', staleInputs: [], staleSources: [] } as ReviewView['freshness'],
    status: 'draft' as const,
  };

  it('follows the decision on the exact version', () => {
    const approved = { ...base, version: { ...base.version, decision: { kind: 'approved' as const, by: 'p', at: 'x', id: 'd' } } };
    assert.equal(versionStatus(approved), 'approved');
    assert.equal(versionStatus({ ...approved, freshness: { ...base.freshness, state: 'stale' } }), 'stale');
    const returned = { ...base, version: { ...base.version, decision: { kind: 'changes_requested' as const, by: 'p', at: 'x', id: 'd' } } };
    assert.equal(versionStatus(returned), 'changes_requested');
  });

  it('is waiting when the request points at this version', () => {
    const pendingReview = { subject: { versionId: 'v4' } } as ReviewView['pendingReview'];
    assert.equal(versionStatus({ ...base, pendingReview }), 'in_review');
    assert.equal(versionStatus(base), 'draft');
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
    assert.equal(sectionMark(body, 'b3'), '§3');
  });

  it('shortens long excerpts on a word boundary', () => {
    assert.equal(shortExcerpt('palavra '.repeat(30), 20), 'palavra palavra…');
    assert.equal(shortExcerpt('curto'), 'curto');
  });
});

describe('reviewHistory', () => {
  it('lists decisions, the pending request, versions and failed generations, newest first', () => {
    const versions = [
      version({ id: 'v1', number: 1, label: 'v1 · IA', origin: 'generation', runId: 'run-1', createdAt: '2026-10-01T10:00:00.000Z' }),
      version({ id: 'v2', number: 2, createdAt: '2026-10-02T10:00:00.000Z' }),
    ];
    const review = {
      decisions: [
        {
          id: 'd1',
          gate: 'article.approval',
          subject: versions[0]!.ref,
          decision: 'changes_requested',
          by: 'person-pedro',
          at: '2026-10-01T12:00:00.000Z',
          note: 'Encurte a abertura.',
          anchors: [{ blockId: 'b1', from: 0, to: 5 }],
          checks: [],
          decider: null,
        },
      ],
      pendingReview: {
        id: 'r1',
        gate: 'article.approval',
        subject: versions[1]!.ref,
        requestedBy: 'person-joao',
        requestedAt: '2026-10-02T11:00:00.000Z',
        requester: null,
      },
      runs: [
        { id: 'run-1', kind: 'article.generate', status: 'completed', label: 'Geração do artigo', createdBy: 'person-joao', createdAt: '2026-10-01T09:59:00.000Z' },
        { id: 'run-0', kind: 'article.generate', status: 'failed', label: 'Geração do artigo', createdBy: 'person-joao', createdAt: '2026-09-30T09:00:00.000Z', endedAt: '2026-09-30T09:01:00.000Z' },
        { id: 'run-2', kind: 'article.assist', status: 'failed', label: 'Assistente de texto', createdBy: 'person-joao', createdAt: '2026-10-02T09:00:00.000Z' },
      ],
    } as unknown as ReviewView;
    const history = reviewHistory(review, versions);
    assert.deepEqual(
      history.map((item) => item.action),
      ['enviou a v2 para aprovação', 'salvou a v2', 'devolveu a v1', 'gerou a v1 · IA', 'Geração do artigo falhou'],
    );
    assert.equal(history[2]?.note, 'Encurte a abertura.');
    assert.equal(history[3]?.runId, 'run-1');
    assert.equal(history[4]?.standalone, true);
  });
});

describe('groupEvidence', () => {
  it('groups used passages by speaker and lists missing ones first, alone', () => {
    const ref = { kind: 'source', sourceId: 's', sourceVersion: 1, locator: { type: 'segment', segmentId: 'g' } } as const;
    const sergio = { label: 'Sérgio', segments: 3, words: 10, person: { id: 'person-sergio', name: 'Sérgio Lang', initials: 'SL' } };
    const groups = groupEvidence([
      { ref, blockIds: ['b1'], status: 'used', excerpt: 'um', speaker: sergio },
      { ref, blockIds: ['b2', 'b1'], status: 'used', excerpt: 'dois', speaker: sergio },
      { ref, blockIds: ['b3'], status: 'missing' },
    ]);
    assert.deepEqual(
      groups.map((group) => [group.missing, group.entries.length, group.blockIds]),
      [
        [true, 1, ['b3']],
        [false, 2, ['b1', 'b2']],
      ],
    );
  });
});
