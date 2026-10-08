import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTranscriptSource, headingBlock, listBlock, paragraphBlock, parseTranscript, quoteBlock, segmentRef } from '../../../domain/index.ts';
import type { ArticleBody, CheckResult, SendItem, Suggestion } from '../../../domain/index.ts';
import {
  articleFacts,
  articleOutline,
  blocksCitingSegment,
  checagemGroups,
  clip,
  closestExcerpt,
  documentTools,
  removedRanges,
  suggestionMarks,
  suggestionDelta,
  excerptLabel,
  footerNeeds,
  isOpenSuggestion,
  mergeChecks,
  nextInOrder,
  proposalText,
  suggestionHunks,
  targetLabel,
  usedSegmentIds,
  viewerSegments,
} from './studio-model.ts';

const ref = (segmentId: string) => segmentRef('src-1', 1, segmentId);

const body: ArticleBody = {
  type: 'article',
  title: 'Título',
  blocks: [
    paragraphBlock('b1', 'Abertura do texto com cinco palavras.', { ai: 'unreviewed', sourceRefs: [ref('s1'), ref('s2')] }),
    headingBlock('b2', 'Primeira seção', 2, { ai: 'reviewed' }),
    paragraphBlock('b3', 'Parágrafo revisado.', { ai: 'reviewed', sourceRefs: [ref('s2')] }),
    headingBlock('b4', 'Detalhe', 3),
    quoteBlock('b5', 'Uma citação longa de verdade aqui', { ai: 'unreviewed', sourceRefs: [ref('s3')] }),
  ],
};

describe('studio model', () => {
  it('counts the text and lists unreviewed AI blocks in order', () => {
    const facts = articleFacts(body, []);
    assert.equal(facts.words, 17);
    assert.equal(facts.minutes, 1);
    assert.deepEqual(facts.unreviewed, ['b1', 'b5']);
    assert.equal(facts.review, 'pending');
    assert.deepEqual(facts.quotes, []);
  });

  it('the review of the whole text: reviewed when no AI block is left, none without AI text', () => {
    const reviewed: ArticleBody = { ...body, blocks: body.blocks.map((block) => (block.ai === 'unreviewed' ? { ...block, ai: 'reviewed' as const } : block)) };
    assert.equal(articleFacts(reviewed, []).review, 'reviewed');
    const human: ArticleBody = { ...body, blocks: body.blocks.map(({ ai: _ai, ...block }) => block as typeof block) };
    assert.equal(articleFacts(human, []).review, 'none');
  });

  it('footerNeeds lists what blocks sending without the text review, which has its own control', () => {
    const item = (id: SendItem['id'], level: SendItem['level'], text: string, extra: Partial<SendItem> = {}): SendItem => ({ id, level, text, ...extra });
    const review = item('text-review', 'missing', 'Texto não revisado', { action: { label: 'Marcar como revisado', target: { kind: 'mark-reviewed' } } });
    const quote = item('quotes', 'missing', '1 citação não confere com a entrevista', { short: '1 citação', count: 1 });
    const onlyReview = footerNeeds([review, item('summary', 'ok', '1,6 de 2 laudas')]);
    assert.deepEqual(onlyReview, { ready: false, parts: [], total: 0 });
    const both = footerNeeds([quote, review]);
    assert.deepEqual(both.parts.map((part) => part.text), ['1 citação']);
    assert.equal(both.ready, false);
    assert.equal(both.total, 1);
    assert.equal(footerNeeds([item('text-review', 'ok', 'Texto revisado')]).ready, true);
  });

  it('Checagem lists the text review among what is missing to send', () => {
    const review: CheckResult = { id: 'article.ai-reviewed', label: 'Texto revisado', status: 'warn', blocking: false, progress: { current: 0, total: 2 } };
    const groups = checagemGroups([review], []);
    assert.deepEqual(groups.missing.map((check) => check.id), ['article.ai-reviewed']);
    assert.deepEqual(groups.warnings, []);
  });

  it('knows which transcript segments the text uses and which blocks cite one', () => {
    assert.deepEqual(usedSegmentIds(body), ['s1', 's2', 's3']);
    assert.deepEqual(blocksCitingSegment(body, 's2'), ['b1', 'b3']);
    assert.deepEqual(blocksCitingSegment(body, 'missing'), []);
  });

  it('builds the outline with 1-based block numbers', () => {
    assert.deepEqual(articleOutline(body), [
      { blockId: 'b2', level: 2, text: 'Primeira seção', number: 2 },
      { blockId: 'b4', level: 3, text: 'Detalhe', number: 4 },
    ]);
  });

  it('walks pending items in a loop', () => {
    assert.equal(nextInOrder(['a', 'b', 'c'], null), 'a');
    assert.equal(nextInOrder(['a', 'b', 'c'], 'b'), 'c');
    assert.equal(nextInOrder(['a', 'b', 'c'], 'c'), 'a');
    assert.equal(nextInOrder([], 'a'), undefined);
  });

  it('labels suggestion targets and diffs text proposals word by word', () => {
    const suggestion: Pick<Suggestion, 'anchorText' | 'proposal' | 'target'> = {
      target: [{ blockId: 'b3', from: 0, to: 19 }],
      anchorText: ['Parágrafo revisado.'],
      proposal: { kind: 'replace-text', text: 'Parágrafo curto.' },
    };
    assert.equal(targetLabel(body, suggestion.target), 'parágrafo 3');
    assert.equal(targetLabel(body, [{ blockId: 'b1', from: 0, to: 1 }, { blockId: 'b3', from: 0, to: 1 }]), 'parágrafos 1–3');
    assert.equal(targetLabel(body, [{ blockId: 'gone', from: 0, to: 1 }]), null);
    const hunks = suggestionHunks(suggestion) ?? [];
    assert.ok(hunks.some((hunk) => hunk.kind === 'delete' && hunk.text.includes('revisado')));
    assert.ok(hunks.some((hunk) => hunk.kind === 'insert' && hunk.text.includes('curto')));
    assert.equal(suggestionHunks({ anchorText: [], proposal: { kind: 'title', text: 'Novo' } }), undefined);
    assert.equal(proposalText({ kind: 'title', text: 'Novo título' }), 'Novo título');
  });

  it('treats ready, streaming and stale suggestions as open', () => {
    assert.equal(isOpenSuggestion({ state: 'ready' }), true);
    assert.equal(isOpenSuggestion({ state: 'stale' }), true);
    assert.equal(isOpenSuggestion({ state: 'applied' }), false);
  });

  it('keeps the run-owned generation check from the store', () => {
    const local: CheckResult[] = [
      { id: 'article.title', label: 'Título', status: 'pass', blocking: false },
      { id: 'article.generation', label: 'Geração concluída', status: 'pass', blocking: true },
    ];
    const stored: CheckResult[] = [{ id: 'article.generation', label: 'Geração concluída', status: 'fail', blocking: true, detail: 'Geração em andamento' }];
    assert.deepEqual(
      mergeChecks(local, stored).map((check) => check.status),
      ['pass', 'fail'],
    );
  });

  it('maps transcript segments to the viewer with the mapped person', () => {
    const segments = viewerSegments(
      [
        { id: 's1', speaker: 'Entrevistadora', text: 'Pergunta?', startMs: 12_000 },
        { id: 's2', speaker: 'M.', text: 'Resposta.' },
        { id: 's3', text: 'Sem falante.' },
      ],
      [{ label: 'Entrevistadora', personId: 'p-clara' }, { label: 'M.' }],
      [{ id: 'p-clara', name: 'Clara Souto' }],
    );
    assert.deepEqual(segments[0], { id: 's1', text: 'Pergunta?', speaker: { id: 'Entrevistadora', name: 'Clara Souto' }, start: 12_000 });
    assert.equal(segments[1]?.speaker?.name, 'M.');
    assert.equal(segments[2]?.speaker, undefined);
    assert.equal(excerptLabel(segments[0]), 'Trecho 00:12');
    assert.equal(excerptLabel(segments[1]), 'Fala de M.');
  });

  it('clips long excerpts at a word boundary', () => {
    assert.equal(clip('curto'), 'curto');
    const long = 'palavra '.repeat(40);
    const clipped = clip(long, 50);
    assert.ok(clipped.endsWith('…'));
    assert.ok(clipped.length <= 51);
    assert.ok(!clipped.slice(0, -1).endsWith(' '));
  });
});

describe('studio model · suggestions, tools and quotes', () => {
  const rewrite = {
    anchorText: ['Medido por pedidos fechados em seis meses.'],
    proposal: { kind: 'replace-text' as const, text: 'Pelo critério da empresa, medido em seis meses.' },
  };

  it('strikes through only the words a rewrite removes', () => {
    const range = { blockId: 'b1', from: 10, to: 10 + rewrite.anchorText[0].length };
    const removed = removedRanges(range, rewrite) ?? [];
    const text = `${'x'.repeat(10)}${rewrite.anchorText[0]}`;
    const struck = removed.map((entry) => text.slice(entry.from, entry.to));
    assert.ok(struck.length > 0 && struck.every((part) => part.trim() === part && part.length > 0));
    assert.ok(!struck.join(' ').includes('seis meses'), 'kept words stay plain');
    assert.deepEqual(suggestionDelta(rewrite), { removed: 4, added: 5 });
    assert.equal(removedRanges(range, { anchorText: ['a', 'b'], proposal: rewrite.proposal }), undefined);
  });

  it('reads a rewrite in the paragraph: struck words, then the proposed ones right after them', () => {
    const before = rewrite.anchorText[0];
    const range = { blockId: 'b1', from: 10, to: 10 + before.length };
    const marks = suggestionMarks([range], { target: [range], ...rewrite });
    const text = `${'x'.repeat(10)}${before}`;
    assert.equal(marks.stale, false);
    assert.ok(marks.removed.length > 0);
    // Every insertion sits right after struck words (a replacement), and reads the new words.
    for (const insertion of marks.inserted) assert.ok(marks.removed.some((removed) => removed.to === insertion.offset), insertion.text);
    const read = marks.inserted.map((insertion) => insertion.text).join(' ');
    assert.ok(read.includes('Pelo critério da empresa'), read);
    assert.ok(!marks.removed.map((removed) => text.slice(removed.from, removed.to)).join(' ').includes('seis meses'));
  });

  it('an expansion only inserts: the paragraph stays plain and the addition reads at its end', () => {
    const paragraph = 'O estúdio testa tudo antes.';
    const range = { blockId: 'b1', from: 0, to: paragraph.length };
    const marks = suggestionMarks([range], {
      target: [range],
      anchorText: [paragraph],
      proposal: { kind: 'replace-blocks', blocks: [paragraphBlock('b1', paragraph), paragraphBlock('n1', 'Helena acrescenta: “Erramos barato”.')] },
    });
    assert.deepEqual(marks.removed, []);
    assert.equal(marks.inserted.length, 1);
    assert.equal(marks.inserted[0]?.offset, paragraph.length);
    assert.equal(marks.inserted[0]?.text.trim(), 'Helena acrescenta: “Erramos barato”.');
  });

  it('a change of structure (sentences into a list) strikes the passage and reads the items after it', () => {
    const paragraph = 'Primeiro passo. Segundo passo.';
    const range = { blockId: 'b1', from: 0, to: paragraph.length };
    const marks = suggestionMarks([range], {
      target: [range],
      anchorText: [paragraph],
      proposal: { kind: 'replace-blocks', blocks: [listBlock('b1', ['Primeiro passo.', 'Segundo passo.'], false)] },
    });
    assert.deepEqual(marks.removed, [range]);
    assert.deepEqual(marks.inserted, [{ blockId: 'b1', offset: paragraph.length, text: 'Primeiro passo. · Segundo passo.' }]);
  });

  it('a stale suggestion never strikes its passage: the proposal reads, faded, at the end of its block', () => {
    const range = { blockId: 'b1', from: 0, to: 300 };
    const marks = suggestionMarks(undefined, { target: [range], ...rewrite });
    assert.deepEqual(marks, { removed: [], inserted: [{ blockId: 'b1', offset: Number.MAX_SAFE_INTEGER, text: rewrite.proposal.text }], stale: true });
    assert.deepEqual(suggestionMarks([range], { target: [range], anchorText: ['x'], proposal: { kind: 'title', text: 'Outro título' } }).removed, []);
  });

  it('offers article-wide tools that fit the text and the brief', () => {
    assert.deepEqual(documentTools({ empty: true, characters: 0, size: 'standard', headings: 0 }), []);
    assert.deepEqual(documentTools({ empty: false, characters: 4000, size: 'standard', headings: 0 }).map((tool) => tool.id), ['titles'], 'up to the maximum: nothing to shorten');
    const long = documentTools({ empty: false, characters: 4001, size: 'standard', headings: 2 });
    assert.deepEqual(long.map((tool) => tool.id), ['titles', 'suggest-subheadings', 'shorten-to-brief']);
    assert.equal(long[2]?.label, 'Encurtar para 2 laudas');
    assert.equal(documentTools({ empty: false, characters: 2100, size: 'short', headings: 0 })[1]?.label, 'Encurtar para 1 lauda');
  });

  it('finds the transcript clause behind a misquote', () => {
    const ctx = { now: '2026-10-07T12:00:00.000Z', newId: (prefix: string) => `${prefix}-1`, actorId: 'p' };
    const source = createTranscriptSource(
      { workspaceId: 'ws', title: 'E', origin: 'interview', parsed: parseTranscript('Helena: E a fábrica arrisca mais, porque errar no protótipo ficou barato. Outra frase qualquer.'), authorized: true },
      ctx,
    );
    const found = closestExcerpt({ text: 'Errar no protótipo virou algo barato', sourceRefs: [] }, [source]);
    assert.equal(found?.text, 'errar no protótipo ficou barato');
  });
});
