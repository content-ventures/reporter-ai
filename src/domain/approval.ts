import type { CheckResult } from './checks.ts';
import type { ReviewRequest } from './decision.ts';
import type { CheckId, IsoDateTime, PieceId, SlideId, SuggestionId } from './ids.ts';
import { bodyHash } from './piece.ts';
import type { PieceKind } from './piece.ts';
import { findPiece, latestApproved, pendingReview, pieceDecisions } from './record.ts';
import type { ProductionRecord } from './record.ts';
import type { TextRange } from './refs.ts';
import { charactersAbove, formatLaudasOf, groupDigits } from './sizing.ts';
import type { ArticleSize } from './sizing.ts';

/**
 * Approval of one piece in the writer's words (D10): where the piece stands at its gate, whether
 * the text is locked while someone decides, how urgent the request is, and what is still missing
 * before "Enviar para aprovação" (the pre-send dialog and the studio footer read `sendChecklist`).
 */

/** "Rascunho" (none) · "Aguardando aprovação" · "Ajustes solicitados" · "Aprovado" · "Aprovação desatualizada". */
export type ApprovalState = 'none' | 'awaiting' | 'changes_requested' | 'approved' | 'approval_outdated';

export function approvalStateOf(record: ProductionRecord, pieceId: PieceId): ApprovalState {
  if (pendingReview(record, pieceId)) return 'awaiting';
  const decisions = pieceDecisions(record, pieceId);
  const last = decisions[decisions.length - 1];
  if (!last) return 'none';
  if (last.decision === 'changes_requested' || last.decision === 'rejected') return 'changes_requested';
  if (last.decision !== 'approved') return 'none';
  const approved = latestApproved(record, pieceId);
  const piece = findPiece(record, pieceId);
  if (!approved || !piece) return 'none';
  // Editing after approval keeps the approval (carousel and delivery use it) but asks to resend.
  return bodyHash(piece.draft.body) === approved.version.hash ? 'approved' : 'approval_outdated';
}

/** The text is locked while a request waits for a decision ("Retirar envio para editar", D8). */
export function isLocked(record: ProductionRecord, pieceId: PieceId): boolean {
  return pendingReview(record, pieceId) !== undefined;
}

/**
 * Refusal of any change while the piece waits for a decision (COPY §5.4), shared by the store's
 * commands and the generation adapter: "O texto está com Pedro para aprovação. Retire o envio
 * para editar." (carousel: "O carrossel …"; nobody named: "… está aguardando aprovação. …").
 */
export function lockedMessage(kind: PieceKind, assigneeFirstName?: string): string {
  const subject = kind === 'carousel' ? 'O carrossel' : 'O texto';
  return assigneeFirstName
    ? `${subject} está com ${assigneeFirstName} para aprovação. Retire o envio para editar.`
    : `${subject} está aguardando aprovação. Retire o envio para editar.`;
}

/** "Para quando" against today: nothing set, a later day, today, or past due. */
export type DueState = 'none' | 'later' | 'today' | 'overdue';

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` of an instant in the local calendar (the newsroom's day, not UTC's). */
export function localDateOf(instant: IsoDateTime): string | undefined {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) return undefined;
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dueStateOf(dueOn: string | undefined, now: IsoDateTime): DueState {
  if (!dueOn || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return 'none';
  const today = localDateOf(now);
  if (!today) return 'none';
  if (dueOn < today) return 'overdue';
  return dueOn === today ? 'today' : 'later';
}

/** "Para quando" a send accepts: a real calendar date `YYYY-MM-DD`, today or later (local calendar of `now`). */
export function isValidDue(dueOn: string, now: IsoDateTime): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueOn);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const today = localDateOf(now);
  return today !== undefined && dueOn >= today;
}

/** "2º envio": 1-based position of a request among the piece's sends at its gate (withdrawn ones do not count). */
export function requestRound(record: Pick<ProductionRecord, 'reviewRequests'>, request: ReviewRequest): number {
  const before = record.reviewRequests.filter(
    (entry) =>
      entry.id !== request.id &&
      entry.subject.pieceId === request.subject.pieceId &&
      entry.gate === request.gate &&
      entry.withdrawnAt === undefined &&
      Date.parse(entry.requestedAt) <= Date.parse(request.requestedAt),
  );
  return before.length + 1;
}

// ── Pre-send checklist ("Antes de enviar") ──────────────────────────────────────────────

/** "Falta" blocks sending · "Aviso" informs · "Ok" is the summary row. */
export type SendItemLevel = 'missing' | 'warning' | 'ok';

/**
 * `slides`: slides whose text does not fit; `slides-required`: slides missing a required text
 * (two sentences of COPY §5.2, so two rows).
 */
export type SendItemId =
  | 'empty'
  | 'generation'
  | 'suggestions'
  | 'text-review'
  | 'quotes'
  | 'title'
  | 'slides'
  | 'slides-required'
  | 'images'
  | 'size'
  | 'image-credits'
  | 'image-alt'
  | 'links'
  | 'summary';

/**
 * Where an item's link jumps ("Ir ao trecho", "Revisar", "Ver slide"). `ranges` lists the spots in
 * reading order (the screen goes to the next one); an empty list is the start of the text ("Ir ao
 * texto"). `check` points at a check: `article.title` is the title field, `article.length` the
 * size, `article.generation` / `carousel.generation` the AI's output.
 */
export type SendTarget =
  | { kind: 'suggestion'; suggestionId: SuggestionId }
  | { kind: 'ranges'; ranges: TextRange[] }
  | { kind: 'check'; checkId: CheckId }
  | { kind: 'slide'; slideId: SlideId }
  /** Not a place: "Marcar como revisado" does it right where the item stands (the dialog row), no jump. */
  | { kind: 'mark-reviewed' };

export type SendItem = {
  id: SendItemId;
  level: SendItemLevel;
  /** The row ("1 sugestão da IA sem decisão"); `send_blocked` refusals read the first "Falta" one. */
  text: string;
  action?: { label: string; target: SendTarget };
  /**
   * The studio footer's part ("Falta para enviar: 1 sugestão · 1 citação"); only items the footer
   * lists have one. The text review has none: the footer's right side carries it.
   */
  short?: string;
  /** How many spots the item counts (2 for "2 citações"); the narrow footer sums them ("Falta 5"). */
  count?: number;
};

/** A slide text the template refuses: missing while required, or longer than its slot. */
export type SlideIssueInput = { slideId: SlideId; kind: 'missing' | 'overflow' | 'unknown_layout' };

export type SendChecklistInput = {
  kind: PieceKind;
  /** Checks evaluated on the text that would be sent (the current draft). */
  checks: readonly CheckResult[];
  openSuggestionIds: readonly SuggestionId[];
  /** The AI is still writing this piece. */
  running: boolean;
  /** The text has nothing in it. */
  empty: boolean;
  size?: ArticleSize;
  characters?: number;
  /** Carousel: number of slides ("5 slides"). */
  slides?: number;
  /** Carousel: slide texts the template refuses, in slide order (`slotIssues`). */
  slideIssues?: readonly SlideIssueInput[];
};

const count = (value: number, singular: string, plural: string): string => `${value} ${value === 1 ? singular : plural}`;

/** Items still pending of a check that counts `current` of `total` (citations checked, images with alt text). */
function pendingOf(check: CheckResult | undefined): number {
  if (!check || check.status !== 'warn') return 0;
  if (check.progress) return Math.max(0, check.progress.total - check.progress.current);
  return check.targets?.length ?? 0;
}

function rangesOf(check: CheckResult | undefined): SendTarget {
  return { kind: 'ranges', ranges: check?.targets ? check.targets.map((range) => ({ ...range })) : [] };
}

const IMAGE_ISSUE_PATTERNS: readonly [RegExp, (value: number) => string][] = [
  [/^(\d+) não encontradas?$/, (value) => count(value, 'imagem não encontrada', 'imagens não encontradas')],
  [/^(\d+) sem crédito$/, (value) => count(value, 'imagem sem crédito', 'imagens sem crédito')],
  [/^(\d+) sem uso autorizado$/, (value) => count(value, 'imagem sem uso autorizado', 'imagens sem uso autorizado')],
];

/** "1 imagem sem crédito" from the check's "1 sem crédito · 1 sem uso autorizado". */
function imageCreditText(check: CheckResult): string {
  const parts = (check.detail ?? '')
    .split(' · ')
    .map((part) => {
      for (const [pattern, phrase] of IMAGE_ISSUE_PATTERNS) {
        const match = pattern.exec(part.trim());
        if (match) return phrase(Number(match[1]));
      }
      return undefined;
    })
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(' · ') : count(pendingOf(check), 'imagem sem crédito', 'imagens sem crédito');
}

/**
 * What stands between the draft and "Enviar para aprovação": "Falta" items first, then "Aviso",
 * then ONE `summary` row ("3 de 3 citações conferidas · 1,6 de 2 laudas").
 *
 * R1 table (main-agent override): "Falta" = empty text, the AI still writing or interrupted, open
 * AI suggestions, the AI text not reviewed (ONE item for the whole text, "Marcar como revisado"
 * right on the row; once marked the row is "Ok · Texto revisado"), quotes that do not match the
 * interview, missing title; carousel: slides whose text is missing or does not fit. Image slots,
 * size above the maximum, image credit and rights, alt text and links are an "Aviso" (they never
 * block).
 */
export function sendChecklist(input: SendChecklistInput): SendItem[] {
  const byId = new Map(input.checks.map((check) => [check.id, check]));
  const check = (id: string) => byId.get(id);
  const generation = check(input.kind === 'carousel' ? 'carousel.generation' : 'article.generation');
  const generationItem: SendItem = {
    id: 'generation',
    level: 'missing',
    text: 'A IA não terminou o texto',
    action: { label: 'Ver no texto', target: { kind: 'check', checkId: generation?.id ?? `${input.kind}.generation` } },
  };
  // While the AI writes, the text is a partial one: nothing else is worth listing yet.
  if (input.running) return [generationItem];
  if (input.empty) {
    return [{ id: 'empty', level: 'missing', text: 'O texto está vazio', action: { label: 'Ir ao texto', target: { kind: 'ranges', ranges: [] } }, short: 'o texto' }];
  }

  const missing: SendItem[] = [];
  const warnings: SendItem[] = [];
  if (generation?.status === 'fail') missing.push(generationItem);
  const open = input.openSuggestionIds.length;
  if (open > 0) {
    missing.push({
      id: 'suggestions',
      level: 'missing',
      text: count(open, 'sugestão da IA sem decisão', 'sugestões da IA sem decisão'),
      action: { label: 'Ir ao trecho', target: { kind: 'suggestion', suggestionId: input.openSuggestionIds[0] } },
      short: count(open, 'sugestão', 'sugestões'),
      count: open,
    });
  }

  if (input.kind === 'carousel') {
    const issues = input.slideIssues ?? [];
    const slidesWith = (kinds: readonly SlideIssueInput['kind'][]) => [...new Set(issues.filter((issue) => kinds.includes(issue.kind)).map((issue) => issue.slideId))];
    const required = slidesWith(['missing']);
    const overflow = slidesWith(['overflow', 'unknown_layout']).filter((slideId) => !required.includes(slideId));
    if (required.length > 0) {
      missing.push({
        id: 'slides-required',
        level: 'missing',
        text: count(required.length, 'slide sem o texto obrigatório', 'slides sem o texto obrigatório'),
        action: { label: 'Ver slide', target: { kind: 'slide', slideId: required[0] } },
        count: required.length,
      });
    }
    if (overflow.length > 0) {
      missing.push({
        id: 'slides',
        level: 'missing',
        text: count(overflow.length, 'slide com texto que não cabe', 'slides com texto que não cabe'),
        action: { label: 'Ver slide', target: { kind: 'slide', slideId: overflow[0] } },
        count: overflow.length,
      });
    }
    const items = [...missing, ...warnings];
    if (input.slides !== undefined && input.slides > 0) items.push({ id: 'summary', level: 'ok', text: count(input.slides, 'slide', 'slides') });
    return items;
  }

  const quotes = check('article.quotes');
  const wrongQuotes = pendingOf(quotes);
  if (wrongQuotes > 0) {
    missing.push({
      id: 'quotes',
      level: 'missing',
      text: count(wrongQuotes, 'citação não confere com a entrevista', 'citações não conferem com a entrevista'),
      action: { label: 'Ir ao trecho', target: rangesOf(quotes) },
      short: count(wrongQuotes, 'citação', 'citações'),
      count: wrongQuotes,
    });
  }
  const title = check('article.title');
  if (title && title.status !== 'pass' && title.status !== 'na') {
    missing.push({ id: 'title', level: 'missing', text: 'Falta o título', action: { label: 'Ir ao título', target: { kind: 'check', checkId: title.id } }, short: 'o título' });
  }

  const passages = check('article.ai-reviewed');
  if (pendingOf(passages) > 0) {
    // One review for the whole text, a "Falta": the fix is on the row, no passage to walk through.
    missing.push({ id: 'text-review', level: 'missing', text: 'Texto não revisado', action: { label: 'Marcar como revisado', target: { kind: 'mark-reviewed' } } });
  }
  const slots = check('article.image-slots');
  const openSlots = slots?.status === 'warn' ? (slots.targets?.length ?? 0) : 0;
  if (openSlots > 0) {
    warnings.push({ id: 'images', level: 'warning', text: count(openSlots, 'imagem sugerida sem arquivo', 'imagens sugeridas sem arquivo'), action: { label: 'Ver', target: rangesOf(slots) }, count: openSlots });
  }
  const size = check('article.length');
  if (size?.status === 'warn' && input.size && input.characters !== undefined) {
    warnings.push({
      id: 'size',
      level: 'warning',
      text: `${formatLaudasOf(input.characters, input.size)} · passa ${groupDigits(charactersAbove(input.characters, input.size))} caracteres`,
      action: { label: 'Ver', target: { kind: 'check', checkId: size.id } },
    });
  }
  const credits = check('article.image-credits');
  if (credits?.status === 'warn') warnings.push({ id: 'image-credits', level: 'warning', text: imageCreditText(credits), action: { label: 'Ver', target: rangesOf(credits) } });
  const alt = check('article.image-alt');
  const withoutAlt = pendingOf(alt);
  if (withoutAlt > 0) {
    warnings.push({ id: 'image-alt', level: 'warning', text: count(withoutAlt, 'imagem sem texto alternativo', 'imagens sem texto alternativo'), action: { label: 'Ver', target: rangesOf(alt) }, count: withoutAlt });
  }
  const links = check('article.links');
  const broken = pendingOf(links);
  if (broken > 0) {
    warnings.push({ id: 'links', level: 'warning', text: count(broken, 'link inválido', 'links inválidos'), action: { label: 'Ir ao trecho', target: rangesOf(links) }, count: broken });
  }

  const summary: string[] = [];
  if (quotes?.progress && quotes.progress.total > 0) summary.push(`${quotes.progress.current} de ${quotes.progress.total} citações conferidas`);
  if (input.size && input.characters !== undefined && input.characters > 0) summary.push(formatLaudasOf(input.characters, input.size));
  const items = [...missing, ...warnings];
  if (passages?.status === 'pass') items.push({ id: 'text-review', level: 'ok', text: 'Texto revisado' });
  if (summary.length > 0) items.push({ id: 'summary', level: 'ok', text: summary.join(' · ') });
  return items;
}

/** The first "Falta" item: the reason sending is blocked (`send_blocked`). */
export function sendBlocker(items: readonly SendItem[]): SendItem | undefined {
  return items.find((item) => item.level === 'missing');
}

/** `send_blocked` message: the first "Falta" item as a sentence ("1 sugestão da IA sem decisão."). */
export function sendBlockedMessage(item: Pick<SendItem, 'text'>): string {
  return /[.!?…]$/.test(item.text) ? item.text : `${item.text}.`;
}
