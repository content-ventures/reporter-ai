import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  approvalNoticeKind,
  approvalOutdatedNotice,
  approvedNotice,
  awaitingYouNotice,
  calendarDate,
  changesNotice,
  decidedNotice,
  DUE_OPTIONS,
  dueOnFor,
  errorNotice,
  firstName,
  formatAgo,
  formatDayMonth,
  formatDayTime,
  formatDue,
  formatSince,
  missingItemsReason,
  quoteNote,
  roundLabel,
  sendButtonLabel,
  sendDialogTitle,
  sentNotice,
  sentToast,
  SEND_LEVEL_LABELS,
  taskCardMeta,
  taskCardTitle,
  undoChangesConfirm,
  withdrawnToast,
  writingNotice,
} from './approval-copy.ts';

// Local calendar: 08/10/2026 at 14:20 in the machine's time zone.
const NOW = new Date(2026, 9, 8, 14, 20);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

test('names and quoted notes', () => {
  assert.equal(firstName('Juliana Prates'), 'Juliana');
  assert.equal(firstName('  Pedro  '), 'Pedro');
  assert.equal(firstName(null), '');
  assert.equal(quoteNote('Pode revisar hoje?'), '“Pode revisar hoje?”');
  const long = 'O título promete mais do que o texto entrega e o segundo intertítulo repete a mesma informação do lide.';
  const cut = quoteNote(long);
  assert.ok(cut.startsWith('“O título promete'));
  assert.ok(cut.endsWith('…”'));
  assert.ok(cut.length <= 80 + 3, 'at most 80 characters of the note, plus quotes and ellipsis');
  assert.doesNotMatch(cut, / …”$/, 'never a space before the ellipsis');
});

test('relative time: agora, minutes, hours, yesterday, then the date', () => {
  assert.equal(formatAgo(minutesAgo(0.5), NOW), 'agora');
  assert.equal(formatAgo(minutesAgo(5), NOW), 'há 5 min');
  assert.equal(formatAgo(minutesAgo(120), NOW), 'há 2 h');
  assert.equal(formatAgo(at(7, 18), NOW), 'há 20 h');
  assert.equal(formatAgo(at(7, 9), NOW), 'ontem');
  assert.equal(formatAgo(at(5, 9), NOW), '05/10');
  assert.equal(formatAgo(new Date(2025, 9, 5, 9), NOW), '05/10/2025');
  assert.equal(formatAgo('not a date', NOW), '');
});

test('since: today with the time, yesterday, older with the date', () => {
  assert.equal(formatSince(at(8, 14, 10), NOW), 'desde 14:10');
  assert.equal(formatSince(at(8, 9, 5), NOW), 'desde 09:05');
  assert.equal(formatSince(at(7, 22), NOW), 'desde ontem');
  assert.equal(formatSince(at(7, 9).toISOString(), NOW), 'desde ontem');
  assert.equal(formatSince(at(5, 9), NOW), 'desde 05/10');
});

test('due dates: today orange, overdue red, tomorrow, later, none', () => {
  assert.deepEqual(formatDue('2026-10-08', NOW), { text: 'prazo: hoje', due: 'today' });
  assert.deepEqual(formatDue('2026-10-07', NOW), { text: 'atrasado · prazo era 07/10', due: 'overdue' });
  assert.deepEqual(formatDue('2026-10-09', NOW), { text: 'prazo: amanhã', due: 'later' });
  assert.deepEqual(formatDue('2026-10-10', NOW), { text: 'prazo: 10/10', due: 'later' });
  assert.deepEqual(formatDue('2027-01-04', NOW), { text: 'prazo: 04/01/2027', due: 'later' });
  assert.deepEqual(formatDue(undefined, NOW), { text: '', due: 'none' });
  assert.deepEqual(formatDue('amanhã', NOW), { text: '', due: 'none' });
});

test('dates, rounds and the task card', () => {
  assert.equal(formatDayMonth('2026-10-07'), '07/10');
  assert.equal(formatDayTime(at(8, 14, 20)), '08/10, 14:20');
  assert.equal(roundLabel(1), undefined);
  assert.equal(roundLabel(2), '2º envio');
  assert.equal(roundLabel(3), '3º envio');
  assert.equal(taskCardTitle('Juliana Prates'), 'Juliana Prates pediu sua aprovação');
  assert.equal(taskCardMeta(minutesAgo(120), NOW, 2), 'há 2 h · 2º envio');
  assert.equal(taskCardMeta(minutesAgo(120), NOW, 1), 'há 2 h');
});

test('writing and error notices say where the AI is, in parts', () => {
  assert.equal(writingNotice('article', { current: 2, total: 4 }), 'A IA está escrevendo · parte 2 de 4. Você pode ler enquanto isso.');
  assert.equal(writingNotice('article'), 'A IA está escrevendo. Você pode ler enquanto isso.');
  assert.equal(writingNotice('carousel', { current: 1, total: 3 }), 'A IA está escrevendo os slides. Você pode ler enquanto isso.');
  assert.equal(errorNotice('article', { current: 2, total: 4 }), 'A IA parou ao escrever a parte 2 de 4. O que já foi escrito está salvo.');
  assert.equal(errorNotice('article'), 'A IA parou antes de terminar. O que já foi escrito está salvo.');
  assert.equal(errorNotice('carousel', { current: 2, total: 4 }), 'A IA parou antes de terminar. O que já foi escrito está salvo.');
});

test('sent and awaiting notices name the person, the time and the due date', () => {
  assert.equal(
    sentNotice({ subject: 'article', assigneeName: 'Pedro Alves', at: minutesAgo(5), now: NOW }),
    'Enviado para Pedro há 5 min. O texto fica travado até a decisão.',
  );
  assert.equal(
    sentNotice({ subject: 'article', assigneeName: 'Pedro Alves', at: minutesAgo(5), now: NOW, dueOn: '2026-10-08' }),
    'Enviado para Pedro há 5 min · prazo: hoje. O texto fica travado até a decisão.',
  );
  assert.equal(
    sentNotice({ subject: 'carousel', assigneeName: 'Pedro', at: minutesAgo(5) }),
    'Enviado para Pedro. O carrossel fica travado até a decisão.',
  );
  assert.equal(sentNotice({ subject: 'article', at: minutesAgo(5), now: NOW }), 'Enviado para aprovação há 5 min. O texto fica travado até a decisão.');
  assert.equal(awaitingYouNotice({ requesterName: 'Juliana Prates', at: minutesAgo(120), now: NOW }), 'Juliana Prates pediu sua aprovação há 2 h.');
  assert.equal(
    awaitingYouNotice({ requesterName: 'Juliana Prates', at: minutesAgo(120), now: NOW, dueOn: '2026-10-07' }),
    'Juliana Prates pediu sua aprovação há 2 h · atrasado · prazo era 07/10.',
  );
});

test('changes, approved and approval-outdated notices', () => {
  assert.equal(
    changesNotice({ deciderName: 'Pedro Alves', note: 'O título promete mais do que o texto entrega.' }),
    'Pedro pediu ajustes: “O título promete mais do que o texto entrega.”',
  );
  assert.equal(changesNotice({ deciderName: 'Pedro Alves' }), 'Pedro pediu ajustes.');
  assert.equal(approvedNotice({ deciderName: 'Pedro Alves', at: at(8, 14, 20), next: 'carousel' }), 'Aprovado por Pedro · 08/10, 14:20. Próximo passo: o carrossel.');
  assert.equal(approvedNotice({ deciderName: 'Pedro', at: at(8, 14, 20), next: 'delivery' }), 'Aprovado por Pedro · 08/10, 14:20. Próximo passo: a entrega.');
  assert.equal(approvedNotice({ deciderName: 'Pedro', at: at(8, 14, 20), next: 'package' }), 'Aprovado por Pedro · 08/10, 14:20. Próximo passo: baixar o pacote.');
  assert.equal(approvedNotice({ deciderName: 'Pedro', at: at(8, 14, 20) }), 'Aprovado por Pedro · 08/10, 14:20.');
  assert.equal(approvedNotice({ deciderName: 'Pedro', at: '' }), 'Aprovado por Pedro.');
  assert.equal(
    approvalOutdatedNotice({ subject: 'article', approvedAt: at(8, 11) }),
    'Você mudou o texto aprovado. Carrossel e entrega seguem a versão aprovada em 08/10.',
  );
  assert.equal(
    approvalOutdatedNotice({ subject: 'article', approvedAt: at(8, 11), usedBy: 'delivery' }),
    'Você mudou o texto aprovado. A entrega segue a versão aprovada em 08/10.',
  );
  assert.equal(
    approvalOutdatedNotice({ subject: 'carousel', approvedAt: at(6, 11) }),
    'Você mudou o carrossel aprovado. A entrega segue a versão aprovada em 06/10.',
  );
});

test('the approver notice after deciding points at the next item', () => {
  assert.equal(
    decidedNotice({ decision: 'approved', requesterName: 'Juliana Prates', nextTitle: 'Lume Acessórios: bijuteria na Europa' }),
    'Aprovado · Juliana recebeu o aviso. Próxima: Lume Acessórios: bijuteria na Europa.',
  );
  assert.equal(
    decidedNotice({ decision: 'changes_requested', requesterName: 'Juliana Prates', nextTitle: 'Lume Acessórios.' }),
    'Ajustes pedidos · Juliana recebeu o aviso. Próxima: Lume Acessórios.',
  );
  assert.equal(decidedNotice({ decision: 'approved', requesterName: 'Juliana Prates' }), 'Aprovado · Juliana recebeu o aviso. Nada mais esperando você.');
});

test('undo and withdraw confirmations', () => {
  assert.deepEqual(undoChangesConfirm({ subject: 'article', approvedAt: at(8, 11) }), {
    title: 'Desfazer as mudanças?',
    description: 'O texto volta para a versão aprovada em 08/10.',
    confirm: 'Desfazer mudanças',
    toast: 'Mudanças desfeitas',
  });
  assert.deepEqual(withdrawnToast('article'), { title: 'Envio retirado', description: 'O texto voltou a ser editável.' });
  assert.deepEqual(withdrawnToast('carousel'), { title: 'Envio retirado', description: 'O carrossel voltou a ser editável.' });
});

test('pre-send dialog: title, button, blocked reason, toast and badges', () => {
  assert.equal(sendDialogTitle(false), 'Enviar para aprovação');
  assert.equal(sendDialogTitle(true), 'Reenviar para aprovação');
  assert.equal(sendButtonLabel(false, 'Pedro Alves'), 'Enviar para Pedro');
  assert.equal(sendButtonLabel(true, 'Pedro Alves'), 'Reenviar para Pedro');
  assert.equal(sendButtonLabel(false, undefined), 'Enviar para aprovação');
  assert.equal(missingItemsReason(1), 'Resolva o item marcado “Falta” para enviar.');
  assert.equal(missingItemsReason(2), 'Resolva os 2 itens marcados “Falta” para enviar.');
  assert.equal(missingItemsReason(1, true), 'Marque o texto como revisado para enviar.');
  assert.equal(missingItemsReason(2, true), 'Resolva os 2 itens marcados “Falta” para enviar.');
  assert.equal(sentToast('Pedro Alves'), 'Enviado para Pedro');
  assert.deepEqual(SEND_LEVEL_LABELS, { missing: 'Falta', warning: 'Aviso', ok: 'Ok' });
});

test('due choices become local calendar dates', () => {
  assert.deepEqual(
    DUE_OPTIONS.map((option) => option.label),
    ['Sem prazo', 'Hoje', 'Amanhã', 'Escolher data…'],
  );
  assert.equal(dueOnFor('none', NOW), undefined);
  assert.equal(dueOnFor('today', NOW), '2026-10-08');
  assert.equal(dueOnFor('tomorrow', NOW), '2026-10-09');
  assert.equal(dueOnFor('tomorrow', new Date(2026, 11, 31, 23, 50)), '2027-01-01');
  assert.equal(dueOnFor('pick', NOW, '2026-10-15'), '2026-10-15');
  assert.equal(dueOnFor('pick', NOW, ''), undefined);
  assert.equal(calendarDate(NOW), '2026-10-08');
});

test('one approval notice per viewer: the sender waits, the person asked decides', () => {
  const viewer = (patch: Partial<{ canDecide: boolean; isRequester: boolean; isAssignee: boolean }> = {}) => ({
    canDecide: false,
    isRequester: false,
    isAssignee: false,
    ...patch,
  });
  const awaiting = (assignee: { id: string } | null, who: ReturnType<typeof viewer>) => ({ state: 'awaiting' as const, request: { assignee }, viewer: who });
  const pedro = { id: 'person-pedro' };
  assert.equal(approvalNoticeKind(awaiting(pedro, viewer({ isRequester: true }))), 'sent');
  assert.equal(approvalNoticeKind(awaiting(pedro, viewer({ canDecide: true, isAssignee: true }))), 'awaiting_you');
  // An admin who was not asked reads where it is, not "pediu sua aprovação".
  assert.equal(approvalNoticeKind(awaiting(pedro, viewer({ canDecide: true }))), 'sent');
  // Nobody named (legacy send): any decider is asked.
  assert.equal(approvalNoticeKind(awaiting(null, viewer({ canDecide: true }))), 'awaiting_you');
  // The sender never decides on their own send, admins included.
  assert.equal(approvalNoticeKind(awaiting(null, viewer({ canDecide: true, isRequester: true }))), 'sent');
  assert.equal(approvalNoticeKind({ state: 'changes_requested', viewer: viewer() }), 'changes');
  assert.equal(approvalNoticeKind({ state: 'approved', viewer: viewer() }), 'approved');
  assert.equal(approvalNoticeKind({ state: 'approval_outdated', viewer: viewer() }), 'approval_outdated');
  assert.equal(approvalNoticeKind({ state: 'none', viewer: viewer() }), null);
  assert.equal(approvalNoticeKind({ state: 'approved', viewer: viewer() }, true), 'decided');
});
