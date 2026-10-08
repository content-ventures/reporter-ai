import { R1_FLOW } from '../domain/index.ts';
import type { FlowDefinition, FlowId, GateId, SourceKind } from '../domain/index.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Production flows: the journey stages behind the Stepper, tabs and board. `stageState()` in
 * the domain reads a FlowDefinition, so a new release adds a flow here instead of new screens.
 */

export type FlowEntry = FlowDefinition & {
  since: ReleaseId;
  description: string;
  sourceKinds: SourceKind[];
  gates: GateId[];
};

export const FLOWS: readonly FlowEntry[] = [
  {
    ...R1_FLOW,
    since: 'R1',
    description: 'Transcrição autorizada → artigo aprovado → carrossel aprovado → exportação.',
    sourceKinds: ['transcript'],
    gates: ['article.approval', 'carousel.approval'],
  },
  {
    id: 'news-article',
    label: 'Notícia → artigo',
    since: 'R2',
    description: 'Notícia triada → pesquisa → artigo aprovado → rascunho no CMS.',
    sourceKinds: ['news'],
    gates: ['news.triage', 'article.approval'],
    stages: [
      { id: 'source', label: 'Notícia', kind: 'source' },
      { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article' },
      { id: 'delivery', label: 'Publicação', kind: 'delivery' },
    ],
  },
  {
    id: 'opportunity-article',
    label: 'Oportunidade → artigo',
    since: 'R3',
    description: 'Oportunidade aprovada → estrutura revisada → artigo aprovado → entrega.',
    sourceKinds: ['opportunity'],
    gates: ['brief.approval', 'outline.approval', 'article.approval'],
    stages: [
      { id: 'source', label: 'Oportunidade', kind: 'source' },
      { id: 'outline', label: 'Estrutura', kind: 'piece', pieceKind: 'outline' },
      { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article' },
      { id: 'delivery', label: 'Entrega', kind: 'delivery' },
    ],
  },
  {
    id: 'media-cut',
    label: 'Mídia → corte',
    since: 'R4',
    description: 'Mídia original → corte conferido e aprovado → canal social → vínculo com o artigo.',
    sourceKinds: ['media'],
    gates: ['cut.approval'],
    stages: [
      { id: 'source', label: 'Mídia', kind: 'source' },
      { id: 'cut', label: 'Corte', kind: 'piece', pieceKind: 'cut' },
      { id: 'delivery', label: 'Publicação', kind: 'delivery' },
    ],
  },
  {
    id: 'script-media',
    label: 'Roteiro → áudio e vídeo',
    since: 'R5',
    description: 'Material → roteiro aprovado → áudio e vídeo aprovados → entrega.',
    sourceKinds: ['transcript', 'news'],
    gates: ['script.approval', 'media.approval'],
    stages: [
      { id: 'source', label: 'Material', kind: 'source' },
      { id: 'script', label: 'Roteiro', kind: 'piece', pieceKind: 'script' },
      { id: 'audio', label: 'Áudio', kind: 'piece', pieceKind: 'audio' },
      { id: 'video', label: 'Vídeo', kind: 'piece', pieceKind: 'video' },
      { id: 'delivery', label: 'Entrega', kind: 'delivery' },
    ],
  },
  {
    id: 'newsletter',
    label: 'Newsletter',
    since: 'R6',
    description: 'Artigos aprovados → edição da newsletter aprovada → envio por e-mail.',
    sourceKinds: [],
    gates: ['newsletter.approval'],
    stages: [
      { id: 'source', label: 'Seleção', kind: 'source' },
      { id: 'newsletter', label: 'Newsletter', kind: 'piece', pieceKind: 'newsletter' },
      { id: 'delivery', label: 'Envio', kind: 'delivery' },
    ],
  },
];

export function flowsFor(release: ReleaseId = CURRENT_RELEASE): FlowEntry[] {
  return availableIn(FLOWS, release);
}

export function flowById(id: FlowId): FlowEntry | undefined {
  return FLOWS.find((flow) => flow.id === id);
}

/** The flow new productions use in a release (R1: transcript → article → carousel). */
export const DEFAULT_FLOW_ID: FlowId = R1_FLOW.id;
