import { PEOPLE } from '../people.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { startScenario } from '../build/scenario.ts';
import { ago, dateOf } from '../time.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: material only, NOT authorised (REQ-T.1). "Gerar artigo" stays disabled with the reason.
 * No hand-written script: once authorised, the adapter's extractive path writes the draft
 * (the Q&A shape below turns questions into headings). The "Mediador" label is left unmapped
 * to exercise the "Falantes" step.
 */

export const COURO_NOBRE_TRANSCRIPT = [
  'Mediador: Boa tarde a todos. Para abrir o painel, Otávio, o que é curtimento vegetal e por que ele voltou a ser assunto?',
  'Otávio Kern: Curtimento vegetal é o jeito mais antigo de transformar pele em couro, usando taninos de cascas de árvore em vez de sais de cromo. Ele ficou décadas restrito a nichos porque é mais lento: um lote leva até quarenta dias, contra um ou dois dias do processo ao cromo. Voltou a ser assunto porque o consumidor final começou a perguntar o que tem no couro, e as marcas precisam de uma resposta simples.',
  'Mediador: E o Couro Nobre produz quanto em vegetal hoje?',
  'Otávio Kern: Hoje um quarto da nossa produção é de couro vegetal. Há cinco anos era menos de 5%. Investimos em tanques novos e, principalmente, em gente que sabe acompanhar o processo, porque o couro vegetal não perdoa pressa.',
  'Mediador: Beatriz, do lado do design, o que muda quando o material é esse?',
  'Beatriz Almeida: Muda a conversa com a cor e com o tempo. O couro vegetal escurece com o uso e marca com facilidade. Para mim isso é uma qualidade, porque o sapato envelhece junto com quem usa. Mas eu preciso explicar isso para o lojista, senão ele acha que é defeito. Desenhar com couro vegetal é desenhar contando com o tempo.',
  'Mediador: Existe resistência do mercado?',
  'Otávio Kern: Existe, e ela é de preço. O couro vegetal custa entre 20% e 30% mais. Quem compra pensando só no metro quadrado desiste. Quem pensa no produto final percebe que essa diferença se dilui no preço do par e vira argumento de venda.',
  'Beatriz Almeida: E tem uma resistência de hábito. A modelagem está acostumada com um couro que estica de um jeito, e o vegetal estica de outro. Nas primeiras coleções a gente perdeu muita peça no corte até ajustar os moldes.',
  'Mediador: Como garantir que o couro vendido como vegetal é de fato vegetal?',
  'Otávio Kern: Com rastreio e com laudo. Cada lote nosso sai com um laudo de laboratório e com o registro do curtimento, desde a entrada da pele. Se o comprador quiser, pode visitar o curtume e ver os tanques. Transparência, nesse caso, é parte do produto.',
  'Mediador: Otávio, e o impacto ambiental? O vegetal é sempre melhor?',
  'Otávio Kern: Depende de como é feito. O tanino vem de cascas de acácia e de quebracho, que são plantadas para isso, e a água do processo é mais fácil de tratar do que a do cromo. Mas o vegetal fica mais tempo no tanque e gasta mais energia para secar. No nosso caso, a estação de tratamento foi o maior investimento, maior até do que os tanques. Sem ela, o argumento ambiental não se sustenta.',
  'Mediador: Beatriz, como o consumidor final reage a esse sapato?',
  'Beatriz Almeida: Reage bem quando alguém conta a história. Nas lojas que receberam um cartão explicando por que o couro escurece, a troca por suposto defeito praticamente sumiu. Nas que não receberam, ainda aparece cliente devolvendo o par porque marcou na primeira semana. O consumidor gosta do sapato que envelhece bem, mas precisa saber que isso é esperado.',
  'Mediador: E o prazo de entrega, com quarenta dias de curtimento?',
  'Otávio Kern: Fica mais longo, e por isso a gente trabalha com programação. A marca reserva o couro com três meses de antecedência e recebe em lotes ao longo da estação. Quem tenta comprar vegetal na última hora não encontra. Mantemos um pequeno estoque das cores mais pedidas, mas ele acaba rápido na época de coleção.',
  'Mediador: Para encerrar, que conselho vocês dariam a uma marca que quer começar?',
  'Beatriz Almeida: Comece com uma peça, não com a coleção inteira. Escolha um modelo que conte bem essa história e aprenda com ele.',
  'Otávio Kern: E converse com o curtume antes de desenhar. Metade dos problemas que eu vejo nasce de um desenho pensado para um couro que não é o vegetal.',
].join('\n\n');

export function couroNobreStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { hours: 3, minutes: 10 });
  const source = buildTranscriptSource({
    id: 'src-couro-nobre',
    title: 'Painel: curtimento vegetal e o couro do futuro',
    origin: 'event',
    text: COURO_NOBRE_TRANSCRIPT,
    fileName: 'painel-couro-nobre.txt',
    speakers: { 'Otávio Kern': PEOPLE.otavio, 'Beatriz Almeida': PEOPLE.beatriz },
    authorized: false,
    rightsNote: 'Aguardando o termo de uso assinado pelo Couro Nobre.',
    recordedOn: dateOf(ago(ctx.now, { days: 6 })),
    createdAt,
    createdBy: PEOPLE.joao,
  });
  const builder = startScenario({
    key: 'couro-nobre',
    title: 'Painel Couro Nobre: curtimento vegetal',
    source,
    ownerId: PEOPLE.joao,
    // B06 · REQ-T.1: material still waiting for its release stays with the team that holds it.
    restrictedTo: [PEOPLE.clara],
    createdAt,
    brief: { angle: 'O que muda para marcas e fábricas que adotam o couro vegetal', sections: 3, length: 'short', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  return {
    scenario: builder.scenario,
    expect: {
      label: 'Material não autorizado',
      productionStatus: 'unauthorized',
      pieces: { article: 'not_started', carousel: 'locked' },
    },
  };
}
