'use client';

import { AttachedNote, Badge, Card, CardHeader, CardLink, Field, FieldGroup, Grid, MetaList, PageStack, Panel, Prose, Section, Select, SplitLayout, SwitchRow, Timeline } from '@content-ventures/design-system/v3';
import { FolderUp, Sparkles, Settings2, CheckCircle2, Inbox } from '@content-ventures/design-system/v3/icons';
import { PIPELINE_WORKERS, pipelineWorkerFlow, type PipelineWorkerKey, type WorkerNode } from '@/domain/pipeline-workers';
import { pipelineModelLabel, type PipelineDefinition } from '@/domain/pipeline';
import { PROMPTS, promptChanged, promptStep, type PromptKey } from './pipeline-catalog';

const FLOW_ICONS = { input: Inbox, prompt: Sparkles, automatic: Settings2, output: CheckCircle2 };
const FLOW_LABELS: Record<WorkerNode['kind'], string> = { input: 'Fluxo · entrada', prompt: 'IA · prompt editável', automatic: 'Fluxo · automático', output: 'Fluxo · saída' };
const SCOPE_NOTES: Record<NonNullable<WorkerNode['scope']>, string> = {
  format: 'Prompt só deste formato: editar aqui não muda o artigo nem os outros formatos.',
  shared: 'Prompt compartilhado: vale para o artigo e para todos os formatos.',
};

export function PipelineWorkers({ worker, onSelect, draft, active, saving, onEdit, onUpdate }: {
  worker?: PipelineWorkerKey; onSelect: (key?: PipelineWorkerKey) => void;
  draft: PipelineDefinition; active: PipelineDefinition; saving: boolean;
  onEdit: (key: PromptKey) => void; onUpdate: (patch: Partial<PipelineDefinition>) => void;
}) {
  const changedBadge = (key: PromptKey) => promptChanged(key, draft, active) ? [<Badge key="changed" tone="amber" size="sm">Alterado</Badge>] : [];
  const promptCard = (key: PromptKey) => <Card interactive padding="md">
    <CardHeader titleAs="h3" title={<CardLink onClick={() => onEdit(key)} aria-label={`Editar ${PROMPTS[key].title}`}>{PROMPTS[key].title}</CardLink>}
      description={PROMPTS[key].description} />
    <MetaList size="sm" items={[promptStep(key, draft) ? pipelineModelLabel(promptStep(key, draft)!.model) : 'Compartilhado entre os workers', ...changedBadge(key)]} />
  </Card>;
  if (!worker) return <Grid columns="1:1" collapseBelow={760}>
    {PIPELINE_WORKERS.map(item => {
      const count = pipelineWorkerFlow(item.key, draft).filter(node => node.prompt).length;
      return <Card key={item.key} interactive padding="lg">
        <PageStack>
          <CardHeader titleAs="h2" size="md" leading={<FolderUp size={20} />} title={item.title}
            badge={item.format ? <Badge tone="violet" size="sm">Formato de evento</Badge> : undefined} />
          <Prose variant="compact" measure="wide">{item.description}</Prose>
          <MetaList items={[`${count} ${count === 1 ? 'bloco de IA' : 'blocos de IA'} no fluxo`]} />
          <CardLink onClick={() => onSelect(item.key)} aria-label={`Abrir worker ${item.title}`}>Abrir fluxo</CardLink>
        </PageStack>
      </Card>;
    })}
  </Grid>;
  const selected = PIPELINE_WORKERS.find(item => item.key === worker)!;
  const nodes = pipelineWorkerFlow(worker, draft);
  const aiBlocks = nodes.filter(node => node.prompt).length;

  // A block of AI: where a prompt writes. Highlighted, and the whole card opens its prompt.
  const aiBlock = (node: WorkerNode) => {
    const step = promptStep(node.prompt!, draft);
    const card = <Card interactive padding="md" data-testid={`worker-node-${node.id}`}>
      <CardHeader titleAs="h3" leading={<Sparkles size={18} />}
        title={<CardLink onClick={() => onEdit(node.prompt!)} aria-label={`Editar ${node.title}`}>{node.title}</CardLink>}
        badge={<Badge tone="violet" size="sm" icon={Sparkles}>IA · editável</Badge>} description={node.description} />
      <MetaList size="sm" items={[...(step ? [pipelineModelLabel(step.model)] : []), ...(node.condition ? [node.condition] : []), ...changedBadge(node.prompt!)]} />
    </Card>;
    return node.scope ? <AttachedNote tone="blue" icon={Sparkles} note={SCOPE_NOTES[node.scope]}>{card}</AttachedNote> : card;
  };
  // A block of flow: what the system does by itself. Plain, with nothing to edit.
  const flowBlock = (node: WorkerNode) => <Card padding="sm" elevation="flat" data-testid={`worker-node-${node.id}`}>
    <CardHeader titleAs="h3" title={node.title} description={node.description}
      badge={<Badge tone="gray" size="sm">{node.kind === 'automatic' ? 'Automático' : node.kind === 'input' ? 'Entrada' : 'Saída'}</Badge>} />
    {node.condition ? <MetaList size="sm" items={[node.condition]} /> : null}
  </Card>;

  return <PageStack>
    <SplitLayout main={<Panel><Section title="Fluxo de execução"
      meta={`${aiBlocks} ${aiBlocks === 1 ? 'bloco de IA editável' : 'blocos de IA editáveis'} · ${nodes.length - aiBlocks} de fluxo`}>
      <Timeline variant="icons" label={`Fluxo do worker ${selected.title}`} items={nodes.map((node, index) => ({
        id: node.id, title: `${index + 1} · ${FLOW_LABELS[node.kind]}`, icon: FLOW_ICONS[node.kind], state: node.prompt ? 'current' : 'upcoming',
        extra: node.prompt ? aiBlock(node) : flowBlock(node),
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
