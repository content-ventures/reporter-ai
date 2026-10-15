import { pipelineJobKeys, type PipelineDefinition, type PipelineStepKey } from './pipeline.ts';

export type PipelineWorkerKey = 'article' | 'carousel';
export type WorkerNode = { id: string; title: string; description: string; prompt?: PipelineStepKey; condition?: string; kind: 'input' | 'prompt' | 'automatic' | 'output' };
export const PIPELINE_WORKERS = [
  { key: 'article', title: 'Gerar artigo', description: 'Da fonte autorizada ao rascunho, com evidências e imagens.' },
  { key: 'carousel', title: 'Gerar carrossel', description: 'Do artigo aprovado aos textos dos slides no modelo escolhido.' },
] as const;

/** Mirrors editorial-worker.ts. Conditional planning is skipped when an outline is supplied. */
export function pipelineWorkerFlow(worker: PipelineWorkerKey, definition: PipelineDefinition): WorkerNode[] {
  if (worker === 'carousel') return [
    { id: 'approved', title: 'Artigo aprovado', description: 'Usa a versão aprovada do artigo e o modelo escolhido.', kind: 'input' },
    { id: 'layouts', title: 'Preparar os slides', description: 'Define os espaços, a quantidade de slides e os limites de cada campo.', kind: 'automatic' },
    { id: 'carousel', title: 'Texto do carrossel', description: 'Adapta o artigo aprovado ao conteúdo de cada slide.', kind: 'prompt', prompt: 'carousel' },
    { id: 'validate', title: 'Validar os textos', description: 'Confere campos obrigatórios, limites, referências e citações literais.', kind: 'automatic' },
    { id: 'save', title: 'Carrossel pronto para revisão', description: 'Salva os textos no modelo. Revisão e aprovação continuam manuais.', kind: 'output' },
  ];
  const details: Partial<Record<PipelineStepKey, Omit<WorkerNode, 'id' | 'prompt' | 'kind'>>> = {
    facts: { title: 'Preparar fontes longas', description: 'Processa os trechos da fonte até caberem no contexto.', condition: 'Somente fontes com mais de 24 mil caracteres' },
    outline: { title: 'Estrutura do artigo', description: 'Planeja o título, a introdução e as seções.', condition: 'Se a produção ainda não tem uma estrutura definida' },
    quotes: { title: 'Evidências e citações', description: 'Distribui os trechos da fonte entre as partes do artigo.', condition: 'Durante o planejamento da estrutura' },
    article: { title: 'Artigo completo', description: 'Escreve o artigo inteiro; pode fazer uma revisão automática de tamanho.' },
    intro: { title: 'Introdução', description: 'Escreve a abertura usando a estrutura e as evidências.' },
    section: { title: 'Seções do artigo', description: 'Escreve cada seção em sequência, considerando o texto anterior.', condition: 'Repete uma vez por seção' },
  };
  return [
    { id: 'source', title: 'Fonte autorizada e pauta', description: 'Recebe a transcrição, participantes confirmados e o recorte editorial.', kind: 'input' },
    ...pipelineJobKeys(definition, 'article.draft').map(key => ({ id: key, prompt: key, kind: 'prompt' as const, ...details[key]! })),
    { id: 'validate', title: 'Validar o artigo', description: 'Confere estrutura, tamanho e citações na fonte antes de salvar.', kind: 'automatic' },
    { id: 'images', title: 'Sugestões de imagens', description: 'Planeja a capa e as imagens do corpo. Uma falha preserva o texto.', kind: 'prompt', prompt: 'images', condition: 'Complemento opcional' },
    { id: 'photos', title: 'Buscar fotos', description: 'Busca no Pixabay. O artigo é preservado se as imagens estiverem indisponíveis.', kind: 'automatic' },
    { id: 'save', title: 'Artigo pronto para revisão', description: 'Salva o rascunho e suas citações. A aprovação é manual.', kind: 'output' },
  ];
}
