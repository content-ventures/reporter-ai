/** Sentence splitting shared by the writing runner (repair, measured revisions) and the hard-news lint. */

/** Complete sentences: a stop followed by a space and a capital. "2.500", "R$ 1.200.000", URLs and common
 * abbreviations ("Dr.", "Sra.") never end one. */
const ABBREVIATION = /(?:^|\s)(?:Sr|Sra|Srta|Dr|Dra|Prof|Profa|Eng|Exmo|Exma|Me|Ma|etc|vs|nº|n\.º|art|pág|cap)\.[”"'’»)]*$/iu;
export function articleSentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?…][”"'’»)]*)\s+(?=[\p{Lu}“"«(])/u).reduce<string[]>((sentences, piece) => {
    // Never end a sentence inside an abbreviation or an open quotation.
    const previous = sentences[sentences.length - 1] ?? '';
    const open = (previous.match(/“/gu)?.length ?? 0) > (previous.match(/”/gu)?.length ?? 0)
      || (previous.match(/«/gu)?.length ?? 0) > (previous.match(/»/gu)?.length ?? 0) || (previous.match(/"/gu)?.length ?? 0) % 2 === 1;
    if (sentences.length && (ABBREVIATION.test(previous) || open)) sentences[sentences.length - 1] += ` ${piece}`;
    else sentences.push(piece);
    return sentences;
  }, []);
}
