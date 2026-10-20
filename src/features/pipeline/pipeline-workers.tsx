'use client';

import { AttachedNote, Badge, Card, CardHeader, CardLink, Field, FieldGroup, Grid, IconTile, MetaList, PageStack, Panel, Section, Select, SplitLayout, SwitchRow, Timeline, Tray, type Tone } from '@content-ventures/design-system/v3';
import { CheckCircle2, FileText, GalleryHorizontal, Inbox, Megaphone, Presentation, Settings2, Sparkles, StickyNote, Store, Trophy, type LucideIcon } from '@content-ventures/design-system/v3/icons';
import { PIPELINE_WORKERS, pipelineWorkerFlow, type PipelineWorker, type PipelineWorkerKey, type WorkerNode } from '@/domain/pipeline-workers';
import { FORMAT_SPECS, formatRangeLabel } from '@/domain/formats';
import { pipelineModelLabel, type PipelineDefinition } from '@/domain/pipeline';
import { PROMPTS, promptChanged, promptStep, type PromptKey } from './pipeline-catalog';

const FLOW_ICONS = { input: Inbox, prompt: Sparkles, automatic: Settings2, output: CheckCircle2 };
const FLOW_LABELS: Record<WorkerNode['kind'], string> = { input: 'Fluxo · entrada', prompt: 'IA · prompt editável', automatic: 'Fluxo · automático', output: 'Fluxo · saída' };
/** Each worker's mark: one icon and one tone, so the cards tell apart at a glance. */
const WORKER_LOOK: Record<PipelineWorkerKey, { icon: LucideIcon; tone: Tone }> = {
  article: { icon: FileText, tone: 'blue' }, carousel: { icon: GalleryHorizontal, tone: 'pink' },
  stand: { icon: Store, tone: 'teal' }, panel: { icon: Presentation, tone: 'violet' }, awards: { icon: Trophy, tone: 'amber' },
  opening: { icon: Megaphone, tone: 'orange' }, note: { icon: StickyNote, tone: 'green' },
};
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
  const workerCard = (item: PipelineWorker) => {
    const count = pipelineWorkerFlow(item.key, draft).filter(node => node.prompt).length;
    const sizes = item.format ? FORMAT_SPECS[item.format].sizes : undefined;
    return <Card key={item.key} interactive padding="md">
      <PageStack>
        <CardHeader titleAs="h2" leading={<IconTile icon={WORKER_LOOK[item.key].icon} tone={WORKER_LOOK[item.key].tone} size="lg" />}
          title={<CardLink onClick={() => onSelect(item.key)} aria-label={`Abrir worker ${item.title}`}>{item.title}</CardLink>}
          description={item.format ? FORMAT_SPECS[item.format].summary : item.description} />
        <MetaList size="sm" items={[...(sizes ? [formatRangeLabel({ ...sizes[0], maxChars: sizes[sizes.length - 1].maxChars })] : []),
          `${count} ${count === 1 ? 'bloco de IA' : 'blocos de IA'}`]} />
      </PageStack>
    </Card>;
  };
  if (!worker) {
    const formats = PIPELINE_WORKERS.filter(item => item.format);
    return <PageStack>
      <Tray title="Artigo e carrossel" meta="Fluxo padrão da redação">
        <Grid columns="1:1:1" collapseBelow={760} label="Artigo e carrossel">{PIPELINE_WORKERS.filter(item => !item.format).map(workerCard)}</Grid>
      </Tray>
      <Tray title="Formatos de evento" meta={`${formats.length} workers`}>
        <Grid columns="1:1:1" collapseBelow={760} label="Formatos de evento">{formats.map(workerCard)}</Grid>
      </Tray>
    </PageStack>;
  }
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
