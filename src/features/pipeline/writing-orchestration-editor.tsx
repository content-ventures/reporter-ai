'use client';

import { useState } from 'react';
import { Accordion, Alert, Button, ButtonLink, DescriptionList, Field, FieldGroup, Grid, Input, NumberField, PageStack, Panel, Prose, Section, Select, SwitchRow, Textarea } from '@content-ventures/design-system/v3';
import { PIPELINE_MODELS, pipelineDefaultEffort, pipelineModelEffortOptions, pipelineModelLabel, pipelineModelProvider, pipelineModelReasons, pipelineTokenLimit } from '@/domain/pipeline';
import type { PipelineDefinition, PipelineReasoningEffort, PipelineStep, PipelineView } from '@/domain/pipeline';
import { composeWritingPrompt, defaultWritingOrchestration, defaultWritingReviewCriteria, effectiveWritingReviewCriteria, writingOutputSchema, WRITING_REVIEW_CRITERIA_KEYS, WRITING_REVIEW_CRITERIA_LABELS, WRITING_INVARIANTS, WRITING_STAGES, WRITING_STAGE_LABELS } from '@/domain/writing-orchestration';
import type { WritingOrchestration, WritingStage } from '@/domain/writing-orchestration';
import { writingExecutionDate, writingTemporalContext } from '@/domain/writing-context';
import { effectiveWritingResearch } from '@/domain/writing-research';
import { WritingResearchControls } from './writing-research-controls';

const EFFORT_LABELS: Record<PipelineReasoningEffort, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };

const STAGE_PURPOSE: Record<WritingStage, string> = {
  plan: 'Organiza o conteúdo, escolhe o ângulo e registra fatos essenciais e pendências.',
  write: 'Redige título, linha fina e corpo como uma unidade, a partir do plano e das fontes.',
  review: 'Compara o artigo com as fontes e as regras editoriais. Volta após uma correção.',
  correct: 'Corrige os problemas encontrados e mantém o que já está sustentado.',
};

/** Outlet policy is edited in its own screens; these controls own the execution contracts. */
export function WritingOrchestrationEditor({ definition, providers, researchProviders, saving, onChange }: {
  definition: PipelineDefinition; providers: PipelineView['providers']; researchProviders?: PipelineView['researchProviders']; saving: boolean;
  onChange: (writing: WritingOrchestration) => void;
}) {
  const configuration = definition.writing ?? defaultWritingOrchestration();
  const [previewStage, setPreviewStage] = useState<WritingStage>('plan');
  const [previewContent, setPreviewContent] = useState('');
  const [previewRecordedOn, setPreviewRecordedOn] = useState('');
  const [previewExecutionDate, setPreviewExecutionDate] = useState(() => writingExecutionDate(new Date()));
  const patch = (value: Partial<WritingOrchestration>) => onChange({ ...configuration, ...value });
  const updateStage = (stage: WritingStage, value: Partial<PipelineStep>) => patch({ stages: {
    ...configuration.stages, [stage]: { ...configuration.stages[stage], ...value },
  } });
  const policy = definition.editorial;
  const reviewCriteria = effectiveWritingReviewCriteria(configuration);
  const research = effectiveWritingResearch(configuration);
  const preview = composeWritingPrompt(configuration, policy, previewStage, {
    source: previewContent ? [{ id: 'previa', text: previewContent }] : [],
    brief: { observacao: 'Prévia de composição. Os dados da produção e das etapas anteriores entram durante a execução.',
      ...(previewExecutionDate ? { temporalContext: writingTemporalContext(previewContent
        ? [{ id: 'previa', title: 'Conteúdo para prévia', recordedOn: previewRecordedOn }] : [], previewExecutionDate) } : {}),
    },
  });
  return <PageStack>
    <Panel><Section title="Fluxo da redação">
      <FieldGroup label="Orquestração" columns={1}>
        <SwitchRow label="Usar planejamento, redação e revisão" checked={configuration.enabled} disabled={saving}
          description="Depois de salvar, as próximas gerações de artigos usam este fluxo. A aprovação continua com uma pessoa."
          onCheckedChange={enabled => patch({ enabled })} />
        <Grid columns="1:1" collapseBelow={760} align="start">
          <Field label="Correção após a revisão" hint="Ao parar, as pendências e o texto produzido ficam nos detalhes da execução para análise.">
            {props => <Select {...props} value={String(configuration.maxCorrections)} disabled={saving}
              options={[{ value: '1', label: 'Corrigir uma vez e revisar' }, { value: '0', label: 'Parar e analisar pendências' }]}
              onChange={value => patch({ maxCorrections: Number(value) as 0 | 1 })} />}
          </Field>
          <Field label="Limite de conteúdo por geração" hint="Em caracteres. Acima do limite, a execução pede um recorte; não descarta trechos silenciosamente.">
            {props => <NumberField id={props.id} aria-describedby={props.describedBy} value={configuration.maxSourceCharacters}
              min={4000} max={200000} step={1000} disabled={saving}
              onChange={value => { if (value !== null) patch({ maxSourceCharacters: value }); }} />}
          </Field>
        </Grid>
        <Field label="Mínimo de citações diretas" hint="Padrão do formato usa a configuração da produção. Com 0, a escolha das falas segue o conteúdo e o guia.">
          {props => <Select {...props} value={configuration.minimumQuotes == null ? 'inherit' : String(configuration.minimumQuotes)} disabled={saving}
            options={[{ value: 'inherit', label: 'Padrão do formato' }, { value: '0', label: 'Sem mínimo obrigatório (0)' },
              ...[1, 2, 3, 4, 5].map(value => ({ value: String(value), label: `${value} ${value === 1 ? 'citação' : 'citações'}` }))]}
            onChange={value => patch({ minimumQuotes: value === 'inherit' ? null : Number(value) })} />}
        </Field>
      </FieldGroup>
    </Section></Panel>
    <Panel><Section title="Base editorial">
      <PageStack>
      <DescriptionList items={[
        { label: 'Mapa editorial', value: policy?.map.version ? `Versão ${policy.map.version}` : 'Ainda não configurado' },
        { label: 'Guia de escrita', value: policy?.guide.version ? `Versão ${policy.guide.version}` : 'Ainda não configurado' },
      ]} />
      <Grid columns="1:1" collapseBelow={760}>
        <ButtonLink href="/settings/editorial-map" variant="secondary">Editar mapa editorial</ButtonLink>
        <ButtonLink href="/settings/writing-guide" variant="secondary">Editar guia de escrita</ButtonLink>
      </Grid>
      <Prose variant="compact" measure="wide">Todas as etapas recebem o mapa, o guia e o conteúdo original. Cada execução guarda a versão usada.</Prose>
      <Field label="Instruções compartilhadas da redação" hint="Defina o trabalho comum às etapas. Voz, estrutura e regras do veículo pertencem ao guia de escrita.">
        {props => <Textarea id={props.id} aria-describedby={props.describedBy} value={configuration.systemPrompt} rows={5} maxLength={12000}
          disabled={saving} onChange={event => patch({ systemPrompt: event.target.value })} />}
      </Field>
      <Accordion items={[{ id: 'invariants', title: 'Regras de integridade obrigatórias', content: <Field label="Contrato de integridade">
        {props => <Textarea id={props.id} readOnly rows={8} value={WRITING_INVARIANTS} />}
      </Field> }]} />
      </PageStack>
    </Section></Panel>
    <Panel><Section title="Critérios da revisão e da correção">
      <PageStack>
        <Prose variant="compact" measure="wide">A revisão confere cada fato essencial e, após corrigir, cada apontamento anterior. Os critérios abaixo entram nos prompts; as verificações ficam registradas na execução.</Prose>
        <FieldGroup label="Critérios editoriais" columns={1}>
          {WRITING_REVIEW_CRITERIA_KEYS.map(key => <Field key={key} label={`Critério · ${WRITING_REVIEW_CRITERIA_LABELS[key]}`}>
            {props => <Textarea id={props.id} aria-describedby={props.describedBy} value={reviewCriteria[key]} rows={4} maxLength={4000}
              disabled={saving} onChange={event => patch({ reviewCriteria: { ...reviewCriteria, [key]: event.target.value } })} />}
          </Field>)}
        </FieldGroup>
        <Button variant="secondary" disabled={saving} onClick={() => patch({ reviewCriteria: defaultWritingReviewCriteria() })}>Restaurar critérios recomendados</Button>
      </PageStack>
    </Section></Panel>
    <WritingResearchControls settings={research} configured={researchProviders?.tavily} referenceUrls={policy?.guide.examples.map(example => example.url).filter(Boolean) ?? []}
      saving={saving} onChange={next => patch({ research: next })} />
    {WRITING_STAGES.map((stage, index) => {
      const step = configuration.stages[stage];
      const label = WRITING_STAGE_LABELS[stage];
      const provider = pipelineModelProvider(step.model);
      const unavailable = providers?.[provider] === false;
      const effortOptions = pipelineModelEffortOptions(step.model);
      const effort = step.effort ?? pipelineDefaultEffort(step.model);
      return <Panel key={stage}><Section title={`${index + 1}. ${label}`}>
        <PageStack>
          <Prose variant="compact" measure="wide">{STAGE_PURPOSE[stage]}</Prose>
          {stage === 'correct' && configuration.maxCorrections === 0 && <Prose variant="compact" measure="wide">Etapa desativada pela configuração de correção. Suas instruções ficam salvas.</Prose>}
          {unavailable && <Alert tone="warning" title="Provedor sem chave configurada">Escolha um provedor disponível antes de iniciar uma geração.</Alert>}
          <Field label={`Modelo · ${label}`}>
            {props => <Select {...props} value={step.model} disabled={saving}
              options={PIPELINE_MODELS.map(value => ({ value, label: pipelineModelLabel(value) }))}
              onChange={model => updateStage(stage, { model: model as PipelineStep['model'],
                maxTokens: Math.min(step.maxTokens, pipelineTokenLimit(model)),
                effort: pipelineModelEffortOptions(model).length ? pipelineDefaultEffort(model) : undefined,
                temperature: Math.min(step.temperature, pipelineModelProvider(model) === 'anthropic' ? 1 : 2) })} />}
          </Field>
          <Field label={`Instruções · ${label}`} hint="A tarefa recebe os dados da execução automaticamente; não é necessário repetir o mapa ou o guia.">
            {props => <Textarea id={props.id} aria-describedby={props.describedBy} value={step.prompt} rows={6} maxLength={20000}
              disabled={saving} onChange={event => updateStage(stage, { prompt: event.target.value })} />}
          </Field>
          <Button variant="secondary" aria-label={`Usar instrução recomendada · ${label}`} disabled={saving} onClick={() => updateStage(stage, { prompt: defaultWritingOrchestration().stages[stage].prompt })}>
            Usar instrução recomendada
          </Button>
          <Grid columns="1:1" collapseBelow={760} align="start">
            {effortOptions.length > 0
              ? <Field label={`Esforço de raciocínio · ${label}`}>
                {props => <Select {...props} value={effort ?? effortOptions[0]} disabled={saving}
                  options={effortOptions.map(value => ({ value, label: EFFORT_LABELS[value] }))}
                  onChange={value => updateStage(stage, { effort: value as PipelineReasoningEffort })} />}
              </Field>
              : pipelineModelReasons(step.model)
              ? <DescriptionList items={[{ label: 'Raciocínio', value: `${effort ? EFFORT_LABELS[effort] : 'Padrão do modelo'} · sem temperatura` }]} />
              : <Field label={`Temperatura · ${label}`}>
                {props => <NumberField id={props.id} aria-describedby={props.describedBy} value={step.temperature}
                  decimals={1} min={0} max={provider === 'anthropic' ? 1 : 2} step={0.1} disabled={saving}
                  onChange={value => { if (value !== null) updateStage(stage, { temperature: value }); }} />}
              </Field>}
            <Field label={`Limite de tokens · ${label}`} hint="Limite de saída do modelo, não a extensão desejada do artigo.">
              {props => <NumberField id={props.id} aria-describedby={props.describedBy} value={step.maxTokens}
                min={512} max={pipelineTokenLimit(step.model)} step={256} disabled={saving}
                onChange={value => { if (value !== null) updateStage(stage, { maxTokens: value }); }} />}
            </Field>
          </Grid>
          <Accordion items={[{ id: `contract-${stage}`, title: `Ver contrato de saída · ${label}`, content: <Field label={`Contrato de saída · ${label}`}>
            {props => <Textarea id={props.id} readOnly rows={10} value={JSON.stringify(writingOutputSchema(configuration, stage), null, 2)} />}
          </Field> }]} />
        </PageStack>
      </Section></Panel>;
    })}
    <Panel><Section title="Prévia do prompt composto">
      <PageStack>
        <Prose variant="compact" measure="wide">O formato, o tamanho e as demais orientações definidos na produção também entram no prompt real. Esta prévia mostra a composição das regras e da tarefa; os detalhes da execução preservam a entrada completa enviada ao modelo.</Prose>
        {research.enabled && <DescriptionList items={[{ label: 'Pesquisa na prévia', value: 'As orientações entram no planejamento. Consultas e fontes externas só existem após a execução; esta prévia não pesquisa na web.' }]} />}
        <Field label="Etapa da prévia">
          {props => <Select {...props} value={previewStage} options={WRITING_STAGES.map(value => ({ value, label: WRITING_STAGE_LABELS[value] }))}
            onChange={value => setPreviewStage(value as WritingStage)} />}
        </Field>
        <Field label="Conteúdo para prévia" hint="A prévia usa as alterações desta página. Não salva conteúdo nem faz uma chamada à IA.">
          {props => <Textarea id={props.id} aria-describedby={props.describedBy} rows={4} maxLength={20000} value={previewContent}
            onChange={event => setPreviewContent(event.target.value)} />}
        </Field>
        <FieldGroup label="Datas da prévia" columns={2}>
          <Field label="Data da fonte na prévia" hint="Opcional. Nas gerações, usa a data informada no conteúdo.">
            {props => <Input id={props.id} aria-describedby={props.describedBy} type="date" value={previewRecordedOn} onChange={event => setPreviewRecordedOn(event.target.value)} />}
          </Field>
          <Field label="Data de execução na prévia" hint="Simula quando a geração ocorre; não define a data da declaração.">
            {props => <Input id={props.id} aria-describedby={props.describedBy} type="date" value={previewExecutionDate} onChange={event => setPreviewExecutionDate(event.target.value)} />}
          </Field>
        </FieldGroup>
        <Accordion items={[
          { id: 'preview-system', title: 'Ver instruções efetivas', content: <Field label="Prévia do prompt de sistema">
            {props => <Textarea id={props.id} readOnly rows={12} value={preview.system} />}
          </Field> },
          { id: 'preview-input', title: 'Ver entrada composta', content: <Field label="Prévia da entrada">
            {props => <Textarea id={props.id} readOnly rows={10} value={preview.user} />}
          </Field> },
        ]} />
      </PageStack>
    </Section></Panel>
  </PageStack>;
}
