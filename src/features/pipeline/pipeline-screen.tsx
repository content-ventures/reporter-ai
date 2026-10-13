'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Accordion, Badge, Button, ButtonGroup, ConfirmDialog, DescriptionList, ErrorState, Field, FieldGroup, List, ListItem,
  MetaList, NumberField, PageHeader, PageStack, Panel, Section, Select, SplitLayout, SwitchRow,
  Tabs, Textarea, Timeline, toast, type TimelineEntry,
} from '@content-ventures/design-system/v3';
import { RotateCw, Save } from '@content-ventures/design-system/v3/icons';
import { PIPELINE_MODELS, PIPELINE_SCHEMAS, PIPELINE_STEP_KEYS, PIPELINE_STEP_LABELS, pipelineRevision, validatePipelineTemplates, pipelineModelLabel, pipelineModelProvider, pipelineModelReasons, pipelineTokenLimit, TEXT_PROVIDER_LABELS, withArticleAssist } from '@/domain/pipeline';
import type { PipelineDefinition, PipelineStepKey, PipelineView } from '@/domain/pipeline';
import { useRuntime } from '@/state';
import { useLeaveGuard } from '@/ui/shell';

type Tab = 'system' | PipelineStepKey;
const TAB_LABELS = { material: 'Material',facts: 'Fonte',outline: 'Outline',quotes: 'Evidências',intro: 'Introdução',section: 'Seções',article: 'Artigo completo',assist: 'Assistente',images: 'Imagens',carousel: 'Carrossel' };
const TAB_ITEMS = [{ value: 'system' as const,label: 'Sistema' },...PIPELINE_STEP_KEYS.map(value => ({ value,label: TAB_LABELS[value] }))];
const modelOptions = PIPELINE_MODELS.map(value => ({ value,label: pipelineModelLabel(value) }));
const VARIABLE_LABELS = {
  source: 'Fonte autorizada com ids de evidência',brief: 'Pauta e número de seções',sizing: 'Orçamentos e limite de caracteres',
  outline: 'Estrutura proposta ou revisada',section: 'Seção atual ou ação e alvos do assistente',history: 'Texto realmente escrito até agora',
  futureSections: 'Seções ainda não redigidas',layouts: 'Slots e limites do modelo visual',approvedArticle: 'Versão exata do artigo aprovado',
};
const RUN_STATUS: Record<string,string> = { completed: 'Concluída',failed: 'Falhou',cancelled: 'Cancelada',running: 'Em andamento',queued: 'Na fila' };

function orchestration(definition: PipelineDefinition): TimelineEntry[] {
  const titles = [
    ['Arquivo e transcrição', 'Groq Whisper; arquivos de texto são importados.'],
    ['Identificar tema e participantes', 'Título interno e apresentações com evidência textual. Não identifica vozes; a pessoa confirma os dados.'],
    ['Preparar fonte', 'O prompt de fontes longas é executado somente quando precisa dividir o material.'],
    ['Criar outline', 'Pauta e evidências da transcrição.'],
    ...(definition.curateQuotes ? [['Selecionar evidências e citações', 'Curadoria por parte, sem inventar falas.']] : []),
    ['Revisar estrutura', 'Decisão da pessoa na interface de criação.'],
    ...(definition.articleMode === 'sequential'
      ? [['Escrever introdução', 'Até três parágrafos.'], ['Escrever cada seção', 'Repete conforme a pauta; recebe o texto anterior e as seções futuras.']]
      : [['Escrever artigo completo', 'Uma chamada com a estrutura revisada; no máximo uma revisão com a contagem real para buscar a meta superior.']]),
    ['Validar saída', 'JSON, estrutura, 2.500–4.000 caracteres, 500–800 palavras e ao menos duas citações literais distintas, conferidas nas evidências. Não substitui revisão factual humana.'],
    ['Buscar imagens', 'A IA planeja capa e até duas fotos no corpo; o motor busca no Pixabay e guarda os originais de pelo menos 2400 × 1350 px. Fotos são ilustrativas e precisam de revisão. Sem acesso ao original, preserva o artigo e informa o impedimento.'],
    ['Guardar citações', 'Falas literais usadas no artigo entram no banco com sua versão da transcrição. Autoria e relevância precisam de conferência editorial.'],
    ['Editar com o assistente', 'Encurtar, reescrever e pedir ajustes: propostas validadas, sem alterar o rascunho até você aceitar.'],
    ['Revisar e aprovar artigo', 'Aprovação manual de uma versão exata.'],
    ['Escrever carrossel', 'Somente o artigo aprovado e os slots do modelo visual.'],
  ];
  return titles.map(([title,description],index) => ({ id: String(index),title,description,state: 'upcoming' }));
}

export function PipelineScreen() {
  const { runtime,error: runtimeError } = useRuntime();
  const port = runtime?.pipeline;
  const router = useRouter();
  const [view,setView] = useState<PipelineView>();
  const [draft,setDraft] = useState<PipelineDefinition>();
  const [tab,setTab] = useState<Tab>('outline');
  const [failure,setFailure] = useState<string>();
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [historyRevision,setHistoryRevision] = useState('');
  const [exitTo,setExitTo] = useState<string>();
  const departing = useRef(false);
  const dirty = Boolean(view && draft && pipelineRevision(draft).hash !== view.active.hash);
  const templateError = draft ? validatePipelineTemplates(draft) : undefined;
  const load = useCallback(async () => {
    if (!port) return;
    setLoading(true); setFailure(undefined);
    try { const next = await port.get(); setView(next); setDraft(withArticleAssist(next.active.definition)); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível carregar os prompts.'); }
    finally { setLoading(false); }
  },[port]);
  useEffect(() => {
    if (!port) return;
    let live = true;
    void port.get().then(next => {
      if (live) { setView(next); setDraft(withArticleAssist(next.active.definition)); }
    }).catch(error => { if (live) setFailure(error instanceof Error ? error.message : 'Não foi possível carregar os prompts.'); });
    return () => { live = false; };
  },[port]);
  // Refresh run traces without replacing unsaved prompts or advancing their optimistic base.
  useEffect(() => {
    if (!port) return;
    let live = true,reading = false;
    const timer = window.setInterval(() => {
      if (reading) return; reading = true;
      void port.get().then(next => { if (live) setView(previous => previous ? { ...previous,runs: next.runs } : previous); }).catch(() => {}).finally(() => { reading = false; });
    },3000);
    return () => { live = false; window.clearInterval(timer); };
  },[port]);
  useLeaveGuard(dirty || saving,href => setExitTo(href));
  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => { if (!departing.current) event.preventDefault(); };
    window.addEventListener('beforeunload',guard);
    return () => window.removeEventListener('beforeunload',guard);
  },[dirty,saving]);

  async function save() {
    if (!port || !view || !draft || saving) return;
    setSaving(true); setFailure(undefined);
    try {
      const result = await port.save(draft,view.active.revision);
      if (!result.ok) { setFailure(result.refusal.message); return; }
      setView(result.value); setDraft(structuredClone(result.value.active.definition));
      toast(`Configuração ativada · revisão ${result.value.active.revision}`);
    } catch { setFailure('Não foi possível ativar a configuração. Seus prompts continuam nesta página.'); }
    finally { setSaving(false); }
  }
  const update = (patch: Partial<PipelineDefinition>) => setDraft(previous => previous ? { ...previous,...patch } : previous);
  const updateStep = (patch: Partial<PipelineDefinition['steps'][PipelineStepKey]>) => {
    if (tab === 'system') return;
    setDraft(previous => previous ? { ...previous,steps: { ...previous.steps,[tab]: { ...previous.steps[tab],...patch } } } : previous);
  };
  if (runtimeError || (failure && !view)) return <ErrorState heading="h1" title="Não foi possível abrir a configuração" description={failure ?? runtimeError?.message} onRetry={() => void load()} size="page" />;
  if (runtime && !port) return <ErrorState heading="h1" title="Configuração disponível no motor conectado" description="Esta sessão usa a antiga simulação do front-end." size="page" />;
  if (!view || !draft) return <PageStack><PageHeader title="Engenharia de prompts" /><Panel><Section title="Configuração"><List label="Carregamento"><ListItem title={loading ? 'Carregando prompts do servidor…' : 'Conectando ao motor…'} /></List></Section></Panel></PageStack>;

  const selected = tab === 'system' ? undefined : draft.steps[tab];
  const inactive = tab === 'quotes' && !draft.curateQuotes || tab === 'article' && draft.articleMode === 'sequential'
    || (tab === 'intro' || tab === 'section') && draft.articleMode === 'single';
  const schema = tab === 'system' ? undefined : tab === 'carousel'
    ? 'O schema é calculado com os layouts da produção: slides com chaves numéricas, slots exatos do modelo e sourceBlockIds do artigo aprovado. Os limites de cada slot fazem parte desse schema.'
    : JSON.stringify(PIPELINE_SCHEMAS[tab],null,2);
  return (
    <>
      <PageStack>
        <PageHeader title="Engenharia de prompts" description="Salve para ativar nas próximas gerações. Execuções em andamento mantêm a revisão com que começaram."
          status={<Badge tone={dirty ? 'amber' : 'gray'}>{dirty ? 'Alterações não ativadas' : `Revisão ${view.active.revision} ativa`}</Badge>}
          actions={<ButtonGroup label="Configuração"><Button variant="primary" icon={Save} loading={saving} disabled={!dirty || Boolean(templateError)} onClick={() => void save()}>Salvar e ativar</Button><Button icon={RotateCw} disabled={saving || loading || dirty} onClick={() => void load()}>Recarregar</Button></ButtonGroup>} />
        <SplitLayout asideLabel="Variáveis e contrato" main={
          <>
            <Panel padding="lg">
              <Section title="Execução">
                <FieldGroup label="Orquestração" columns={1} error={failure}>
                  <Field label="Redação do artigo">{props => <Select {...props} value={draft.articleMode} disabled={saving} onChange={value => update({ articleMode: value as PipelineDefinition['articleMode'] })} options={[{ value: 'sequential',label: 'Por introdução e seções (base Make)' },{ value: 'single',label: 'Artigo completo em uma chamada' }]} />}</Field>
                  <SwitchRow label="Fazer curadoria antes de revisar o outline" checked={draft.curateQuotes} onCheckedChange={curateQuotes => update({ curateQuotes })} disabled={saving} />
                  <Accordion items={[{ id: 'sequence',title: dirty ? 'Ver sequência do rascunho' : 'Ver sequência ativa',content: <Timeline variant="dots" label="Sequência do fluxo" items={orchestration(draft)} /> }]} />
                </FieldGroup>
              </Section>
              <Section title="Prompts">
                <Tabs<Tab> label="Etapas da engenharia de prompts" items={TAB_ITEMS} value={tab} onChange={setTab} />
                {inactive && <MetaList items={['Etapa não executada no modo selecionado. O prompt fica salvo para quando ela for ativada.']} />}
                <FieldGroup label={tab === 'system' ? 'Mensagem compartilhada' : PIPELINE_STEP_LABELS[tab]} columns={1} error={templateError}>
                  {selected && <FieldGroup label={TEXT_PROVIDER_LABELS[pipelineModelProvider(selected.model)]} columns={3}>
                    <Field label="Modelo" error={view.providers?.[pipelineModelProvider(selected.model)] === false ? 'Configure a chave deste provedor no servidor.' : undefined}>{props => <Select {...props} value={selected.model} options={modelOptions} disabled={saving} onChange={model => updateStep({ model: model as typeof selected.model, temperature: Math.min(selected.temperature, pipelineModelProvider(model) === 'anthropic' ? 1 : 2) })} />}</Field>
                    {pipelineModelReasons(selected.model) ? <DescriptionList items={[{ label: 'Raciocínio',value: 'Baixo · sem temperatura' }]} /> : <Field label="Temperatura">{props => <NumberField id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={selected.temperature} decimals={1} min={0} max={pipelineModelProvider(selected.model) === 'anthropic' ? 1 : 2} step={0.1} disabled={saving} onChange={value => { if (value !== null) updateStep({ temperature: value }); }} />}</Field>}
                    <Field label="Máximo de tokens" hint={pipelineModelReasons(selected.model) ? 'Inclui o raciocínio e o texto produzido.' : undefined}>{props => <NumberField id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={selected.maxTokens} min={512} max={pipelineTokenLimit(selected.model)} step={256} disabled={saving} onChange={value => { if (value !== null) updateStep({ maxTokens: value }); }} />}</Field>
                  </FieldGroup>}
                  <Field label={tab === 'system' ? 'Mensagem de sistema' : 'Prompt da etapa'} hint={tab === 'system' ? 'Enviada exatamente como escrita, sem prefixo oculto.' : 'As variáveis são substituídas pelos dados reais da produção; não há outro prompt editorial acrescentado.'}>
                    {props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={14} value={selected?.prompt ?? draft.systemPrompt} disabled={saving} maxLength={selected ? 20000 : 12000} onChange={event => selected ? updateStep({ prompt: event.target.value }) : update({ systemPrompt: event.target.value })} />}
                  </Field>
                  {schema && <Accordion items={[{ id: 'output',title: 'Ver contrato de saída',content: <Field label="Formato esperado pelo motor">{props => <Textarea id={props.id} readOnly rows={8} value={schema} />}</Field> }]} />}
                </FieldGroup>
              </Section>
            </Panel>
            <Panel padding="lg"><Section title="Revisões" meta={`${view.history.length} anteriores`}>
              <FieldGroup label="Recuperar configuração" columns={1}>
                <Field label="Revisão anterior">{props => <Select {...props} value={historyRevision} onChange={setHistoryRevision} options={[...view.history].reverse().map(revision => ({ value: String(revision.revision),label: `Revisão ${revision.revision} · #${revision.hash.slice(0,8)}` }))} disabled={!view.history.length || saving} placeholder="Selecione uma revisão" />}</Field>
                <Button disabled={!historyRevision || saving} onClick={() => { const selected = view.history.find(revision => String(revision.revision) === historyRevision); if (selected) setDraft(structuredClone({ ...selected.definition,steps: { ...view.active.definition.steps,...selected.definition.steps } })); }}>Carregar como rascunho</Button>
                {dirty && <Button disabled={saving} onClick={() => { setDraft(structuredClone(view.active.definition)); setFailure(undefined); }}>Descartar alterações</Button>}
              </FieldGroup>
            </Section></Panel>
            <Panel padding="lg"><Section title="Execuções reais" meta="Revisão e chamadas usadas pelo worker">
              {view.runs.length ? <Accordion items={view.runs.map(run => ({ id: run.runId,title: run.label,meta: `v${run.pipelineRevision} · ${RUN_STATUS[run.status] ?? run.status}`,content: <>
                <MetaList items={[`Execução ${run.runId}`,`Configuração v${run.pipelineRevision} · #${run.pipelineHash.slice(0,8)}`]} />
                <Timeline variant="dots" label="Chamadas da execução" items={run.calls.map(call => ({ id: call.hash,title: PIPELINE_STEP_LABELS[call.key]+(call.index === undefined ? '' : ` · ${call.index+1}`),
                  description: `${call.model} · #${call.hash.slice(0,8)}${call.cached ? ' · checkpoint reutilizado' : ''}${call.errorCode ? ' · '+call.errorCode : ''}`,state: call.status === 'completed' ? 'done' : call.status === 'failed' ? 'blocked' : 'current',date: call.status === 'completed' ? 'Respondida' : call.status === 'failed' ? 'Falhou' : 'Aguardando resposta' }))} />
              </> }))} /> : <List label="Execuções"><ListItem title="Nenhuma geração com a configuração versionada ainda." /></List>}
            </Section></Panel>
          </>
        } aside={
          <Panel>
            <Section title="Variáveis"><List label="Variáveis dos prompts">{Object.entries(VARIABLE_LABELS).map(([key,description]) => <ListItem key={key} title={`{{${key}}}`} description={description} />)}</List></Section>
            <Section title="Contrato do motor"><DescriptionList labelWidth={100} items={[{ label: 'Fonte',value: 'Transcrição autorizada' },{ label: 'Corpo',value: '2.500–4.000 caracteres com espaços · 500–800 palavras' },{ label: 'Meta',value: '3.900 caracteres · cerca de 700 palavras, sem repetição' },{ label: 'Citações',value: 'Mínimo de 2 distintas, literais e referenciadas. Sem atribuir vozes não identificadas.' },{ label: 'Validação',value: 'Obrigatória antes de salvar. Alterar o prompt não desativa essas regras.' },{ label: 'Aprovação',value: 'Manual, por versão' },{ label: 'Carrossel',value: 'Somente artigo aprovado' },{ label: 'Chave da API',value: 'Somente no servidor' }]} /></Section>
          </Panel>
        } />
      </PageStack>
      <ConfirmDialog open={Boolean(exitTo)} onClose={() => setExitTo(undefined)} title="Sair sem ativar os prompts?" description="As alterações desta página ainda não foram salvas. A configuração ativa continua a mesma." confirmLabel="Descartar e sair" cancelLabel="Continuar editando" tone="danger" onConfirm={() => { departing.current = true; const href = exitTo; setExitTo(undefined); if (href) router.push(href); }} />
    </>
  );
}
