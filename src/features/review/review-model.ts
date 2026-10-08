import { blockText, creditLine, DECISION_LABELS, findBlock } from '../../domain/index.ts';
import type {
  ArticleBody,
  ImageRef,
  CheckResult,
  DecisionAnchor,
  DecisionKind,
  DiffBlock,
  DiffChange,
  DiffHunk,
  PieceStatus,
  TextRange,
} from '../../domain/index.ts';
import type { EvidenceView, ReviewView, VersionView } from '../../ports/index.ts';

/**
 * Pure rules of the review surface (PLAN §3.6): which comparisons exist, the status of the exact
 * version on screen, the diff blocks handed to the DS `DiffView`, the passages a reviewer points
 * at when returning a version, and the history lines. No React, no Design System: tested with
 * `node --test`.
 */

// ── Comparação ───────────────────────────────────────────────────────────────────────────

export type ReviewMode = 'changes' | 'final';
export type CompareTarget = 'ai' | 'approved';

export type CompareOption = { target: CompareTarget; version: VersionView; label: string };

/** "Comparar com": the last approved version first (re-approval), then the pure AI output. */
export function compareOptions(review: Pick<ReviewView, 'compareWith'>): CompareOption[] {
  const { lastApproved, ai } = review.compareWith;
  const options: CompareOption[] = [];
  if (lastApproved) options.push({ target: 'approved', version: lastApproved, label: `desde v${lastApproved.number} · aprovada` });
  if (ai && ai.id !== lastApproved?.id) options.push({ target: 'ai', version: ai, label: `desde ${ai.label}` });
  return options;
}

export type ResolvedView = { mode: ReviewMode; option?: CompareOption };

const isMode = (value: unknown): value is ReviewMode => value === 'changes' || value === 'final';

/**
 * The view on screen from the URL (`?view`, `?compare`) and what the version allows. Default:
 * "Alterações" since the last approval when there is one (what changed is the question), else
 * "Texto final" (a first approval reads the piece as the reader will).
 */
export function resolveView(options: readonly CompareOption[], requested: { view?: string | null; compare?: string | null }): ResolvedView {
  if (options.length === 0) return { mode: 'final' };
  const option = options.find((candidate) => candidate.target === requested.compare) ?? options[0];
  const fallback: ReviewMode = options.some((candidate) => candidate.target === 'approved') ? 'changes' : 'final';
  return { mode: isMode(requested.view) ? requested.view : fallback, option };
}

// ── Status da versão ─────────────────────────────────────────────────────────────────────

/**
 * Status of the EXACT version on screen (plan tones): approved teal (amber when its inputs went
 * stale), returned orange, waiting violet; otherwise the piece status (Rascunho, Gerando…).
 */
export function versionStatus(review: Pick<ReviewView, 'version' | 'pendingReview' | 'freshness' | 'status'>): PieceStatus {
  const decision = review.version.decision?.kind;
  if (decision === 'approved') return review.freshness.state === 'stale' ? 'stale' : 'approved';
  if (decision === 'changes_requested' || decision === 'rejected') return 'changes_requested';
  if (review.pendingReview?.subject.versionId === review.version.id) return 'in_review';
  if (review.status === 'generating' || review.status === 'failed') return review.status;
  return review.freshness.state === 'stale' ? 'stale' : 'draft';
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

// ── Trechos apontados (âncoras da devolução) ─────────────────────────────────────────────

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

/** "§3": the block's position in the article (same numbering as the studio selection chip). */
export function sectionMark(body: Pick<ArticleBody, 'blocks'>, blockId: string): string | undefined {
  const index = body.blocks.findIndex((block) => block.id === blockId);
  return index < 0 ? undefined : `§${index + 1}`;
}

/** Short quote for a list row: whole words, ellipsis past `max` characters. */
export function shortExcerpt(text: string, max = 96): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?–-]+$/, '')}…`;
}

// ── Fonte ────────────────────────────────────────────────────────────────────────────────

export type EvidenceGroup = {
  key: string;
  /** Speaker of the passages (mapped person or transcript label). */
  speaker?: EvidenceView['speaker'];
  entries: EvidenceView[];
  /** Blocks of the text standing on these passages, in order, without repeats. */
  blockIds: string[];
  /** A passage that does not match the material ("Falta"). */
  missing: boolean;
};

/**
 * Passages the text stands on, one chip per speaker ("Sérgio Lang · 12 trechos"); each passage
 * that does not match the material stands alone and first, because it needs a look.
 */
export function groupEvidence(evidence: readonly EvidenceView[]): EvidenceGroup[] {
  const missing: EvidenceGroup[] = [];
  const bySpeaker = new Map<string, EvidenceGroup>();
  evidence.forEach((entry, index) => {
    if (entry.status === 'missing') {
      missing.push({ key: `missing-${index}`, speaker: entry.speaker, entries: [entry], blockIds: [...entry.blockIds], missing: true });
      return;
    }
    const key = entry.speaker?.person?.id ?? entry.speaker?.label ?? 'trecho';
    const group = bySpeaker.get(key) ?? { key, speaker: entry.speaker, entries: [], blockIds: [], missing: false };
    group.entries.push(entry);
    for (const blockId of entry.blockIds) if (!group.blockIds.includes(blockId)) group.blockIds.push(blockId);
    bySpeaker.set(key, group);
  });
  return [...missing, ...bySpeaker.values()];
}

// ── Checagem ─────────────────────────────────────────────────────────────────────────────

/** Checks that do not block but deserve a second look before approving. */
export function checkWarnings(checks: readonly CheckResult[]): CheckResult[] {
  return checks.filter((check) => check.status === 'warn' || (check.status === 'fail' && !check.blocking));
}

// ── Histórico ────────────────────────────────────────────────────────────────────────────

export type HistoryKind = 'decision' | 'request' | 'version' | 'run';

export type HistoryItem = {
  id: string;
  kind: HistoryKind;
  at: string;
  /** Person (or `system`) who did it; the screen names them. */
  actorId?: string;
  /** Verb phrase after the name ("aprovou a v3", "gerou a v1 · IA"); whole line when `standalone`. */
  action: string;
  /** The line reads on its own ("Geração do artigo falhou"): the actor is only the marker. */
  standalone?: boolean;
  decision?: DecisionKind;
  note?: string;
  anchors?: DecisionAnchor[];
  /** Run whose provenance explains this line. */
  runId?: string;
};

const DECISION_VERBS: Partial<Record<DecisionKind, string>> = {
  approved: 'aprovou',
  changes_requested: 'devolveu',
  rejected: 'recusou',
};

const VERSION_VERBS: Record<VersionView['origin'], string> = {
  generation: 'gerou',
  edit: 'salvou',
  suggestion: 'salvou',
  restore: 'criou',
};

const RUN_OUTCOMES: Partial<Record<ReviewView['runs'][number]['status'], string>> = {
  running: 'em andamento',
  queued: 'na fila',
  awaiting_input: 'aguardando resposta',
  failed: 'falhou',
  cancelled: 'interrompida',
};

/**
 * Newest first: decisions (with note and anchors), the pending request, every version and the
 * top-level generations that produced no version (failed, interrupted, running).
 */
export function reviewHistory(review: Pick<ReviewView, 'decisions' | 'pendingReview' | 'runs' | 'requests'>, versions: readonly VersionView[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const decision of review.decisions) {
    const number = decision.subject.kind === 'version' ? decision.subject.number : undefined;
    const verb = DECISION_VERBS[decision.decision] ?? DECISION_LABELS[decision.decision].toLowerCase();
    const item: HistoryItem = {
      id: `decision-${decision.id}`,
      kind: 'decision',
      at: decision.at,
      actorId: decision.by,
      action: number === undefined ? verb : `${verb} a v${number}`,
      decision: decision.decision,
    };
    if (decision.note) item.note = decision.note;
    if (decision.anchors && decision.anchors.length > 0) item.anchors = decision.anchors;
    items.push(item);
  }
  // Every request stays in the history after it is decided ("Juliana enviou a v2 para aprovação").
  const requests = review.requests ?? (review.pendingReview ? [review.pendingReview] : []);
  for (const request of requests) {
    const item: HistoryItem = {
      id: `request-${request.id}`,
      kind: 'request',
      at: request.requestedAt,
      actorId: request.requestedBy,
      action: `enviou a v${request.subject.number} para aprovação`,
    };
    if (request.note) item.note = request.note;
    items.push(item);
  }
  const produced = new Set<string>();
  for (const version of versions) {
    const item: HistoryItem = {
      id: `version-${version.id}`,
      kind: 'version',
      at: version.createdAt,
      actorId: version.createdBy,
      action: `${VERSION_VERBS[version.origin]} a ${version.label}`,
    };
    if (version.runId) {
      item.runId = version.runId;
      produced.add(version.runId);
    }
    items.push(item);
  }
  for (const run of review.runs) {
    if (run.parentRunId || produced.has(run.id) || !run.kind.endsWith('.generate')) continue;
    const outcome = RUN_OUTCOMES[run.status];
    if (!outcome) continue;
    items.push({
      id: `run-${run.id}`,
      kind: 'run',
      at: run.endedAt ?? run.startedAt ?? run.createdAt,
      actorId: run.createdBy,
      action: `${run.label} ${outcome}`,
      standalone: true,
      runId: run.id,
    });
  }
  const rank: Record<HistoryKind, number> = { decision: 0, request: 1, version: 2, run: 3 };
  return items.sort((a, b) => b.at.localeCompare(a.at) || rank[a.kind] - rank[b.kind]);
}
