import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockText } from '../../../domain/article.ts';
import { checkQuotes } from '../../../domain/quotes.ts';
import { resolveSourceRef } from '../../../domain/source.ts';
import { createTranscriptSource } from '../../../domain/source.ts';
import { countWords } from '../../../domain/text/stats.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import { extractiveCarouselPlan, slideSequence } from './carousel-plan.ts';
import { askedQuestion, extractivePlan, MAX_MATERIAL_SHARE, planBlocks } from './draft-plan.ts';
import { groupUnits, readMaterial } from './material.ts';
import { chunkWords } from './pacing.ts';
import { createRng } from './random.ts';
import { cutAtWord, fitText, sentenceSpans } from './sentences.ts';
import { INTERVIEW, TEST_TEMPLATE } from './testing.ts';
import { rewrite, shorten, toListItems } from './transforms.ts';

const ctx = { now: '2026-10-07T12:00:00.000Z', newId: (prefix: string) => `${prefix}-x`, actorId: 'person-ana' };
let counter = 0;
const newId = (prefix: string) => `${prefix}-${++counter}`;

function source(text = INTERVIEW) {
  return createTranscriptSource({ workspaceId: 'ws', title: 'Entrevista', origin: 'interview', parsed: parseTranscript(text), authorized: true }, ctx);
}

describe('extractive helpers', () => {
  it('splits sentences with exact offsets and keeps abbreviations together', () => {
    const text = 'O Sr. Nunes chegou. Depois, a feira! E então?';
    const spans = sentenceSpans(text);
    assert.deepEqual(spans.map((span) => span.text), ['O Sr. Nunes chegou.', 'Depois, a feira!', 'E então?']);
    for (const span of spans) assert.equal(text.slice(span.from, span.to), span.text);
  });

  it('cuts at word boundaries and fits whole sentences first', () => {
    assert.deepEqual(cutAtWord('Começamos numa garagem em 2015', 18), { text: 'Começamos numa', cut: true });
    assert.equal(fitText('Primeira frase curta. Segunda frase bem mais longa que o limite.', 30), 'Primeira frase curta.');
    assert.equal(fitText('Uma frase única que não cabe no limite pedido', 20), 'Uma frase única que…');
  });

  it('chunks text into 1–3 word deltas that rebuild it exactly', () => {
    const text = 'A feira mudou tudo,  porque ali a gente entendeu.';
    const chunks = chunkWords(text, createRng('seed'));
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every((chunk) => countWords(chunk) <= 3));
  });

  it('is deterministic for a seed', () => {
    const a = createRng('x');
    const b = createRng('x');
    assert.deepEqual([a.next(), a.next(), a.int(1, 9)], [b.next(), b.next(), b.int(1, 9)]);
  });

  it('reads an interview as questions and answers', () => {
    const material = readMaterial([source()]);
    assert.equal(material.interviewer, 'Entrevistadora');
    assert.equal(material.mode, 'qa');
    assert.equal(material.units.length, 5);
    assert.ok(material.units.every((unit) => unit.question?.speaker === 'Entrevistadora'));
    assert.deepEqual(groupUnits(material.units, 3).map((group) => group.length).reduce((a, b) => a + b, 0), 5);
  });

  it('falls back to contiguous chunks when the material has no questions', () => {
    const talk = source(
      [
        'Palestrante: Hoje vou contar como montamos a cooperativa de padeiras no bairro, desde a primeira reunião na associação de moradores.',
        'Palestrante: Primeiro juntamos nove padeiras que compravam farinha sozinhas e pagavam caro por cada saco entregue na porta de casa.',
        'Palestrante: Depois alugamos um forno coletivo num galpão e criamos uma escala semanal de turnos de quatro horas para cada uma.',
        'Palestrante: Por fim, abrimos uma escola de panificação para os jovens do bairro, com aulas aos sábados no próprio galpão.',
      ].join('\n'),
    );
    const material = readMaterial([talk]);
    assert.equal(material.mode, 'flow');
    const plan = extractivePlan({ sources: [talk], brief: { sections: 2, length: 'short', revision: 1 }, fallbackTitle: 'Palestra', rng: createRng('t'), newId });
    assert.ok(plan.ok);
    assert.equal(plan.value.sections.length, 2);
  });
});

describe('extractive article plan', () => {
  const material = source();
  const plan = extractivePlan({
    sources: [material],
    brief: { sections: 3, length: 'long', revision: 1 },
    fallbackTitle: 'Padaria Fermento Vivo',
    rng: createRng('plan'),
    newId,
  });

  it('never draws more than the material holds, even for a long brief', () => {
    assert.ok(plan.ok);
    // Material words only: what is inside quotation marks, or the whole block when nothing is quoted.
    const excerpts = planBlocks(plan.value)
      .filter((block) => block.type !== 'heading')
      .map((block) => {
        const text = blockText(block);
        const quoted = [...text.matchAll(/“([^”]+)”/g)].map((match) => match[1]);
        return quoted.length > 0 ? quoted.join(' ') : text;
      });
    const used = countWords(excerpts.join(' '));
    assert.ok(used <= readMaterial([material]).answerWords * MAX_MATERIAL_SHARE + 6, `${used} words`);
  });

  it('cites every block with a resolvable segment range and quotes verbatim', () => {
    assert.ok(plan.ok);
    const blocks = planBlocks(plan.value);
    for (const block of blocks) {
      assert.ok(block.sourceRefs && block.sourceRefs.length > 0, `block ${block.id} cites the material`);
      for (const ref of block.sourceRefs) assert.ok(resolveSourceRef([material], ref));
    }
    const quotes = checkQuotes({ type: 'article', title: plan.value.title, blocks }, [material]);
    assert.ok(quotes.length >= 2 && quotes.every((quote) => quote.status === 'verified'));
    assert.ok(plan.value.keyQuotes.every((ref) => resolveSourceRef([material], ref)));
  });

  it('every paragraph is an exact excerpt of the cited segment range', () => {
    assert.ok(plan.ok);
    for (const block of planBlocks(plan.value)) {
      if (block.type !== 'paragraph' || block.inlines.some((inline) => inline.text.includes('“'))) continue;
      const ref = block.sourceRefs?.[0];
      assert.ok(ref);
      const excerpt = resolveSourceRef([material], ref)?.excerpt ?? '';
      const text = blockText(block).replace(/^[^:]+: /, '').replace(/…$/, '');
      assert.equal(text, excerpt);
    }
  });

  it('turns a spoken question into a heading', () => {
    const speakers = ['Rafael Dias', 'Beatriz Almeida', 'Lucas Ferraz'];
    assert.equal(askedQuestion('Beatriz, pra começar: o que vai estar no pé das pessoas no verão de 2027?', speakers), 'O que vai estar no pé das pessoas no verão de 2027?');
    assert.equal(askedQuestion('Lucas, isso aparece na venda?', speakers), 'Isso aparece na venda?');
    assert.equal(askedQuestion('E a sustentabilidade, sai do discurso em 2027?', speakers), 'A sustentabilidade, sai do discurso em 2027?');
    assert.equal(askedQuestion('Brasil, qual o próximo passo?', speakers), 'Brasil, qual o próximo passo?');
  });

  it('keeps greetings out and the answer before the first question in the intro', () => {
    const pasted = source(
      [
        'Clara Souto: Bom dia, Marcos. Pra começar, conta pra quem não conhece o que a Oficina Vento faz hoje.',
        'Marcos Lima: Bom dia, Clara. A Oficina Vento fabrica mochilas e bolsas de lona reciclada em Novo Hamburgo. Começamos em 2019 com quatro pessoas e hoje somos trinta e duas costureiras.',
        'Clara Souto: E de onde vem a lona?',
        'Marcos Lima: Vem de caminhoneiros e de transportadoras do Vale dos Sinos. A lona de caminhão dura uns cinco anos na estrada e depois vira lixo. A gente compra por quilo e corta à mão.',
        'Clara Souto: Qual foi a maior dificuldade no começo?',
        'Marcos Lima: Padronizar. Cada lona chega com uma cor, um desgaste, um logotipo diferente. Depois percebemos que era o produto, e hoje a etiqueta conta de onde ela veio.',
        'Clara Souto: Obrigada, Marcos.',
        'Marcos Lima: Eu que agradeço, Clara.',
      ].join('\n'),
    );
    const material = readMaterial([pasted]);
    assert.equal(material.preamble.length, 1);
    assert.equal(material.units[0].question?.text, 'E de onde vem a lona?');
    const result = extractivePlan({ sources: [pasted], brief: { sections: 2, length: 'short', revision: 1 }, fallbackTitle: 'x', rng: createRng('p'), newId });
    assert.ok(result.ok);
    const texts = planBlocks(result.value).map(blockText);
    assert.ok(texts.every((text) => !/bom dia|agradeço/i.test(text)), texts.join(' | '));
    const lona = result.value.sections.find((section) => section.blocks.some((block) => /caminhoneiros|transportadoras/.test(blockText(block))));
    assert.ok(lona && lona.blocks.some((block) => /caminhoneiros|caminhão|quilo/.test(blockText(block))));
    assert.ok(planBlocks(result.value).some((block) => /Oficina Vento|2019/.test(blockText(block))));
  });

  it('writes reported speech with the person\'s name and role, and closes on a quote', () => {
    const named = extractivePlan({
      sources: [material],
      brief: { sections: 3, length: 'medium', revision: 1 },
      fallbackTitle: 'x',
      rng: createRng('voices'),
      newId,
      speakers: { 'Lúcia Prado': { name: 'Lúcia Prado', title: 'fundadora da padaria' } },
    });
    assert.ok(named.ok);
    const texts = planBlocks(named.value).filter((block) => block.type === 'paragraph').map(blockText);
    assert.match(texts.join(' '), /diz Lúcia Prado, fundadora da padaria/);
    assert.equal(texts.join(' ').match(/fundadora da padaria/g)?.length, 1, 'the role is said once');
    const last = named.value.sections[named.value.sections.length - 1];
    assert.equal(last.blocks[last.blocks.length - 1]?.type, 'quote');
    assert.ok(named.value.sections.every((section) => !blockText(section.heading).endsWith('?')));
  });

  it('caps sections at the number of question units and refuses tiny material', () => {
    const short = source('Entrevistadora: Como foi?\nLúcia Prado: Foi bom.\nEntrevistadora: E agora?\nLúcia Prado: Seguimos.');
    const refused = extractivePlan({ sources: [short], brief: { sections: 3, length: 'short', revision: 1 }, fallbackTitle: 'x', rng: createRng('s'), newId });
    assert.equal(!refused.ok && refused.refusal.code, 'material_too_short');
    const five = extractivePlan({ sources: [material], brief: { sections: 5, length: 'short', revision: 1 }, fallbackTitle: 'x', rng: createRng('s'), newId });
    assert.ok(five.ok && five.value.sections.length <= 5);
  });
});

describe('text transforms (never alter quotations)', () => {
  const text = 'Na verdade, a gente começou numa garagem, né, e basicamente tudo mudou. É importante destacar que a feira tá crescendo pra todo mundo. Ela disse: “na verdade, tá tudo bem”.';

  it('"Mais direto" drops fillers and meta-commentary', () => {
    const direct = rewrite(text, 'direct');
    assert.doesNotMatch(direct.replace(/“[^”]*”/g, ''), /na verdade|basicamente|é importante destacar/i);
    assert.match(direct, /“na verdade, tá tudo bem”/);
    assert.match(direct, /^A gente começou/);
  });

  it('"Formal" swaps colloquial forms outside quotations', () => {
    const formal = rewrite(text, 'formal');
    assert.match(formal, /está crescendo para todo mundo/);
    assert.match(formal, /em uma garagem/);
    assert.match(formal, /“na verdade, tá tudo bem”/);
  });

  it('"Didático" splits long sentences at their joints', () => {
    const long = 'A cooperativa comprou farinha direto do moinho e o custo caiu muito em pouco tempo para todas, mas a divisão do caixa demorou seis meses para ficar clara entre as nove padeiras do bairro.';
    assert.match(rewrite(long, 'didactic'), /\. Mas a divisão/);
  });

  it('"Encurtar" removes words without dropping quotes or the lead sentence', () => {
    const shorter = shorten(`${text} Também houve outras coisas pequenas que não importam tanto agora.`);
    assert.ok(countWords(shorter) < countWords(text) + 10);
    assert.match(shorter, /“na verdade, tá tudo bem”/);
  });

  it('"Virar lista" makes one item per sentence', () => {
    assert.deepEqual(toListItems('Abrimos a loja. Veio a feira! E a escola.'), ['Abrimos a loja', 'Veio a feira!', 'E a escola']);
  });
});

describe('carousel copy plan', () => {
  it('maps the default sequence onto the template and fits every slot budget', () => {
    assert.deepEqual(slideSequence(TEST_TEMPLATE, 5), ['cover', 'context', 'point', 'quote', 'closing']);
    assert.deepEqual(slideSequence(TEST_TEMPLATE, 3), ['cover', 'point', 'closing']);
    assert.equal(slideSequence(TEST_TEMPLATE, 7).filter((layout) => layout === 'point').length, 3);
    const material = source();
    const plan = extractivePlan({ sources: [material], brief: { sections: 3, length: 'short', revision: 1 }, fallbackTitle: 'x', rng: createRng('c'), newId });
    assert.ok(plan.ok);
    const article = { type: 'article' as const, title: plan.value.title, blocks: planBlocks(plan.value) };
    const carousel = extractiveCarouselPlan({ article, template: TEST_TEMPLATE, slides: 5, sources: [material], newId });
    const ids = new Set(article.blocks.map((block) => block.id));
    for (const slide of carousel.slides) {
      const layout = TEST_TEMPLATE.layouts.find((entry) => entry.id === slide.layout);
      assert.ok(layout);
      for (const slot of layout.slots) assert.ok((slide.slots[slot.id] ?? '').length <= slot.maxChars, `${slide.layout}.${slot.id} fits`);
      assert.ok(slide.sourceBlockIds.every((id) => ids.has(id)));
    }
    assert.equal(carousel.slides[0].slots.kicker, 'Entrevista');
  });
});
