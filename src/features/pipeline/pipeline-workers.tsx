'use client';

import { Badge, Card, CardHeader, CardLink, Field, FieldGroup, Grid, MetaList, PageStack, Panel, Prose, Section, Select, SplitLayout, SwitchRow, Timeline } from '@content-ventures/design-system/v3';
import { FolderUp, FileText, Settings2, CheckCircle2, Inbox } from '@content-ventures/design-system/v3/icons';
import { PIPELINE_WORKERS, pipelineWorkerFlow, type PipelineWorkerKey, type WorkerNode } from '@/domain/pipeline-workers';
import { pipelineModelLabel, type PipelineDefinition } from '@/domain/pipeline';
import { PROMPTS, promptChanged, promptStep, type PromptKey } from './pipeline-catalog';

export function PipelineWorkers({ worker, onSelect, draft, active, saving, onEdit, onUpdate }: {
  worker?: PipelineWorkerKey; onSelect: (key?: PipelineWorkerKey) => void;
  draft: PipelineDefinition; active: PipelineDefinition; saving: boolean;
  onEdit: (key: PromptKey) => void; onUpdate: (patch: Partial<PipelineDefinition>) => void;
}) {
  const promptCard = (key: PromptKey) => <Card interactive padding="md">
    <CardHeader titleAs="h3" title={<CardLink onClick={() => onEdit(key)} aria-label={`Editar ${PROMPTS[key].title}`}>{PROMPTS[key].title}</CardLink>}
      description={PROMPTS[key].description} />
    <MetaList size="sm" items={[promptStep(key, draft) ? pipelineModelLabel(promptStep(key, draft)!.model) : 'Compartilhado entre os workers',
      ...(promptChanged(key, draft, active) ? [<Badge key="changed" tone="amber" size="sm">Alterado</Badge>] : [])]} />
  </Card>;
  if (!worker) return <Grid columns="1:1" collapseBelow={760}>
    {PIPELINE_WORKERS.map(item => {
      const count = pipelineWorkerFlow(item.key, draft).filter(node => node.prompt).length;
      return <Card key={item.key} interactive padding="lg">
        <PageStack>
          <CardHeader titleAs="h2" size="md" leading={<FolderUp size={20} />} title={item.title} />
          <Prose variant="compact" measure="wide">{item.description}</Prose>
          <MetaList items={[`${count} ${count === 1 ? 'prompt' : 'prompts'} no fluxo`]} />
          <CardLink onClick={() => onSelect(item.key)} aria-label={`Abrir worker ${item.title}`}>Abrir fluxo</CardLink>
        </PageStack>
      </Card>;
    })}
  </Grid>;
  const selected = PIPELINE_WORKERS.find(item => item.key === worker)!;
  const nodes = pipelineWorkerFlow(worker, draft);
  const icons = { input: Inbox, prompt: FileText, automatic: Settings2, output: CheckCircle2 };
  const kindLabels: Record<WorkerNode['kind'], string> = { input: 'Entrada', prompt: 'Prompt editável', automatic: 'Automático', output: 'Saída' };
  return <PageStack>
    <SplitLayout main={<Panel><Section title="Fluxo de execução">
      <Timeline variant="icons" label={`Fluxo do worker ${selected.title}`} items={nodes.map((node, index) => ({
        id: node.id, title: `${index + 1} · ${kindLabels[node.kind]}`, icon: icons[node.kind], state: 'upcoming',
        extra: <Card interactive={Boolean(node.prompt)} padding="md" data-testid={`worker-node-${node.id}`}>
          <CardHeader titleAs="h3" title={node.prompt
            ? <CardLink onClick={() => onEdit(node.prompt!)} aria-label={`Editar ${node.title}`}>{node.title}</CardLink> : node.title}
            description={node.description} />
          <MetaList size="sm" items={[
            ...(node.condition ? [node.condition] : []),
            ...(node.prompt ? [pipelineModelLabel(draft.steps[node.prompt].model)] : []),
            ...(node.prompt && promptChanged(node.prompt, draft, active) ? [<Badge key="changed" tone="amber" size="sm">Alterado</Badge>] : []),
          ]} />
        </Card>,
      }))} />
    </Section></Panel>}
      asideLabel="Configuração do worker" aside={<>
        {worker === 'article' && <Panel><Section title="Etapas da redação">
          <FieldGroup label="Configuração do fluxo" columns={1}>
            <Field label="Modo de redação">{props => <Select {...props} value={draft.articleMode} disabled={saving}
              onChange={value => onUpdate({ articleMode: value as PipelineDefinition['articleMode'] })} options={[
                { value: 'single', label: 'Artigo completo' }, { value: 'sequential', label: 'Introdução e seções' },
              ]} />}</Field>
            <SwitchRow label="Selecionar evidências antes da redação" checked={draft.curateQuotes} disabled={saving}
              onCheckedChange={curateQuotes => onUpdate({ curateQuotes })} />
          </FieldGroup>
        </Section></Panel>}
        <Panel><Section title="Instruções compartilhadas">{promptCard('system')}</Section></Panel>
        {worker === 'article' && <>
          <Panel><Section title="Antes da geração" meta="Na importação do material">{promptCard('material')}</Section></Panel>
          <Panel><Section title="Durante a edição" meta="Sob demanda">{promptCard('assist')}</Section></Panel>
        </>}
      </>} />
  </PageStack>;
}
