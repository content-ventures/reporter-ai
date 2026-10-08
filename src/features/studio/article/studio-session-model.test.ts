import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { briefHash, paragraphBlock } from '../../../domain/index.ts';
import type { ArticleBody, RunFold, Suggestion } from '../../../domain/index.ts';
import type { RunView } from '../../../ports/index.ts';
import {
  askQuestion,
  assistTurnsOf,
  continuationMode,
  factsBodyOf,
  focusedSuggestionOf,
  generationRunsOf,
  approvedOnScreen,
  articleStatusOf,
  studioBadge,
  briefChangedSince,
  reviewRequestBlock,
  selectionTarget,
  toolForSuggestion,
  unpinnedRunIds,
} from './studio-session-model.ts';
import type { ComposerChip } from './studio-types.ts';

function run(id: string, patch: Partial<RunView> = {}): RunView {
  return { id, pieceId: 'piece-1', kind: 'article.generate', label: `Run ${id}`, createdAt: '2026-10-07T12:00:00.000Z', ...patch } as RunView;
}

function suggestion(id: string, patch: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    runId: 'run-a',
    pieceId: 'piece-1',
    baseRevision: 1,
    target: [{ blockId: 'b1', from: 0, to: 4 }],
    anchorText: ['Abre'],
    proposal: { kind: 'replace-text', text: 'Começa' },
    state: 'ready',
    createdAt: '2026-10-07T12:00:00.000Z',
    ...patch,
  } as Suggestion;
}

const cover = { assetId: 'asset-1', alt: 'Capa' } as unknown as NonNullable<ArticleBody['cover']>;
const written: RunFold = {
  seq: 3,
  title: 'Título gerado',
  blocks: [{ id: 'g1', type: 'paragraph', text: 'Texto gerado.', complete: true, final: paragraphBlock('g1', 'Texto gerado.') }],
} as unknown as RunFold;

describe('studio session model', () => {
  it('keeps the article generations of the piece, without continuations', () => {
    const runs = [
      run('r1'),
      run('r2', { parentRunId: 'r1' } as Partial<RunView>),
      run('r3', { kind: 'article.assist' }),
      run('r4', { pieceId: 'piece-2' }),
      run('r5'),
    ];
    assert.deepEqual(
      generationRunsOf(runs, 'piece-1').map((entry) => entry.id),
      ['r1', 'r5'],
    );
  });

  it('reads the generated text while a run writes over an empty text or replaces it', () => {
    const blank: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('b1', '  ')], cover };
    const typed: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('b1', 'Texto da pessoa.')] };

    assert.deepEqual(factsBodyOf(typed, 'Título', undefined), { ...typed, title: 'Título' });
    const over = factsBodyOf(blank, 'Título', { fold: written, mode: 'append' });
    assert.equal(over.title, 'Título gerado');
    assert.deepEqual(
      over.blocks.map((block) => block.id),
      ['g1'],
    );
    assert.equal(over.cover, cover, 'the cover on screen stays');
    assert.deepEqual(factsBodyOf(typed, 'Título', { fold: written, mode: 'append' }), { ...typed, title: 'Título' });
    assert.deepEqual(
      factsBodyOf(typed, 'Título', { fold: written, mode: 'replace' }).blocks.map((block) => block.id),
      ['g1'],
    );
    assert.equal('cover' in factsBodyOf(typed, 'Título', { fold: written, mode: 'replace' }), false);
  });

  it('continues a replacing generation in place only while it wrote nothing', () => {
    assert.equal(continuationMode('replace', 0), 'replace');
    assert.equal(continuationMode('replace', 2), 'append');
    assert.equal(continuationMode('append', 0), 'append');
  });

  it('pins each run with open suggestions once, in order of appearance', () => {
    const open = [suggestion('s1', { runId: 'run-b' }), suggestion('s2', { runId: 'run-a' }), suggestion('s3', { runId: 'run-b' })];
    assert.deepEqual(unpinnedRunIds(open, []), ['run-b', 'run-a']);
    assert.deepEqual(unpinnedRunIds(open, ['run-a']), ['run-b']);
    assert.deepEqual(unpinnedRunIds(open, ['run-a', 'run-b']), []);
  });

  it('rebuilds the thread from pinned assist runs this tab did not start', () => {
    const runs = [
      run('run-a', { kind: 'article.assist', label: 'Ajuste' }),
      run('run-b', { kind: 'article.titles', label: 'Títulos' }),
      run('run-c', { kind: 'article.assist' }),
      run('run-d', { kind: 'article.generate' }),
      run('run-e', { kind: 'article.assist', pieceId: 'piece-2' }),
      run('run-f', { kind: 'article.assist', parentRunId: 'run-a' } as Partial<RunView>),
    ];
    const turns = assistTurnsOf({
      runs,
      pieceId: 'piece-1',
      pinned: ['run-a', 'run-b', 'run-c', 'run-d', 'run-e', 'run-f'],
      turns: [{ runId: 'run-c' }, {}],
      suggestions: [suggestion('s1', { runId: 'run-a', label: 'Mais direto' })],
    });
    assert.deepEqual(turns, [
      { id: 'run-run-a', runId: 'run-a', prompt: 'Mais direto', chips: [], at: Date.parse('2026-10-07T12:00:00.000Z') },
      { id: 'run-run-b', runId: 'run-b', prompt: 'Títulos', chips: [], at: Date.parse('2026-10-07T12:00:00.000Z') },
    ]);
    assert.deepEqual(assistTurnsOf({ runs, pieceId: 'piece-1', pinned: [], turns: [], suggestions: [] }), []);
  });

  it('sends the pinned selection as the target and the excerpts in quotes', () => {
    const chips: ComposerChip[] = [
      { id: 'exc-1', kind: 'excerpt', label: 'Ana · 00:12', segmentId: 'seg-1', text: 'A fala' },
      { id: 'sel-1', kind: 'selection', label: 'Seleção · §2', ranges: [{ blockId: 'b2', from: 0, to: 5 }], text: 'Trecho' },
      { id: 'note-1', kind: 'note', label: 'Nota', text: 'Corrigir a data' },
    ];
    assert.deepEqual(selectionTarget(chips), [{ blockId: 'b2', from: 0, to: 5 }]);
    assert.equal(selectionTarget(chips.slice(0, 1)), undefined);
    assert.equal(askQuestion('Está claro?', chips), 'Está claro?\n\n“A fala”\n\n“Corrigir a data”');
    assert.equal(askQuestion('Está claro?', []), 'Está claro?');
  });

  it('points the bar at the chosen card or at the run of an inline action', () => {
    const open = [
      suggestion('title', { runId: 'run-t', proposal: { kind: 'title', text: 'Outro título' }, target: [] }),
      suggestion('s1', { runId: 'run-a' }),
      suggestion('s2', { runId: 'run-a' }),
      suggestion('s3', { runId: 'run-b', target: [] }),
    ];
    assert.equal(focusedSuggestionOf(null, open), undefined);
    assert.equal(focusedSuggestionOf({ suggestionId: 's2' }, open)?.id, 's2');
    assert.equal(focusedSuggestionOf({ runId: 'run-a' }, open)?.id, 's1');
    assert.equal(focusedSuggestionOf({ suggestionId: 'title' }, open), undefined);
    assert.equal(focusedSuggestionOf({ runId: 'run-b' }, open), undefined);
  });

  it('blocks the approval request with the first reason the person can act on', () => {
    const clear = { busy: false, openCount: 0, conflict: false, empty: false };
    assert.equal(reviewRequestBlock({ ...clear, busy: true, openCount: 2 }), 'Aguarde a geração terminar.');
    assert.equal(reviewRequestBlock({ ...clear, openCount: 1, conflict: true }), 'Decida a sugestão aberta antes de enviar.');
    assert.equal(reviewRequestBlock({ ...clear, openCount: 3 }), 'Decida as 3 sugestões abertas antes de enviar.');
    assert.equal(reviewRequestBlock({ ...clear, conflict: true, empty: true }), 'O texto foi alterado em outra aba. Recarregue a página.');
    assert.equal(reviewRequestBlock({ ...clear, empty: true }), 'Escreva ou gere o texto antes de enviar.');
    // A failing blocking check of the text on screen blocks the request, with its detail.
    const interrupted = { label: 'Geração concluída', detail: 'Geração interrompida: continue ou edite o texto' };
    assert.equal(reviewRequestBlock({ ...clear, blockers: [interrupted] }), 'Geração interrompida: continue ou edite o texto.');
    assert.equal(reviewRequestBlock({ ...clear, blockers: [{ label: 'Geração concluída' }] }), 'Geração concluída pendente.');
    assert.equal(reviewRequestBlock({ ...clear, openCount: 1, blockers: [interrupted] }), 'Decida a sugestão aberta antes de enviar.');
    assert.equal(reviewRequestBlock({ ...clear, guard: { allowed: false, code: 'not_allowed', reason: 'Sem permissão.' } }), 'Sem permissão.');
    assert.equal(reviewRequestBlock({ ...clear, guard: { allowed: false, code: 'already_requested', reason: 'Já enviada.' } }), null);
    assert.equal(reviewRequestBlock({ ...clear, guard: { allowed: true } }), null);
    assert.equal(reviewRequestBlock(clear), null);
  });

  it('finds the tool that produced a suggestion, to run it again', () => {
    assert.equal(toolForSuggestion({ label: 'Mais direto', proposal: { kind: 'replace-text', text: 'x' } })?.id, 'rewrite.direct');
    assert.equal(toolForSuggestion({ label: 'Virar lista', proposal: { kind: 'replace-text', text: 'x' } })?.id, 'to-list');
    assert.equal(toolForSuggestion({ label: 'Ajustar trecho', proposal: { kind: 'replace-text', text: 'x' } })?.id, 'rewrite.direct');
    assert.equal(toolForSuggestion({ proposal: { kind: 'title', text: 'Outro' } })?.id, 'titles');
    assert.equal(toolForSuggestion({ label: 'Desconhecida', proposal: { kind: 'replace-text', text: 'x' } }), undefined);
    assert.equal(toolForSuggestion({ proposal: { kind: 'replace-text', text: 'x' } }), undefined);
  });

  it('reads the article status in its studio, never the production one', () => {
    const v1 = { id: 'v1', number: 1 } as never;
    const v2 = { id: 'v2', number: 2 } as never;
    const piece = { status: 'approved' as const, statusLabel: 'Aprovado', approvedVersion: v2, latestVersion: v2, draft: { dirty: false } as never };
    assert.deepEqual(articleStatusOf(piece), { status: 'approved', label: 'Aprovado · v2' });
    assert.equal(approvedOnScreen(piece), v2);
    // Edited after the approval: a new draft on screen (the approval stays on v2).
    const edited = { ...piece, draft: { dirty: true } as never };
    assert.deepEqual(articleStatusOf(edited), { status: 'draft', label: 'Em edição' });
    assert.equal(approvedOnScreen(edited), undefined);
    assert.deepEqual(articleStatusOf({ ...piece, approvedVersion: v1 }), { status: 'draft', label: 'Em edição' });
    assert.deepEqual(articleStatusOf({ ...piece, status: 'in_review', statusLabel: 'Aguardando aprovação' }), { status: 'in_review', label: 'Aguardando aprovação' });
    assert.deepEqual(articleStatusOf({ ...piece, status: 'draft', statusLabel: 'Rascunho', approvedVersion: undefined }), { status: 'draft', label: 'Em edição' });
  });

  it('says "Falta autorização" in the studio header while nothing can be written, as the list does', () => {
    const empty = { status: 'not_started' as const, statusLabel: 'Não iniciado', approvedVersion: undefined, latestVersion: undefined, draft: { dirty: false } as never };
    assert.deepEqual(studioBadge(empty, 'unauthorized'), { kind: 'production', status: 'unauthorized', label: 'Falta autorização' });
    assert.deepEqual(studioBadge(empty, 'draft'), { kind: 'piece', status: 'not_started', label: 'Não iniciado' });
    const written = { ...empty, status: 'draft' as const, statusLabel: 'Rascunho' };
    assert.deepEqual(studioBadge(written, 'unauthorized'), { kind: 'piece', status: 'draft', label: 'Em edição' }, 'a text already written keeps its own status');
  });

  it('knows when the brief changed after the text was generated', () => {
    const brief = { sections: 3, length: 'medium' as const, revision: 2 };
    const used = (hash: string) => ({ inputs: [{ kind: 'brief' as const, productionId: 'p', revision: 1, hash }] });
    const same = briefHash({ ...brief, revision: 1 });
    assert.equal(briefChangedSince(used(same), brief), false);
    assert.equal(briefChangedSince(used('outra'), brief), true);
    assert.equal(briefChangedSince({ inputs: [] }, brief), false);
    assert.equal(briefChangedSince(undefined, brief), false);
  });
});
