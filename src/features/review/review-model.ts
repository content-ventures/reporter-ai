import { blockText, creditLine, findBlock, firstName, formatLaudas, formatLaudasOf, PIECE_LABELS, sendChecklist } from '../../domain/index.ts';
import type {
  ArticleBody,
  ArticleSize,
  CheckResult,
  DecisionAnchor,
  DiffBlock,
  DiffChange,
  DiffHunk,
  ImageRef,
  PieceKind,
  TextRange,
  VersionView,
} from '../../domain/index.ts';
import type { ApprovalDecisionView, ApprovalRequestView, PersonSummary } from '../../ports/index.ts';
import { formatDayMonth, formatDayTime } from '../../ui/approval-copy.ts';

/**
 * Pure rules of the guided review (D10, COPY §4): which view opens ("O que mudou" when there was a
 * previous send), the checks in one line, the facts of the decision bar, the diff blocks handed to
 * the DS `DiffView`, the passages a reviewer points at, the text's origin on demand and the
 * history drawer's events. No React, no Design System: tested with `node --test`. No version
 * numbers anywhere (D11): versions are named by what happened to them and when.
 */

// ── Ver: O que mudou | Texto final ──────────────────────────────────────────────────────

export type ReviewMode = 'changes' | 'final';

const isMode = (value: unknown): value is ReviewMode => value === 'changes' || value === 'final';

/**
 * The view on screen: what the URL asks (`?ver=`), else the review's default ("O que mudou" when a
 * previous send was decided). Without a previous send there is nothing to compare: the final text.
 */
export function resolveMode(requested: string | null | undefined, review: { hasPrevious: boolean; defaultView: ReviewMode }): ReviewMode {
  if (!review.hasPrevious) return 'final';
  return isMode(requested) ? requested : review.defaultView;
}

/** "Texto final" for an article, "Slides" for a carousel (COPY §4.3). */
export function finalLabel(kind: PieceKind): string {
  return kind === 'carousel' ? 'Slides' : 'Texto final';
}

/** "3 trechos mudaram desde o envio anterior" / "Nada mudou desde o envio anterior." */
export function changedSummary(changed: number): string {
  if (changed <= 0) return 'Nada mudou desde o envio anterior.';
  return changed === 1 ? '1 trecho mudou desde o envio anterior' : `${changed} trechos mudaram desde o envio anterior`;
}

// ── Checagem numa linha ──────────────────────────────────────────────────────────────────

export type ChecksSummary = { level: 'ok' | 'warning' | 'missing'; text: string };

export type ChecksSummaryInput = {
  kind: PieceKind;
  /** Checks of the version under review. */
  checks: readonly CheckResult[];
  size?: ArticleSize;
  characters?: number;
};

const lower = (text: string) => text.charAt(0).toLocaleLowerCase('pt-BR') + text.slice(1);

/** A carousel check as a phrase ("Limites de texto: 1 slide passa do limite"). */
function checkPhrase(check: CheckResult): string {
  return check.detail ? `${check.label}: ${lower(check.detail)}` : check.label;
}

/**
 * The checks of the version in one line (COPY §4.3): "Tudo conferido", or what is missing first
 * ("Falta: 1 citação não confere com a entrevista"), else the warnings ("Aviso: 2 imagens
 * sugeridas sem arquivo"). The article reads the same items as the pre-send dialog, so the writer
 * and the approver see the same words; the carousel names its checks.
 */
export function checksSummary(input: ChecksSummaryInput): ChecksSummary {
  let missing: string[];
  let warnings: string[];
  if (input.kind === 'article') {
    const items = sendChecklist({
      kind: 'article',
      checks: input.checks,
      openSuggestionIds: [],
      running: false,
      empty: false,
      ...(input.size ? { size: input.size } : {}),
      ...(input.characters !== undefined ? { characters: input.characters } : {}),
    });
    missing = items.filter((item) => item.level === 'missing').map((item) => item.text);
    warnings = items.filter((item) => item.level === 'warning').map((item) => item.text);
  } else {
    missing = input.checks.filter((check) => check.status === 'fail').map(checkPhrase);
    warnings = input.checks.filter((check) => check.status === 'warn').map(checkPhrase);
  }
  if (missing.length > 0) return { level: 'missing', text: `Falta: ${missing.join(' · ')}` };
  if (warnings.length > 0) return { level: 'warning', text: `Aviso: ${warnings.join(' · ')}` };
  return { level: 'ok', text: 'Tudo conferido' };
}

// ── Barra de decisão ─────────────────────────────────────────────────────────────────────

/** "Aprovar artigo" / "Aprovar carrossel". */
export function approveLabel(kind: PieceKind): string {
  return `Aprovar ${PIECE_LABELS[kind].toLocaleLowerCase('pt-BR')}`;
}

/** "Aprovar o artigo" / "Aprovar o carrossel" (the approve popover's title). */
export function approveTitle(kind: PieceKind): string {
  return `Aprovar o ${PIECE_LABELS[kind].toLocaleLowerCase('pt-BR')}`;
}

/**
 * The bar's facts (COPY §4.4): "Artigo · 1,4 de 2 laudas · enviado por Juliana" / "Carrossel ·
 * 5 slides · enviado por Rafael". No version number.
 */
export function decisionFacts(input: DecisionFactsInput): string {
  return decisionFactList(input).join(' · ');
}

export type DecisionFactsInput = {
  kind: PieceKind;
  characters?: number;
  size?: ArticleSize;
  slides?: number;
  requesterName?: string | null;
};

/** The same facts one by one, for a `MetaList` (which draws the separators). */
export function decisionFactList(input: DecisionFactsInput): string[] {
  const size =
    input.kind === 'carousel'
      ? input.slides !== undefined
        ? `${input.slides} ${input.slides === 1 ? 'slide' : 'slides'}`
        : undefined
      : input.characters !== undefined
        ? input.size
          ? formatLaudasOf(input.characters, input.size)
          : formatLaudas(input.characters)
        : undefined;
  const who = firstName(input.requesterName);
  return [PIECE_LABELS[input.kind], size, who ? `enviado por ${who}` : undefined].filter((fact): fact is string => Boolean(fact));
}

/** "Pedir ajustes" dialog: "Juliana recebe a nota e os trechos apontados." */
export function returnDescription(requesterName?: string | null): string {
  const who = firstName(requesterName);
  return `${who || 'Quem enviou'} recebe a nota e os trechos apontados.`;
}

// ── Diferenças (DS DiffView) ─────────────────────────────────────────────────────────────

/** Mirrors the DS `DiffBlockType` (reading typography only). */
export type ReviewDiffType = 'title' | 'lead' | 'h2' | 'h3' | 'paragraph' | 'quote' | 'item' | 'caption';

/** Structurally the DS `DiffBlock`, built from the domain diff. */
export type ReviewDiffBlock = { id: string; change: DiffChange; hunks: DiffHunk[]; type: ReviewDiffType };

function diffType(block: DiffBlock): ReviewDiffType {
  switch (block.blockType) {
    case 'title':
      return 'title';
    // "[Imagem] Legenda — Foto: Crédito" reads as the caption it is.
    case 'cover':
    case 'figure':
      return 'caption';
    case 'heading':
      return block.level === 3 ? 'h3' : 'h2';
    case 'quote':
      return 'quote';
    case 'list':
      return 'item';
    default:
      return 'paragraph';
  }
}

/** Domain `DiffBlock[]` → DS blocks; dividers and empty blocks carry no text to compare. */
export function toReviewDiff(blocks: readonly DiffBlock[]): ReviewDiffBlock[] {
  return blocks
    .filter((block) => block.blockType !== 'divider' && block.hunks.some((hunk) => hunk.text.trim().length > 0))
    .map((block) => ({ id: block.id, change: block.change, hunks: block.hunks, type: diffType(block) }));
}

/** Passages that changed (the DS counts the same way): a block whose change or hunks are not "equal". */
export function changedCount(blocks: readonly ReviewDiffBlock[]): number {
  return blocks.filter((block) => block.change !== 'unchanged' || block.hunks.some((hunk) => hunk.kind !== 'equal')).length;
}

// ── Imagens ──────────────────────────────────────────────────────────────────────────────

/** "Legenda — Foto: Ana Prado": the line under an image (empty parts left out). */
export function imageCaption(caption: string | undefined, credit: string | undefined): string | undefined {
  const line = [caption?.replace(/\s+/g, ' ').trim(), creditLine(credit)].filter(Boolean).join(' — ');
  return line || undefined;
}

export type ImageChangeKind = 'added' | 'removed' | 'swapped' | 'caption' | 'alt';

export const IMAGE_CHANGE_LABELS: Record<ImageChangeKind, string> = {
  added: 'Nova',
  removed: 'Removida',
  swapped: 'Trocada',
  caption: 'Legenda ou crédito alterados',
  alt: 'Texto alternativo alterado',
};

export const IMAGE_ROLE_LABELS: Record<'cover' | 'figure', string> = { cover: 'Destaque', figure: 'Imagem no texto' };

/** An image the comparison touches: the cover or a figure, with what happened to it. */
export type ImageChange = {
  /** Block id (`cover` for the cover). */
  id: string;
  role: 'cover' | 'figure';
  kind: ImageChangeKind;
  /** The image after the change (before it, when removed). */
  image: ImageRef;
  /** Swapped: the image it replaced. */
  previous?: ImageRef;
};

/**
 * The images a comparison touches, in text order, so the reviewer sees the pictures themselves
 * next to the text diff (which reads them as "[Imagem] Legenda — Foto: Crédito"). A change of the
 * alt text alone reads the same in the diff, so it is named here.
 */
export function imageChanges(blocks: readonly DiffBlock[]): ImageChange[] {
  return blocks.flatMap((block): ImageChange[] => {
    if (!block.image || block.change === 'unchanged') return [];
    if (block.blockType !== 'cover' && block.blockType !== 'figure') return [];
    const kind: ImageChangeKind =
      block.change === 'added' ? 'added' : block.change === 'removed' ? 'removed' : block.previousImage ? 'swapped' : block.formatOnly ? 'alt' : 'caption';
    const change: ImageChange = { id: block.id, role: block.blockType, kind, image: block.image };
    if (kind === 'swapped' && block.previousImage) change.previous = block.previousImage;
    return [change];
  });
}

// ── Trechos apontados (âncoras de "Pedir ajustes") ───────────────────────────────────────

const WORD = /[\p{L}\p{N}]/u;

/** One anchor per selected block range (whole words), with the excerpt the reviewer pointed at. */
export function anchorsFromRanges(body: Pick<ArticleBody, 'blocks'>, ranges: readonly TextRange[]): DecisionAnchor[] {
  return ranges.flatMap((range) => {
    const block = findBlock(body as ArticleBody, range.blockId);
    if (!block) return [];
    const text = blockText(block);
    let from = Math.max(0, Math.min(range.from, range.to));
    let to = Math.min(text.length, Math.max(range.from, range.to));
    // A drag that cuts a word points at the whole word.
    while (from > 0 && from < to && WORD.test(text.charAt(from - 1)) && WORD.test(text.charAt(from))) from -= 1;
    while (to < text.length && to > from && WORD.test(text.charAt(to - 1)) && WORD.test(text.charAt(to))) to += 1;
    const excerpt = text.slice(from, to).trim();
    return excerpt ? [{ blockId: range.blockId, from, to, excerpt }] : [];
  });
}

const overlaps = (a: TextRange, b: TextRange) => a.blockId === b.blockId && a.from < b.to && b.from < a.to;

/** Adds anchors, merging those that overlap one already pointed at (never a duplicate mark). */
export function addAnchors(body: Pick<ArticleBody, 'blocks'>, existing: readonly DecisionAnchor[], added: readonly DecisionAnchor[]): DecisionAnchor[] {
  let result = [...existing];
  for (const anchor of added) {
    const touching = result.filter((candidate) => overlaps(candidate, anchor));
    if (touching.length === 0) {
      result.push(anchor);
      continue;
    }
    const from = Math.min(anchor.from, ...touching.map((candidate) => candidate.from));
    const to = Math.max(anchor.to, ...touching.map((candidate) => candidate.to));
    const merged = anchorsFromRanges(body, [{ blockId: anchor.blockId, from, to }]);
    result = [...result.filter((candidate) => !touching.includes(candidate)), ...merged];
  }
  return sortAnchors(body, result);
}

/** Document order: block position, then offset. */
export function sortAnchors(body: Pick<ArticleBody, 'blocks'>, anchors: readonly DecisionAnchor[]): DecisionAnchor[] {
  const order = new Map(body.blocks.map((block, index) => [block.id, index]));
  return [...anchors].sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0) || a.from - b.from);
}

export function anchorKey(anchor: TextRange): string {
  return `${anchor.blockId}:${anchor.from}-${anchor.to}`;
}

/** "1 trecho apontado" / "2 trechos apontados". */
export function anchorsLabel(count: number): string {
  return count === 1 ? '1 trecho apontado' : `${count} trechos apontados`;
}

/** Short quote for a list row: whole words, ellipsis past `max` characters. */
export function shortExcerpt(text: string, max = 96): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?–-]+$/, '')}…`;
}

// ── Origem do texto ──────────────────────────────────────────────────────────────────────

/**
 * "Ver origem do texto": every block the AI wrote carries the AI mark (reviewed or not), the rest
 * reads as written by people. The reviewer sees authorship, not the writer's review progress.
 */
export function originBody(body: ArticleBody): ArticleBody {
  if (!body.blocks.some((block) => block.ai !== undefined)) return body;
  return { ...body, blocks: body.blocks.map((block) => (block.ai === undefined ? block : { ...block, ai: 'unreviewed' as const })) };
}

/** Whether the AI wrote any of the text (the switch has something to show). */
export function hasAiText(body: ArticleBody): boolean {
  return body.blocks.some((block) => block.ai !== undefined);
}

// ── Histórico de versões ─────────────────────────────────────────────────────────────────

export type HistoryEventKind = 'version' | 'request' | 'decision';

export type HistoryEvent = {
  id: string;
  kind: HistoryEventKind;
  at: string;
  /** "Texto da IA", "Editado por Juliana", "Enviado a Pedro", "Aprovado por Pedro"… (COPY §2.7). */
  title: string;
  /** "08/10, 14:20 · 1,4 lauda". */
  meta: string;
  /** Who did it (marker); `null` for the AI. */
  personId: string | null;
  /** Recado or nota, as written. */
  note?: string;
  /** The version this event is about (comparison). */
  versionId?: string;
  decision?: 'approved' | 'changes_requested';
};

export type HistoryInput = {
  kind: PieceKind;
  versions: readonly VersionView[];
  requests: readonly ApprovalRequestView[];
  decisions: readonly ApprovalDecisionView[];
  people?: readonly PersonSummary[];
  now?: Date | string;
};

function nameOf(people: readonly PersonSummary[] | undefined, id: string | undefined): string {
  if (!id || id === 'system') return '';
  return firstName(people?.find((person) => person.id === id)?.name);
}

/**
 * The piece's history, newest first, in the words of COPY §2.7: versions by what made them ("Texto
 * da IA", "Editado por Juliana", "Restaurado de 06/10"), each send ("Enviado a Pedro") and each
 * decision ("Ajustes pedidos por Pedro", "Aprovado por Pedro") with its note. Withdrawn sends stay
 * out. Meta: when, and the text's size (an article's laudas).
 */
export function historyEvents(input: HistoryInput): HistoryEvent[] {
  const size = (version: Pick<VersionView, 'characters'>) => (input.kind === 'article' ? formatLaudas(version.characters) : undefined);
  const meta = (at: string, version?: Pick<VersionView, 'characters'>) => [formatDayTime(at, input.now), version ? size(version) : undefined].filter(Boolean).join(' · ');
  const events: HistoryEvent[] = [];
  for (const version of input.versions) {
    const who = nameOf(input.people, version.createdBy);
    let title: string;
    if (version.origin === 'generation') title = 'Texto da IA';
    else if (version.origin === 'restore') {
      const from = input.versions.find((candidate) => candidate.id === version.restoredFrom);
      title = from ? `Restaurado de ${formatDayMonth(from.createdAt, input.now)}` : 'Restaurado';
    } else title = who ? `Editado por ${who}` : 'Editado';
    events.push({
      id: `version-${version.id}`,
      kind: 'version',
      at: version.createdAt,
      title,
      meta: meta(version.createdAt, version),
      personId: version.origin === 'generation' || version.createdBy === 'system' ? null : version.createdBy,
      versionId: version.id,
    });
  }
  for (const request of input.requests) {
    if (request.withdrawnAt) continue;
    const to = firstName(request.assignee?.name);
    const event: HistoryEvent = {
      id: `request-${request.id}`,
      kind: 'request',
      at: request.requestedAt,
      title: to ? `Enviado a ${to}` : 'Enviado para aprovação',
      meta: meta(request.requestedAt, request.version),
      personId: request.requester?.id ?? null,
      versionId: request.version.id,
    };
    if (request.note?.trim()) event.note = request.note.trim();
    events.push(event);
  }
  for (const decision of input.decisions) {
    const who = firstName(decision.decider?.name);
    const verb = decision.kind === 'approved' ? 'Aprovado' : 'Ajustes pedidos';
    const event: HistoryEvent = {
      id: `decision-${decision.version.id}-${decision.at}`,
      kind: 'decision',
      at: decision.at,
      title: who ? `${verb} por ${who}` : verb,
      meta: meta(decision.at, decision.version),
      personId: decision.decider?.id ?? null,
      versionId: decision.version.id,
      decision: decision.kind,
    };
    if (decision.note?.trim()) event.note = decision.note.trim();
    events.push(event);
  }
  const rank: Record<HistoryEventKind, number> = { decision: 0, request: 1, version: 2 };
  return events.sort((a, b) => b.at.localeCompare(a.at) || rank[a.kind] - rank[b.kind]);
}
