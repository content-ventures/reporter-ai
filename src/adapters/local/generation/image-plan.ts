import { blockText, imageSlotBlock } from '../../../domain/article.ts';
import type { ArticleBlock, ImageSlot } from '../../../domain/article.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import type { SpeakerInfo } from './editorial.ts';
import { isFullName } from './editorial.ts';
import type { Material, MaterialLine } from './material.ts';
import { capitalize, sentenceSpans } from './sentences.ts';

/**
 * Image slots of an extractive draft ("Sugestões de imagem"): where the article asks for a picture
 * and what it should show. Like the text, a subject only SELECTS what the material holds: a
 * portrait of a person who speaks in it (name and role from "Falantes"), or a place, product or
 * scene the answers mention, cut verbatim ("loja de museu em Lisboa"). Nothing found, no slot:
 * an image is never invented. Each slot points at the excerpt it came from (`sourceRefs`).
 *
 * Layout (configurable): a slot right after the introduction, one inside every second section
 * (after its opening paragraph) and a suggestion for the cover.
 */

export type ImagePlanOptions = {
  /** A slot between the introduction and the first section. */
  afterIntro: boolean;
  /** One slot every `everySections` sections (the 2nd, the 4th…); 0 turns them off. */
  everySections: number;
  /** A suggestion for the cover ("Imagem de destaque" stays optional, D04). */
  cover: boolean;
};

export const DEFAULT_IMAGE_PLAN: ImagePlanOptions = { afterIntro: true, everySections: 2, cover: true };

/** What a draft plan holds that the image plan reads and extends. */
export type ImagePlanTarget = { intro: ArticleBlock[]; sections: { blocks: ArticleBlock[] }[]; coverSlot?: ImageSlot };

export type ImagePlanInput = {
  material: Material;
  /** Person behind each speaker label (name and role line). */
  speakers?: Readonly<Record<string, SpeakerInfo>>;
  newId: (prefix: string) => string;
  options?: Partial<ImagePlanOptions>;
};

/**
 * Things a camera can show, folded (no accents, lower case). A mention starts at one of them and
 * may carry up to two complements ("loja de museu em Lisboa", "fábrica de calçados").
 */
const VISUAL_NOUNS = new Set(
  [
    'fábrica', 'fábricas', 'ateliê', 'ateliês', 'oficina', 'oficinas', 'loja', 'lojas', 'feira', 'feiras', 'estande', 'estandes',
    'vitrine', 'vitrines', 'galpão', 'galpões', 'laboratório', 'laboratórios', 'escola', 'escolas', 'curtume', 'curtumes',
    'pavilhão', 'pavilhões', 'armazém', 'depósito', 'esteira', 'esteiras', 'máquina', 'máquinas', 'impressora', 'impressoras',
    'produto', 'produtos', 'peça', 'peças', 'coleção', 'coleções', 'sapato', 'sapatos', 'calçado', 'calçados', 'bota', 'botas',
    'sandália', 'sandálias', 'tênis', 'bolsa', 'bolsas', 'pulseira', 'pulseiras', 'colar', 'colares', 'brinco', 'brincos',
    'bijuteria', 'bijuterias', 'couro', 'solado', 'solados', 'molde', 'moldes', 'amostra', 'amostras', 'protótipo', 'protótipos',
    'embalagem', 'embalagens', 'caixa', 'caixas', 'catálogo', 'catálogos', 'cartão', 'aparas', 'retalhos', 'tecido', 'tecidos',
    'artesã', 'artesãs', 'artesão', 'artesãos', 'costureira', 'costureiras', 'modelista', 'modelistas', 'linha', 'contêiner',
    'contêineres', 'porto', 'caminhão', 'caminhões', 'aplicativo', 'app', 'balcão', 'prateleira', 'prateleiras', 'expositor',
    'expositores', 'showroom', 'forno', 'fornos', 'fornada', 'fornadas', 'cozinha', 'cozinhas', 'padaria', 'padarias', 'pão', 'pães',
    'bancada', 'bancadas', 'sala', 'salas', 'bicicleta', 'horta', 'hortas', 'restaurante', 'prato', 'pratos',
  ].map(fold),
);

/** Complements a mention may carry: a preposition and what follows ("de museu", "em Lisboa"). */
const LINKS = new Set(['de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'com']);
/** Words that end a complement: they start a clause, point elsewhere or say nothing on their own. */
const CLAUSE_WORDS = new Set(
  [
    'que', 'quem', 'onde', 'quando', 'como', 'qual', 'e', 'ou', 'mas', 'porque', 'pra', 'para', 'a', 'o', 'as', 'os', 'um', 'uma',
    'uns', 'umas', 'isso', 'isto', 'aquilo', 'ela', 'ele', 'eles', 'elas', 'gente', 'você', 'vocês', 'mim', 'nós', 'cada', 'todo',
    'toda', 'todos', 'todas', 'mesmo', 'mesma', 'mesmos', 'mesmas', 'outro', 'outra', 'outros', 'outras', 'seu', 'sua', 'seus',
    'suas', 'nosso', 'nossa', 'nossos', 'nossas', 'meu', 'minha', 'meus', 'minhas', 'esse', 'essa', 'esses', 'essas', 'este',
    'esta', 'estes', 'estas', 'aquele', 'aquela', 'dele', 'dela', 'deles', 'delas', 'muito', 'muita', 'muitos', 'muitas', 'pouco',
    'pouca', 'vez', 'vezes', 'dois', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'cem', 'mil',
    'primeiro', 'primeira', 'segundo', 'segunda', 'tudo', 'nada', 'algo', 'alguém', 'ninguém', 'verdade', 'fato', 'forma', 'jeito',
    'tipo', 'parte', 'coisa', 'coisas',
  ].map(fold),
);
/** Nouns that are vague alone ("linha", "sala"): only "linha de separação", "sala de modelagem" show something. */
const NEEDS_COMPLEMENT = new Set(['linha', 'caixa', 'caixas', 'cartão', 'app', 'aplicativo', 'porto', 'sala', 'salas', 'prato', 'pratos'].map(fold));

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

type Token = { text: string; from: number; to: number };

function tokens(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((match) => ({ text: match[0], from: match.index ?? 0, to: (match.index ?? 0) + match[0].length }));
}

/** Text between two tokens with only spaces in it (a comma or a quote ends the mention). */
function joined(text: string, left: Token, right: Token): boolean {
  return /^\s+$/.test(text.slice(left.to, right.from));
}

const capitalized = (token: Token) => /^\p{Lu}/u.test(token.text);
/** An infinitive starts a clause ("de costurar", "para dividir"): the complement stops before it. */
const infinitive = (token: Token) => token.text.length >= 5 && /[aei]r$/i.test(token.text) && !capitalized(token);

/** Adjective-looking endings ("calçados femininos", "feira grande", "couro vegetal"). */
const ADJECTIVE =
  /^(?:grandes?|pequen[oa]s?|nov[oa]s?|antig[oa]s?|\p{L}+(?:al|ais|os[oa]s?|iv[oa]s?|ic[oa]s?|ad[oa]s?|id[oa]s?|entes?|antes?|eir[oa]s?|in[oa]s?|esas?|ês|ários?|árias?))$/u;

/** One adjective right after a word (`index` is the candidate), or -1. */
function adjectiveAt(text: string, list: readonly Token[], index: number): number {
  const word = list[index];
  if (!word || capitalized(word) || CLAUSE_WORDS.has(fold(word.text)) || LINKS.has(fold(word.text)) || !joined(text, list[index - 1], word)) return -1;
  return ADJECTIVE.test(word.text.toLocaleLowerCase('pt-BR')) ? index : -1;
}

/**
 * The complement after a preposition at `index`: one plain word, or a proper name of up to three
 * capitalised words ("Minas Gerais", "Bella Passo"). Returns the index of its last token, or -1.
 */
function complementEnd(text: string, list: readonly Token[], index: number): number {
  const first = list[index];
  if (!first || CLAUSE_WORDS.has(fold(first.text)) || /^\d/.test(first.text) || infinitive(first)) return -1;
  if (!capitalized(first)) return index;
  let end = index;
  while (end + 1 < list.length && end - index < 2 && capitalized(list[end + 1]) && joined(text, list[end], list[end + 1])) end += 1;
  return end;
}

export type Mention = { text: string; score: number; /** The visual noun it starts with, folded. */ head: string };

/**
 * Visual mentions of a text, verbatim: a visual noun and up to two complements. Specific ones
 * (with complements, with a proper name) score higher; a noun that is vague alone needs one.
 */
export function visualMentions(text: string): Mention[] {
  const found: Mention[] = [];
  for (const sentence of sentenceSpans(text)) {
    const list = tokens(sentence.text);
    for (let index = 0; index < list.length; index += 1) {
      const noun = fold(list[index].text);
      if (!VISUAL_NOUNS.has(noun)) continue;
      // Part of a proper name ("Ateliê Sul", "Grupo Horizonte"): a brand, not a scene.
      if (capitalized(list[index]) && (index > 0 || (list[index + 1] && capitalized(list[index + 1])))) continue;
      let end = index;
      let complements = 0;
      let named = false;
      let described = false;
      const describe = () => {
        const adjective = adjectiveAt(sentence.text, list, end + 1);
        if (adjective < 0) return;
        end = adjective;
        described = true;
      };
      describe();
      while (complements < 2 && end + 2 < list.length) {
        const link = list[end + 1];
        if (!LINKS.has(fold(link.text)) || !joined(sentence.text, list[end], link) || !joined(sentence.text, link, list[end + 2])) break;
        const last = complementEnd(sentence.text, list, end + 2);
        if (last < 0) break;
        if (capitalized(list[end + 2])) named = true;
        end = last;
        complements += 1;
        if (!capitalized(list[last])) describe();
      }
      if (complements === 0 && !described && NEEDS_COMPLEMENT.has(noun)) continue;
      const phrase = sentence.text.slice(list[index].from, list[end].to);
      found.push({ text: phrase, head: noun, score: 1 + complements * 2 + (described ? 1 : 0) + (named ? 2 : 0) });
      index = end;
    }
  }
  return found;
}

/** The best mention of some texts (ties: the first one) whose noun no slot shows yet. */
function bestMention(texts: readonly string[], used: ReadonlySet<string>): Mention | undefined {
  let best: Mention | undefined;
  for (const text of texts) {
    for (const mention of visualMentions(text)) {
      if (used.has(mention.head)) continue;
      if (!best || mention.score > best.score) best = mention;
    }
  }
  return best;
}

type Voice = { label: string; name: string; title?: string; words: number };

/** Named voices of the material (never the interviewer, never a raw label), most words first. */
function namedVoices(material: Material, speakers: Readonly<Record<string, SpeakerInfo>> | undefined): Voice[] {
  const voices = new Map<string, Voice>();
  for (const line of material.lines) {
    if (!line.speaker || line.speaker === material.interviewer) continue;
    const info = speakers?.[line.speaker];
    const name = info?.name?.trim() || (isFullName(line.speaker) ? line.speaker.trim() : '');
    if (!name) continue;
    const voice = voices.get(line.speaker) ?? { label: line.speaker, name, words: 0 };
    const title = info?.title?.trim();
    if (title) voice.title = title;
    voice.words += line.words;
    voices.set(line.speaker, voice);
  }
  return [...voices.values()].sort((a, b) => b.words - a.words);
}

function portrait(voice: Voice): ImageSlot {
  return {
    subject: `Retrato de ${voice.name}`,
    suggestedCaption: voice.title ? `${voice.name}, ${voice.title}` : voice.name,
    suggestedAlt: `Retrato de ${voice.name}`,
    orientation: 'landscape',
  };
}

function scene(mention: Mention): ImageSlot {
  const subject = capitalize(mention.text);
  return { subject, suggestedAlt: subject, orientation: 'landscape' };
}

function refsOf(blocks: readonly ArticleBlock[]): SourceRef[] {
  return blocks.flatMap((block) => block.sourceRefs ?? []);
}

/** Blocks with text that a voice speaks in (by the segments their evidence cites). */
function spokenBy(blocks: readonly ArticleBlock[], label: string, lines: ReadonlyMap<string, MaterialLine>): ArticleBlock[] {
  return blocks.filter((block) =>
    (block.sourceRefs ?? []).some((ref) => ref.locator.type === 'segment' && lines.get(ref.locator.segmentId)?.speaker === label),
  );
}

/** The text a block contributes to the search (quotes and attributions included: all of it is verbatim). */
function textsOf(blocks: readonly ArticleBlock[]): string[] {
  return blocks.map(blockText).filter((text) => text.length > 0);
}

/**
 * Adds the image slots to a draft plan: the cover suggestion (a portrait of the main voice, else
 * the strongest scene), a slot after the introduction (a scene of the opening, else that
 * portrait) and one per `everySections` sections (a scene of the section, else a portrait of
 * another voice who speaks there). Text, word counts and quotes are untouched.
 */
export function withImageSlots<P extends ImagePlanTarget>(plan: P, input: ImagePlanInput): P {
  const options = { ...DEFAULT_IMAGE_PLAN, ...input.options };
  const voices = namedVoices(input.material, input.speakers);
  const lines = new Map(input.material.lines.map((line) => [line.segmentId as string, line]));
  const used = new Set<string>();
  const portrayed = new Set<string>();
  const allBlocks = [...plan.intro, ...plan.sections.flatMap((section) => section.blocks)];
  const main = voices[0];

  const slotBlock = (slot: ImageSlot, refs: readonly SourceRef[]) =>
    imageSlotBlock(input.newId('blk'), slot, refs.length > 0 ? { sourceRefs: [refs[0]] } : undefined);
  const take = (slot: ImageSlot, key: string) => {
    used.add(key);
    return slot;
  };

  let coverSlot: ImageSlot | undefined;
  if (options.cover && !plan.coverSlot) {
    if (main) {
      portrayed.add(main.label);
      coverSlot = take(portrait(main), main.name);
    } else {
      const mention = bestMention(textsOf(allBlocks), used);
      if (mention) coverSlot = take(scene(mention), mention.head);
    }
  }

  let intro = plan.intro;
  if (options.afterIntro && plan.intro.length > 0) {
    const mention = bestMention(textsOf(plan.intro), used);
    let slot: ArticleBlock | undefined;
    if (mention) {
      const source = plan.intro.find((block) => visualMentions(blockText(block)).some((entry) => entry.text === mention.text));
      slot = slotBlock(take(scene(mention), mention.head), refsOf(source ? [source] : plan.intro));
    } else if (main && !portrayed.has(main.label)) {
      portrayed.add(main.label);
      slot = slotBlock(take(portrait(main), main.name), refsOf(spokenBy(allBlocks, main.label, lines)));
    }
    if (slot) intro = [...plan.intro, slot];
  }

  const every = Math.max(0, Math.floor(options.everySections));
  const sections = plan.sections.map((section, index) => {
    if (every === 0 || (index + 1) % every !== 0 || section.blocks.length === 0) return section;
    const mention = bestMention(textsOf(section.blocks), used);
    let slot: ArticleBlock | undefined;
    if (mention) {
      const source = section.blocks.find((block) => visualMentions(blockText(block)).some((entry) => entry.text === mention.text));
      slot = slotBlock(take(scene(mention), mention.head), refsOf(source ? [source] : section.blocks));
    } else {
      const voice = voices.find((candidate) => !portrayed.has(candidate.label) && spokenBy(section.blocks, candidate.label, lines).length > 0);
      if (voice) {
        portrayed.add(voice.label);
        slot = slotBlock(take(portrait(voice), voice.name), refsOf(spokenBy(section.blocks, voice.label, lines)));
      }
    }
    if (!slot) return section;
    // After the section's opening paragraph: the image sits inside the section, never last.
    return { ...section, blocks: [section.blocks[0], slot, ...section.blocks.slice(1)] };
  });

  const next: P = { ...plan, intro, sections };
  if (coverSlot) next.coverSlot = coverSlot;
  return next;
}
