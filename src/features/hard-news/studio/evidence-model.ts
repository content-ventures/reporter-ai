import type { ArticleBody, CheckResult, TextRange } from '@/domain';
import type { EnrichmentSuggestion, EvidenceFlag } from '@/domain/hard-news';

/**
 * Where each evidence flag (F2.8) sits in the text the person is editing. A claim that is no longer
 * in the text was changed by hand: it stops being flagged (the edit is the decision) and says so.
 */

export type LocatedFlag = EvidenceFlag & {
  range?: TextRange;
  /** Open, but its words are not in the text any more. */
  changed: boolean;
};

function blockTexts(body: ArticleBody): { blockId: string; text: string }[] {
  return body.blocks.flatMap((block) => ('inlines' in block ? [{ blockId: block.id, text: block.inlines.map((inline) => inline.text).join('') }] : []));
}

export function locateText(body: ArticleBody, words: string): TextRange | undefined {
  const wanted = words.trim();
  if (!wanted) return undefined;
  for (const { blockId, text } of blockTexts(body)) {
    const from = text.indexOf(wanted);
    if (from >= 0) return { blockId, from, to: from + wanted.length };
  }
  return undefined;
}

export function locateFlags(flags: readonly EvidenceFlag[], body: ArticleBody): LocatedFlag[] {
  return flags.map((flag) => {
    const range = locateText(body, flag.claim);
    return { ...flag, range, changed: flag.state === 'open' && !range };
  });
}

/** Flags still waiting for a person, in reading order. */
export function pendingFlags(located: readonly LocatedFlag[]): LocatedFlag[] {
  return located.filter((flag) => flag.state === 'open' && flag.range);
}

/**
 * "Evidências conferidas" (registry `article.evidence`, R2): a warning while any claim waits for a
 * person, never blocking (the AI flags, the editor decides).
 */
export function evidenceCheck(located: readonly LocatedFlag[]): CheckResult {
  const pending = pendingFlags(located);
  const total = located.length;
  const done = total - pending.length;
  return {
    id: 'article.evidence',
    label: 'Evidências conferidas',
    status: pending.length > 0 ? 'warn' : 'pass',
    blocking: false,
    detail: pending.length > 0 ? `${pending.length} ${pending.length === 1 ? 'afirmação a conferir' : 'afirmações a conferir'}` : `${total} ${total === 1 ? 'conferida' : 'conferidas'}`,
    progress: { current: done, total },
    targets: pending.flatMap((flag) => (flag.range ? [flag.range] : [])),
  };
}

/** A suggestion whose anchor left the text cannot be placed any more. */
export function placeable(suggestion: EnrichmentSuggestion, body: ArticleBody): boolean {
  return Boolean(locateText(body, suggestion.anchor));
}
