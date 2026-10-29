'use client';
import { DescriptionList } from '@content-ventures/design-system/v3';
import type { MemoryDiscovery } from '@/domain/editorial-memory';
import { VERDICT_LABELS } from '@/domain/fact-check';
import { usePeople } from '@/state';

/** Discovery describes the original choice; it is independent of current evidence eligibility. */
export function MemoryDiscoveryDetails({ discovery, material }: { discovery: MemoryDiscovery; material?: { id: string; title: string } }) {
  const people = usePeople(), q = discovery.query;
  return <DescriptionList items={[
    { label: 'Texto buscado', value: q.query?.trim() || 'Sem termo de busca' },
    ...(q.kind ? [{ label: 'Tipo buscado', value: q.kind === 'citation' ? 'Citações' : 'Estatísticas' }] : []),
    ...(q.status ? [{ label: 'Estado buscado', value: ({ active: 'Ativas', withdrawn: 'Retiradas', superseded: 'Substituídas', all: 'Todos' })[q.status] }] : []),
    ...(q.topics?.length ? [{ label: 'Temas', value: q.topics.join(', ') }] : []),
    ...(q.personId ? [{ label: 'Pessoa buscada', value: people.data?.find(person => person.id === q.personId)?.name ?? q.personId }] : []),
    ...(['institution', 'company', 'event', 'edition'] as const).flatMap(key => q[key] ? [{ label: ({ institution: 'Instituição', company: 'Empresa', event: 'Evento', edition: 'Edição' })[key], value: q[key] }] : []),
    ...(q.materialId ? [{ label: 'Material buscado', value: material?.id === q.materialId ? material.title : q.materialId }] : []),
    ...(q.materialKind ? [{ label: 'Tipo de material', value: ({ transcript: 'Transcrição', news: 'Notícia', release: 'Release', report: 'Relatório', archive: 'Acervo', market_data: 'Dados de mercado' })[q.materialKind] }] : []),
    ...(q.dateField ? [{ label: 'Data filtrada', value: ({ recorded: 'Declaração', published: 'Publicação', observation: 'Período do dado' })[q.dateField] }] : []),
    ...(q.from ? [{ label: 'Desde', value: q.from }] : []), ...(q.to ? [{ label: 'Até', value: q.to }] : []),
    ...(q.verdict ? [{ label: 'Resultado buscado', value: VERDICT_LABELS[q.verdict] }] : []),
    ...(q.minConfidence !== undefined ? [{ label: 'Confiança mínima', value: `${q.minConfidence}%` }] : []),
    ...(q.unused !== undefined ? [{ label: 'Uso buscado', value: q.unused ? 'Sem uso' : 'Com uso' },
      { label: 'Etapa do uso', value: ({ inserted: 'Rascunho', approved: 'Aprovação', published: 'Publicação' })[q.useStage ?? 'inserted'] }] : []),
    { label: 'Ordem da busca', value: ({ newest: 'Mais recentes', oldest: 'Mais antigas', confidence: 'Confiança factual', relevance: 'Relevância', usage: 'Mais usadas' })[q.sort ?? 'newest'] },
    { label: 'Revisão encontrada na busca', value: discovery.evidence.revision },
  ]} />;
}
