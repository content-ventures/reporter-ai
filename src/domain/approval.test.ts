import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArticleBody } from './article.ts';
import { approvalStateOf, dueStateOf, isLocked, isValidDue, localDateOf, lockedMessage, requestRound, sendBlocker, sendBlockedMessage, sendChecklist } from './approval.ts';
import type { SendChecklistInput, SendItem } from './approval.ts';
import { articleCharacters } from './article.ts';
import type { CheckResult } from './checks.ts';
import type { TextRange } from './refs.ts';
import { evaluatePieceChecks } from './views.ts';
import { pendingReview } from './record.ts';
import type { ProductionRecord } from './record.ts';
import { baseRecord, commitVersion, createKit, pieceIn, recordDecision, requestReview, sampleArticle } from './testing/scenario.ts';

function editDraftTitle(record: ProductionRecord, title: string): void {
  record.pieces = record.pieces.map((piece) =>
    piece.kind === 'article' && piece.draft.body.type === 'article' ? { ...piece, draft: { ...piece.draft, body: { ...piece.draft.body, title } } } : piece,
  );
}

function withdrawLatest(record: ProductionRecord, at: string): void {
  const latest = record.reviewRequests[record.reviewRequests.length - 1];
  record.reviewRequests = record.reviewRequests.map((request) => (request.id === latest.id ? { ...request, withdrawnAt: at, withdrawnBy: request.requestedBy } : request));
}

describe('approvalStateOf', () => {
  it('follows a piece from draft to approved, and flags an approved text edited afterwards', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    const piece = pieceIn(record, 'article');
    assert.equal(approvalStateOf(record, piece.id), 'none');

    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    requestReview(record, kit, v1);
    assert.equal(approvalStateOf(record, piece.id), 'awaiting');
    assert.equal(isLocked(record, piece.id), true);

    recordDecision(record, kit, v1, 'changes_requested', { note: 'Ajustar o título.' });
    assert.equal(approvalStateOf(record, piece.id), 'changes_requested');
    assert.equal(isLocked(record, piece.id), false);

    const v2 = commitVersion(record, kit, 'article', { ...(v1.body as ArticleBody), title: 'Título novo' });
    requestReview(record, kit, v2);
    recordDecision(record, kit, v2, 'approved');
    assert.equal(approvalStateOf(record, piece.id), 'approved');

    editDraftTitle(record, 'Título mudado depois da aprovação');
    assert.equal(approvalStateOf(record, piece.id), 'approval_outdated');
  });

  it('a withdrawn send no longer waits: the text is editable again', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    requestReview(record, kit, v1);
    kit.advance();
    withdrawLatest(record, kit.now());
    assert.equal(pendingReview(record, v1.pieceId), undefined);
    assert.equal(isLocked(record, v1.pieceId), false);
    assert.equal(approvalStateOf(record, v1.pieceId), 'none');
  });
});

describe('requestRound', () => {
  it('counts the sends of the piece at its gate, without withdrawn ones', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    requestReview(record, kit, v1);
    recordDecision(record, kit, v1, 'changes_requested', { note: 'Rever.' });
    requestReview(record, kit, v1);
    kit.advance();
    withdrawLatest(record, kit.now());
    requestReview(record, kit, v1);
    const [first, withdrawn, third] = record.reviewRequests;
    assert.equal(requestRound(record, first), 1);
    assert.equal(requestRound(record, third), 2, 'the withdrawn send is not a round');
    assert.equal(requestRound(record, withdrawn), 2);
  });
});

describe('dueStateOf', () => {
  const now = new Date(2026, 9, 8, 14, 10).toISOString();

  it('reads the due date against the local calendar day of now', () => {
    assert.equal(localDateOf(now), '2026-10-08');
    assert.equal(dueStateOf(undefined, now), 'none');
    assert.equal(dueStateOf('2026-10-07', now), 'overdue');
    assert.equal(dueStateOf('2026-10-08', now), 'today');
    assert.equal(dueStateOf('2026-10-10', now), 'later');
    assert.equal(dueStateOf('amanhã', now), 'none');
  });

  it('accepts today or a later real date as "Para quando"', () => {
    assert.equal(isValidDue('2026-10-08', now), true);
    assert.equal(isValidDue('2026-12-31', now), true);
    assert.equal(isValidDue('2026-10-07', now), false, 'yesterday');
    assert.equal(isValidDue('2026-02-30', now), false, 'not a date');
    assert.equal(isValidDue('08/10/2026', now), false);
  });
});

describe('lockedMessage', () => {
  it('names who has the piece (COPY §5.4)', () => {
    assert.equal(lockedMessage('article', 'Pedro'), 'O texto está com Pedro para aprovação. Retire o envio para editar.');
    assert.equal(lockedMessage('carousel'), 'O carrossel está aguardando aprovação. Retire o envio para editar.');
  });
});

describe('sendBlocker', () => {
  it('is the first "Falta" item', () => {
    const items: SendItem[] = [
      { id: 'images', level: 'warning', text: '2 imagens sugeridas sem arquivo' },
      { id: 'suggestions', level: 'missing', text: '1 sugestão da IA sem decisão' },
      { id: 'title', level: 'missing', text: 'Falta o título' },
      { id: 'summary', level: 'ok', text: '1,6 de 2 laudas' },
    ];
    assert.equal(sendBlocker(items)?.id, 'suggestions');
    assert.equal(sendBlocker(items.filter((item) => item.level !== 'missing')), undefined);
  });
});

describe('sendChecklist (R1: "Falta" blocks, and so does the AI text not reviewed)', () => {
  const check = (id: string, status: CheckResult['status'], extra: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, blocking: id.endsWith('generation'), ...extra });
  const range = (blockId: string): TextRange => ({ blockId, from: 0, to: 10 });
  const clean: CheckResult[] = [
    check('article.title', 'pass'),
    check('article.quotes', 'pass', { progress: { current: 3, total: 3 } }),
    check('article.generation', 'pass'),
  ];
  const base: SendChecklistInput = { kind: 'article', checks: clean, openSuggestionIds: [], running: false, empty: false, size: 'standard', characters: 3200 };
  const rows = (items: SendItem[]) => items.map((item) => [item.level, item.text, item.action?.label ?? null, item.short ?? null]);

  it('a clean text has only the summary: quotes and laudas', () => {
    assert.deepEqual(rows(sendChecklist(base)), [['ok', '3 de 3 citações conferidas · 1,6 de 2 laudas', null, null]]);
  });

  it('lists every "Falta" first, then the warnings, then one summary row (COPY §5.2)', () => {
    const items = sendChecklist({
      ...base,
      characters: 4640,
      openSuggestionIds: ['sug-1', 'sug-2'],
      checks: [
        check('article.title', 'warn', { detail: 'Sem título' }),
        check('article.quotes', 'warn', { progress: { current: 2, total: 3 }, targets: [range('b-q1')] }),
        check('article.ai-reviewed', 'warn', { progress: { current: 9, total: 12 }, targets: [range('b-1'), range('b-2'), range('b-3')] }),
        check('article.image-slots', 'warn', { detail: '2 a preencher', targets: [range('fig-1'), range('fig-2')] }),
        check('article.length', 'warn', { meta: '2,4/2 laudas' }),
        check('article.image-credits', 'warn', { detail: '1 sem crédito · 2 sem uso autorizado', progress: { current: 0, total: 3 } }),
        check('article.image-alt', 'warn', { progress: { current: 2, total: 3 } }),
        check('article.links', 'warn', { progress: { current: 1, total: 3 } }),
        check('article.generation', 'pass'),
      ],
    });
    assert.deepEqual(rows(items), [
      ['missing', '2 sugestões da IA sem decisão', 'Ir ao trecho', '2 sugestões'],
      ['missing', '1 citação não confere com a entrevista', 'Ir ao trecho', '1 citação'],
      ['missing', 'Falta o título', 'Ir ao título', 'o título'],
      ['missing', 'Texto não revisado', 'Marcar como revisado', null],
      ['warning', '2 imagens sugeridas sem arquivo', 'Ver', null],
      ['warning', '2,4 de 2 laudas · passa 640 caracteres', 'Ver', null],
      ['warning', '1 imagem sem crédito · 2 imagens sem uso autorizado', 'Ver', null],
      ['warning', '1 imagem sem texto alternativo', 'Ver', null],
      ['warning', '2 links inválidos', 'Ir ao trecho', null],
      ['ok', '2 de 3 citações conferidas · 2,4 de 2 laudas', null, null],
    ]);
    assert.deepEqual(items[0].action?.target, { kind: 'suggestion', suggestionId: 'sug-1' });
    assert.deepEqual(items[1].action?.target, { kind: 'ranges', ranges: [range('b-q1')] });
    assert.deepEqual(items[2].action?.target, { kind: 'check', checkId: 'article.title' });
    assert.equal(sendBlocker(items)?.id, 'suggestions');
    assert.equal(sendBlockedMessage(sendBlocker(items) ?? items[0]), '2 sugestões da IA sem decisão.');
    assert.deepEqual(items[3].action?.target, { kind: 'mark-reviewed' });
    // The narrow footer sums the spots ("Falta 3": 2 sugestões · 1 citação); the review has its own control.
    assert.deepEqual(items.map((item) => item.count ?? null), [2, 1, null, null, 2, null, null, 1, 2, null]);
  });

  it('the AI text not reviewed is ONE "Falta" for the whole text, however many passages are open', () => {
    const items = sendChecklist({ ...base, checks: [...clean, check('article.ai-reviewed', 'warn', { progress: { current: 0, total: 5 }, targets: [range('b-1'), range('b-2')] })] });
    assert.equal(sendBlocker(items)?.id, 'text-review');
    assert.deepEqual(rows(items)[0], ['missing', 'Texto não revisado', 'Marcar como revisado', null]);
    assert.equal(sendBlockedMessage(sendBlocker(items) ?? items[0]), 'Texto não revisado.');
    assert.equal(items.filter((item) => item.id === 'text-review').length, 1);
  });

  it('once the text is reviewed the row turns "Ok · Texto revisado" and nothing blocks', () => {
    const items = sendChecklist({ ...base, checks: [...clean, check('article.ai-reviewed', 'pass', { progress: { current: 5, total: 5 } })] });
    assert.equal(sendBlocker(items), undefined);
    assert.deepEqual(rows(items).map(([level, text]) => [level, text]), [
      ['ok', 'Texto revisado'],
      ['ok', '3 de 3 citações conferidas · 1,6 de 2 laudas'],
    ]);
  });

  it('a text without AI passages has no review row at all', () => {
    const items = sendChecklist({ ...base, checks: [...clean, check('article.ai-reviewed', 'na')] });
    assert.equal(items.some((item) => item.id === 'text-review'), false);
  });

  it('an empty text, the AI still writing, or an interrupted generation are the only rows that matter', () => {
    assert.deepEqual(rows(sendChecklist({ ...base, empty: true, characters: 0 })), [['missing', 'O texto está vazio', 'Ir ao texto', 'o texto']]);
    assert.deepEqual(rows(sendChecklist({ ...base, running: true })), [['missing', 'A IA não terminou o texto', 'Ver no texto', null]]);
    const interrupted = sendChecklist({ ...base, checks: [...clean.slice(0, 2), check('article.generation', 'fail', { detail: 'Geração interrompida' })] });
    assert.equal(sendBlocker(interrupted)?.id, 'generation');
    assert.deepEqual(sendBlocker(interrupted)?.action?.target, { kind: 'check', checkId: 'article.generation' });
  });

  it('carousel: slides without their required text or with text that does not fit block; the summary counts slides', () => {
    const items = sendChecklist({
      kind: 'carousel',
      checks: [check('carousel.generation', 'pass'), check('carousel.limits', 'warn')],
      openSuggestionIds: [],
      running: false,
      empty: false,
      slides: 5,
      slideIssues: [
        { slideId: 's-2', kind: 'overflow' },
        { slideId: 's-3', kind: 'missing' },
        { slideId: 's-3', kind: 'overflow' },
        { slideId: 's-4', kind: 'overflow' },
      ],
    });
    assert.deepEqual(rows(items), [
      ['missing', '1 slide sem o texto obrigatório', 'Ver slide', null],
      ['missing', '2 slides com texto que não cabe', 'Ver slide', null],
      ['ok', '5 slides', null, null],
    ]);
    assert.deepEqual(items[0].action?.target, { kind: 'slide', slideId: 's-3' });
    assert.deepEqual(items[1].action?.target, { kind: 'slide', slideId: 's-2' });
  });

  it('reads the real checks of a draft (sample: 4 AI blocks, quotes checked, inside the size)', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    const piece = pieceIn(record, 'article');
    const body = piece.draft.body;
    assert.equal(body.type, 'article');
    const items = sendChecklist({
      kind: 'article',
      checks: evaluatePieceChecks(record, piece),
      openSuggestionIds: [],
      running: false,
      empty: false,
      size: 'standard',
      characters: body.type === 'article' ? articleCharacters(body) : 0,
    });
    assert.equal(sendBlocker(items)?.id, 'text-review');
    assert.deepEqual(items.map((item) => item.id), ['text-review', 'summary']);
    assert.equal(items[0].text, 'Texto não revisado');
  });
});
