"use client";
import {workspaceAddress} from '@/domain/workspace-address';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {
  AccessState, Accordion, Alert, Badge, Button, ButtonGroup, ButtonLink, ConfirmDialog, DescriptionList, Drawer, EmptyState, ErrorState, Field, FieldGroup,
  MetaList, PageHeader, PageStack, Panel, Prose, ResponsiveDialog, Section, Select, Tabs, Timeline, focusField, toast,
} from '@content-ventures/design-system/v3';
import { RotateCw, Save } from '@content-ventures/design-system/v3/icons';
import { PIPELINE_STEP_LABELS, compactFunnels, pipelineRevision, validatePipelineTemplates, pipelineModelLabel, withArticleAssist, withFormatFunnels } from '@/domain/pipeline';
import type { PipelineDefinition, PipelineStepKey, PipelineView } from '@/domain/pipeline';
import type { WritingRunDetails as RunDetails } from '@/ports/pipeline-settings';
import { useCan, useRuntime, useSession } from '@/state';
import { useBreadcrumb, useLeaveGuard } from '@/ui/shell';
import { NEW_PRODUCTION_HREF, pieceHref } from '@/ui/routes';
import { useMediaQuery } from '@/ui/use-media-query';
import { PipelineCatalog, PROMPTS, promptChanged, withPromptStep, type PromptKey } from './pipeline-catalog';
import { WritingOrchestrationEditor } from './writing-orchestration-editor';
import { WritingRunDetails } from './writing-run-details';

/** What the page edits: the saved definition with the stages and funnels added after it was saved. */
const editable = (definition: PipelineDefinition) => withFormatFunnels(withArticleAssist(definition));
import { PipelineWorkers } from './pipeline-workers';
import { PIPELINE_WORKERS, type PipelineWorkerKey } from '@/domain/pipeline-workers';
import { PipelineEditor } from './pipeline-editor';
import { PresetUpgrade } from './preset-upgrade';
import { upgradePreset } from '@/domain/pipeline-preset';

const RUN_STATUS: Record<string, string> = { completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada', running: 'Em andamento', queued: 'Na fila' };
const savedDate = (date: string | null) => date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : 'Configuração inicial';
const PAGE_TABS = { workers: 'Workers', writing: 'Redação', prompts: 'Todos os prompts', history: 'Histórico', runs: 'Execuções' };
type PageTab = keyof typeof PAGE_TABS;
/** The panel of a page tab; its tab is `${panelId}-tab` (Design System Tabs). */
const panelId = (tab: PageTab) => `pipeline-${tab}`;

/** Prompts are admin-only (the server refuses the save too): a deep link answers AccessState. */
export function PipelineScreen() {
  const session = useSession();
  const edits = useCan('pipeline.edit');
  if (!session.data) return null;
  if (!edits&&!session.data.current?.roles.includes('admin')) return <AccessState kind="restricted" heading="h1" title="Prompts restritos a administradores" />;
  return <PipelineConfig readOnly={!edits} />;
}

function PipelineConfig({readOnly}:{readOnly:boolean}) {
  const workspaceHrefFor = useWorkspaceHref();
  const { runtime,error: runtimeError } = useRuntime();
  const port = runtime?.pipeline;
  const router = useRouter();
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
    if (href !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, '', workspaceHrefFor(href));
  }
  useBreadcrumb(currentWorker
    ? [{ label: 'Prompts', href: '/config' }, { label: currentWorker.title }]
    : pageTab !== 'workers' ? [{ label: 'Prompts', href: '/config' }, { label: PAGE_TABS[pageTab] }] : [{ label: 'Prompts' }]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string>();
  const [resetTarget, setResetTarget] = useState<'active' | string>();
  const [failure,setFailure] = useState<string>();
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [historyRevision,setHistoryRevision] = useState('');
  const [exitTo,setExitTo] = useState<string>();
  const departing = useRef(false);
  // Applying preset 3.0 removes its banner and drawer together; focus then goes to the open tab, not to the page body.
  const focusTab = useRef(false);
  useEffect(() => {
    if (!focusTab.current) return;
    focusTab.current = false;
    focusField(`${panelId(pageTab)}-tab`);
  },[view,pageTab]);
  const dirty = Boolean(view && draft && pipelineRevision(compactFunnels(draft)).hash !== pipelineRevision(compactFunnels(view.active.definition)).hash);
  const templateError = draft ? validatePipelineTemplates(draft) : undefined;
  const load = useCallback(async () => {
    if (!port) return;
    setLoading(true); setFailure(undefined);
    try { const next = await port.get(); setView(next); setDraft(editable(next.active.definition)); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível carregar os prompts.'); }
    finally { setLoading(false); }
  },[port]);
  useEffect(() => {
    if (!port) return;
    let live = true;
    void port.get().then(next => {
      if (live) { setView(next); setDraft(editable(next.active.definition)); }
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
    if ((workspaceAddress(new URL(href, window.location.origin).pathname)?.path??new URL(href, window.location.origin).pathname) === '/config') router.push(href);
    else setExitTo(href);
  });
  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => { if (!departing.current) event.preventDefault(); };
    window.addEventListener('beforeunload',guard);
    return () => window.removeEventListener('beforeunload',guard);
  },[dirty,saving]);

  async function save() {
    if (readOnly || !port || !view || !draft || saving) return;
    setSaving(true); setFailure(undefined);
    try {
      const result = await port.save(compactFunnels(draft),view.active.revision);
      if (!result.ok) { setFailure(result.refusal.message); return; }
      setView(result.value); setDraft(editable(result.value.active.definition));
      toast(`Configuração ativada · revisão ${result.value.active.revision}`);
    } catch { setFailure('Não foi possível ativar a configuração. Seus prompts continuam nesta página.'); }
    finally { setSaving(false); }
  }
  /** Saves the active revision with every untouched prompt on preset 3.0, as a new revision. */
  async function applyPreset(): Promise<boolean> {
    if (readOnly || !port || saving) return false;
    setSaving(true); setFailure(undefined);
    try {
      // Upgrade what is active now, not what this page loaded: another tab may have saved since.
      const fresh = await port.get();
      const { next, updated, added } = upgradePreset(fresh.active.definition);
      if (!updated.length && !added.length) { focusTab.current = true; setView(fresh); setDraft(editable(fresh.active.definition)); return true; }
      const result = await port.save(next, fresh.active.revision);
      if (!result.ok) { setFailure(result.refusal.message); return false; }
      focusTab.current = true;
      setView(result.value); setDraft(editable(result.value.active.definition));
      toast(`Prompts 3.0 ativados · revisão ${result.value.active.revision}`, { description: 'A revisão anterior está no Histórico.' });
      return true;
    } catch {
      setFailure('Não foi possível ativar os prompts 3.0. A configuração ativa continua a mesma.');
      return false;
    } finally { setSaving(false); }
  }
  const update = (patch: Partial<PipelineDefinition>) => setDraft(previous => previous ? { ...previous,...patch } : previous);
  const updateStep = (patch: Partial<PipelineDefinition['steps'][PipelineStepKey]>) => {
    if (tab === 'system') return;
    setDraft(previous => previous ? withPromptStep(previous,tab,patch) : previous);
  };
  const refreshRuns = async () => {
    if (!port) return;
    const next = await port.get();
    setView(previous => previous ? { ...previous, runs: next.runs } : previous);
  };
  if (runtimeError || (failure && !view)) return <ErrorState heading="h1" title="Não foi possível abrir os prompts" description={failure ?? runtimeError?.message} onRetry={() => void load()} size="page" />;
  if (runtime && !port) return <ErrorState heading="h1" title="Prompts disponíveis no motor conectado" description="Esta sessão usa a antiga simulação do front-end." size="page" />;
  if (!view || !draft) return <PageStack><PageHeader title="Prompts" /><Panel><Section title="Carregando prompts"><DescriptionList items={[]} loading /></Section></Panel></PageStack>;

  // Saved revisions keep only edited funnel steps: compare against the defaults filled in.
  const active = editable(view.active.definition);
  const changed = (Object.keys(PROMPTS) as PromptKey[]).filter(key => promptChanged(key, draft, active));
  const flowChanged = draft.articleMode !== view.active.definition.articleMode || draft.curateQuotes !== view.active.definition.curateQuotes;
  const writingChanged = JSON.stringify(draft.writing) !== JSON.stringify(active.writing);
  function reset(target: string) {
    if (!view) return;
    const definition = target === 'active' ? view.active.definition : view.history.find(revision => String(revision.revision) === target)?.definition;
    if (definition) {
      // This screen restores task prompts; editorial policies are owned by their settings pages.
      setDraft(editable(structuredClone({ ...definition, editorial: view.active.definition.editorial,
        steps: { ...view.active.definition.steps, ...definition.steps } })));
      setFailure(undefined);
      if (target !== 'active') toast(`Revisão ${target} carregada para edição`, { description: 'Salve e ative para usá-la nas próximas gerações.' });
    }
    setResetTarget(undefined);
  }
  return <>
    <PageStack>
      <PageHeader title={pageTab === 'writing' ? 'Redação' : currentWorker?.title ?? 'Prompts'}
        description={pageTab === 'writing' ? 'Defina as etapas, os modelos e as instruções que usam o mapa editorial e o guia de escrita.' : currentWorker?.description ?? 'Gerencie a redação, edite os prompts e acompanhe as execuções.'}
        status={<Badge tone={dirty ? 'amber' : 'gray'}>{dirty ? 'Alterações não ativadas' : `Revisão ${view.active.revision} ativa`}</Badge>}
        actions={currentWorker || pageTab === 'writing' ? <>
          <Button variant="primary" icon={Save} loading={saving} disabled={readOnly || !dirty || Boolean(templateError)} onClick={() => void save()}>Salvar e ativar</Button>
          <Button icon={RotateCw} disabled={saving || loading || dirty} onClick={() => void load()}>Recarregar</Button>
          {dirty && <Button disabled={saving} onClick={() => setResetTarget('active')}>Descartar alterações</Button>}
        </> : undefined} />
      {failure && <Alert tone="danger" title="Não foi possível salvar">{failure}</Alert>}
      {templateError && <Alert tone="danger" title="Revise a configuração">{templateError}</Alert>}
      {!readOnly && <PresetUpgrade active={view.active.definition} blocked={dirty || saving} saving={saving} error={failure} onApply={applyPreset} />}
      <Tabs label="Gerenciar prompts" value={pageTab} onChange={value => navigate(value)} items={[
        { value: 'workers', label: 'Workers', count: PIPELINE_WORKERS.length, panelId: panelId('workers') },
        { value: 'writing', label: 'Redação', panelId: panelId('writing') },
        { value: 'prompts', label: 'Todos os prompts', count: Object.keys(PROMPTS).length, panelId: panelId('prompts') },
        { value: 'history', label: 'Histórico', count: view.history.length, panelId: panelId('history') },
        { value: 'runs', label: 'Execuções', count: view.runs.length, panelId: panelId('runs') },
      ]} />
      {dirty && <MetaList items={[...(changed.length ? [`${changed.length} ${changed.length === 1 ? 'prompt alterado' : 'prompts alterados'}`] : []), ...(flowChanged ? ['Fluxo alterado'] : []), ...(writingChanged ? ['Orquestração da redação alterada'] : [])]} />}
      <PageStack role="tabpanel" id={panelId(pageTab)} aria-labelledby={`${panelId(pageTab)}-tab`}>
        {pageTab === 'writing' && <>
          <WritingOrchestrationEditor definition={draft} providers={view.providers} researchProviders={view.researchProviders} saving={saving||readOnly} onChange={writing => update({ writing })} />
          <Panel><Section title="Usar e acompanhar">
            <PageStack>
              <Prose variant="compact" measure="wide">Salve e ative a configuração, depois gere um artigo a partir do conteúdo de uma produção. A aba Execuções mostra os prompts enviados, as respostas, o consumo de tokens e as falhas de cada etapa.</Prose>
              <ButtonGroup label="Usar a redação"><ButtonLink href={workspaceHrefFor(NEW_PRODUCTION_HREF)} variant="primary">Criar produção</ButtonLink><Button onClick={() => navigate('runs')}>Ver execuções</Button></ButtonGroup>
            </PageStack>
          </Section></Panel>
        </>}
        {pageTab === 'prompts' && <PipelineCatalog readOnly={readOnly} draft={draft} active={active} onEdit={key => { setTab(key); setEditorOpen(true); }} />}
        {pageTab === 'workers' && <>
          {active.writing?.enabled && <Alert tone="info" title="A orquestração da redação está ativa">
            <PageStack><Prose variant="compact" measure="wide">As novas gerações de artigos usam planejamento, redação e revisão. Os modelos e as instruções desse fluxo estão na aba Redação.</Prose><Button onClick={() => navigate('writing')}>Gerenciar redação</Button></PageStack>
          </Alert>}
          <PipelineWorkers readOnly={readOnly} worker={worker} onSelect={value => navigate('workers', value)} draft={draft} active={active}
            saving={saving||readOnly} onUpdate={update} onEdit={key => { setTab(key); setEditorOpen(true); }} />
        </>}
        {pageTab === 'history' && <Panel><Section title="Histórico de configurações" meta={`Revisão ${view.active.revision} ativa`}>
          <PageStack>
            <DescriptionList items={[{ label: 'Ativada em', value: savedDate(view.active.savedAt) }]} />
            {view.history.length ? <FieldGroup label="Recuperar uma revisão" hint="Carregar uma revisão não a ativa. Você pode editar e depois salvar como uma nova revisão." columns={1}>
              <Field label="Revisão anterior">{props => <Select {...props} value={historyRevision} onChange={setHistoryRevision}
                options={[...view.history].reverse().map(revision => ({ value: String(revision.revision), label: `Revisão ${revision.revision} · ${savedDate(revision.savedAt)}` }))}
                disabled={saving} placeholder="Selecione uma revisão" />}</Field>
              <Button disabled={readOnly || !historyRevision || saving} onClick={() => dirty ? setResetTarget(historyRevision) : reset(historyRevision)}>Carregar para edição</Button>
            </FieldGroup> : <EmptyState size="inline" title="Nenhuma revisão anterior" />}
          </PageStack>
        </Section></Panel>}
        {pageTab === 'runs' && <Panel><Section title="Execuções da IA">
          {view.runs.length ? <Accordion items={view.runs.map(run => ({ id: run.runId, title: run.label,
            meta: `Revisão ${run.pipelineRevision} · ${RUN_STATUS[run.status] ?? run.status}`, content: <PageStack>
              {run.writing ? <PageStack>
                <DescriptionList items={[{ label: 'Etapas registradas', value: String(run.writing.stages) }]} />
                <Button onClick={() => setSelectedRun(run.runId)}>Ver execução</Button>
              </PageStack> : <Timeline variant="dots" label="Etapas executadas" items={run.calls.map((call, index) => ({ id: `${call.hash}-${index}`,
                title: PIPELINE_STEP_LABELS[call.key] + (call.index === undefined ? '' : ` · ${call.index + 1}`),
                description: `${pipelineModelLabel(call.model)}${call.cached ? ' · resultado reutilizado' : ''}${call.errorCode ? ' · ' + call.errorCode : ''}`,
                state: call.status === 'completed' ? 'done' : call.status === 'failed' ? 'blocked' : 'current',
                date: call.status === 'completed' ? 'Respondida' : call.status === 'failed' ? 'Falhou' : 'Aguardando resposta',
              }))} />}
              <DescriptionList items={[
                { label: 'Execução', value: run.runId }, { label: 'Configuração', value: run.pipelineHash },
              ]} />
            </PageStack> }))} /> : <EmptyState size="inline" title="Nenhuma execução registrada" />}
        </Section></Panel>}
      </PageStack>
    </PageStack>
    {editorOpen && <PipelineEditor readOnly={readOnly} promptKey={tab} draft={draft} view={view} saving={saving} dirty={dirty} invalid={Boolean(templateError)} error={templateError ?? failure}
      onClose={() => setEditorOpen(false)} onUpdate={update} onUpdateStep={updateStep} onSave={() => void save()} />}
    {selectedRun && <WritingRunInspector key={selectedRun} runId={selectedRun} onClose={() => setSelectedRun(undefined)} onSelect={setSelectedRun} onRefresh={refreshRuns} />}
    <ConfirmDialog open={Boolean(resetTarget)} onClose={() => setResetTarget(undefined)} title={resetTarget === 'active' ? 'Descartar as alterações?' : 'Substituir as alterações pela revisão selecionada?'}
      description="As alterações ainda não ativadas serão descartadas. A configuração ativa permanece a mesma." confirmLabel={resetTarget === 'active' ? 'Descartar alterações' : 'Carregar revisão'} cancelLabel="Continuar editando" tone="danger"
      onConfirm={() => { if (resetTarget) reset(resetTarget); }} />
    <ConfirmDialog open={Boolean(exitTo)} onClose={() => setExitTo(undefined)} title="Sair sem ativar os prompts?" description="As alterações desta página ainda não foram salvas. A configuração ativa continua a mesma." confirmLabel="Descartar e sair" cancelLabel="Continuar editando" tone="danger" onConfirm={() => { departing.current = true; const href = exitTo; setExitTo(undefined); if (href) router.push(href); }} />
  </>;
}

/** Detail polling never reloads the editable definition or its optimistic revision. */
function WritingRunInspector({ runId, onClose, onSelect, onRefresh }: {
  runId: string; onClose: () => void; onSelect: (runId: string) => void; onRefresh: () => Promise<void>;
}) {
  const workspaceHrefFor = useWorkspaceHref();
  const { runtime } = useRuntime();
  const edits=useCan('pipeline.edit');
  const port = runtime?.pipeline;
  const narrow = useMediaQuery('(max-width: 640px)');
  const [run, setRun] = useState<RunDetails>();
  const [failure, setFailure] = useState<string>();
  const [actionFailure, setActionFailure] = useState<string>();
  const [action, setAction] = useState<'cancel' | 'retry'>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!port?.getWritingRun) return;
    let live = true, reading = false, active = true;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await port.getWritingRun!(runId);
        if (live) { setRun(next); setFailure(undefined); active = ['running', 'queued'].includes(next.status); }
      } catch (error) { if (live) setFailure(error instanceof Error ? error.message : 'Não foi possível carregar a execução.'); }
      finally { reading = false; }
    };
    void read();
    const timer = window.setInterval(() => { if (active) void read(); }, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [port, runId, refresh]);

  async function manage(kind: 'cancel' | 'retry') {
    if (!runtime || action) return;
    setAction(kind); setActionFailure(undefined);
    try {
      if (kind === 'cancel') {
        const result = await runtime.generation.cancel(runId);
        if (!result.ok) { setActionFailure(result.refusal.message); return; }
        setRefresh(value => value + 1);
        toast('Execução cancelada');
      } else {
        const result = await runtime.generation.retry(runId);
        if (!result.ok) { setActionFailure(result.refusal.message); return; }
        toast('Nova tentativa iniciada com a configuração atual');
        onSelect(result.value.runId);
      }
      await onRefresh();
    } catch (error) { setActionFailure(error instanceof Error ? error.message : 'Não foi possível concluir a ação.'); }
    finally { setAction(undefined); }
  }
  const running = run && ['running', 'queued'].includes(run.status);
  const retryable = run && ['failed', 'cancelled'].includes(run.status);
  const content = <PageStack>
      {failure && <Alert tone="danger" title="Não foi possível atualizar a execução"><PageStack>{failure}<Button onClick={() => setRefresh(value => value + 1)}>Tentar carregar novamente</Button></PageStack></Alert>}
      {actionFailure && <Alert tone="danger" title="A ação não foi concluída">{actionFailure}</Alert>}
      {!port?.getWritingRun && <EmptyState size="inline" title="Detalhes indisponíveis nesta conexão" />}
      {port?.getWritingRun && !run && !failure && <DescriptionList items={[]} loading />}
      {run && <>
        <ButtonGroup label="Gerenciar execução">
          <ButtonLink href={workspaceHrefFor(pieceHref(run.productionId, 'article'))}>Abrir artigo</ButtonLink>
          {edits && running && <Button disabled={Boolean(action)} loading={action === 'cancel'} onClick={() => void manage('cancel')}>Cancelar execução</Button>}
          {edits && retryable && <Button disabled={Boolean(action)} loading={action === 'retry'} onClick={() => void manage('retry')}>Nova tentativa</Button>}
        </ButtonGroup>
        {retryable && <Prose variant="compact" measure="wide">A nova tentativa usa a configuração atualmente ativa. Esta execução preserva os prompts e as respostas originais.</Prose>}
        <WritingRunDetails run={run} />
      </>}
    </PageStack>;
  const common = { open: true, onClose, title: 'Detalhes da redação', footer: <Button onClick={onClose}>Fechar execução</Button> };
  return narrow ? <ResponsiveDialog {...common} snap="full">{content}</ResponsiveDialog>
    : <Drawer {...common} size="lg">{content}</Drawer>;
}
