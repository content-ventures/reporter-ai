import type { Citation } from './citation-library.ts';
import { literalQuoteText, quotedWords } from './article-policy.ts';
import type { PipelineDefinition, PipelineStepKey } from './pipeline.ts';
import type { SourceRef } from './refs.ts';
import { sourceVersion } from './source.ts';
import type { Source } from './source.ts';
import { countWords } from './text/stats.ts';

/**
 * Hints that point the planning and writing steps at the best literal lines of a production:
 * the quotes a person curated in the citation bank, and, when the source reaches the prompts as
 * summaries, a shortlist of quotable sentences with their ids. Hints only add text the prompts
 * can choose from; the quote checks stay the same.
 */

/** What a prompt names when it explains the hints. A prompt saved before them (production's
 * revision 1) names neither, so it keeps its exact source and its cache. */
export const PLANNING_HINT = 'FALAS CURADAS', WRITING_HINT = 'curated: true';
export function explainedHints(definition: PipelineDefinition): { planning: boolean; writing: boolean } {
  const explains = (key: PipelineStepKey, marker: string) => Boolean(definition.steps[key]?.prompt.includes(marker));
  return { planning: explains('outline', PLANNING_HINT), writing: explains(definition.articleMode === 'single' ? 'article' : 'intro', WRITING_HINT) };
}

/** One sentence of the material as the editorial steps see it: `[key] speaker: text`. */
export type EvidenceCandidate = { key: string; text: string; speaker?: string; ref: SourceRef };
/** A sentence a curated citation covers. The newsroom's note stays out: the writing steps never read it. */
export type CuratedMark = { citationId: string };
export type CuratedLine = { keys: string[]; speaker?: string; text: string; relevance?: string };
export type CuratedEvidence = { byKey: ReadonlyMap<string, CuratedMark>; lines: readonly CuratedLine[] };

export const SHORTLIST_CHARS = 6000, CURATED_CHARS = 4000;
const RELEVANCE_CHARS = 200;
const FIRST_PERSON = /(?<![\p{L}\p{N}])(?:eu|nós|a gente|nosso|nossa)(?![\p{L}\p{N}])/iu;

/** Saved by a person, author confirmed and linked, still literal in the authorized version it names. */
export function isCuratedCitation(c: Citation, sources: readonly Source[]): boolean {
  if (c.revision < 1 || !c.authorConfirmed || !c.personId || c.ref.locator.type !== 'segment') return false;
  const source = sources.find(candidate => candidate.id === c.ref.sourceId);
  const version = source?.rights.authorized ? sourceVersion(source, c.ref.sourceVersion) : undefined;
  if (!version || version.hash !== c.sourceHash) return false;
  const segmentId = c.ref.locator.segmentId;
  const segment = version.content.segments.find(entry => entry.id === segmentId);
  return Boolean(segment && literalQuoteText(segment.text).includes(c.text));
}

const words = (text: string) => quotedWords(literalQuoteText(text));
const segmentKey = (ref: SourceRef) => ref.locator.type === 'segment' ? `${ref.sourceId}\u0000${ref.sourceVersion}\u0000${ref.locator.segmentId}` : undefined;

function curatedLineText(line: CuratedLine): string {
  return `${line.keys.map(key => `[${key}]`).join(' ')} ${line.speaker ? `${line.speaker}: ` : ''}${line.text}${line.relevance ? ` — nota da redação (não é fonte): ${line.relevance}` : ''}`;
}
function candidateLineText(candidate: EvidenceCandidate): string {
  return `[${candidate.key}] ${candidate.speaker ? `${candidate.speaker}: ` : ''}${candidate.text}`;
}

/** The curated citations of this material mapped to the sentences that carry them, newest first. */
export function curatedEvidence(citations: readonly Citation[], sources: readonly Source[], candidates: readonly EvidenceCandidate[]): CuratedEvidence {
  const byKey = new Map<string, CuratedMark>();
  const lines: CuratedLine[] = [];
  let used = 0;
  const curated = citations.filter(citation => isCuratedCitation(citation, sources)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const citation of curated) {
    const where = segmentKey(citation.ref), quoted = words(citation.text);
    const matched = candidates.filter(candidate => {
      const said = words(candidate.text);
      return Boolean(said) && segmentKey(candidate.ref) === where && (quoted.includes(said) || said.includes(quoted));
    });
    if (!matched.length) continue;
    const relevance = citation.relevance.trim().slice(0, RELEVANCE_CHARS).trim();
    const line: CuratedLine = { keys: matched.map(candidate => candidate.key), text: citation.text,
      ...(matched[0].speaker ? { speaker: matched[0].speaker } : {}), ...(relevance ? { relevance } : {}) };
    const size = curatedLineText(line).length + 1;
    if (used + size > CURATED_CHARS) break;
    used += size;
    lines.push(line);
    for (const key of line.keys) if (!byKey.has(key)) byKey.set(key, { citationId: citation.id });
  }
  return { byKey, lines };
}

function quotableScore(text: string): number {
  const count = countWords(text);
  return (/\p{N}/u.test(text) ? 2 : 0) + (FIRST_PERSON.test(text) ? 1 : 0) + (count >= 12 && count <= 45 ? 1 : 0);
}

/**
 * Quotable sentences of identified speakers (8 to 60 words) spread over the beginning, middle and
 * end of the material: the best of each third in turn, until `limitChars`, returned in material order.
 */
export function quotableShortlist(candidates: readonly EvidenceCandidate[], identified: (c: EvidenceCandidate) => boolean,
  skip: ReadonlySet<string>, limitChars = SHORTLIST_CHARS): EvidenceCandidate[] {
  const thirds: { candidate: EvidenceCandidate; index: number; score: number }[][] = [[], [], []];
  candidates.forEach((candidate, index) => {
    const count = countWords(candidate.text);
    if (count < 8 || count > 60 || skip.has(candidate.key) || !identified(candidate)) return;
    thirds[Math.min(2, Math.floor(index * 3 / candidates.length))].push({ candidate, index, score: quotableScore(candidate.text) });
  });
  for (const third of thirds) third.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: { candidate: EvidenceCandidate; index: number }[] = [];
  let used = 0;
  for (let round = 0; thirds.some(third => round < third.length); round++) {
    for (const third of thirds) {
      const entry = third[round];
      if (!entry) continue;
      const size = candidateLineText(entry.candidate).length + 1;
      if (used + size > limitChars) return picked.sort((a, b) => a.index - b.index).map(item => item.candidate);
      used += size;
      picked.push(entry);
    }
  }
  return picked.sort((a, b) => a.index - b.index).map(item => item.candidate);
}

/**
 * The source of the planning steps: the context plus the curated lines and the quotable shortlist. A
 * curated line's note (why it matters, typed by a person) is labelled as the newsroom's, not a source:
 * no fact of it may reach the title or the text.
 */
export function planningSource(context: string, curated: CuratedEvidence, shortlist: readonly EvidenceCandidate[]): string {
  let source = context;
  if (curated.lines.length) source += '\n\nFALAS CURADAS (conferidas pela redação no banco de citações; os ids são os da fonte; a nota da redação diz por que a fala importa e não é fonte: nenhum fato dela entra no título, na linha fina, nos intertítulos nem no texto):\n'
    + curated.lines.map(curatedLineText).join('\n');
  if (shortlist.length) source += '\n\nFALAS LITERAIS CITÁVEIS (frases exatas da transcrição original, com seus ids):\n'
    + shortlist.map(candidateLineText).join('\n');
  return source;
}

/** The source of the writing steps: the context and the exact selected sentences, curated ones marked (without their note). */
export function writingSource(context: string, candidates: readonly EvidenceCandidate[], selected: ReadonlySet<string>, curated: ReadonlyMap<string, CuratedMark>): string {
  return JSON.stringify({ context, literalEvidence: candidates.filter(candidate => selected.has(candidate.key)).map(candidate => {
    const mark = curated.get(candidate.key);
    return { id: candidate.key, text: candidate.text, ...(candidate.speaker ? { speaker: candidate.speaker } : {}), ...(mark ? { curated: true } : {}) };
  }) });
}
