import { localDateOf } from '../../domain/index.ts';
import type { ArticleBody, Source } from '../../domain/index.ts';
import { anchorOn, applyEdits, buildDraftScript, h2, img, p, quote, reviewAll } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { scriptBody } from '../script-book.ts';
import type { ScriptEntry } from '../script-book.ts';
import { after, ago, dateOf } from '../time.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: article in review, waiting for Pedro (violet), 2º envio. Juliana sent v1 · IA to Pedro
 * yesterday; he asked for adjustments ("O título promete mais do que o texto entrega."). She
 * edited it into v2 and sent it again two hours ago, due today, with a "Recado" — the review opens
 * on "O que mudou". The interviewer is labelled "Entrevistadora" and mapped to Juliana.
 */

export const AURORA_REVIEW_NOTE = 'O título promete mais do que o texto entrega.';

export const AURORA_TRANSCRIPT = [
  'Entrevistadora: Sérgio, a Aurora lançou há um ano um aplicativo de pedidos para lojistas. Por quê?',
  'Sérgio Lang: Porque o lojista multimarca mudou. Ele compra menos de cada vez e quer repor rápido. Antes, o pedido grande da feira garantia o semestre. Hoje o lojista compra uma grade enxuta na feira e repõe ao longo da estação, conforme vende. Sem um canal de reposição simples, a gente perdia essa segunda compra para quem tinha estoque na hora.',
  'Entrevistadora: Como funciona o aplicativo?',
  'Sérgio Lang: O lojista vê o estoque disponível em tempo real, escolhe modelo, cor e numeração e fecha o pedido em poucos minutos. O pedido mínimo caiu de 24 pares para 6 pares por modelo, e a entrega na maior parte do país sai em até cinco dias úteis. O representante continua acompanhando a conta e recebe comissão sobre a reposição feita pelo aplicativo.',
  'Entrevistadora: Os representantes não viram o aplicativo como ameaça?',
  'Sérgio Lang: Viram, no começo. A primeira reunião foi tensa. O que resolveu foi a regra da comissão: todo pedido de um lojista da carteira do representante conta para ele, venha de onde vier. Hoje os representantes são os maiores divulgadores do aplicativo, porque ganham com a reposição sem precisar visitar a loja toda semana.',
  'Entrevistadora: Que resultados vocês já medem?',
  'Sérgio Lang: A reposição representa hoje 27% das vendas para o varejo multimarca, e era praticamente zero antes. O número de lojistas ativos cresceu 18% em um ano. E caiu a sobra no fim da estação, porque o lojista compra menos no início e completa depois, com base no que realmente vendeu.',
  'Entrevistadora: E o que deu errado?',
  'Sérgio Lang: A primeira versão tinha fotos lindas e informação de menos. Os lojistas queriam saber a forma, a altura do salto e o material do forro, não só ver a foto. Recebemos tantas ligações perguntando a mesma coisa que refizemos as fichas em dois meses. Lojista não compra foto, compra informação.',
  'Entrevistadora: Como a operação da fábrica se adaptou?',
  'Sérgio Lang: Esse foi o maior desafio. Pedido pequeno e frequente exige estoque de produto pronto e uma expedição diferente. Criamos uma linha de separação só para reposição e passamos a produzir parte da coleção para estoque, com base na previsão de giro. Errar a previsão custa caro, então revisamos os números toda semana.',
  'Entrevistadora: A feira perdeu importância?',
  'Sérgio Lang: Não, mudou de papel. A feira é onde o lojista conhece a coleção e faz a primeira compra. O aplicativo é onde ele mantém a loja abastecida. Uma coisa não vive sem a outra. Inclusive, metade dos lojistas que baixaram o aplicativo fez isso no nosso estande.',
  'Entrevistadora: Qual o próximo passo?',
  'Sérgio Lang: Queremos avisar o lojista antes que o estoque dele acabe. Com o histórico de pedidos, dá para saber quando ele costuma repor cada modelo. A ideia é mandar uma sugestão de reposição pronta, que ele só confirma. Mas isso só funciona se a sugestão for boa. Uma sugestão ruim e o lojista para de confiar.',
  'Entrevistadora: Como o lojista paga pelos pedidos de reposição?',
  'Sérgio Lang: Pelo próprio aplicativo, com boleto ou cartão, em até três vezes. Para lojista com histórico, liberamos prazo de trinta dias. O crédito era uma barreira para o pedido pequeno, porque ninguém quer passar por análise para comprar seis pares. Hoje a análise é feita uma vez por ano, e o limite aparece na tela antes de o lojista fechar o pedido.',
].join('\n\n');

export const AURORA_ARTICLE: ArticleSpec = {
  title: 'Aurora Calçados cria app de reposição e reduz pedido mínimo para 6 pares',
  coverSlot: { subject: 'Retrato de Sérgio Lang', suggestedCaption: 'Sérgio Lang, diretor comercial da Aurora Calçados', suggestedAlt: 'Retrato de Sérgio Lang', orientation: 'landscape' },
  keyExcerpts: [
    'o lojista compra uma grade enxuta na feira e repõe ao longo da estação',
    'A reposição representa hoje 27% das vendas para o varejo multimarca',
    'Lojista não compra foto, compra informação.',
    'Uma sugestão ruim e o lojista para de confiar.',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'au-intro-1',
          'Há um ano, a Aurora Calçados lançou um aplicativo de pedidos para o varejo multimarca. A aposta respondia a uma mudança no comportamento do lojista, que passou a comprar uma grade enxuta na feira e repor ao longo da estação, conforme vende. Hoje a reposição responde por 27% das vendas da marca para esse varejo, segundo o diretor comercial Sérgio Lang.',
          'o lojista compra uma grade enxuta na feira e repõe ao longo da estação',
          'A reposição representa hoje 27% das vendas para o varejo multimarca',
        ),
        p(
          'au-intro-2',
          'Antes, o pedido grande da feira garantia o semestre. Sem um canal simples de reposição, a marca perdia a segunda compra do lojista para concorrentes com estoque disponível na hora.',
          'Antes, o pedido grande da feira garantia o semestre.',
          'Sem um canal de reposição simples, a gente perdia essa segunda compra para quem tinha estoque na hora.',
        ),
        img(
          'au-img-1',
          { subject: 'Tela do aplicativo com o estoque em tempo real, a cor e a numeração', suggestedCaption: 'No aplicativo, o lojista vê o estoque disponível em tempo real', suggestedAlt: 'Tela do aplicativo de pedidos da Aurora Calçados', orientation: 'portrait' },
          'O lojista vê o estoque disponível em tempo real',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('au-h1', 'Pedido menor, entrega mais rápida'),
        p(
          'au-s1-p1',
          'No aplicativo, o lojista consulta o estoque em tempo real, escolhe modelo, cor e numeração e fecha o pedido em poucos minutos. O pedido mínimo caiu de 24 para 6 pares por modelo, e a entrega na maior parte do país sai em até cinco dias úteis. O número de lojistas ativos cresceu 18% em um ano. O representante continua acompanhando a conta e recebe comissão sobre a reposição feita pela ferramenta.',
          'O lojista vê o estoque disponível em tempo real',
          'O pedido mínimo caiu de 24 pares para 6 pares por modelo',
          'a entrega na maior parte do país sai em até cinco dias úteis',
          'O número de lojistas ativos cresceu 18% em um ano.',
          'O representante continua acompanhando a conta e recebe comissão sobre a reposição feita pelo aplicativo.',
        ),
        p(
          'au-s1-p2',
          'A resistência inicial veio dos representantes, que viram na ferramenta uma ameaça. A solução foi uma regra simples: todo pedido de um lojista da carteira conta para o representante, venha de onde vier. Hoje eles são os maiores divulgadores do aplicativo, porque ganham com a reposição sem precisar visitar a loja toda semana.',
          'Viram, no começo.',
          'todo pedido de um lojista da carteira do representante conta para ele, venha de onde vier',
          'Hoje os representantes são os maiores divulgadores do aplicativo',
        ),
        quote('au-q1', 'Lojista não compra foto, compra informação.'),
        p(
          'au-s1-p3',
          'A frase resume o principal erro da primeira versão, que tinha fotos bonitas e poucas informações sobre forma, altura do salto e forro. Os lojistas queriam detalhes técnicos, não só ver a foto. Depois de uma enxurrada de ligações com as mesmas perguntas, as fichas foram refeitas em dois meses.',
          'A primeira versão tinha fotos lindas e informação de menos.',
          'não só ver a foto',
          'refizemos as fichas em dois meses',
        ),
        p(
          'au-s1-p4',
          'O pagamento também é feito no aplicativo, com boleto ou cartão em até três vezes, e lojistas com histórico têm prazo de trinta dias. Segundo Sérgio, o crédito era uma barreira para o pedido pequeno, já que ninguém quer passar por análise para comprar seis pares. Agora a análise é anual, e o limite aparece na tela antes de o lojista fechar o pedido.',
          'Pelo próprio aplicativo, com boleto ou cartão, em até três vezes.',
          'Para lojista com histórico, liberamos prazo de trinta dias.',
          'O crédito era uma barreira para o pedido pequeno',
          'Hoje a análise é feita uma vez por ano, e o limite aparece na tela antes de o lojista fechar o pedido.',
        ),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('au-h2', 'A fábrica mudou junto'),
        p(
          'au-s2-p1',
          'Pedidos pequenos e frequentes exigiram estoque de produto pronto e uma nova linha de separação dedicada à reposição. Parte da coleção passou a ser produzida com base na previsão de giro, revisada toda semana. Em troca, caiu a sobra no fim da estação, já que o lojista completa a compra com base no que realmente vendeu.',
          'Criamos uma linha de separação só para reposição',
          'revisamos os números toda semana',
          'caiu a sobra no fim da estação',
        ),
        img(
          'au-img-2',
          { subject: 'Linha de separação dedicada aos pedidos de reposição', suggestedCaption: 'A linha de separação criada só para a reposição', suggestedAlt: 'Pares separados na linha de reposição da Aurora', orientation: 'landscape' },
          'Criamos uma linha de separação só para reposição',
        ),
        p(
          'au-s2-p2',
          'A feira não perdeu espaço, mudou de papel. “A feira é onde o lojista conhece a coleção e faz a primeira compra”, diz Sérgio. O aplicativo mantém a loja abastecida depois disso, e metade dos lojistas que usam a ferramenta baixou o aplicativo no estande da marca.',
          'A feira é onde o lojista conhece a coleção e faz a primeira compra.',
          'metade dos lojistas que baixaram o aplicativo fez isso no nosso estande',
        ),
        p(
          'au-s2-p3',
          'O próximo passo é avisar o lojista antes que o estoque acabe, com sugestões de reposição prontas para confirmar, calculadas a partir do histórico de pedidos. Sérgio faz uma ressalva: “Uma sugestão ruim e o lojista para de confiar.”',
          'Com o histórico de pedidos, dá para saber quando ele costuma repor cada modelo.',
          'Uma sugestão ruim e o lojista para de confiar.',
        ),
      ],
    },
  ],
};

export function auroraScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, AURORA_ARTICLE),
    titles: [
      'Aurora Calçados aposta na reposição e conquista o lojista multimarca',
      'Pedido mínimo de 6 pares: como a Aurora redesenhou a venda ao varejo',
      'Lojista não compra foto: as lições do app da Aurora Calçados',
    ],
    subheadings: ['Reposição sem burocracia', 'Estoque pronto e previsão semanal'],
  };
}

export function auroraStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { days: 1, hours: 6 });
  const source = buildTranscriptSource({
    id: 'src-aurora',
    title: 'Entrevista Aurora Calçados: aplicativo de reposição',
    origin: 'interview',
    text: AURORA_TRANSCRIPT,
    fileName: 'entrevista-aurora-calcados.txt',
    speakers: { Entrevistadora: PEOPLE.juliana, 'Sérgio Lang': PEOPLE.sergio },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 3 })),
    createdAt,
    createdBy: PEOPLE.juliana,
  });
  const script = auroraScripts(source);
  if (!script.draft) throw new Error('aurora: missing draft');
  const builder = startScenario({
    key: 'aurora',
    title: 'Aurora Calçados: app de reposição',
    source,
    ownerId: PEOPLE.juliana,
    createdAt,
    brief: { angle: 'O que o app de reposição mudou na relação com o lojista multimarca', sections: 2, size: 'standard', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  const v1 = builder.generate('article', { body: scriptBody(script.draft), endedAt: after(createdAt, { minutes: 3 }), durationMs: 52_000, by: PEOPLE.juliana });
  // 1º envio: Pedro asked for adjustments on the AI text.
  builder.requestReview('article', ago(ctx.now, { days: 1 }), PEOPLE.juliana, { assigneeId: PEOPLE.pedro });
  builder.decide('article', 'changes_requested', ago(ctx.now, { hours: 20 }), PEOPLE.pedro, {
    note: AURORA_REVIEW_NOTE,
    anchors: [anchorOn(v1.body as ArticleBody, 'au-s1-p3', 'Depois de uma enxurrada de ligações com as mesmas perguntas')],
  });
  const v2Body = reviewAll(
    applyEdits(source, v1.body as ArticleBody, [
      { type: 'title', text: 'Aurora Calçados reduz pedido mínimo para 6 pares com app de reposição' },
      {
        type: 'text',
        blockId: 'au-s1-p3',
        text: 'A frase resume o principal erro da primeira versão do aplicativo, que tinha fotos bonitas e poucas informações sobre forma, altura do salto e forro. Depois de muitas ligações com as mesmas perguntas, as fichas foram refeitas em dois meses.',
      },
    ]),
  );
  builder.saveEdit('article', v2Body, ago(ctx.now, { hours: 2, minutes: 20 }), PEOPLE.juliana);
  // 2º envio: back to Pedro, due today ("prazo: hoje"), with a "Recado".
  builder.requestReview('article', ago(ctx.now, { hours: 2 }), PEOPLE.juliana, {
    assigneeId: PEOPLE.pedro,
    dueOn: localDateOf(ctx.now),
    note: 'Pedro, pode revisar hoje? O Sérgio pediu para publicar ainda nesta semana.',
  });
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Aguardando aprovação (2º envio, prazo hoje)',
      productionStatus: 'in_review',
      pieces: { article: 'in_review', carousel: 'locked' },
      draftQuotes: { verified: 3, total: 3 },
    },
  };
}
