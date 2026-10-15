"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Accordion, Alert, Badge, Breadcrumb, Button, ButtonGroup, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, FieldGroup,
  MetaList, PageHeader, PageStack, Panel, Section, Select, Tabs, Timeline, toast,
} from '@content-ventures/design-system/v3';
import { RotateCw, Save } from '@content-ventures/design-system/v3/icons';
import { PIPELINE_STEP_KEYS, PIPELINE_STEP_LABELS, pipelineRevision, validatePipelineTemplates, pipelineModelLabel, withArticleAssist } from '@/domain/pipeline';
import type { PipelineDefinition, PipelineStepKey, PipelineView } from '@/domain/pipeline';
import { useRuntime } from '@/state';
import { useBreadcrumb, useLeaveGuard } from '@/ui/shell';
import { useMediaQuery } from '@/ui/use-media-query';
import { PipelineCatalog, promptChanged, type PromptKey } from './pipeline-catalog';
import { PipelineWorkers } from './pipeline-workers';
import { PIPELINE_WORKERS, type PipelineWorkerKey } from '@/domain/pipeline-workers';
import { PipelineEditor } from './pipeline-editor';

const RUN_STATUS: Record<string, string> = { completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada', running: 'Em andamento', queued: 'Na fila' };
const savedDate = (date: string | null) => date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : 'Configuração inicial';
const PAGE_TABS = { workers: 'Workers', prompts: 'Todos os prompts', history: 'Histórico', runs: 'Execuções' };
type PageTab = keyof typeof PAGE_TABS;

export function PipelineScreen() {
  const { runtime,error: runtimeError } = useRuntime();
  const port = runtime?.pipeline;
  const router = useRouter();
  const narrow = useMediaQuery('(max-width: 640px)');
  const [view,setView] = useState<PipelineView>();
  const [draft,setDraft] = useState<PipelineDefinition>();
  const [tab,setTab] = useState<PromptKey>('outline');
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const pageTab: PageTab = requestedTab && Object.hasOwn(PAGE_TABS, requestedTab) ? requestedTab as PageTab : 'workers';
  const currentWorker = pageTab === 'workers' ? PIPELINE_WORKERS.find(item => item.key === searchParams.get('worker')) : undefined;
  const worker = currentWorker?.key;
  function navigate(nextTab: PageTab, nextWorker?: PipelineWorkerKey) {
    const query = new URLSearchParams(window.location.search);
    query.delete('tab'); query.delete('worker');
    if (nextTab !== 'workers') query.set('tab', nextTab);
    if (nextWorker) query.set('worker', nextWorker);
    const href = query.size ? `/config?${query}` : '/config';
    if (href !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, '', href);
  }
  useBreadcrumb(currentWorker
    ? [{ label: 'Prompts', href: '/config' }, { label: currentWorker.title }]
    : pageTab !== 'workers' ? [{ label: 'Prompts', href: '/config' }, { label: PAGE_TABS[pageTab] }] : [{ label: 'Prompts' }]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<'active' | string>();
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
  useLeaveGuard(dirty || saving, href => {
    // Internal tabs and breadcrumbs keep this screen mounted, including its draft.
    if (new URL(href, window.location.origin).pathname === '/config') router.push(href);
    else setExitTo(href);
  });
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
  if (runtimeError || (failure && !view)) return <ErrorState heading="h1" title="Não foi possível abrir os prompts" description={failure ?? runtimeError?.message} onRetry={() => void load()} size="page" />;
  if (runtime && !port) return <ErrorState heading="h1" title="Prompts disponíveis no motor conectado" description="Esta sessão usa a antiga simulação do front-end." size="page" />;
  if (!view || !draft) return <PageStack><PageHeader title="Prompts" /><Panel><Section title="Carregando prompts"><DescriptionList items={[]} loading /></Section></Panel></PageStack>;

  const changed = (['system', ...PIPELINE_STEP_KEYS] as PromptKey[]).filter(key => promptChanged(key, draft, view.active.definition));
  const flowChanged = draft.articleMode !== view.active.definition.articleMode || draft.curateQuotes !== view.active.definition.curateQuotes;
  function reset(target: string) {
    if (!view) return;
    const definition = target === 'active' ? view.active.definition : view.history.find(revision => String(revision.revision) === target)?.definition;
    if (definition) {
      setDraft(withArticleAssist(structuredClone({ ...definition, steps: { ...view.active.definition.steps, ...definition.steps } })));
      setFailure(undefined);
      if (target !== 'active') toast(`Revisão ${target} carregada para edição`, { description: 'Salve e ative para usá-la nas próximas gerações.' });
    }
    setResetTarget(undefined);
  }
  return <>
    <PageStack>
      {narrow && currentWorker && <Breadcrumb variant="compact" items={[{ label: 'Prompts', href: '/config' }, { label: currentWorker.title }]} />}
      <PageHeader title={currentWorker?.title ?? 'Prompts'}
        description={currentWorker?.description ?? 'Gerencie os workers, edite seus prompts e acompanhe as execuções.'}
        status={<Badge tone={dirty ? 'amber' : 'gray'}>{dirty ? 'Alterações não ativadas' : `Revisão ${view.active.revision} ativa`}</Badge>}
        actions={currentWorker ? <ButtonGroup label="Configuração">
          {dirty && <Button disabled={saving} onClick={() => setResetTarget('active')}>Descartar alterações</Button>}
          <Button icon={RotateCw} disabled={saving || loading || dirty} onClick={() => void load()}>Recarregar</Button>
          <Button variant="primary" icon={Save} loading={saving} disabled={!dirty || Boolean(templateError)} onClick={() => void save()}>Salvar e ativar</Button>
        </ButtonGroup> : undefined} />
      {failure && <Alert tone="danger" title="Não foi possível salvar">{failure}</Alert>}
      {templateError && <Alert tone="danger" title="Revise as variáveis do prompt">{templateError}</Alert>}
      <Tabs label="Gerenciar prompts" value={pageTab} onChange={value => navigate(value)} items={[
        { value: 'workers', label: 'Workers', count: PIPELINE_WORKERS.length }, { value: 'prompts', label: 'Todos os prompts', count: PIPELINE_STEP_KEYS.length + 1 },
        { value: 'history', label: 'Histórico', count: view.history.length }, { value: 'runs', label: 'Execuções', count: view.runs.length },
      ]} />
      {dirty && <MetaList items={[`${changed.length} ${changed.length === 1 ? 'prompt alterado' : 'prompts alterados'}`, ...(flowChanged ? ['Fluxo alterado'] : [])]} />}
      {pageTab === 'prompts' && <PipelineCatalog draft={draft} active={view.active.definition} onEdit={key => { setTab(key); setEditorOpen(true); }} />}
      {pageTab === 'workers' && <PipelineWorkers worker={worker} onSelect={value => navigate('workers', value)} draft={draft} active={view.active.definition}
        saving={saving} onUpdate={update} onEdit={key => { setTab(key); setEditorOpen(true); }} />}
      {pageTab === 'history' && <Panel><Section title="Histórico de configurações" meta={`Revisão ${view.active.revision} ativa`}>
        <PageStack>
          <DescriptionList items={[{ label: 'Ativada em', value: savedDate(view.active.savedAt) }]} />
          {view.history.length ? <FieldGroup label="Recuperar uma revisão" hint="Carregar uma revisão não a ativa. Você pode editar e depois salvar como uma nova revisão." columns={1}>
            <Field label="Revisão anterior">{props => <Select {...props} value={historyRevision} onChange={setHistoryRevision}
              options={[...view.history].reverse().map(revision => ({ value: String(revision.revision), label: `Revisão ${revision.revision} · ${savedDate(revision.savedAt)}` }))}
              disabled={saving} placeholder="Selecione uma revisão" />}</Field>
            <Button disabled={!historyRevision || saving} onClick={() => dirty ? setResetTarget(historyRevision) : reset(historyRevision)}>Carregar para edição</Button>
          </FieldGroup> : <EmptyState size="inline" title="Nenhuma revisão anterior" />}
        </PageStack>
      </Section></Panel>}
      {pageTab === 'runs' && <Panel><Section title="Execuções da IA">
        {view.runs.length ? <Accordion items={view.runs.map(run => ({ id: run.runId, title: run.label,
          meta: `Revisão ${run.pipelineRevision} · ${RUN_STATUS[run.status] ?? run.status}`, content: <PageStack>
            <Timeline variant="dots" label="Etapas executadas" items={run.calls.map((call, index) => ({ id: `${call.hash}-${index}`,
              title: PIPELINE_STEP_LABELS[call.key] + (call.index === undefined ? '' : ` · ${call.index + 1}`),
              description: `${pipelineModelLabel(call.model)}${call.cached ? ' · resultado reutilizado' : ''}${call.errorCode ? ' · ' + call.errorCode : ''}`,
              state: call.status === 'completed' ? 'done' : call.status === 'failed' ? 'blocked' : 'current',
              date: call.status === 'completed' ? 'Respondida' : call.status === 'failed' ? 'Falhou' : 'Aguardando resposta',
            }))} />
            <Accordion items={[{ id: 'technical', title: 'Identificadores técnicos', content: <DescriptionList items={[
              { label: 'Execução', value: run.runId }, { label: 'Configuração', value: run.pipelineHash },
            ]} /> }]} />
          </PageStack> }))} /> : <EmptyState size="inline" title="Nenhuma execução registrada" />}
      </Section></Panel>}
    </PageStack>
    {editorOpen && <PipelineEditor promptKey={tab} draft={draft} view={view} saving={saving} dirty={dirty} invalid={Boolean(templateError)} error={templateError ?? failure}
      onClose={() => setEditorOpen(false)} onUpdate={update} onUpdateStep={updateStep} onSave={() => void save()} />}
    <ConfirmDialog open={Boolean(resetTarget)} onClose={() => setResetTarget(undefined)} title={resetTarget === 'active' ? 'Descartar as alterações?' : 'Substituir as alterações pela revisão selecionada?'}
      description="As alterações ainda não ativadas serão descartadas. A configuração ativa permanece a mesma." confirmLabel={resetTarget === 'active' ? 'Descartar alterações' : 'Carregar revisão'} cancelLabel="Continuar editando" tone="danger"
      onConfirm={() => { if (resetTarget) reset(resetTarget); }} />
    <ConfirmDialog open={Boolean(exitTo)} onClose={() => setExitTo(undefined)} title="Sair sem ativar os prompts?" description="As alterações desta página ainda não foram salvas. A configuração ativa continua a mesma." confirmLabel="Descartar e sair" cancelLabel="Continuar editando" tone="danger" onConfirm={() => { departing.current = true; const href = exitTo; setExitTo(undefined); if (href) router.push(href); }} />
  </>;
}
