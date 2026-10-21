'use client';

import { useState } from 'react';
import { Badge, Button, EmptyState, FilterBar, Grid, MetaList, PageStack, Panel, Prose, SearchField, Section, Select } from '@content-ventures/design-system/v3';
import type { FunnelStepKey, PipelineDefinition, PipelineStep, PipelineStepKey } from '@/domain/pipeline';
import { FUNNEL_STEP_KEYS, FUNNEL_STEP_LABELS, pipelineModelLabel } from '@/domain/pipeline';
import { EDITORIAL_FORMATS, FORMAT_SPECS, type EditorialFormat } from '@/domain/formats';
import { funnelPromptKey, type FunnelPromptKey, type WorkerPromptKey } from '@/domain/pipeline-workers';

export { funnelPromptKey, type FunnelPromptKey };
export type PromptKey = 'system' | WorkerPromptKey;

/** The format and step of a funnel prompt; undefined for the shared and article prompts. */
export function funnelOf(key: PromptKey): { format: EditorialFormat; step: FunnelStepKey } | undefined {
  if (!key.startsWith('funnel:')) return undefined;
  const [, format, step] = key.split(':') as [string, EditorialFormat, FunnelStepKey];
  return { format, step };
}

/** The step a prompt key edits (none for the shared system message). */
export function promptStep(key: PromptKey, definition: PipelineDefinition): PipelineStep | undefined {
  if (key === 'system') return undefined;
  const funnel = funnelOf(key);
  return funnel ? definition.funnels?.[funnel.format]?.[funnel.step] : definition.steps[key as PipelineStepKey];
}

/** The definition with one step's fields changed, funnel steps included. */
export function withPromptStep(definition: PipelineDefinition, key: PromptKey, patch: Partial<PipelineStep>): PipelineDefinition {
  if (key === 'system') return definition;
  const funnel = funnelOf(key);
  if (!funnel) return { ...definition, steps: { ...definition.steps, [key]: { ...definition.steps[key as PipelineStepKey], ...patch } } };
  const current = definition.funnels?.[funnel.format];
  if (!current) return definition;
  return { ...definition, funnels: { ...definition.funnels, [funnel.format]: { ...current, [funnel.step]: { ...current[funnel.step], ...patch } } } };
}

const FUNNEL_DESCRIPTIONS: Record<FunnelStepKey, string> = {
  outline: 'Planeja título, linha fina e intertítulos no padrão da Seafood Brasil.',
  quotes: 'Distribui as evidências e as falas entre as partes do formato.',
  intro: 'Escreve a abertura no padrão do formato, só com fatos do material.',
  section: 'Escreve cada parte com falas literais e dados atribuídos.',
};

const FUNNEL_PROMPTS = Object.fromEntries(EDITORIAL_FORMATS.flatMap(format => FUNNEL_STEP_KEYS.map(step =>
  [funnelPromptKey(format, step), { title: `${FORMAT_SPECS[format].label} · ${FUNNEL_STEP_LABELS[step]}`, description: FUNNEL_DESCRIPTIONS[step] }]))) as Record<FunnelPromptKey, { title: string; description: string }>;

export const PROMPTS: Record<PromptKey, { title: string; description: string }> = {
  ...FUNNEL_PROMPTS,
  system: { title: 'Diretrizes gerais', description: 'Define as regras editoriais compartilhadas por todas as etapas.' },
  material: { title: 'Tema e participantes', description: 'Identifica o assunto e quem participa da transcrição.' },
  facts: { title: 'Preparar fontes longas', description: 'Organiza os fatos quando a transcrição precisa ser dividida.' },
  outline: { title: 'Estrutura do artigo', description: 'Planeja título, introdução e seções com base na pauta.' },
  quotes: { title: 'Evidências e citações', description: 'Seleciona os trechos da fonte que sustentam cada parte.' },
  intro: { title: 'Introdução', description: 'Escreve a abertura no modo de redação por partes.' },
  section: { title: 'Seções do artigo', description: 'Escreve cada seção, considerando o texto já produzido.' },
  article: { title: 'Artigo completo', description: 'Escreve o artigo inteiro em uma chamada.' },
  assist: { title: 'Assistente de edição', description: 'Propõe ajustes no editor para você revisar e aceitar.' },
  images: { title: 'Sugestões de imagens', description: 'Planeja a capa e as fotos do corpo do artigo.' },
  carousel: { title: 'Texto do carrossel', description: 'Adapta o artigo aprovado aos espaços do modelo visual.' },
};
const GROUPS: { title: string; keys: PromptKey[] }[] = [
  { title: 'Regras gerais', keys: ['system'] },
  { title: 'Preparação do material', keys: ['material', 'facts', 'outline', 'quotes'] },
  { title: 'Redação do artigo', keys: ['article', 'intro', 'section'] },
  { title: 'Edição e carrossel', keys: ['assist', 'images', 'carousel'] },
  ...EDITORIAL_FORMATS.map(format => ({ title: `Funil · ${FORMAT_SPECS[format].label}`, keys: FUNNEL_STEP_KEYS.map(step => funnelPromptKey(format, step)) as PromptKey[] })),
];

export function promptInactive(key: PromptKey, definition: PipelineDefinition) {
  if (funnelOf(key)) return false;
  return key === 'quotes' && !definition.curateQuotes || key === 'article' && definition.articleMode === 'sequential'
    || (key === 'intro' || key === 'section') && definition.articleMode === 'single';
}
export function promptChanged(key: PromptKey, draft: PipelineDefinition, active: PipelineDefinition) {
  return key === 'system' ? draft.systemPrompt !== active.systemPrompt : JSON.stringify(promptStep(key, draft)) !== JSON.stringify(promptStep(key, active));
}
export function promptUsage(key: PromptKey, definition: PipelineDefinition) {
  if (promptInactive(key, definition)) return 'Fora do fluxo';
  if (key === 'system') return 'Compartilhado';
  if (key === 'facts') return 'Fontes longas';
  if (funnelOf(key)) return 'Funil de evento';
  if (key === 'assist') return 'Sob demanda';
  return 'No fluxo';
}

export function PipelineCatalog({ draft, active, onEdit }: {
  draft: PipelineDefinition; active: PipelineDefinition; onEdit: (key: PromptKey) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const term = search.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const groups = GROUPS.map(group => ({ ...group, keys: group.keys.filter(key => {
    const step = promptStep(key, draft);
    const model = step ? pipelineModelLabel(step.model) : '';
    const text = `${PROMPTS[key].title} ${PROMPTS[key].description} ${model}`.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return text.includes(term) && (filter === 'all' || filter === 'changed' && promptChanged(key, draft, active)
      || filter === 'inactive' && promptInactive(key, draft) || filter === 'active' && !promptInactive(key, draft));
  }) })).filter(group => group.keys.length > 0);
  return <PageStack>
    <FilterBar filters={false}
      search={<SearchField label="Buscar prompts" placeholder="Buscar por função ou modelo" value={search} onValueChange={setSearch} />}
      actions={<Select label="Filtrar prompts" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'Todos os prompts' }, { value: 'active', label: 'Em uso' },
        { value: 'inactive', label: 'Fora do fluxo' }, { value: 'changed', label: 'Com alterações' },
      ]} />} />
    {groups.length ? <Grid columns="1:1" collapseBelow={960} align="start">
      {groups.flatMap(group => group.keys.map(key => <Panel key={key}><Section title={PROMPTS[key].title}
        action={<Button size="sm" onClick={() => onEdit(key)} aria-label={`Editar ${PROMPTS[key].title}`}>Editar</Button>}>
        <Prose variant="compact" measure="wide">{PROMPTS[key].description}</Prose>
        <MetaList size="sm" items={[
          group.title,
          <Badge key="usage" tone={promptInactive(key, draft) ? 'gray' : 'blue'} size="sm">{promptUsage(key, draft)}</Badge>,
          promptStep(key, draft) ? pipelineModelLabel(promptStep(key, draft)!.model) : 'Todas as etapas',
          ...(promptChanged(key, draft, active) ? [<Badge key="changed" tone="amber" size="sm">Alterado</Badge>] : []),
        ]} />
      </Section></Panel>))}
    </Grid> : <EmptyState size="panel" title="Nenhum prompt encontrado" actions={<Button onClick={() => { setSearch(''); setFilter('all'); }}>Limpar filtros</Button>} />}
  </PageStack>;
}
