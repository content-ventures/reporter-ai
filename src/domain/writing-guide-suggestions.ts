import type { WritingGuide } from './hard-news.ts';

/** Opt-in configuration suggestions, never injected into a run unless saved in its guide. */
const PRINCIPLES = {
  voice: 'Jornalístico, direto, informado e acessível. Use ações concretas e detalhes relevantes. No discurso indireto, transforme a oralidade em explicação clara, preservando autoria, causalidade, intensidade e ressalvas. Não transporte imagens orais pouco claras para a narração. Dentro das aspas, preserve o texto original; não amplie termos técnicos por plausibilidade.',
  headline: 'Expresse o desenvolvimento principal sustentado pelo conteúdo e organize os complementos em torno dele. Preserve a diferença entre apresentação, lançamento, intenção, projeção e resultado. O tempo verbal deve respeitar o momento documentado do acontecimento; a data da geração não atualiza a notícia.',
  dek: 'Acrescente um complemento central ao título em uma frase concisa, sem enumerar os assuntos do corpo. Se houver dois complementos independentes, escolha o que melhor desenvolve o recorte e leve o outro ao texto. Título, linha fina e abertura devem orientar a mesma leitura. Preserve autoria, ressalvas e referência temporal: uma avaliação na entrevista não comprova a situação atual. Não invente a data ausente.',
  lead: 'Abra pela ação concreta e apenas pelo contexto necessário para compreendê-la. Desenvolva cedo o que justifica título e linha fina, antes de histórico, elogios ou intenções genéricas. A menção a local ou destino não exige uma avaliação ampla de sua importância: retenha o detalhe que explica concretamente a ação. Uma cobertura de evento pode reunir produto, discussão técnica e mercado, com prioridade clara e desdobramentos conectados.',
  attribution: 'Identifique a origem de dados, avaliações e declarações. Apresente nome, cargo e organização quando confirmados e relevantes. Mantenha clara a autoria ao longo do parágrafo; retome a fonte quando houver mudança, ambiguidade ou nova afirmação que precise de atribuição, evitando reapresentá-la em cada frase. Não transforme uma avaliação em afirmação do veículo nem complete identificação por plausibilidade.',
} as const;
const COMPOSITION = {
  paragraphs: 'Cada parágrafo acrescenta fato, explicação ou consequência relevante ao recorte. Contexto institucional ou regional entra quando explica concretamente a ação, o público atendido ou uma condição da notícia. Faça o teste de retirada: se a frase só acrescenta avaliação genérica de relevância, evolução, satisfação ou cumprimento de objetivos, corte-a e preserve o dado específico que ajuda a compreender o desenvolvimento. Conecte informação, explicação e consequência; integre frases isoladas quando isso melhora a leitura. Corte repetições de significado e antecipações do que a fala seguinte informa. Preserve fatos essenciais, finalidades, causas, condições, prazos, atribuição e grau de certeza ao condensar ou mover trechos. A extensão acompanha a informação disponível, sem meta de corte nem preenchimento.',
  headings: 'Use intertítulos para mudanças relevantes de assunto, respeitando o formato e a estrutura confirmados na pauta. Uma seção curta não exige divisão apenas para parecer completa; quando o formato permitir, pode integrar o desenvolvimento anterior. Não imponha quantidade universal de seções. H2 é a divisão normal; H3 exige subordinação real.',
  closing: 'Encerre com a última informação relevante ou uma declaração que acrescente conteúdo. Preserve condições e horizontes de uma previsão, sem anunciar a operação editorial com expressões como “manteve a ressalva”. Não acrescente balanço genérico, conclusão promocional ou recapitulação. Mantenha a referência temporal do relato também nas transições e na última frase; o presente não deve atualizar uma avaliação feita no evento.',
} as const;
const LABELS = { voice: 'Voz', headline: 'Título', dek: 'Linha fina', lead: 'Lead', attribution: 'Atribuição', paragraphs: 'Parágrafos', headings: 'Intertítulos', closing: 'Encerramento' };

export function writingGuideSuggestions(guide: WritingGuide): { id: string; label: string; before: string; after: string }[] {
  return [
    ...Object.entries(PRINCIPLES).map(([key, after]) => ({ id: key, label: LABELS[key as keyof typeof PRINCIPLES], before: guide[key as keyof typeof PRINCIPLES] ?? '', after })),
    ...Object.entries(COMPOSITION).map(([key, after]) => ({ id: key, label: LABELS[key as keyof typeof COMPOSITION], before: guide.composition?.[key as keyof typeof COMPOSITION] ?? '', after })),
  ].filter(change => change.before !== change.after);
}

/** Preserve metadata, outlet rules, terminology, examples and every untargeted composition field. */
export function applyWritingGuideSuggestions(guide: WritingGuide): WritingGuide {
  return { ...guide, ...PRINCIPLES, composition: { ...guide.composition, ...COMPOSITION } };
}
