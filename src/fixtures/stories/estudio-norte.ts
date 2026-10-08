import { blockText, findBlock, toSourceVersionRef, toVersionRef } from '../../domain/index.ts';
import type { ArticleBody, Source } from '../../domain/index.ts';
import { copilotTool } from '../../registries/index.ts';
import { applyEdits, buildDraftScript, h2, img, p } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { completedRun } from '../build/runs.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { scriptBody } from '../script-book.ts';
import type { ScriptEntry } from '../script-book.ts';
import { after, ago, dateOf } from '../time.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: draft being edited ("Continue de onde parou" for João). v1 · IA, a saved v2, and a
 * dirty working draft where João paraphrased a quotation (the quote check shows "Falta"), two
 * AI blocks still unreviewed and a "Mais direto" suggestion waiting for Aceitar/Descartar.
 */

export const ESTUDIO_NORTE_TRANSCRIPT = [
  'Juliana Prates: Helena, o que o Estúdio Norte faz exatamente?',
  'Helena Brandão: Somos um estúdio de design de calçados. A gente desenha coleções para fábricas que não têm equipe própria de criação, do conceito até a ficha técnica. Hoje atendemos catorze fábricas, a maioria de pequeno porte.',
  'Juliana Prates: E onde entra a impressão 3D?',
  'Helena Brandão: Entra no protótipo. Antes, para testar um solado ou um salto novo, a fábrica precisava encomendar uma matriz, que custa caro e leva semanas. Hoje a gente imprime o salto em resina no próprio estúdio, monta no cabedal e leva para a fábrica testar no mesmo dia. Um protótipo de salto que levava três semanas agora fica pronto em dois dias.',
  'Juliana Prates: Quanto custou montar essa estrutura?',
  'Helena Brandão: Começamos com uma impressora de mesa, que custou menos do que uma única matriz de salto. Hoje temos três impressoras e uma pessoa dedicada só a isso. O investimento se pagou no primeiro semestre, só com as matrizes que nossos clientes deixaram de encomendar para testes que não deram certo.',
  'Juliana Prates: Os clientes confiam num salto impresso?',
  'Helena Brandão: No começo, não. A primeira reação é achar que é brinquedo. Por isso a gente nunca entrega o protótipo impresso como produto final. Ele serve para validar forma, altura e equilíbrio. Quando o modelo é aprovado, a fábrica encomenda a matriz definitiva com a certeza de que ela vai servir. A impressora não substitui a matriz, ela impede a matriz errada.',
  'Juliana Prates: Teve algum caso marcante?',
  'Helena Brandão: Teve uma fábrica que estava prestes a encomendar matrizes para um salto bloco em quatro alturas. Imprimimos os quatro, montamos e levamos para as vendedoras de três lojas experimentarem. Duas alturas foram descartadas na hora, porque desequilibravam o pé. A fábrica economizou duas matrizes e lançou o modelo com as duas alturas que as lojistas aprovaram. Esse modelo foi o mais vendido da coleção.',
  'Juliana Prates: E qual é o limite da tecnologia hoje?',
  'Helena Brandão: O material. A resina que a gente usa é ótima para testar forma, mas não aguenta o uso real. Ninguém deve caminhar uma semana com um salto impresso. Existem materiais mais resistentes, mas ainda são caros para estúdios do nosso tamanho. Acho que em três ou quatro anos isso muda, e aí a impressão vai chegar a pequenas séries de produto final.',
  'Juliana Prates: Como isso muda a relação com as fábricas?',
  'Helena Brandão: A conversa fica mais concreta. Antes eu apresentava um desenho e a fábrica precisava imaginar o sapato. Agora eu coloco o protótipo na mesa e todo mundo discute a mesma coisa. Reunião que levava uma tarde inteira agora se resolve em quarenta minutos. E a fábrica arrisca mais, porque errar no protótipo ficou barato.',
  'Juliana Prates: Que conselho você dá para uma fábrica que quer começar?',
  'Helena Brandão: Comece pelo teste mais caro que vocês fazem hoje. Para a maioria, é o salto. Imprima esse teste e compare o custo. Não precisa começar com um laboratório: uma impressora boa e alguém curioso já fazem muita diferença.',
  'Juliana Prates: E como vocês cobram por esse serviço?',
  'Helena Brandão: Cobramos por protótipo, com um valor fechado que inclui a impressão e a montagem no cabedal. Para a fábrica, fica mais fácil comparar com o preço de uma matriz. No último ano imprimimos mais de duzentos saltos para testes, e menos de um terço chegou a virar matriz definitiva. Cada teste descartado é uma matriz que ninguém precisou pagar.',
].join('\n\n');

export const ESTUDIO_NORTE_ARTICLE: ArticleSpec = {
  title: 'Estúdio Norte usa impressão 3D para testar saltos em dois dias',
  coverSlot: { subject: 'Helena Brandão com um salto impresso em resina', suggestedCaption: 'Helena Brandão, sócia do Estúdio Norte', suggestedAlt: 'Helena Brandão segura um protótipo de salto impresso em 3D', orientation: 'landscape' },
  keyExcerpts: [
    'Um protótipo de salto que levava três semanas agora fica pronto em dois dias.',
    'A impressora não substitui a matriz, ela impede a matriz errada.',
    'Esse modelo foi o mais vendido da coleção.',
    'errar no protótipo ficou barato',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'en-intro-1',
          'O Estúdio Norte, que desenha coleções de calçados para catorze fábricas sem equipe própria de criação, encontrou na impressão 3D uma forma de errar mais barato. Protótipos de salto que levavam três semanas agora ficam prontos em dois dias, impressos em resina e montados no cabedal para teste na própria fábrica. A sócia Helena Brandão explica como a tecnologia mudou a relação com os clientes e onde ainda estão os limites.',
          'Hoje atendemos catorze fábricas, a maioria de pequeno porte.',
          'Um protótipo de salto que levava três semanas agora fica pronto em dois dias.',
        ),
        img(
          'en-img-1',
          { subject: 'Impressora 3D imprimindo um salto em resina no estúdio', suggestedCaption: 'Um protótipo de salto que levava três semanas fica pronto em dois dias', suggestedAlt: 'Impressora 3D do Estúdio Norte imprime um salto', orientation: 'landscape' },
          'Hoje a gente imprime o salto em resina no próprio estúdio',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('en-h1', 'Um teste que custa menos do que uma matriz'),
        p(
          'en-s1-p1',
          'A estrutura começou com uma impressora de mesa, que custou menos do que uma única matriz de salto. Hoje são três equipamentos e uma pessoa dedicada. Segundo a sócia Helena Brandão, o investimento se pagou no primeiro semestre, apenas com as matrizes que os clientes deixaram de encomendar para testes que não deram certo.',
          'Começamos com uma impressora de mesa, que custou menos do que uma única matriz de salto.',
          'O investimento se pagou no primeiro semestre',
        ),
        p(
          'en-s1-p1b',
          'O processo é simples: o salto é impresso em resina no próprio estúdio, montado no cabedal e levado à fábrica para teste no mesmo dia. Antes, cada teste de solado ou salto exigia encomendar uma matriz, que custa caro e leva semanas para ficar pronta.',
          'Hoje a gente imprime o salto em resina no próprio estúdio, monta no cabedal e leva para a fábrica testar no mesmo dia.',
          'a fábrica precisava encomendar uma matriz, que custa caro e leva semanas',
        ),
        p(
          'en-s1-p2',
          'O protótipo impresso nunca vira produto. Ele serve para validar forma, altura e equilíbrio antes de a fábrica encomendar a matriz definitiva. “A impressora não substitui a matriz, ela impede a matriz errada”, resume Helena.',
          'Ele serve para validar forma, altura e equilíbrio.',
          'A impressora não substitui a matriz, ela impede a matriz errada.',
        ),
        p(
          'en-s1-p3',
          'Uma fábrica prestes a encomendar matrizes para um salto bloco em quatro alturas testou antes os protótipos com vendedoras de três lojas. Duas alturas foram descartadas na hora por desequilibrar o pé. A fábrica economizou duas matrizes, e o modelo lançado com as alturas aprovadas foi o mais vendido da coleção.',
          'Teve uma fábrica que estava prestes a encomendar matrizes para um salto bloco em quatro alturas.',
          'Duas alturas foram descartadas na hora, porque desequilibravam o pé.',
          'Esse modelo foi o mais vendido da coleção.',
        ),
        p(
          'en-s1-p4',
          'O serviço é cobrado por protótipo, com valor fechado que inclui impressão e montagem no cabedal, o que facilita a comparação com o preço de uma matriz. No último ano, o estúdio imprimiu mais de duzentos saltos para testes, e menos de um terço virou matriz definitiva. Para Helena, cada teste descartado é uma matriz que ninguém precisou pagar.',
          'Cobramos por protótipo, com um valor fechado que inclui a impressão e a montagem no cabedal.',
          'No último ano imprimimos mais de duzentos saltos para testes, e menos de um terço chegou a virar matriz definitiva.',
          'Cada teste descartado é uma matriz que ninguém precisou pagar.',
        ),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('en-h2', 'Reuniões mais curtas e fábricas mais ousadas'),
        p(
          'en-s2-p1',
          'Com o protótipo na mesa, a conversa ficou concreta. Reuniões que tomavam uma tarde inteira agora se resolvem em quarenta minutos, e as fábricas passaram a arriscar mais. “Errar no protótipo ficou barato”, diz Helena.',
          'Reunião que levava uma tarde inteira agora se resolve em quarenta minutos.',
          'porque errar no protótipo ficou barato',
        ),
        img(
          'en-img-2',
          { subject: 'Protótipo de salto sobre a mesa de reunião com a fábrica', suggestedCaption: 'Com o protótipo na mesa, a reunião que levava uma tarde se resolve em quarenta minutos', suggestedAlt: 'Protótipo de calçado com salto impresso sobre a mesa', orientation: 'square' },
          'Agora eu coloco o protótipo na mesa e todo mundo discute a mesma coisa.',
        ),
        p(
          'en-s2-p1b',
          'Antes, Helena apresentava um desenho e a fábrica precisava imaginar o sapato. Agora o protótipo vai para a mesa e todos discutem a mesma coisa.',
          'Antes eu apresentava um desenho e a fábrica precisava imaginar o sapato.',
          'Agora eu coloco o protótipo na mesa e todo mundo discute a mesma coisa.',
        ),
        p(
          'en-s2-p2',
          'O limite ainda é o material. A resina é ótima para testar forma, mas não suporta o uso real, e os materiais mais resistentes seguem caros para estúdios pequenos. Helena estima que isso mude em três ou quatro anos, quando a impressão deve chegar a pequenas séries de produto final. Até lá, ninguém deve caminhar uma semana com um salto impresso, alerta a sócia.',
          'A resina que a gente usa é ótima para testar forma, mas não aguenta o uso real.',
          'Acho que em três ou quatro anos isso muda',
          'Ninguém deve caminhar uma semana com um salto impresso.',
        ),
        p(
          'en-s2-p3',
          'Para quem quer começar, o conselho é atacar o teste mais caro da fábrica, que na maioria dos casos é o salto, imprimir esse teste e comparar o custo. Não é preciso montar um laboratório: “uma impressora boa e alguém curioso já fazem muita diferença”.',
          'Comece pelo teste mais caro que vocês fazem hoje.',
          'Imprima esse teste e compare o custo.',
          'uma impressora boa e alguém curioso já fazem muita diferença',
        ),
      ],
    },
  ],
};

export function estudioNorteScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, ESTUDIO_NORTE_ARTICLE),
    rewrites: {
      'en-s2-p2': {
        direct:
          'O limite é o material: a resina testa forma, mas não aguenta o uso real, e as opções mais resistentes ainda são caras. Helena calcula que isso mude em três ou quatro anos.',
        shorter: 'A resina ainda não aguenta o uso real; Helena espera mudança em três ou quatro anos.',
      },
    },
    titles: [
      'Impressão 3D corta de três semanas para dois dias o protótipo de salto',
      'Estúdio Norte: errar no protótipo ficou barato',
      'Como uma impressora de mesa mudou o desenvolvimento de calçados',
    ],
    subheadings: ['A impressora que evita a matriz errada', 'Protótipo na mesa, decisão mais rápida'],
  };
}

export function estudioNorteStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { days: 2, hours: 2 });
  const source = buildTranscriptSource({
    id: 'src-estudio-norte',
    title: 'Entrevista Estúdio Norte: impressão 3D no protótipo',
    origin: 'interview',
    text: ESTUDIO_NORTE_TRANSCRIPT,
    fileName: 'entrevista-estudio-norte.txt',
    speakers: { 'Juliana Prates': PEOPLE.juliana, 'Helena Brandão': PEOPLE.helena },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 4 })),
    createdAt,
    createdBy: PEOPLE.joao,
  });
  const script = estudioNorteScripts(source);
  const draft = script.draft;
  if (!draft) throw new Error('estudio-norte: missing draft');
  const builder = startScenario({
    key: 'estudio-norte',
    title: 'Estúdio Norte: impressão 3D no protótipo',
    source,
    ownerId: PEOPLE.joao,
    createdAt,
    brief: { angle: 'Como a impressão 3D barateia o erro no desenvolvimento de calçados', sections: 2, size: 'standard', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });

  const v1 = builder.generate('article', { body: scriptBody(draft), endedAt: after(createdAt, { minutes: 4 }), durationMs: 46_000, by: PEOPLE.joao });
  const v2Body = applyEdits(source, v1.body as ArticleBody, [
    { type: 'review', blockIds: ['en-intro-1', 'en-h1', 'en-s1-p1', 'en-s1-p1b', 'en-s1-p2'] },
    {
      type: 'text',
      blockId: 'en-s1-p3',
      text: 'Uma fábrica que estava prestes a encomendar matrizes para um salto bloco em quatro alturas testou antes os protótipos com vendedoras de três lojas. Duas alturas foram descartadas na hora por desequilibrar o pé. A fábrica economizou duas matrizes, e o modelo lançado com as alturas aprovadas foi o mais vendido da coleção.',
    },
  ]);
  builder.saveEdit('article', v2Body, ago(ctx.now, { days: 1, hours: 4 }), PEOPLE.joao);

  // Working draft (autosaved, not a version): the quote below was paraphrased, so it no longer
  // matches the transcript and the check shows "Falta".
  const draftBody = applyEdits(source, v2Body, [
    { type: 'review', blockIds: ['en-h2', 'en-s2-p1b'] },
    {
      type: 'text',
      blockId: 'en-s2-p1',
      text: 'Com o protótipo na mesa, a conversa ficou concreta. Reuniões que tomavam uma tarde inteira agora se resolvem em quarenta minutos, e as fábricas passaram a arriscar mais. “Errar no protótipo virou algo barato”, diz Helena.',
    },
  ]);
  builder.editDraft('article', draftBody, ago(ctx.now, { minutes: 35 }), PEOPLE.joao);

  // A "Mais direto" suggestion on the material paragraph, waiting for Aceitar / Descartar.
  const article = builder.piece('article');
  const assistEnded = ago(ctx.now, { minutes: 20 });
  const runId = builder.newId('run');
  const target = findBlock(draftBody, 'en-s2-p2');
  const proposal = script.rewrites?.['en-s2-p2']?.direct;
  if (!target || !proposal) throw new Error('estudio-norte: missing suggestion target');
  builder.addRun(
    completedRun({
      id: runId,
      kind: 'article.assist',
      productionId: builder.record.production.id,
      pieceId: article.id,
      createdBy: PEOPLE.joao,
      inputs: [toSourceVersionRef(source), toVersionRef(builder.record.versions[builder.record.versions.length - 1])],
      startedAt: after(assistEnded, { seconds: -6 }),
      durationMs: 6_000,
    }),
  );
  const text = blockText(target);
  builder.addSuggestion({
    runId,
    pieceId: article.id,
    baseRevision: article.draft.revision,
    target: [{ blockId: target.id, from: 0, to: text.length }],
    anchorText: [text],
    proposal: { kind: 'replace-text', text: proposal },
    state: 'ready',
    label: copilotTool('rewrite.direct')?.label ?? 'Mais direto',
    createdAt: assistEnded,
  });

  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Rascunho em edição',
      productionStatus: 'draft',
      pieces: { article: 'draft', carousel: 'locked' },
      draftQuotes: { verified: 2, total: 3 },
    },
  };
}
