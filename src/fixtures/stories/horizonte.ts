import type { Source } from '../../domain/index.ts';
import { buildDraftScript, h2, img, p, quote } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { toVtt } from '../build/vtt.ts';
import type { Turn } from '../build/vtt.ts';
import { PEOPLE } from '../people.ts';
import type { ScriptEntry } from '../script-book.ts';
import { ago, dateOf } from '../time.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: generation failed at "Seção 2 de 2", with the error kept on the step (red) and
 * "Tentar de novo a partir desta etapa". Seeded exactly as a live failure ends: the introduction
 * and section 1 are the draft ("v1 · interrompida"), the run log keeps the steps, and a retry
 * continues at section 2. The material is a podcast caption file (.vtt) to exercise that parser.
 */

const HORIZONTE_TURNS: Turn[] = [
  ['Rafael Dias', 'Fernanda, o Grupo Horizonte cuida da logística de expositores em feiras. O que isso envolve?'],
  [
    'Fernanda Kuhn',
    'Tudo o que acontece entre a fábrica do expositor e o estande. Coleta das peças, transporte, armazenagem perto do pavilhão, entrega no horário da montagem e o caminho de volta depois da feira. Numa feira grande, a gente movimenta a carga de mais de duzentos expositores em quatro dias de montagem.',
  ],
  ['Rafael Dias', 'Qual é o momento mais crítico?'],
  [
    'Fernanda Kuhn',
    'A montagem. O pavilhão tem horário para tudo, e as docas são disputadas. Se o caminhão de um expositor chega fora da janela dele, pode esperar horas. Por isso a gente agenda cada entrega com janela de trinta minutos e acompanha os caminhões em tempo real.',
  ],
  ['Rafael Dias', 'E o que mais dá errado?'],
  [
    'Fernanda Kuhn',
    'Amostra esquecida. Parece piada, mas é o problema mais comum. O expositor despacha o estande inteiro e esquece a caixa com os modelos principais na fábrica. Hoje mantemos um serviço de coleta de emergência que busca a caixa e entrega no pavilhão no mesmo dia, quando a distância permite.',
  ],
  ['Rafael Dias', 'Como a tecnologia mudou o trabalho?'],
  [
    'Fernanda Kuhn',
    'Cada volume recebe uma etiqueta com código, lido na saída da fábrica, na chegada ao armazém e na entrega no estande. O expositor acompanha tudo pelo celular. Antes, metade das ligações que a gente recebia na montagem era alguém perguntando onde estava a carga. Hoje essas ligações caíram para menos de um quinto.',
  ],
  ['Rafael Dias', 'E a armazenagem perto do pavilhão?'],
  [
    'Fernanda Kuhn',
    'É o que dá tranquilidade ao expositor. Mantemos um armazém a quinze minutos do pavilhão durante toda a temporada de feiras. A carga chega com até uma semana de antecedência, fica conferida e sai para o estande na hora marcada. Quem manda direto da fábrica no dia da montagem está apostando que nada vai dar errado na estrada.',
  ],
  ['Rafael Dias', 'E a volta, depois da feira?'],
  [
    'Fernanda Kuhn',
    'A volta é onde o expositor relaxa e a gente perde controle. Todo mundo quer desmontar ao mesmo tempo e ir embora. Criamos um checklist de desmontagem e passamos a recolher as caixas por ordem de agendamento, não por ordem de chegada. As avarias na volta caíram pela metade em duas temporadas.',
  ],
  ['Rafael Dias', 'Como fica o custo para um expositor pequeno?'],
  [
    'Fernanda Kuhn',
    'O expositor pequeno costuma achar que logística de feira é luxo de empresa grande. Não é. Oferecemos carga compartilhada, em que vários expositores da mesma região dividem o caminhão. O custo por expositor cai bastante, e o pequeno ganha o mesmo agendamento e o mesmo rastreio do grande.',
  ],
  ['Rafael Dias', 'Que dica você dá para quem vai expor pela primeira vez?'],
  [
    'Fernanda Kuhn',
    'Faça uma lista do que vai e confira duas vezes. Mande a carga com folga, nunca no último dia. E tenha uma pessoa responsável só pela logística durante a montagem. O expositor que tenta montar estande, atender cliente e receber carga ao mesmo tempo sempre esquece alguma coisa.',
  ],
  ['Rafael Dias', 'Quanto tempo antes a feira precisa ser planejada?'],
  [
    'Fernanda Kuhn',
    'Para expositor grande, quatro meses. É quando a gente reserva os caminhões e a área no armazém, porque na temporada tudo fica disputado. O pequeno pode fechar com dois meses, desde que entre na carga compartilhada. O que não dá é ligar na semana da feira. Aí sobra o frete avulso, que custa até três vezes mais.',
  ],
];

export const HORIZONTE_FILE_NAME = 'podcast-horizonte-ep12.vtt';
export const HORIZONTE_TRANSCRIPT = toVtt(HORIZONTE_TURNS);

export const HORIZONTE_ARTICLE: ArticleSpec = {
  title: 'Grupo Horizonte organiza a logística de expositores com janelas de 30 minutos',
  coverSlot: { subject: 'Caminhões nas docas do pavilhão durante a montagem da feira', suggestedAlt: 'Caminhões descarregam nas docas do pavilhão', orientation: 'landscape' },
  keyExcerpts: [
    'a gente movimenta a carga de mais de duzentos expositores em quatro dias de montagem',
    'Parece piada, mas é o problema mais comum.',
    'As avarias na volta caíram pela metade em duas temporadas.',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'gh-intro-1',
          'Entre a fábrica do expositor e o estande, há uma operação que o visitante não vê. O Grupo Horizonte cuida dessa etapa: coleta das peças, transporte, armazenagem perto do pavilhão, entrega no horário da montagem e o caminho de volta. Numa feira grande, a empresa movimenta a carga de mais de duzentos expositores em quatro dias de montagem. Em podcast, a gerente de operações Fernanda Kuhn conta onde a operação costuma falhar e como evitar.',
          'Tudo o que acontece entre a fábrica do expositor e o estande.',
          'Coleta das peças, transporte, armazenagem perto do pavilhão, entrega no horário da montagem e o caminho de volta depois da feira.',
          'a gente movimenta a carga de mais de duzentos expositores em quatro dias de montagem',
        ),
        img(
          'gh-img-1',
          { subject: 'Armazém perto do pavilhão com a carga dos expositores', suggestedCaption: 'A carga chega ao armazém com até uma semana de antecedência', suggestedAlt: 'Volumes etiquetados no armazém do Grupo Horizonte', orientation: 'landscape' },
          'Mantemos um armazém a quinze minutos do pavilhão durante toda a temporada de feiras.',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('gh-h1', 'A montagem é o ponto crítico'),
        p(
          'gh-s1-p1',
          'Com horários rígidos e docas disputadas, um caminhão que chega fora da janela pode esperar horas. Por isso cada entrega é agendada com janela de trinta minutos e acompanhada em tempo real, explica Fernanda.',
          'Se o caminhão de um expositor chega fora da janela dele, pode esperar horas.',
          'a gente agenda cada entrega com janela de trinta minutos e acompanha os caminhões em tempo real',
        ),
        p(
          'gh-s1-p2',
          'Um armazém a quinze minutos do pavilhão funciona durante toda a temporada de feiras. A carga chega com até uma semana de antecedência, é conferida e segue para o estande na hora marcada. Para Fernanda, quem despacha direto da fábrica no dia da montagem aposta que nada vai dar errado na estrada.',
          'Mantemos um armazém a quinze minutos do pavilhão durante toda a temporada de feiras.',
          'A carga chega com até uma semana de antecedência',
          'Quem manda direto da fábrica no dia da montagem está apostando que nada vai dar errado na estrada.',
        ),
        p(
          'gh-s1-p3',
          'O problema mais frequente é a amostra esquecida: o expositor despacha o estande inteiro e deixa na fábrica a caixa com os modelos principais. Para esses casos, a empresa mantém um serviço de coleta de emergência que leva a caixa ao pavilhão no mesmo dia, quando a distância permite.',
          'Amostra esquecida.',
          'esquece a caixa com os modelos principais na fábrica',
          'Hoje mantemos um serviço de coleta de emergência que busca a caixa e entrega no pavilhão no mesmo dia, quando a distância permite.',
        ),
        quote('gh-q1', 'Parece piada, mas é o problema mais comum.'),
        p(
          'gh-s1-p4',
          'Cada volume recebe uma etiqueta com código, lida na saída da fábrica, na chegada ao armazém e na entrega no estande, e o expositor acompanha a carga pelo celular. As ligações perguntando onde estava a carga, que eram metade do total na montagem, caíram para menos de um quinto.',
          'Cada volume recebe uma etiqueta com código, lido na saída da fábrica, na chegada ao armazém e na entrega no estande.',
          'metade das ligações que a gente recebia na montagem era alguém perguntando onde estava a carga',
          'Hoje essas ligações caíram para menos de um quinto.',
        ),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('gh-h2', 'A volta exige o mesmo cuidado'),
        p(
          'gh-s2-p1',
          'É na volta, diz Fernanda, que o expositor relaxa e a empresa perde o controle: na desmontagem, todos querem sair ao mesmo tempo. Com um checklist e a coleta por ordem de agendamento, e não de chegada, as avarias no retorno caíram pela metade em duas temporadas.',
          'A volta é onde o expositor relaxa e a gente perde controle.',
          'Todo mundo quer desmontar ao mesmo tempo e ir embora.',
          'passamos a recolher as caixas por ordem de agendamento, não por ordem de chegada',
          'As avarias na volta caíram pela metade em duas temporadas.',
        ),
        img(
          'gh-img-2',
          { subject: 'Caixas recolhidas por ordem de agendamento na desmontagem', suggestedCaption: 'Na volta, as caixas são recolhidas por ordem de agendamento', suggestedAlt: 'Equipe recolhe caixas na desmontagem de um estande', orientation: 'landscape' },
          'passamos a recolher as caixas por ordem de agendamento, não por ordem de chegada',
        ),
        p(
          'gh-s2-p2',
          'Para expositores pequenos, que costumam ver a logística de feira como luxo de empresa grande, a empresa oferece carga compartilhada: vários expositores da mesma região dividem o caminhão, pagam menos e recebem o mesmo agendamento e rastreio dos grandes.',
          'O expositor pequeno costuma achar que logística de feira é luxo de empresa grande.',
          'Oferecemos carga compartilhada, em que vários expositores da mesma região dividem o caminhão.',
          'o pequeno ganha o mesmo agendamento e o mesmo rastreio do grande',
        ),
        p(
          'gh-s2-p2b',
          'O planejamento começa quatro meses antes para expositores grandes, quando são reservados caminhões e área no armazém, disputados na temporada. O pequeno pode fechar com dois meses, desde que entre na carga compartilhada. Quem liga na semana da feira fica com o frete avulso, que custa até três vezes mais.',
          'Para expositor grande, quatro meses.',
          'É quando a gente reserva os caminhões e a área no armazém',
          'O pequeno pode fechar com dois meses, desde que entre na carga compartilhada.',
          'Aí sobra o frete avulso, que custa até três vezes mais.',
        ),
        p(
          'gh-s2-p3',
          'A quem vai expor pela primeira vez, Fernanda recomenda conferir a lista duas vezes, despachar a carga com folga e ter uma pessoa dedicada à logística durante a montagem. “O expositor que tenta montar estande, atender cliente e receber carga ao mesmo tempo sempre esquece alguma coisa.”',
          'Faça uma lista do que vai e confira duas vezes.',
          'Mande a carga com folga, nunca no último dia.',
          'O expositor que tenta montar estande, atender cliente e receber carga ao mesmo tempo sempre esquece alguma coisa.',
        ),
      ],
    },
  ],
};

export function horizonteScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, HORIZONTE_ARTICLE),
    titles: [
      'Da fábrica ao estande: como o Grupo Horizonte evita a carga perdida',
      'Janela de 30 minutos e rastreio no celular: a logística por trás da feira',
      'O problema mais comum da montagem é a amostra esquecida',
    ],
    subheadings: ['Montagem com hora marcada', 'Desmontagem sem avarias'],
  };
}

export function horizonteStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { minutes: 52 });
  const source = buildTranscriptSource({
    id: 'src-horizonte',
    title: 'Podcast Horizonte ep. 12: logística de feira',
    origin: 'podcast',
    text: HORIZONTE_TRANSCRIPT,
    fileName: HORIZONTE_FILE_NAME,
    speakers: { 'Rafael Dias': PEOPLE.rafael, 'Fernanda Kuhn': PEOPLE.fernanda },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 2 })),
    createdAt,
    createdBy: PEOPLE.rafael,
  });
  const script = horizonteScripts(source);
  if (!script.draft) throw new Error('horizonte: missing draft');
  const builder = startScenario({
    key: 'horizonte',
    title: 'Grupo Horizonte: logística para expositores',
    source,
    ownerId: PEOPLE.rafael,
    createdAt,
    brief: { angle: 'O que o expositor precisa saber sobre a logística da feira', sections: 2, size: 'standard', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  builder.streamArticle({
    script: script.draft,
    stopAt: 'section-2',
    outcome: 'failed',
    error: {
      code: 'simulated_timeout',
      message: 'A simulação não respondeu ao escrever a seção 2. O material e as seções prontas foram mantidos.',
      retryable: true,
    },
    startedAt: ago(ctx.now, { minutes: 41 }),
    by: PEOPLE.rafael,
  });
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Geração com falha (tentar de novo)',
      productionStatus: 'failed',
      pieces: { article: 'failed', carousel: 'locked' },
    },
  };
}
