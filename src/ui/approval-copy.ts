import { dueStateOf, localDateOf } from '../domain/approval.ts';
import { firstName } from '../domain/workspace.ts';
import type { DueState, SendItemLevel } from '../domain/approval.ts';

/**
 * Every sentence of the approval flow (COPY §5): the task notices above the text, the pre-send
 * dialog, the undo and withdraw confirmations, plus the time and due formats the queues share
 * ("há 2 h", "desde 14:10", "prazo: hoje", "atrasado · prazo era 07/10"). Pure functions with an
 * explicit `now`, so screens never hand-format these strings and server and browser agree.
 * Dates are read in the local calendar (the newsroom's day).
 */

type Instant = Date | string;

/** What the notice is about: the article text or the carousel slides. */
export type ApprovalSubject = 'article' | 'carousel';

/** What follows an approved piece ("Próximo passo: o carrossel / a entrega / baixar o pacote"). */
export type ApprovedNext = 'carousel' | 'delivery' | 'package';

const pad = (value: number) => String(value).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: Instant | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  // A bare calendar day ("2026-10-08") is that day in the local calendar, not UTC midnight.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Calendar days from `from` to `to` (local): same day 0, yesterday → today 1. */
function calendarDays(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

/** "Pedro" from "Pedro Alves" (the notices name people by their first name). */
export { firstName };

/** A recado or nota in typographic quotes, cut at `max` characters on a word: “O título promete…” */
export function quoteNote(note: string, max = 80): string {
  const text = note.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return `“${text}”`;
  const cut = text.slice(0, max);
  const word = cut.lastIndexOf(' ');
  const head = (word > max * 0.6 ? cut.slice(0, word) : cut).replace(/[\s,.;:!?–—-]+$/, '');
  return `“${head}…”`;
}

/** "08/10" (with the year when it is not the year of `now`: "08/10/2025"). */
export function formatDayMonth(value: Instant, now?: Instant): string {
  const date = toDate(value);
  if (!date) return '—';
  const reference = toDate(now);
  const short = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  return reference && reference.getFullYear() !== date.getFullYear() ? `${short}/${date.getFullYear()}` : short;
}

/** "08/10, 14:20". */
export function formatDayTime(at: Instant, now?: Instant): string {
  const date = toDate(at);
  if (!date) return '—';
  return `${formatDayMonth(date, now)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "agora", "há 5 min", "há 2 h", "ontem", "08/10" (COPY §0.6). */
export function formatAgo(at: Instant, now: Instant): string {
  const date = toDate(at);
  const reference = toDate(now);
  if (!date || !reference) return '';
  const span = Math.max(0, reference.getTime() - date.getTime());
  if (span < 60_000) return 'agora';
  if (span < 3_600_000) return `há ${Math.floor(span / 60_000)} min`;
  if (span < DAY_MS) return `há ${Math.floor(span / 3_600_000)} h`;
  if (calendarDays(date, reference) <= 1) return 'ontem';
  return formatDayMonth(date, reference);
}

/** "desde 14:10" (today), "desde ontem", "desde 07/10". */
export function formatSince(at: Instant, now: Instant): string {
  const date = toDate(at);
  const reference = toDate(now);
  if (!date || !reference) return '';
  const days = calendarDays(date, reference);
  if (days <= 0) return `desde ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (days === 1) return 'desde ontem';
  return `desde ${formatDayMonth(date, reference)}`;
}

/**
 * "Para quando" against today, for `NextAction` (`due` 'today' orange, 'overdue' red): "prazo:
 * hoje", "prazo: amanhã", "prazo: 10/10", "atrasado · prazo era 07/10"; nothing without a date.
 */
export function formatDue(dueOn: string | undefined, now: Instant): { text: string; due: DueState } {
  const reference = toDate(now);
  if (!dueOn || !reference) return { text: '', due: 'none' };
  const due = dueStateOf(dueOn, reference.toISOString());
  const day = toDate(dueOn);
  if (due === 'none' || !day) return { text: '', due: 'none' };
  if (due === 'today') return { text: 'prazo: hoje', due };
  if (due === 'overdue') return { text: `atrasado · prazo era ${formatDayMonth(day, reference)}`, due };
  return { text: calendarDays(reference, day) === 1 ? 'prazo: amanhã' : `prazo: ${formatDayMonth(day, reference)}`, due };
}

/** "2º envio", "3º envio"; the first send is never labelled. */
export function roundLabel(round: number): string | undefined {
  return round >= 2 ? `${round}º envio` : undefined;
}

// ── Task notices (COPY §5.1) ────────────────────────────────────────────────────────────

/** Verbs of the notices. "Retirar envio" is the same command in the ⋯ menus. */
export const NOTICE_VERBS = {
  stop: 'Parar',
  retry: 'Tentar de novo',
  withdraw: 'Retirar envio para editar',
  withdrawMenu: 'Retirar envio',
  comments: 'Ver comentários',
  undo: 'Desfazer mudanças',
  review: 'Revisar',
  approvals: 'Ver aprovações',
} as const;

type Parts = { current: number; total: number } | undefined;

/** "A IA está escrevendo · parte 2 de 4. Você pode ler enquanto isso." */
export function writingNotice(subject: ApprovalSubject, parts?: Parts): string {
  if (subject === 'carousel') return 'A IA está escrevendo os slides. Você pode ler enquanto isso.';
  return parts
    ? `A IA está escrevendo · parte ${parts.current} de ${parts.total}. Você pode ler enquanto isso.`
    : 'A IA está escrevendo. Você pode ler enquanto isso.';
}

/** "A IA parou ao escrever a parte 2 de 4. O que já foi escrito está salvo." */
export function errorNotice(subject: ApprovalSubject, parts?: Parts): string {
  return subject === 'article' && parts
    ? `A IA parou ao escrever a parte ${parts.current} de ${parts.total}. O que já foi escrito está salvo.`
    : 'A IA parou antes de terminar. O que já foi escrito está salvo.';
}

const LOCKED: Record<ApprovalSubject, string> = {
  article: 'O texto fica travado até a decisão.',
  carousel: 'O carrossel fica travado até a decisão.',
};

function sentence(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** "Enviado para Pedro há 5 min · prazo: hoje. O texto fica travado até a decisão." */
export function sentNotice(input: {
  subject: ApprovalSubject;
  assigneeName?: string | null;
  at: Instant;
  now?: Instant;
  dueOn?: string;
}): string {
  const who = firstName(input.assigneeName);
  const ago = input.now ? formatAgo(input.at, input.now) : '';
  const head = [who ? `Enviado para ${who}` : 'Enviado para aprovação', ago].filter(Boolean).join(' ');
  const due = input.now ? formatDue(input.dueOn, input.now).text : '';
  return `${sentence([head, due])}. ${LOCKED[input.subject]}`;
}

/** "Juliana Prates pediu sua aprovação há 2 h · prazo: hoje." */
export function awaitingYouNotice(input: { requesterName?: string | null; at: Instant; now?: Instant; dueOn?: string }): string {
  const who = (input.requesterName ?? '').trim();
  const ago = input.now ? formatAgo(input.at, input.now) : '';
  const head = [who ? `${who} pediu sua aprovação` : 'Pediram sua aprovação', ago].filter(Boolean).join(' ');
  const due = input.now ? formatDue(input.dueOn, input.now).text : '';
  return `${sentence([head, due])}.`;
}

/** "Pedro pediu ajustes: “O título promete mais do que o texto entrega.”" */
export function changesNotice(input: { deciderName?: string | null; note?: string }): string {
  const who = firstName(input.deciderName);
  const head = who ? `${who} pediu ajustes` : 'Ajustes solicitados';
  const note = input.note?.trim();
  return note ? `${head}: ${quoteNote(note)}` : `${head}.`;
}

const NEXT_WORDS: Record<ApprovedNext, string> = {
  carousel: 'o carrossel',
  delivery: 'a entrega',
  package: 'baixar o pacote',
};

/** "Aprovado por Pedro · 08/10, 14:20. Próximo passo: o carrossel." */
export function approvedNotice(input: { deciderName?: string | null; at: Instant; now?: Instant; next?: ApprovedNext }): string {
  const who = firstName(input.deciderName);
  const when = toDate(input.at) ? formatDayTime(input.at, input.now) : undefined;
  const head = `${sentence([who ? `Aprovado por ${who}` : 'Aprovado', when])}.`;
  return input.next ? `${head} Próximo passo: ${NEXT_WORDS[input.next]}.` : head;
}

/** Who keeps using the approved version while the text differs from it. */
export type ApprovedUsers = 'carousel_and_delivery' | 'delivery';

/** "Você mudou o texto aprovado. Carrossel e entrega seguem a versão aprovada em 08/10." */
export function approvalOutdatedNotice(input: {
  subject: ApprovalSubject;
  approvedAt: Instant;
  now?: Instant;
  usedBy?: ApprovedUsers;
}): string {
  const day = formatDayMonth(input.approvedAt, input.now);
  const changed = input.subject === 'carousel' ? 'Você mudou o carrossel aprovado.' : 'Você mudou o texto aprovado.';
  const usedBy = input.usedBy ?? (input.subject === 'article' ? 'carousel_and_delivery' : 'delivery');
  const follows = usedBy === 'carousel_and_delivery' ? `Carrossel e entrega seguem a versão aprovada em ${day}.` : `A entrega segue a versão aprovada em ${day}.`;
  return `${changed} ${follows}`;
}

/** "Aprovado · Juliana recebeu o aviso. Próxima: Lume Acessórios…" (approver, right after deciding). */
export function decidedNotice(input: { decision: 'approved' | 'changes_requested'; requesterName?: string | null; nextTitle?: string }): string {
  const head = input.decision === 'approved' ? 'Aprovado' : 'Ajustes pedidos';
  const who = firstName(input.requesterName);
  const told = who ? `${head} · ${who} recebeu o aviso.` : `${head}.`;
  const title = input.nextTitle?.trim().replace(/[.!?…]+$/, '');
  return title ? `${told} Próxima: ${title}.` : `${told} Nada mais esperando você.`;
}

/** "Desfazer mudanças": back to the approved text (the edited one stays in the history). */
export function undoChangesConfirm(input: { subject: ApprovalSubject; approvedAt: Instant; now?: Instant }) {
  const day = formatDayMonth(input.approvedAt, input.now);
  const what = input.subject === 'carousel' ? 'O carrossel' : 'O texto';
  return {
    title: 'Desfazer as mudanças?',
    description: `${what} volta para a versão aprovada em ${day}.`,
    confirm: NOTICE_VERBS.undo,
    toast: 'Mudanças desfeitas',
  } as const;
}

/** Toast after "Retirar envio": "Envio retirado. O texto voltou a ser editável." */
export function withdrawnToast(subject: ApprovalSubject): { title: string; description: string } {
  return {
    title: 'Envio retirado',
    description: subject === 'carousel' ? 'O carrossel voltou a ser editável.' : 'O texto voltou a ser editável.',
  };
}

// ── Pre-send dialog (COPY §5.2) ────────────────────────────────────────────────────────

export const SEND_LEVEL_LABELS: Readonly<Record<SendItemLevel, string>> = { missing: 'Falta', warning: 'Aviso', ok: 'Ok' };

export const SEND_FIELDS = {
  checklist: 'Antes de enviar',
  assignee: 'Quem aprova',
  note: 'Recado',
  notePlaceholder: 'Ex.: Pode revisar hoje?',
  due: 'Para quando',
  date: 'Data',
} as const;

export const NOTE_MAX = 500;

/** "Quem aprova" option meta: the role that lets the person decide at this gate. */
export const APPROVER_ROLE_LABELS: Readonly<Record<'approver' | 'creative_reviewer' | 'admin', string>> = {
  approver: 'Aprovador',
  creative_reviewer: 'Revisor criativo',
  admin: 'Admin',
};

export const NO_APPROVER_REASON = 'Ninguém pode aprovar ainda. Peça a um admin o papel de aprovador.';
export const INVALID_DUE = 'Escolha hoje ou uma data futura.';

/** "Enviar para aprovação" / "Reenviar para aprovação". */
export function sendDialogTitle(isResend: boolean): string {
  return isResend ? 'Reenviar para aprovação' : 'Enviar para aprovação';
}

/** "Enviar para Pedro" / "Reenviar para Pedro" (no one chosen yet: the dialog title). */
export function sendButtonLabel(isResend: boolean, assigneeName?: string | null): string {
  const who = firstName(assigneeName);
  if (!who) return sendDialogTitle(isResend);
  return `${isResend ? 'Reenviar' : 'Enviar'} para ${who}`;
}

/**
 * "Resolva o item marcado “Falta” para enviar." / "Resolva os 2 itens marcados “Falta” para
 * enviar."; when the only one is the text review, it says what to do: "Marque o texto como revisado
 * para enviar."
 */
export function missingItemsReason(count: number, onlyReview = false): string {
  if (count === 1 && onlyReview) return 'Marque o texto como revisado para enviar.';
  return count === 1 ? 'Resolva o item marcado “Falta” para enviar.' : `Resolva os ${count} itens marcados “Falta” para enviar.`;
}

/** "Enviado para Pedro". */
export function sentToast(assigneeName?: string | null): string {
  const who = firstName(assigneeName);
  return who ? `Enviado para ${who}` : 'Enviado para aprovação';
}

export type DueChoice = 'none' | 'today' | 'tomorrow' | 'pick';

export const DUE_OPTIONS: readonly { value: DueChoice; label: string }[] = [
  { value: 'none', label: 'Sem prazo' },
  { value: 'today', label: 'Hoje' },
  { value: 'tomorrow', label: 'Amanhã' },
  { value: 'pick', label: 'Escolher data…' },
];

/** `YYYY-MM-DD` in the local calendar (the domain's `localDateOf`, for a Date or an instant). */
export function calendarDate(value: Instant): string | undefined {
  const date = toDate(value);
  return date ? localDateOf(date.toISOString()) : undefined;
}

/** The `dueOn` a choice means today ("Hoje", "Amanhã", a picked day); `undefined` = no due date. */
export function dueOnFor(choice: DueChoice, now: Instant, picked?: string): string | undefined {
  const today = toDate(now);
  if (!today) return undefined;
  switch (choice) {
    case 'none':
      return undefined;
    case 'today':
      return calendarDate(today);
    case 'tomorrow':
      return calendarDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 12));
    case 'pick':
      return picked && /^\d{4}-\d{2}-\d{2}$/.test(picked) ? picked : undefined;
  }
}

// ── Guided review task card (COPY §4.2) ─────────────────────────────────────────────────

/** "Juliana Prates pediu sua aprovação". */
export function taskCardTitle(requesterName?: string | null): string {
  const who = (requesterName ?? '').trim();
  return who ? `${who} pediu sua aprovação` : 'Pediram sua aprovação';
}

/** "há 2 h · 2º envio". */
export function taskCardMeta(at: Instant, now: Instant | undefined, round: number): string {
  return sentence([now ? formatAgo(at, now) : undefined, roundLabel(round)]);
}

// ── Which approval notice a viewer sees ────────────────────────────────────────────────

type NoticeApproval = {
  state: 'none' | 'awaiting' | 'changes_requested' | 'approved' | 'approval_outdated';
  request?: { assignee: { id: string } | null };
  viewer: { canDecide: boolean; isRequester: boolean; isAssignee: boolean };
};

/**
 * The approval notice of a piece for the acting member (`null`: none), so a screen can pick ONE
 * notice: the sender (and anyone not asked) sees "Enviado para Pedro…", the person asked (or any
 * decider when nobody was named) "Juliana pediu sua aprovação…", then the decision's notice.
 * `decided`: the approver has just decided on this screen.
 */
export function approvalNoticeKind(
  approval: NoticeApproval,
  decided = false,
): 'decided' | 'sent' | 'awaiting_you' | 'changes' | 'approved' | 'approval_outdated' | null {
  if (decided) return 'decided';
  switch (approval.state) {
    case 'awaiting': {
      const { viewer } = approval;
      const asked = viewer.isAssignee || !approval.request?.assignee;
      return viewer.canDecide && !viewer.isRequester && asked ? 'awaiting_you' : 'sent';
    }
    case 'changes_requested':
      return 'changes';
    case 'approved':
      return 'approved';
    case 'approval_outdated':
      return 'approval_outdated';
    default:
      return null;
  }
}
