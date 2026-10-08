import {
  articleStats,
  blockText,
  bodyHash,
  checkQuotes,
  currentSourceVersion,
  diffWords,
  foldForMatch,
  formatTimestamp,
  shortenToSizeLabel,
  sizeOf,
  textReviewOf,
  unreviewedAiBlockIds,
  words,
} from '../../../domain/index.ts';
import type {
  ArticleBlock,
  ArticleSize,
  ArticleBody,
  BlockId,
  CheckResult,
  DiffBlock,
  DiffChange,
  DiffHunk,
  QuoteCheck,
  SendItem,
  SendItemId,
  SendItemLevel,
  SendTarget,
  Source,
  SourceRef,
  Speaker,
  Suggestion,
  SuggestionProposal,
  TextRange,
  TextReview,
  TranscriptSegment,
} from '../../../domain/index.ts';

/**
 * Pure helpers of the article studio: what the footer and the Checagem say, which transcript
 * segments the text uses, how a suggestion reads in a card, how a version compares with the text
 * on screen, and how the transcript maps onto the Design System `TranscriptViewer`. No React and
 * no Design System here, so `node --test` covers them.
 */

// ——— Facts about the text (status line, Checagem, outline) ———

export type OutlineEntry = { blockId: BlockId; level: 2 | 3; text: string; number: number };

export type ArticleFacts = {
  words: number;
  /** The lauda count of the body (characters with spaces, title and captions excluded). */
  characters: number;
  minutes: number;
  /** AI blocks still marked `unreviewed`, in document order. */
  unreviewed: BlockId[];
  /** The review of the whole text: `none` without AI text, `pending` while any AI block is unreviewed, else `reviewed`. */
  review: TextReview;
  quotes: QuoteCheck[];
  verifiedQuotes: number;
  /** Quotes that do not match the material ("Falta"), in document order. */
  missingQuotes: TextRange[];
  /** Transcript segments the text quotes (verified quotations): "Usado" in the transcript. */
  usedSegmentIds: string[];
  outline: OutlineEntry[];
};

export const EMPTY_FACTS: ArticleFacts = {
  words: 0,
  characters: 0,
  minutes: 0,
  unreviewed: [],
  review: 'none',
  quotes: [],
  verifiedQuotes: 0,
  missingQuotes: [],
  usedSegmentIds: [],
  outline: [],
};

function segmentIdsOf(refs: readonly SourceRef[] | undefined): string[] {
  return (refs ?? []).flatMap((ref) => (ref.locator.type === 'segment' ? [ref.locator.segmentId] : []));
}

/** Segment ids a block is based on (first one first). */
export function blockSegmentIds(block: Pick<ArticleBlock, 'sourceRefs'>): string[] {
  return [...new Set(segmentIdsOf(block.sourceRefs))];
}

export function usedSegmentIds(body: ArticleBody): string[] {
  return [...new Set(body.blocks.flatMap((block) => segmentIdsOf(block.sourceRefs)))];
}

/** Segments a verified quotation was found in (the transcript marks only what the text quotes). */
export function quotedSegmentIds(quotes: readonly QuoteCheck[]): string[] {
  return [...new Set(quotes.flatMap((quote) => (quote.status === 'verified' && quote.match ? segmentIdsOf([quote.match]) : [])))];
}

/** Blocks that cite a transcript segment (transcript → text highlight). */
export function blocksCitingSegment(body: ArticleBody, segmentId: string): BlockId[] {
  return body.blocks.filter((block) => segmentIdsOf(block.sourceRefs).includes(segmentId)).map((block) => block.id);
}

export function articleOutline(body: ArticleBody): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  body.blocks.forEach((block, index) => {
    if (block.type !== 'heading') return;
    outline.push({ blockId: block.id, level: block.level, text: blockText(block).trim(), number: index + 1 });
  });
  return outline;
}

export function articleFacts(body: ArticleBody, sources: readonly Source[]): ArticleFacts {
  const stats = articleStats(body);
  const quotes = sources.length > 0 ? checkQuotes(body, sources) : [];
  return {
    words: stats.words,
    characters: stats.characters,
    minutes: stats.words > 0 ? stats.readingMinutes : 0,
    unreviewed: unreviewedAiBlockIds(body),
    review: textReviewOf(body),
    quotes,
    verifiedQuotes: quotes.filter((quote) => quote.status === 'verified').length,
    missingQuotes: quotes.filter((quote) => quote.status === 'missing').map((quote) => quote.range),
    usedSegmentIds: quotedSegmentIds(quotes),
    outline: articleOutline(body),
  };
}

/** The item after `current` in document order (wraps around); the first when `current` is absent. */
export function nextInOrder<T>(items: readonly T[], current: T | null | undefined, same: (a: T, b: T) => boolean = Object.is): T | undefined {
  if (items.length === 0) return undefined;
  const at = current === null || current === undefined ? -1 : items.findIndex((item) => same(item, current));
  return items[(at + 1) % items.length];
}

/**
 * Nothing written yet: no text and no image in the flow ("Texto em branco"). A figure is
 * content (a new generation would replace it, so the draft is frozen as a version first); a
 * cover alone is not, as generating keeps it.
 */
export function isBlankBody(body: Pick<ArticleBody, 'blocks'>): boolean {
  return body.blocks.every((block) => block.type !== 'figure' && !blockText(block).trim());
}

/** Same blocks and title, compared by content hash (what autosave and versions compare). */
export function sameBody(a: ArticleBody, b: ArticleBody): boolean {
  return bodyHash(a) === bodyHash(b);
}

/**
 * Local checks of the live text: the domain article checks on what is on screen, with the
 * "Geração concluída" result (run state) taken from the store, which owns the run.
 */
export function mergeChecks(local: readonly CheckResult[], stored: readonly CheckResult[]): CheckResult[] {
  return local.map((check) => (check.id === 'article.generation' ? (stored.find((entry) => entry.id === check.id) ?? check) : check));
}

// ——— Copilot tools that make sense for the text on screen ———

/**
 * Article-wide tools with their label for this text: nothing on an empty draft; "Sugerir
 * intertítulos" only with headings; "Encurtar para 2 laudas" (the brief's size) only when the
 * text passes the size's maximum.
 */
export function documentTools(input: { empty: boolean; characters: number; size: ArticleSize; headings: number }): { id: string; label?: string }[] {
  if (input.empty) return [];
  const tools: { id: string; label?: string }[] = [{ id: 'titles', label: 'Títulos alternativos' }];
  if (input.headings > 0) tools.push({ id: 'suggest-subheadings' });
  if (input.characters > sizeOf(input.size).maxChars) tools.push({ id: 'shorten-to-brief', label: shortenToSizeLabel(input.size) });
  return tools;
}

// ——— Suggestions ———

export type OpenSuggestionState = 'streaming' | 'ready' | 'stale' | 'applied' | 'discarded' | 'error';

export function isOpenSuggestion(suggestion: Pick<Suggestion, 'state'>): boolean {
  return suggestion.state === 'ready' || suggestion.state === 'streaming' || suggestion.state === 'stale';
}

/** Readable proposal: the replacement text, list items joined, the title. */
export function proposalText(proposal: SuggestionProposal): string {
  switch (proposal.kind) {
    case 'replace-text':
    case 'title':
      return proposal.text;
    case 'replace-blocks':
      return proposal.blocks.map(blockText).join('\n');
    case 'add-link':
      return proposal.href;
    case 'slide':
      return Object.values(proposal.slots).join('\n');
  }
}

/** Word diff of a text suggestion against the passage it replaces (DS `DiffView` blocks). */
export function suggestionHunks(suggestion: Pick<Suggestion, 'anchorText' | 'proposal'>): DiffHunk[] | undefined {
  if (suggestion.proposal.kind !== 'replace-text') return undefined;
  const before = suggestion.anchorText.join('\n');
  if (!before) return undefined;
  return diffWords(before, suggestion.proposal.text);
}

/**
 * Ranges a text rewrite removes inside its (located) target: the `delete` hunks of the word diff
 * between the passage and the proposal, so only the words that go are struck through. Undefined
 * when the suggestion is not a one-range text replacement (the whole range is marked instead).
 */
export function removedRanges(range: TextRange, suggestion: Pick<Suggestion, 'anchorText' | 'proposal'>): TextRange[] | undefined {
  if (suggestion.proposal.kind !== 'replace-text' || suggestion.anchorText.length !== 1) return undefined;
  const before = suggestion.anchorText[0] ?? '';
  if (before.length !== range.to - range.from) return undefined;
  const ranges: TextRange[] = [];
  let offset = 0;
  for (const hunk of diffWords(before, suggestion.proposal.text)) {
    if (hunk.kind === 'insert') continue;
    if (hunk.kind === 'delete') {
      const lead = hunk.text.length - hunk.text.trimStart().length;
      const trail = hunk.text.length - hunk.text.trimEnd().length;
      const from = range.from + offset + lead;
      const to = range.from + offset + hunk.text.length - trail;
      if (to > from) ranges.push({ blockId: range.blockId, from, to });
    }
    offset += hunk.text.length;
  }
  return ranges;
}

/** What a pending suggestion puts in, read in the paragraph after what it takes out. */
export type SuggestionInsertionMark = { blockId: BlockId; offset: number; text: string };

/** How a pending suggestion reads inside the text: struck words and inserted words. */
export type SuggestionMarks = { removed: TextRange[]; inserted: SuggestionInsertionMark[]; stale: boolean };

const NO_MARKS: SuggestionMarks = { removed: [], inserted: [], stale: false };

/** A proposal as one line of a paragraph: list items read "a · b · c", blocks join with a space. */
function proposalLine(proposal: SuggestionProposal): string {
  const text =
    proposal.kind === 'replace-blocks'
      ? proposal.blocks.map((block) => (block.type === 'list' ? blockText(block).split('\n').join(' · ') : blockText(block))).join(' ')
      : proposalText(proposal);
  return text.replace(/\s+/g, ' ').trim();
}

/** The proposal text compared word by word with the passage (blocks one per line, like `blockText`). */
function proposalForDiff(proposal: SuggestionProposal): string | undefined {
  if (proposal.kind === 'replace-text') return proposal.text;
  if (proposal.kind === 'replace-blocks') return proposal.blocks.map(blockText).join('\n');
  return undefined;
}

/**
 * How a pending suggestion reads inside the text (PLAN §3.5 "IA inline"): the words it takes out
 * are struck through and what it puts in reads right after them, as part of the paragraph (DS
 * insertion widget). A one-passage proposal marks its word diff (an expansion only inserts; a
 * rewrite strikes and inserts word by word); one that only changes the structure ("Virar lista")
 * or spans several blocks strikes its passage and reads the proposal after it. A stale suggestion
 * (`located` undefined) strikes nothing: its proposal reads, faded, at the end of its block (the
 * editor clamps the offset), so a whole paragraph is never struck by a suggestion that no longer fits.
 */
export function suggestionMarks(
  located: readonly TextRange[] | undefined,
  suggestion: Pick<Suggestion, 'target' | 'anchorText' | 'proposal'>,
): SuggestionMarks {
  const { proposal } = suggestion;
  if (proposal.kind === 'title' || proposal.kind === 'slide' || proposal.kind === 'add-link') return NO_MARKS;
  const line = proposalLine(proposal);
  if (!located) {
    // Its words were edited, so where it ended is unknown: it reads at the end of its block.
    const last = suggestion.target[suggestion.target.length - 1];
    return { removed: [], inserted: last && line ? [{ blockId: last.blockId, offset: Number.MAX_SAFE_INTEGER, text: line }] : [], stale: true };
  }
  const whole = (): SuggestionMarks => {
    const last = located[located.length - 1];
    return { removed: [...located], inserted: last && line ? [{ blockId: last.blockId, offset: last.to, text: line }] : [], stale: false };
  };
  const range = located[0];
  const before = suggestion.anchorText[0] ?? '';
  const after = proposalForDiff(proposal);
  if (located.length !== 1 || suggestion.anchorText.length !== 1 || !range || after === undefined || before.length !== range.to - range.from) return whole();
  const removed: TextRange[] = [];
  const inserted: SuggestionInsertionMark[] = [];
  let offset = 0;
  /** End of the words struck just before (an insertion right after them reads in their place). */
  let struckEnd: number | null = null;
  for (const hunk of diffWords(before, after)) {
    if (hunk.kind === 'insert') {
      const text = hunk.text.replace(/\s+/g, ' ');
      if (!text.trim()) continue;
      // After struck words the spacing is theirs; a pure insertion keeps its own spaces.
      if (struckEnd !== null) inserted.push({ blockId: range.blockId, offset: struckEnd, text: text.trim() });
      else inserted.push({ blockId: range.blockId, offset: range.from + offset, text });
      continue;
    }
    if (hunk.kind === 'delete') {
      const lead = hunk.text.length - hunk.text.trimStart().length;
      const trail = hunk.text.length - hunk.text.trimEnd().length;
      const from = range.from + offset + lead;
      const to = range.from + offset + hunk.text.length - trail;
      if (to > from) {
        removed.push({ blockId: range.blockId, from, to });
        struckEnd = to;
      }
    } else {
      struckEnd = null;
    }
    offset += hunk.text.length;
  }
  // Only the structure changes (sentences into a list): the passage is replaced as a whole.
  return removed.length === 0 && inserted.length === 0 ? whole() : { removed, inserted, stale: false };
}

/** "−12 +5 palavras": what a text suggestion takes out and puts in. */
export function suggestionDelta(suggestion: Pick<Suggestion, 'anchorText' | 'proposal'>): { removed: number; added: number } | undefined {
  const hunks = suggestionHunks(suggestion);
  if (!hunks) return undefined;
  const count = (kind: 'insert' | 'delete') => hunks.filter((hunk) => hunk.kind === kind).reduce((sum, hunk) => sum + words(hunk.text).length, 0);
  return { removed: count('delete'), added: count('insert') };
}

/**
 * The transcript line closest to a quotation that does not match it ("Falta"): the sentence of
 * the block's own segments (else of the whole material) sharing most words with the quote.
 */
export type ClosestExcerpt = { segmentId: string; text: string; from: number; to: number };

export function closestExcerpt(quote: Pick<QuoteCheck, 'text' | 'sourceRefs'>, sources: readonly Source[]): ClosestExcerpt | undefined {
  const wanted = new Set(words(foldForMatch(quote.text)).filter((word) => word.length >= 3));
  if (wanted.size === 0) return undefined;
  const own = new Set(segmentIdsOf(quote.sourceRefs));
  let best: (ClosestExcerpt & { score: number }) | undefined;
  for (const source of sources) {
    if (source.kind !== 'transcript') continue;
    for (const segment of currentSourceVersion(source).content.segments) {
      if (own.size > 0 && !own.has(segment.id)) continue;
      for (const match of segment.text.matchAll(/[^.!?…]+[.!?…]*/g)) {
        const text = match[0].trim();
        if (!text) continue;
        const from = (match.index ?? 0) + (match[0].length - match[0].trimStart().length);
        const hits = words(foldForMatch(text)).filter((word) => wanted.has(word)).length;
        const score = hits / Math.max(wanted.size, 1);
        if (hits >= 2 && (!best || score > best.score)) best = { segmentId: segment.id, text: text.replace(/[.]+$/, ''), from, to: from + text.length, score };
      }
    }
  }
  if (!best && own.size > 0) return closestExcerpt({ text: quote.text, sourceRefs: [] }, sources);
  return best ? narrowToClause({ segmentId: best.segmentId, text: best.text, from: best.from, to: best.to }, wanted) : undefined;
}

const CONNECTOR = /^(?:e|mas|porque|que|então|pois|já|só que)\s+/i;

/** The clause of the sentence that carries the quoted words ("…, porque errar no protótipo ficou barato" → "errar no protótipo ficou barato"). */
function narrowToClause(excerpt: ClosestExcerpt, wanted: ReadonlySet<string>): ClosestExcerpt {
  let best: { from: number; to: number; hits: number } | undefined;
  const parts = [...excerpt.text.matchAll(/[^,;:—–]+/g)];
  for (const part of parts) {
    const raw = part[0];
    const lead = raw.length - raw.trimStart().length;
    let from = (part.index ?? 0) + lead;
    let text = raw.trim();
    const connector = CONNECTOR.exec(text);
    if (connector) {
      from += connector[0].length;
      text = text.slice(connector[0].length);
    }
    const hits = words(foldForMatch(text)).filter((word) => wanted.has(word)).length;
    if (!best || hits > best.hits) best = { from, to: from + text.length, hits };
  }
  const total = words(foldForMatch(excerpt.text)).filter((word) => wanted.has(word)).length;
  // Only when one clause holds every quoted word; otherwise the whole sentence is the source.
  if (!best || parts.length < 2 || best.hits < total) return excerpt;
  const text = excerpt.text.slice(best.from, best.to);
  return { segmentId: excerpt.segmentId, text, from: excerpt.from + best.from, to: excerpt.from + best.to };
}

/** "parágrafo 5" for the target block(s) of a suggestion (1-based positions in the current body). */
export function targetLabel(body: ArticleBody, target: readonly TextRange[]): string | null {
  const numbers = [...new Set(target.map((range) => body.blocks.findIndex((block) => block.id === range.blockId) + 1).filter((n) => n > 0))].sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  if (numbers.length === 1) return `parágrafo ${numbers[0]}`;
  return `parágrafos ${numbers[0]}–${numbers[numbers.length - 1]}`;
}

// ——— Transcript ———

export type ViewerSpeaker = { id: string; name: string; src?: string };
export type ViewerSegment = { id: string; speaker?: ViewerSpeaker; start?: number; end?: number; text: string };

export type PersonLike = { id: string; name: string; avatarUrl?: string };

/** Transcript segments in the shape of the DS `TranscriptViewer` (speaker = mapped person). */
export function viewerSegments(
  segments: readonly TranscriptSegment[],
  speakers: readonly Speaker[],
  people: readonly PersonLike[],
): ViewerSegment[] {
  const bySpeaker = new Map<string, ViewerSpeaker>();
  for (const speaker of speakers) {
    const person = speaker.personId ? people.find((entry) => entry.id === speaker.personId) : undefined;
    const entry: ViewerSpeaker = { id: speaker.label, name: person?.name ?? speaker.label };
    if (person?.avatarUrl) entry.src = person.avatarUrl;
    bySpeaker.set(speaker.label, entry);
  }
  return segments.map((segment) => {
    const entry: ViewerSegment = { id: segment.id, text: segment.text };
    if (segment.speaker) entry.speaker = bySpeaker.get(segment.speaker) ?? { id: segment.speaker, name: segment.speaker };
    if (segment.startMs !== undefined) entry.start = segment.startMs;
    if (segment.endMs !== undefined) entry.end = segment.endMs;
    return entry;
  });
}

/** Chip label of a transcript excerpt: "Trecho 12:48", or the speaker when there is no time. */
export function excerptLabel(segment: Pick<ViewerSegment, 'start' | 'speaker'> | undefined): string {
  if (segment?.start !== undefined) return `Trecho ${formatTimestamp(segment.start)}`;
  return segment?.speaker ? `Fala de ${segment.speaker.name}` : 'Trecho';
}

/** Short excerpt for a chip tooltip or a quoted preview. */
export function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ——— Footer: "Falta para enviar" (COPY §2.5) ———

export type FooterPart = { id: SendItemId; level: SendItemLevel; text: string; count: number; target?: SendTarget };

/**
 * What the footer's "Falta para enviar" lists, from the pre-send checklist ("1 sugestão · 1
 * citação"). The text review is not in it: it has its own control on the footer's right side, so
 * its "Falta" only keeps `ready` false. `ready`: nothing blocks ("Pronto para enviar"); with only
 * the review missing there is nothing to list and nothing to celebrate yet. `total` is the narrow
 * footer's number ("Falta 5").
 */
export function footerNeeds(items: readonly SendItem[]): { ready: boolean; parts: FooterPart[]; total: number } {
  const missing = items.filter((item) => item.level === 'missing');
  const parts = missing
    .filter((item) => item.id !== 'text-review')
    .map((item) => ({
      id: item.id,
      level: item.level,
      text: item.short ?? item.text,
      count: item.count ?? 1,
      ...(item.action ? { target: item.action.target } : {}),
    }));
  return { ready: missing.length === 0, parts, total: parts.reduce((sum, part) => sum + part.count, 0) };
}

// ——— Checagem (panel tab) ———

/** Checks whose problem blocks "Enviar para aprovação" (CONTRACT override R1); the rest only warn. */
const SEND_BLOCKING_CHECKS = new Set(['article.generation', 'article.quotes', 'article.title', 'article.ai-reviewed']);

/**
 * The Checagem tab: only what needs attention, grouped as "Falta para enviar" and "Avisos" (no
 * passing rows, nothing that does not apply). Open AI suggestions are the first "Falta" row
 * ("Sugestões da IA · 1 sem decisão"), pointing at the first one.
 */
export function checagemGroups(checks: readonly CheckResult[], open: readonly Pick<Suggestion, 'target'>[]): { missing: CheckResult[]; warnings: CheckResult[] } {
  const pending = checks.filter((check) => check.status === 'warn' || check.status === 'fail');
  const suggestions: CheckResult[] =
    open.length > 0
      ? [
          {
            id: 'article.suggestions',
            label: 'Sugestões da IA',
            status: 'fail',
            blocking: false,
            meta: `${open.length} sem decisão`,
            targets: open.flatMap((suggestion) => suggestion.target.slice(0, 1)),
          },
        ]
      : [];
  return {
    missing: [...suggestions, ...pending.filter((check) => SEND_BLOCKING_CHECKS.has(check.id))],
    warnings: pending.filter((check) => !SEND_BLOCKING_CHECKS.has(check.id)),
  };
}

// ——— Histórico de versões ———

/** Mirrors the DS `DiffBlockType` (reading typography only). */
export type HistoryDiffType = 'title' | 'lead' | 'h2' | 'h3' | 'paragraph' | 'quote' | 'item' | 'caption';
/** Structurally the DS `DiffBlock`, built from the domain diff. */
export type HistoryDiffBlock = { id: string; change: DiffChange; hunks: DiffHunk[]; type: HistoryDiffType };

function historyDiffType(block: DiffBlock): HistoryDiffType {
  switch (block.blockType) {
    case 'title':
      return 'title';
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
export function historyDiff(blocks: readonly DiffBlock[]): HistoryDiffBlock[] {
  return blocks
    .filter((block) => block.blockType !== 'divider' && block.hunks.some((hunk) => hunk.text.trim().length > 0))
    .map((block) => ({ id: block.id, change: block.change, hunks: block.hunks, type: historyDiffType(block) }));
}

/** What a version of the history needs to be named by what happened to it. */
export type HistoryVersion = {
  id: string;
  origin: 'generation' | 'edit' | 'suggestion' | 'restore';
  createdAt: string;
  createdBy: string;
  restoredFrom?: string;
  decision?: { kind: string; by: string; at: string };
};

/**
 * A version of the history named by its event (COPY §2.7), never by its number: "Aprovado por
 * Pedro", "Ajustes pedidos por Pedro", "Enviado a Pedro", "Texto da IA", "Restaurado de 06/10",
 * "Editado por João". `sentTo`: who the version was sent to (a request that was not withdrawn).
 */
export function historyTitle(
  version: HistoryVersion,
  context: { nameOf: (id: string) => string; sentTo?: string; restoredFromDate?: string },
): string {
  const name = (id: string) => context.nameOf(id).trim().split(/\s+/)[0] ?? '';
  if (version.decision?.kind === 'approved') return `Aprovado por ${name(version.decision.by)}`;
  if (version.decision?.kind === 'changes_requested' || version.decision?.kind === 'rejected') return `Ajustes pedidos por ${name(version.decision.by)}`;
  if (context.sentTo) return `Enviado a ${context.sentTo.trim().split(/\s+/)[0] ?? context.sentTo}`;
  if (version.origin === 'generation') return 'Texto da IA';
  if (version.origin === 'restore' && context.restoredFromDate) return `Restaurado de ${context.restoredFromDate}`;
  const author = name(version.createdBy);
  return author ? `Editado por ${author}` : 'Editado';
}
