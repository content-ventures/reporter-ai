import type { WritingGuide } from '../../../domain/hard-news.ts';

/**
 * The writing guide at work (F2.5): a paragraph as a draft would come without the guide, the same
 * paragraph after the guide's terms and banned phrases, what changed and which rule changed it,
 * and, for the history, what a new version changes. The headline and lead checks measure the
 * guide's limits on a house-style opening.
 */

/** A paragraph the way the AI writes before the guide: banned phrases and terms the portal avoids. */
export const SAMPLE_DRAFT = 'Vale lembrar que o setor de pescados ganha espaço lá fora. A piscicultura de tilápias deve alavancar as vendas em 2027, e players do Paraná já se preparam. É importante destacar que as exportações cresceram 38% no terceiro trimestre, segundo o Painel de Comércio Exterior. Confira os números.';

/** The headline and lead the house wrote for the same story (measured against the guide's limits). */
export const SAMPLE_OPENING = {
  headline: 'Exportações de tilápia crescem 38% no terceiro trimestre',
  lead: 'O Brasil exportou 4,1 mil toneladas de tilápia entre julho e setembro, 38% a mais que no mesmo período de 2025, segundo o Painel de Comércio Exterior.',
};

export type GuideChange = { kind: 'term' | 'phrase'; from: string; to?: string; rule: string };

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "pescado (coletivo)" → "pescado": the word to write, without the note. */
export function termWord(use: string): string {
  return use.replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

/** A rule that bans what it quotes: "Nada de …", "Evite …", "Não use …", "Sem …". */
const BANNING = /^\s*(nada de|evite|evitar|não use|nao use|não usar|proibid|sem )/i;

/** Phrases a banning rule quotes: Nada de "vale lembrar" ou "confira". */
export function bannedPhrases(guide: Pick<WritingGuide, 'rules'>): { phrase: string; rule: number }[] {
  return guide.rules.flatMap((rule, index) => (BANNING.test(rule.text)
    ? [...rule.text.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => ({ phrase: match[1].trim(), rule: index + 1 }))
    : []))
    .filter((entry) => entry.phrase.length > 0);
}

const capitalizeSentences = (text: string) => text.replace(/(^|[.!?]\s+)([a-zà-ú])/g, (_, start: string, letter: string) => `${start}${letter.toUpperCase()}`);

/**
 * The guide applied to a text: each preferred term replaced (whole words, any case) and each
 * banned phrase removed with its "que" and, when it is a sentence on its own, the whole sentence.
 */
export function applyGuide(text: string, guide: Pick<WritingGuide, 'terms' | 'rules'>): { after: string; changes: GuideChange[] } {
  let after = text;
  const changes: GuideChange[] = [];
  for (const term of guide.terms) {
    const word = termWord(term.use);
    if (!term.avoid.trim() || !word) continue;
    const pattern = new RegExp(`(?<![\\p{L}])${escape(term.avoid.trim())}(?![\\p{L}])`, 'giu');
    if (!pattern.test(after)) continue;
    after = after.replace(pattern, (found: string) => (found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word));
    changes.push({ kind: 'term', from: term.avoid.trim(), to: word, rule: 'Termos' });
  }
  for (const { phrase, rule } of bannedPhrases(guide)) {
    const sentence = new RegExp(`(^|(?<=[.!?]\\s))${escape(phrase)}(?![\\p{L}])[^.!?]*[.!?]\\s*`, 'iu');
    const lead = new RegExp(`(?<![\\p{L}])${escape(phrase)}(?![\\p{L}])(\\s+que)?\\s*`, 'giu');
    const whole = sentence.exec(after);
    if (whole && whole[0].trim().split(/\s+/).length <= phrase.split(/\s+/).length + 3) {
      after = after.replace(sentence, '');
    } else if (lead.test(after)) {
      after = after.replace(lead, '');
    } else {
      continue;
    }
    changes.push({ kind: 'phrase', from: phrase, rule: `Regra ${rule}` });
  }
  return { after: capitalizeSentences(after.replace(/\s{2,}/g, ' ').trim()), changes };
}

export type DiffHunk = { kind: 'equal' | 'insert' | 'delete'; text: string };

/** Word-level difference of two texts (longest common subsequence), as runs for the DS DiffView. */
export function wordDiff(before: string, after: string): DiffHunk[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const hunks: DiffHunk[] = [];
  const push = (kind: DiffHunk['kind'], text: string) => {
    const last = hunks[hunks.length - 1];
    if (last && last.kind === kind) last.text += text;
    else hunks.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('delete', a[i]);
      i += 1;
    } else {
      push('insert', b[j]);
      j += 1;
    }
  }
  while (i < a.length) push('delete', a[i++]);
  while (j < b.length) push('insert', b[j++]);
  return hunks;
}

/** "Até 90 caracteres", "Até 40 palavras": the first limit a principle states. */
export function limitIn(text: string, unit: 'caracteres' | 'palavras'): number | undefined {
  const match = new RegExp(`até\\s+(\\d+)\\s+${unit}`, 'i').exec(text);
  return match ? Number(match[1]) : undefined;
}

export type OpeningCheck = { rule: string; ok: boolean; detail: string };

/** The attribution words the guide asks for, quoted in its text ("segundo", "de acordo com"). */
export function attributionWords(guide: Pick<WritingGuide, 'attribution'>): string[] {
  return [...guide.attribution.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1].trim()).filter(Boolean);
}

/** The example opening measured against the guide's headline and lead limits and its attribution words. */
export function openingChecks(guide: Pick<WritingGuide, 'headline' | 'lead' | 'attribution'>): OpeningCheck[] {
  const headlineMax = limitIn(guide.headline, 'caracteres');
  const leadMax = limitIn(guide.lead, 'palavras');
  const leadWords = SAMPLE_OPENING.lead.split(/\s+/).filter(Boolean).length;
  return [
    {
      rule: 'Título',
      ok: headlineMax === undefined || SAMPLE_OPENING.headline.length <= headlineMax,
      detail: headlineMax ? `${SAMPLE_OPENING.headline.length} de até ${headlineMax} caracteres` : `${SAMPLE_OPENING.headline.length} caracteres`,
    },
    {
      rule: 'Lead',
      ok: leadMax === undefined || leadWords <= leadMax,
      detail: leadMax ? `${leadWords} de até ${leadMax} palavras` : `${leadWords} palavras`,
    },
    (() => {
      const words = attributionWords(guide);
      const used = words.find((word) => SAMPLE_OPENING.lead.toLowerCase().includes(word.toLowerCase()));
      return {
        rule: 'Atribuição',
        ok: words.length === 0 || Boolean(used),
        detail: used ? `o número vem com “${used}”` : words.length ? `nenhuma das palavras ${words.map((word) => `“${word}”`).join(', ')}` : 'sem palavras de atribuição no guia',
      };
    })(),
  ];
}

const addedOf = (before: readonly string[], after: readonly string[]) => after.filter((value) => !before.includes(value));

/** What a new version of the guide changes, in words, for the history. */
export function guideChanges(saved: WritingGuide, draft: WritingGuide): string[] {
  const changes: string[] = [];
  const principles: { key: 'voice' | 'headline' | 'dek' | 'lead' | 'attribution'; label: string }[] = [
    { key: 'voice', label: 'Voz' }, { key: 'headline', label: 'Título' }, { key: 'dek', label: 'Linha fina' }, { key: 'lead', label: 'Lead' }, { key: 'attribution', label: 'Atribuição' },
  ];
  for (const principle of principles) {
    if ((saved[principle.key] ?? '').trim() !== (draft[principle.key] ?? '').trim()) changes.push(`${principle.label} revisto`);
  }
  const composition = { paragraphs: 'Parágrafos', headings: 'Intertítulos', emphasis: 'Negrito e destaques', lists: 'Listas', closing: 'Encerramento', length: 'Extensão', links: 'Links', figures: 'Imagens e legendas' };
  for (const key of Object.keys(composition) as (keyof typeof composition)[]) {
    if ((saved.composition?.[key] ?? '').trim() !== (draft.composition?.[key] ?? '').trim()) changes.push(`${composition[key]} revisto`);
  }
  const terms = (guide: WritingGuide) => guide.terms.map((term) => `${term.avoid} → ${term.use}`);
  for (const term of addedOf(terms(saved), terms(draft))) changes.push(`Novo termo: ${term}`);
  for (const term of addedOf(terms(draft), terms(saved))) changes.push(`Termo removido: ${term}`);
  const rules = (guide: WritingGuide) => guide.rules.map((rule) => rule.text.trim());
  for (const rule of addedOf(rules(saved), rules(draft))) changes.push(`Nova regra: ${rule}`);
  for (const rule of addedOf(rules(draft), rules(saved))) changes.push(`Regra removida: ${rule}`);
  for (const example of draft.examples) {
    const previous = saved.examples.find(item => item.id === example.id);
    if (!previous) changes.push(`Nova referência: ${example.title || 'Sem título'}`);
    else if (previous.title !== example.title || previous.url !== example.url || previous.note !== example.note) changes.push(`Referência revista: ${example.title || 'Sem título'}`);
  }
  for (const example of saved.examples) if (!draft.examples.some(item => item.id === example.id)) changes.push(`Referência removida: ${example.title}`);
  return changes;
}
