import { pipelineJobKeys, type PipelineDefinition, type PipelineStepKey } from './pipeline.ts';
import { EDITORIAL_FORMATS, FORMAT_SPECS, type EditorialFormat } from './formats.ts';
import type { FunnelStepKey } from './format-prompts.ts';

/** A prompt of an event-format funnel: "funnel:stand:intro". */
export type FunnelPromptKey = `funnel:${EditorialFormat}:${FunnelStepKey}`;
/** The prompt a block edits: a step of the article pipeline or of a format's funnel. */
export type WorkerPromptKey = PipelineStepKey | FunnelPromptKey;

export function funnelPromptKey(format: EditorialFormat, step: FunnelStepKey): FunnelPromptKey {
  return `funnel:${format}:${step}`;
}

/**
 * Whether a prompt runs in a definition's flow: curation, shared or of a format, only with
 * `curateQuotes`; the article prompts of the writing mode in use; the other funnel steps always.
 */
export function promptRuns(key: WorkerPromptKey, definition: PipelineDefinition): boolean {
  const step = key.startsWith('funnel:') ? key.split(':')[2] : key;
  if (step === 'quotes') return definition.curateQuotes;
  if (key === 'article') return definition.articleMode === 'single';
  if (key === 'intro' || key === 'section') return definition.articleMode !== 'single';
  return true;
}

export type PipelineWorkerKey = 'article' | 'carousel' | EditorialFormat;
/**
 * A block of a worker's flow. `prompt` blocks are where AI writes, each with the prompt a person
 * edits; the others are the flow the system runs by itself (input, automatic checks, output).
 * `scope` says whether the prompt belongs to this format only or is shared with the article.
 */
export type WorkerNode = {
  id: string; title: string; description: string; prompt?: WorkerPromptKey; condition?: string;
  kind: 'input' | 'prompt' | 'automatic' | 'output'; scope?: 'format' | 'shared';
};
export type PipelineWorker = { key: PipelineWorkerKey; title: string; description: string; format?: EditorialFormat };

const FORMAT_WORKER_TITLES: Record<EditorialFormat, string> = {
  stand: 'Gerar cobertura de estande', panel: 'Gerar cobertura de painel', awards: 'Gerar premiação',
  opening: 'Gerar abertura', note: 'Gerar nota curta',
};

export const PIPELINE_WORKERS: readonly PipelineWorker[] = [
  { key: 'article', title: 'Gerar artigo', description: 'Da fonte autorizada ao rascunho, com evidências e imagens.' },
  { key: 'carousel', title: 'Gerar carrossel', description: 'Do artigo aprovado aos textos dos slides no modelo escolhido.' },
  ...EDITORIAL_FORMATS.map((format): PipelineWorker => ({ key: format, format, title: FORMAT_WORKER_TITLES[format],
    description: `${FORMAT_SPECS[format].summary} Com o guia do workspace e somente fatos do material.` })),
];

const images: WorkerNode[] = [
  { id: 'images', title: 'Sugestões de imagens', description: 'Planeja a capa e as imagens do corpo. Uma falha preserva o texto.', kind: 'prompt', prompt: 'images', condition: 'Complemento opcional' },
  { id: 'photos', title: 'Buscar fotos', description: 'Busca no Pixabay. O texto é preservado se as imagens estiverem indisponíveis.', kind: 'automatic' },
];

/** After the text is saved, its citations are checked on the web (fact-check-worker.ts). */
const veracity: WorkerNode = { id: 'veracity', title: 'Checar veracidade das falas', description: 'Busca cada afirmação das citações na web e registra o veredito com a fonte.',
  kind: 'automatic', condition: 'Em segundo plano; o texto não espera' };

/** An event format's worker: its own structure, curation, opening and parts, the shared long-source step before them, no AI images. */
function formatWorkerFlow(format: EditorialFormat, definition: PipelineDefinition): WorkerNode[] {
  const spec = FORMAT_SPECS[format];
  const nodes: WorkerNode[] = [
    { id: 'source', title: 'Material, pauta e evento', description: 'Recebe a transcrição, as pessoas confirmadas, o formato escolhido e os dados do evento.', kind: 'input' },
    { id: 'facts', title: 'Preparar fontes longas', description: 'Processa os trechos da fonte até caberem no contexto.', kind: 'prompt', prompt: 'facts', condition: 'Somente fontes com mais de 24 mil caracteres', scope: 'shared' },
    { id: 'outline', title: 'Estrutura do formato', description: 'Planeja título, linha fina e intertítulos com o guia do workspace.', kind: 'prompt', prompt: funnelPromptKey(format, 'outline'), scope: 'format' },
    { id: 'quotes', title: 'Evidências e citações', description: 'Distribui os trechos da fonte entre as partes do texto.', kind: 'prompt', prompt: funnelPromptKey(format, 'quotes'), condition: 'Durante o planejamento da estrutura', scope: 'format' },
    { id: 'intro', title: 'Abertura', description: 'Escreve o lide e a apresentação de quem fala.', kind: 'prompt', prompt: funnelPromptKey(format, 'intro'), scope: 'format' },
    { id: 'section', title: spec.headings ? 'Seções' : 'Contexto', description: spec.headings ? 'Escreve cada intertítulo em sequência, com falas literais.' : 'Escreve o contexto da nota, sem intertítulo.', kind: 'prompt', prompt: funnelPromptKey(format, 'section'), condition: 'Repete uma vez por parte', scope: 'format' },
    { id: 'grounding', title: 'Checar fatos e repetições', description: 'Confere cada número e nome contra o material, as pessoas e o evento; revisa a parte ou remove a frase.', kind: 'automatic' },
    { id: 'validate', title: 'Validar o texto', description: 'Confere o teto do formato, as citações literais e a linha fina antes de salvar.', kind: 'automatic' },
    veracity,
    { id: 'save', title: 'Texto pronto para revisão', description: 'Salva o rascunho com a linha fina, sem imagens de IA: a cobertura usa as fotos da redação. O box do evento sai na entrega. A aprovação é manual.', kind: 'output' },
  ];
  return nodes.filter(node => !node.prompt || promptRuns(node.prompt, definition));
}

/** Mirrors editorial-worker.ts. Conditional planning is skipped when an outline is supplied. */
export function pipelineWorkerFlow(worker: PipelineWorkerKey, definition: PipelineDefinition): WorkerNode[] {
  if (worker !== 'article' && worker !== 'carousel') return formatWorkerFlow(worker, definition);
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
    ...images,
    veracity,
    { id: 'save', title: 'Artigo pronto para revisão', description: 'Salva o rascunho e suas citações. A aprovação é manual.', kind: 'output' },
  ];
}
