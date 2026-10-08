import { DEFAULT_SECTIONS } from '../../../domain/production.ts';
import { longestPlanWords } from './draft-plan.ts';
import { createVoices, headlineLine } from './editorial.ts';
import type { SpeakerInfo } from './editorial.ts';
import { keywords, pickKeyQuotes, readMaterial, readSegments } from './material.ts';
import { currentSourceVersion } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import { createRng } from './random.ts';
import type { MaterialOutlook } from '../../../ports/source-ingest.ts';

/**
 * "Como o artigo nasce" in Nova produção: what the extractive simulation would build from the
 * material — the proposed headline, how many questions can become sections and the key lines
 * it would quote — computed from the text alone, before anything is saved. Same rules as the
 * draft (verbatim lines, nothing invented); the brief can still change the final pick.
 */
export function materialOutlook(
  segments: readonly { id: string; speaker?: string; text: string }[],
  options: { angle?: string; speakerNames?: Readonly<Record<string, string>> } = {},
): MaterialOutlook {
  const material = readSegments(segments);
  const people: Record<string, SpeakerInfo> = {};
  for (const [label, name] of Object.entries(options.speakerNames ?? {})) if (name.trim()) people[label] = { name: name.trim() };
  const voices = createVoices(material, people);
  // The draft's headline rule (material, angle and names only), so the preview promises the same.
  const top = headlineLine(material, new Set(options.angle ? keywords(options.angle) : []), voices);
  const quotes = pickKeyQuotes(material, 3, createRng('outlook'), options.angle, new Set(top ? [top.key] : []));
  const title = top?.text ?? (quotes[0] ? headlineLine(material, new Set(), voices, { prefer: quotes[0] })?.text : undefined);
  const outlook: MaterialOutlook = {
    sections: material.mode === 'qa' ? material.units.length : Math.min(5, material.units.length),
    // The longest draft this material supports: the preview promises a length only up to it.
    wordsAvailable: longestPlanWords(material, DEFAULT_SECTIONS),
    keyLines: quotes.map((quote) => ({
      segmentId: quote.line.segmentId,
      text: quote.text,
      ...(quote.line.speaker ? { speaker: quote.line.speaker } : {}),
    })),
  };
  if (title) outlook.headline = title;
  return outlook;
}

const supported = new Map<string, number>();

/**
 * Words of the longest article these sources support (the extractive simulation never invents
 * more), remembered per material version: the brief's length field says when a target is out of
 * reach for the material already in the production.
 */
export function wordsAvailable(sources: readonly Source[]): number {
  const key = sources.map((source) => `${source.id}@${currentSourceVersion(source).hash}`).join('|');
  const known = supported.get(key);
  if (known !== undefined) return known;
  const words = longestPlanWords(readMaterial(sources), DEFAULT_SECTIONS);
  if (supported.size > 64) supported.clear();
  supported.set(key, words);
  return words;
}
