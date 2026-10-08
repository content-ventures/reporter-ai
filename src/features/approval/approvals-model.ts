import { firstName, formatLaudasOf, PIECE_LABELS } from '../../domain/index.ts';
import type { DueState } from '../../domain/index.ts';
import type { ApprovalItem, ApprovalsTab } from '../../ports/index.ts';
import { formatAgo, formatDayTime, formatDue, quoteNote, roundLabel } from '../../ui/approval-copy.ts';

/**
 * Pure rules of the Aprovações page (D10, COPY §3): the tabs, the line under each piece, who sent
 * it and when, the due date in the `NextAction` tones, and what an empty tab says. No React, no
 * Design System: tested with `node --test`.
 */

type Instant = Date | string;

export type ApprovalsTabDefinition = { value: ApprovalsTab; label: string };

/** "Para aprovar" carries the count (the menu's "Aprovações N"); the other two are history. */
export const APPROVALS_TABS: readonly ApprovalsTabDefinition[] = [
  { value: 'to_approve', label: 'Para aprovar' },
  { value: 'approved_by_me', label: 'Aprovadas por mim' },
  { value: 'returned', label: 'Devolvidas' },
];

/** Empty tab (COPY §3). */
export const APPROVALS_EMPTY: Readonly<Record<ApprovalsTab, { title: string; description?: string }>> = {
  to_approve: { title: 'Nada para aprovar', description: 'Quando alguém enviar uma peça para você, ela aparece aqui.' },
  approved_by_me: { title: 'Nenhuma aprovação ainda' },
  returned: { title: 'Nada devolvido' },
};

export const APPROVALS_COPY = {
  title: 'Aprovações',
  error: 'Não foi possível carregar as aprovações',
  noAccessTitle: 'Aprovações é para quem aprova',
  noAccessDescription: 'Peça a um admin o papel de aprovador.',
  noAccessAction: 'Ver produções',
  review: 'Revisar',
  open: 'Abrir',
} as const;

/** Column headers per tab (COPY §3). */
export const APPROVALS_COLUMNS = {
  piece: 'Peça',
  sender: 'Enviada por',
  note: 'Recado',
  due: 'Prazo',
  approvedAt: 'Aprovada em',
  returnedAt: 'Devolvida em',
  decisionNote: 'Nota',
} as const;

/**
 * The line under the production title: "Artigo · 1,4 de 2 laudas · 2º envio" / "Carrossel · 5
 * slides". The round only says something while the piece waits ("Para aprovar").
 */
export function pieceMeta(item: ApprovalItem, options: { round?: boolean } = {}): string {
  const label = PIECE_LABELS[item.kind] ?? item.pieceLabel;
  const size =
    item.kind === 'carousel'
      ? item.slides !== undefined
        ? `${item.slides} ${item.slides === 1 ? 'slide' : 'slides'}`
        : undefined
      : item.characters !== undefined && item.size
        ? formatLaudasOf(item.characters, item.size)
        : undefined;
  const round = options.round ? roundLabel(item.round) : undefined;
  return [label, size, round].filter(Boolean).join(' · ');
}

/** "Juliana · há 2 h": who sent it (first name) and when. */
export function senderLine(item: Pick<ApprovalItem, 'requester' | 'requestedAt'>, now: Instant | undefined): string {
  const who = firstName(item.requester?.name) || 'Alguém';
  const ago = now ? formatAgo(item.requestedAt, now) : '';
  return ago ? `${who} · ${ago}` : who;
}

/** `NextAction` tone of a due date: today orange, overdue red, later plain. */
export type DueTone = 'today' | 'overdue' | 'later';

const DUE_TONE: Readonly<Record<Exclude<DueState, 'none'>, DueTone>> = { today: 'today', overdue: 'overdue', later: 'later' };

/** "prazo: hoje" (orange), "atrasado · prazo era 07/10" (red), "prazo: 10/10"; nothing without a date. */
export function dueOf(dueOn: string | undefined, now: Instant | undefined): { text: string; tone: DueTone } | undefined {
  if (!dueOn || !now) return undefined;
  const { text, due } = formatDue(dueOn, now);
  if (due === 'none' || !text) return undefined;
  return { text, tone: DUE_TONE[due] };
}

/** The recado in quotes, cut on a word ("“Pedro, pode revisar hoje? …”"); nothing without one. */
export function noteLine(note: string | undefined, max = 80): string | undefined {
  const text = note?.trim();
  return text ? quoteNote(text, max) : undefined;
}

/** "08/10, 14:20": when the viewer decided ("Aprovada em", "Devolvida em"). */
export function decidedLine(item: Pick<ApprovalItem, 'decidedAt'>, now: Instant | undefined): string | undefined {
  return item.decidedAt ? formatDayTime(item.decidedAt, now) : undefined;
}

/**
 * One row on a phone: the piece, who sent it and the recado (cut last), so the title, the piece
 * and the sender stay readable on one line.
 */
export function phoneDescription(item: ApprovalItem, tab: ApprovalsTab, now: Instant | undefined): string {
  if (tab === 'to_approve') {
    return [pieceMeta(item, { round: true }), senderLine(item, now), noteLine(item.note, 60)].filter(Boolean).join(' · ');
  }
  const when = decidedLine(item, now);
  return [pieceMeta(item), when, tab === 'returned' ? noteLine(item.decisionNote, 60) : senderLine(item, now)].filter(Boolean).join(' · ');
}

/** Stable key of a row: one per piece (a piece appears once per tab). */
export function itemKey(item: Pick<ApprovalItem, 'pieceId'>): string {
  return item.pieceId;
}
