'use client';

import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ActionBar,
  ConfirmDialog,
  ErrorState,
  IconButton,
  LinkButton,
  MetaList,
  PageStack,
  Segmented,
  SlideStrip,
  toast,
  Tooltip,
  useWorkspace,
  WorkspaceLayout,
  type SlideStripItem,
  type SlideStripOrientation,
} from '@content-ventures/design-system/v3';
import { ArrowLeftRight, GalleryHorizontal, Maximize2, Save, Send } from '@content-ventures/design-system/v3/icons';
import {
  countWords,
  findLayout,
  isRunActive,
  type CarouselBody,
  type RunId,
  type Slide,
  type SlideId,
  type TemplateId,
  type VersionRef,
  type VersionView,
} from '@/domain';
import type { PieceView, ProductionDetail, SlotFit } from '@/ports';
import { useCommands, usePiece, useRun, useRuntime, useSaveStatus, useVersion } from '@/state';
import { ProductionHeader } from '@/features/production/production-frame';
import { plural } from '@/ui/format';
import { pieceHref, reviewHref } from '@/ui/routes';
import { RunTrace } from '@/ui/run-trace';
import { takeArmedSimulation, useCommandGroup, useFocusMode } from '@/ui/shell';
import { usePersistentFlag } from '@/ui/shell/preference';
import {
  CarouselDocumentState,
  CarouselHeaderActions,
  CarouselSendButton,
  type CarouselGenerateAction,
  type CarouselReviewAction,
  type CarouselSaveState,
} from './carousel-actions';
import { OutdatedNotice } from './outdated-notice';
import { SlidePanel } from './slide-panel';
import { SlideThumb } from './slide-media';
import { applyProposal } from './slide-proposal';
import { SlideStage, type StageView } from './slide-stage';
import { StudioToolbar } from './studio-toolbar';
import { useCarouselDraft } from './use-carousel-draft';
import { useSlideAssist } from './use-slide-assist';
import { useSlideRenders } from './use-slide-renders';

/**
 * Carousel studio (PLAN §3.7) in the same WorkspaceLayout as the article: slide strip on the
 * start (PNG thumbnails, ok / aviso / erro, reorder by drag or Alt + arrows), the rendered slide
 * or the whole sequence in the middle, and the slot fields, the AI actions and the origin of the
 * selected slide on the end. While the copy is generated, slides stream into the strip as each
 * one is written; the run lives in the runtime, so leaving the page never cancels it.
 */

export type CarouselWorkspaceProps = {
  production: ProductionDetail;
  carousel: PieceView;
  article: PieceView | undefined;
  /** Run started from this screen (shown even before the read model reports it). */
  startedRunId: RunId | undefined;
  onRunStarted: (runId: RunId) => void;
};

const LOCKED = 'Aguarde a geração terminar.';

/** Reports the frame's narrow mode (tabs) to the screen that lays out the panes. */
function NarrowProbe({ onChange }: { onChange: (narrow: boolean) => void }) {
  const narrow = useWorkspace()?.narrow ?? false;
  useEffect(() => onChange(narrow), [narrow, onChange]);
  return null;
}

function slideWords(slide: Slide): number {
  return countWords(Object.values(slide.slots).join(' '));
}

export function CarouselWorkspace({ production, carousel, article, startedRunId, onRunStarted }: CarouselWorkspaceProps) {
  const router = useRouter();
  const commands = useCommands();
  const { runtime } = useRuntime();
  const focusMode = useFocusMode();
  const saveState = useSaveStatus();
  const piece = usePiece(carousel.id);
  const draft = useCarouselDraft(piece.data);

  // ── Generation run ──────────────────────────────────────────────────────────────────
  const runId = carousel.activeRun?.id ?? startedRunId;
  const run = useRun(runId);
  const live = run.status === 'ready' ? run.data : undefined;
  const running = live ? isRunActive(live.fold.run) : Boolean(carousel.activeRun);
  const request = live?.meta.request.kind === 'carousel.copy' ? live.meta.request.input : undefined;
  const runBody = useMemo<CarouselBody | undefined>(() => {
    if (!running || !live) return undefined;
    return { type: 'carousel', templateId: request?.templateId ?? draft.body?.templateId ?? '', slides: live.fold.slides };
  }, [draft.body?.templateId, live, request?.templateId, running]);
  const body = runBody ?? draft.body;
  const slides = useMemo(() => body?.slides ?? [], [body]);
  const lockedReason = running ? LOCKED : undefined;

  // ── Template and fit (approximate, measured by the render service) ──────────────────
  const templates = useMemo(() => runtime?.render.templates() ?? [], [runtime]);
  const template = templates.find((entry) => entry.id === body?.templateId);
  // Measured on a deferred copy: typing never waits for the renderer.
  const measuredBody = useDeferredValue(body);
  const fits = useMemo<SlotFit[]>(() => {
    if (!measuredBody || !runtime || measuredBody.slides.length === 0) return [];
    const measured = runtime.render.measure(measuredBody);
    return measured.ok ? measured.value : [];
  }, [measuredBody, runtime]);

  const [view, setView] = useState<StageView>('slide');

  // ── Selection ───────────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<SlideId | null>(null);
  const [picked, setPicked] = useState(false);
  const found = slides.findIndex((slide) => slide.id === selected);
  const index = running && !picked ? Math.max(0, slides.length - 1) : Math.max(0, found);
  const current = slides[index];
  const layout = findLayout(template, current?.layout ?? '');
  const select = (id: SlideId) => {
    setSelected(id);
    if (running) setPicked(true);
  };

  // ── Article versions behind the slides ──────────────────────────────────────────────
  const approvedRef = article?.approvedVersion?.ref;
  const inputRef = piece.data?.inputs.find((ref) => ref.pieceId === article?.id) ?? piece.data?.inputs[0];
  const inputVersion = useVersion(inputRef?.versionId);
  const inputArticle = inputVersion.data?.body.type === 'article' ? inputVersion.data.body : undefined;
  const outdated = Boolean(approvedRef && inputRef && approvedRef.versionId !== inputRef.versionId);
  const approvedVersion = useVersion(outdated ? approvedRef?.versionId : undefined);
  const approvedArticle = approvedVersion.data?.body.type === 'article' ? approvedVersion.data.body : undefined;
  const [kept, setKept] = usePersistentFlag(`reporter:ui:carousel-keep:${carousel.id}:${approvedRef?.versionId ?? 'none'}`);

  // ── Slide assist (runs of the generation service, stored as suggestions) ────────────
  const assist = useSlideAssist({ production, pieceId: carousel.id, draft: piece.data, body: draft.body, flush: draft.flush });
  const [updatingTo, setUpdatingTo] = useState<VersionRef | null>(null);
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'writing' | 'deciding' | 'failed'>('idle');
  const updateEntries = Object.entries(assist.pending).filter(([, entry]) => entry.kind === 'update');
  const pendingUpdates = updateEntries.length;

  const finishUpdate = async (ref: VersionRef) => {
    await draft.flush();
    setUpdatingTo(null);
    setUpdatePhase('idle');
    const result = await commands.production.derive({ productionId: production.id, kind: 'carousel', from: ref, rebase: true });
    if (result.ok) toast(`Slides atualizados para a versão ${ref.number}`);
    else toast('Não foi possível atualizar o carrossel', { tone: 'error', description: result.refusal.message });
  };

  const startUpdate = async () => {
    if (!approvedRef || !inputArticle || !approvedArticle) return;
    setKept(false);
    setUpdatingTo(approvedRef);
    setUpdatePhase('writing');
    const outcome = await assist.requestUpdates();
    if (outcome === 'none') await finishUpdate(approvedRef);
    else if (outcome === 'refused') {
      setUpdatingTo(null);
      setUpdatePhase('idle');
    }
  };

  // "Atualizar slides": once the proposals are written, the first one is on stage; deciding the
  // last one points the carousel at the new version.
  const firstUpdate = updateEntries[0]?.[0];
  if (updatePhase === 'writing' && assist.updateStatus === 'failed') {
    setUpdatePhase('failed');
    setUpdatingTo(null);
  } else if (updatePhase === 'writing' && pendingUpdates > 0) {
    setUpdatePhase('deciding');
    if (firstUpdate) setSelected(firstUpdate);
  }
  useEffect(() => {
    if (updatePhase === 'failed') toast('Não foi possível atualizar os slides', { tone: 'error' });
  }, [updatePhase]);
  /** Decides proposals; deciding the last update proposal points the carousel at the new version. */
  const decide = async (ids: SlideId[] | 'all-updates', decision: 'accept' | 'discard') => {
    const left = ids === 'all-updates' ? 0 : updateEntries.filter(([id]) => !ids.includes(id)).length;
    if (ids === 'all-updates') {
      if (decision === 'accept') await assist.acceptAll('update');
      else await assist.discardAll('update');
    } else {
      for (const id of ids) {
        if (decision === 'accept') await assist.accept(id);
        else await assist.discard(id);
      }
    }
    const touchedUpdate = ids === 'all-updates' || ids.some((id) => assist.pending[id]?.kind === 'update');
    if (updatingTo && updatePhase === 'deciding' && touchedUpdate && left === 0) await finishUpdate(updatingTo);
  };

  // ── Edits ───────────────────────────────────────────────────────────────────────────
  const editSlides = (change: (slides: Slide[]) => Slide[]) => draft.update((value) => ({ ...value, slides: change(value.slides) }));
  const setSlot = (slotId: string, value: string) => {
    if (!current) return;
    editSlides((list) => list.map((slide) => (slide.id === current.id ? { ...slide, slots: { ...slide.slots, [slotId]: value } } : slide)));
  };
  const reorder = (from: number, to: number) =>
    editSlides((list) => {
      const next = list.slice();
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  const duplicate = (id: SlideId) => {
    const copyId = runtime?.ids.next('sld');
    if (!copyId) return;
    editSlides((list) => list.flatMap((slide) => (slide.id === id ? [slide, { ...slide, id: copyId, slots: { ...slide.slots }, sourceBlockIds: [...slide.sourceBlockIds] }] : [slide])));
    setSelected(copyId);
  };
  const remove = (id: SlideId) => {
    editSlides((list) => list.filter((slide) => slide.id !== id));
    assist.discard(id);
  };
  const add = () => {
    const layoutId = findLayout(template, 'point')?.id ?? template?.layouts.find((entry) => entry.id !== template.coverLayoutId)?.id;
    const id = runtime?.ids.next('sld');
    if (!layoutId || !id) return;
    editSlides((list) => {
      const at = Math.max(0, list.findIndex((slide) => slide.id === current?.id)) + 1;
      const next = list.slice();
      next.splice(at, 0, { id, layout: layoutId, slots: {}, sourceBlockIds: [] });
      return next;
    });
    setSelected(id);
  };
  const changeTemplate = (templateId: TemplateId) => draft.update((value) => ({ ...value, templateId }));

  // ── Proposal on stage: Atual | Proposta, with the renderer's fit of the proposal ────
  const proposal = current ? assist.pending[current.id] : undefined;
  const proposalReady = proposal?.proposal && proposal.state === 'ready' ? proposal.proposal : undefined;
  const [stageSide, setStageSide] = useState<{ slideId: SlideId | null; side: 'current' | 'proposal' }>({ slideId: null, side: 'proposal' });
  const side = proposalReady && stageSide.slideId === current?.id ? stageSide.side : 'proposal';
  const proposedBody = useMemo<CarouselBody | undefined>(() => {
    if (!body || !proposalReady) return undefined;
    return { ...body, slides: body.slides.map((slide) => (slide.id === proposalReady.slideId ? applyProposal(slide, proposalReady) : slide)) };
  }, [body, proposalReady]);
  const proposalFit = useMemo(() => {
    if (!proposedBody || !runtime || !current) return undefined;
    const measured = runtime.render.measure({ ...proposedBody, slides: proposedBody.slides.filter((slide) => slide.id === current.id) });
    return measured.ok ? measured.value.find((fit) => fit.overflow) : undefined;
  }, [proposedBody, runtime, current]);
  const stageBody = proposedBody && side === 'proposal' && view === 'slide' ? proposedBody : body;

  // ── Strip ───────────────────────────────────────────────────────────────────────────
  const articleCover = piece.data?.articleCover?.assetId;
  const thumbs = useSlideRenders(body, { scale: 0.25, articleCover });
  const states = slides.map((slide) => {
    const slideLayout = findLayout(template, slide.layout);
    const missing = slideLayout?.slots.find((slot) => slot.required && !slide.slots[slot.id]?.trim());
    const over = fits.find((fit) => fit.slideId === slide.id && fit.overflow);
    const failed = thumbs[slide.id]?.status === 'error';
    const update = assist.pending[slide.id]?.kind === 'update';
    if (missing) return { state: 'error' as const, issue: `Falta ${missing.label.toLowerCase()}` };
    if (failed) return { state: 'error' as const, issue: 'Não foi possível desenhar' };
    if (over) return { state: 'warning' as const, issue: over.message ?? 'Texto não cabe no slide' };
    if (update) return { state: 'warning' as const, issue: 'Atualização pendente' };
    return { state: 'ok' as const, issue: undefined };
  });
  const items: SlideStripItem[] = slides.map((slide, at) => ({
    id: slide.id,
    label: findLayout(template, slide.layout)?.label ?? 'Slide',
    thumb: <SlideThumb render={thumbs[slide.id]} />,
    state: states[at]?.state,
    issue: states[at]?.issue,
    meta: plural(slideWords(slide), 'palavra', 'palavras'),
  }));
  if (running) {
    const planned = request?.slides ?? 5;
    for (let at = slides.length; at < planned; at += 1) {
      items.push({ id: `writing-${at}`, label: at === slides.length ? 'Escrevendo…' : 'Na fila', thumb: <SlideThumb render={undefined} /> });
    }
  }
  const warnings = states.filter((entry) => entry.state !== 'ok').length;
  const jumpToWarning = () => {
    const order = slides.map((_, at) => (index + 1 + at) % slides.length);
    const next = order.find((at) => states[at]?.state !== 'ok');
    const slide = next !== undefined ? slides[next] : undefined;
    if (slide) select(slide.id);
  };

  const [narrow, setNarrow] = useState(false);
  const strip = (orientation: SlideStripOrientation) => (
    <SlideStrip
      label="Slides do carrossel"
      items={items}
      value={current?.id ?? null}
      onChange={(id) => {
        if (slides.some((slide) => slide.id === id)) select(id);
      }}
      onReorder={running ? undefined : reorder}
      onAdd={running || !template ? undefined : add}
      onDuplicate={running ? undefined : duplicate}
      onRemove={running ? undefined : remove}
      ratio="4/5"
      orientation={orientation}
      loading={!body && piece.status === 'loading'}
      disabled={running}
      maxItems={template?.maxSlides}
      minItems={template?.minSlides ?? 1}
    />
  );

  // ── Actions ─────────────────────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [traceOpen, setTraceOpen] = useState<boolean | null>(null);

  const saveVersion = async () => {
    if (running) return;
    await draft.flush();
    const result = await commands.production.createVersion(carousel.id);
    if (result.ok) toast(`Versão ${result.value.version.label} salva`);
    else toast(result.refusal.message, { tone: 'info' });
  };

  // "Restaurar" from the versions menu: the draft becomes a version first, so nothing is lost.
  const [restoring, setRestoring] = useState<VersionView | null>(null);
  const restoreVersion = async (version: VersionView) => {
    await draft.flush();
    await commands.production.createVersion(carousel.id);
    const result = await commands.production.restoreVersion(carousel.id, version.id);
    if (result.ok) toast(`${result.value.version.label} criada`);
    else toast('Versão não restaurada', { tone: 'error', description: result.refusal.message });
  };

  const sendToReview = async () => {
    setSending(true);
    const saved = await draft.flush();
    const result = saved ? await commands.production.requestReview(carousel.id) : undefined;
    setSending(false);
    if (result && !result.ok && result.refusal.code !== 'already_requested') {
      toast('Não foi possível enviar para aprovação', { tone: 'error', description: result.refusal.message });
      return;
    }
    if (result) router.push(reviewHref(production.id, 'carousel'));
  };

  const regenerate = async () => {
    await draft.flush();
    const started = await commands.generation.start(
      'carousel.copy',
      {
        productionId: production.id,
        pieceId: carousel.id,
        ...(approvedRef ? { from: approvedRef } : {}),
        ...(draft.body ? { templateId: draft.body.templateId } : {}),
        slides: Math.max(template?.minSlides ?? 3, Math.min(template?.maxSlides ?? 10, slides.length || 5)),
      },
      { simulation: takeArmedSimulation('carousel.copy') },
    );
    if (!started.ok) {
      toast('Não foi possível gerar os textos', { tone: 'error', description: started.refusal.message });
      return;
    }
    setPicked(false);
    setTraceOpen(null);
    onRunStarted(started.value.runId);
  };

  const stop = async () => {
    if (!runId) return;
    setStopping(true);
    await commands.generation.cancel(runId);
    setStopping(false);
  };

  const lastRun = carousel.lastRun;
  const traceRun = running && live ? live.fold.run : lastRun && (lastRun.status === 'failed' || lastRun.status === 'cancelled') ? lastRun : live?.fold.run.status === 'completed' && startedRunId === runId ? live.fold.run : undefined;
  const retry = async (stepId?: string) => {
    if (!traceRun) return;
    const retried = await commands.generation.retry(traceRun.id, stepId);
    if (retried.ok) {
      setTraceOpen(null);
      onRunStarted(retried.value.runId);
    } else toast('Não foi possível continuar', { tone: 'error', description: retried.refusal.message });
  };

  const guards = production.guards.pieces.carousel;
  const reviewGuard = guards?.requestReview;
  const inReview = reviewGuard && !reviewGuard.allowed && reviewGuard.code === 'already_requested' && !draft.pending;
  const reviewReason = lockedReason ?? (reviewGuard && !reviewGuard.allowed && !inReview && !draft.pending ? reviewGuard.reason : undefined);
  const generateGuard = guards?.generate;
  const carouselStage = production.stages.find((stage) => stage.pieceKind === 'carousel');
  const regenerateReason =
    lockedReason ?? (generateGuard && !generateGuard.allowed ? generateGuard.reason : !approvedRef ? (carouselStage?.blockedReason ?? 'Aprove o artigo primeiro.') : undefined);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveVersion();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useCommandGroup({
    label: 'Carrossel',
    items: [
      { id: 'carousel-save-version', label: 'Salvar versão', hint: '⌘S', icon: Save, onSelect: () => void saveVersion() },
      // Blocked, "Enviar para aprovação" stays listed with the header's reason and says it again on Enter.
      {
        id: 'carousel-send-review',
        label: inReview ? 'Abrir revisão' : 'Enviar para aprovação',
        icon: Send,
        ...(!inReview && reviewReason ? { description: reviewReason } : {}),
        onSelect: () => {
          if (inReview) router.push(reviewHref(production.id, 'carousel'));
          else if (reviewReason) toast('Ainda não dá para enviar', { tone: 'info', description: reviewReason });
          else void sendToReview();
        },
      },
      ...(warnings > 0 ? [{ id: 'carousel-next-warning', label: 'Próximo slide com aviso', icon: ArrowLeftRight, onSelect: jumpToWarning }] : []),
      { id: 'carousel-toggle-view', label: view === 'slide' ? 'Ver sequência' : 'Ver slide', icon: GalleryHorizontal, onSelect: () => setView(view === 'slide' ? 'sequence' : 'slide') },
      { id: 'carousel-focus', label: focusMode.focus ? 'Sair do modo foco' : 'Modo foco', icon: Maximize2, onSelect: focusMode.toggle },
    ],
  });

  // ── Layout ──────────────────────────────────────────────────────────────────────────
  const latestVersion = piece.data?.latestVersion;
  const generationRun =
    production.runs.find((entry) => entry.id === latestVersion?.runId) ?? (lastRun?.kind === 'carousel.generate' && lastRun.status === 'completed' ? lastRun : undefined);
  const saveStatus = draft.pending || saveState.status === 'saving' ? 'saving' : saveState.status === 'error' ? 'error' : 'saved';
  const save: CarouselSaveState = {
    status: saveStatus,
    label: saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'error' ? 'Não foi possível salvar' : saveState.scope === 'local' ? 'Salvo neste navegador' : 'Salvo nesta sessão',
    ...(saveStatus === 'error' ? { onRetry: () => void commands.save.retry() } : {}),
  };
  const generateAction: CarouselGenerateAction = {
    running,
    stopping,
    ...(regenerateReason ? { reason: regenerateReason } : {}),
    onStop: () => void stop(),
    onRegenerate: () => setConfirmRegenerate(true),
  };
  const reviewAction: CarouselReviewAction = {
    inReview: Boolean(inReview),
    href: reviewHref(production.id, 'carousel'),
    ...(reviewReason ? { reason: reviewReason } : {}),
    sending,
    onSend: () => void sendToReview(),
  };

  // Narrow frames only (tabs, phone): the header has no room for the actions, so the footer returns
  // with the real save state, "Salvar versão" and the primary action.
  const footer = (narrowFooter: boolean) =>
    narrowFooter ? (
      <ActionBar position="static" status={save.status} statusLabel={save.label} onRetry={save.onRetry}>
        <Tooltip content={running ? LOCKED : 'Salvar versão'} shortcut={running ? undefined : '⌘S'}>
          <IconButton label="Salvar versão" icon={Save} aria-disabled={running || undefined} onClick={() => void saveVersion()} />
        </Tooltip>
        <CarouselSendButton action={reviewAction} />
      </ActionBar>
    ) : null;

  return (
    <>
      <WorkspaceLayout
        docked
        storageKey="reporter:carousel-studio"
        header={(narrowHeader) => (
          <ProductionHeader compact actions={narrowHeader ? undefined : <CarouselHeaderActions generate={generateAction} review={reviewAction} />} />
        )}
        footer={footer}
        focus={focusMode.focus}
        onFocusChange={focusMode.setFocus}
        start={narrow ? undefined : { label: 'Slides', content: strip('vertical'), defaultSize: 296, min: 260, max: 360 }}
        mainLabel="Slide"
        mainHeader={
          <StudioToolbar
            view={view}
            onView={setView}
            templates={templates}
            templateId={body?.templateId}
            onTemplate={changeTemplate}
            lockedReason={lockedReason}
            running={running}
            stopping={stopping}
            onStop={() => void stop()}
            onRegenerate={() => setConfirmRegenerate(true)}
            regenerateReason={regenerateReason}
            generate={narrow}
            end={
              narrow ? undefined : (
                <CarouselDocumentState
                  save={save}
                  versions={carousel.versions}
                  latest={latestVersion}
                  dirty={draft.pending || Boolean(piece.data?.dirty)}
                  running={running}
                  onSaveVersion={() => void saveVersion()}
                  onRestore={setRestoring}
                />
              )
            }
          />
        }
        mainFooter={
          <MetaList
            size="sm"
            label="Situação do carrossel"
            items={[
              plural(slides.length, 'slide', 'slides'),
              warnings > 0 ? (
                <LinkButton key="warnings" tone="quiet" size="inherit" onClick={jumpToWarning}>
                  {plural(warnings, 'aviso', 'avisos')}
                </LinkButton>
              ) : null,
              inputRef ? (
                outdated && kept ? (
                  <LinkButton key="article" tone="quiet" size="inherit" onClick={() => void startUpdate()}>
                    Artigo v{inputRef.number} · Atualizar slides
                  </LinkButton>
                ) : (
                  `Artigo v${inputRef.number}`
                )
              ) : null,
            ]}
          />
        }
        end={{
          label: 'Texto',
          defaultSize: 336,
          min: 300,
          max: 480,
          content: (
            <SlidePanel
              body={draft.body}
              slide={current}
              index={index}
              layout={layout}
              template={template}
              fits={fits.filter((fit) => fit.slideId === current?.id)}
              lockedReason={lockedReason}
              onSlotChange={setSlot}
              article={inputArticle}
              articleNumber={inputRef?.number}
              onOpenArticle={() => router.push(pieceHref(production.id, 'article'))}
              generationRun={generationRun}
              assistRun={current ? production.runs.find((run) => run.id === assist.pending[current.id]?.runId) : undefined}
              assist={current ? assist.pending[current.id] : undefined}
              updateLabel={updatingTo ? `Atualizar para a versão ${updatingTo.number}` : undefined}
              onAssist={(kind) => current && assist.request(current.id, kind)}
              onAccept={() => {
                if (current) void decide([current.id], 'accept');
              }}
              onDiscard={() => {
                if (current) void decide([current.id], 'discard');
              }}
              loading={(!body && piece.status === 'loading') || (running && !current)}
            />
          ),
        }}
      >
        <NarrowProbe onChange={setNarrow} />
        <PageStack>
          {piece.status === 'error' ? <ErrorState title="Não foi possível abrir o carrossel" onRetry={piece.retry} /> : null}
          {outdated && approvedRef && inputRef && (!kept || updatingTo) && !running ? (
            <OutdatedNotice
              from={inputRef.number}
              to={approvedRef.number}
              pending={pendingUpdates}
              updating={Boolean(updatingTo)}
              onUpdate={() => void startUpdate()}
              onKeep={() => setKept(true)}
              onAcceptAll={() => void decide('all-updates', 'accept')}
              onDiscardAll={() => void decide('all-updates', 'discard')}
            />
          ) : null}
          {traceRun ? (
            <RunTrace
              key={traceRun.id}
              run={traceRun}
              label="Textos do carrossel"
              onRetry={(stepId) => void retry(stepId)}
              collapsed={traceOpen === null ? !running && traceRun.status === 'completed' : !traceOpen}
              onCollapsedChange={(collapsed) => setTraceOpen(!collapsed)}
            />
          ) : null}
          {proposedBody && view === 'slide' && current ? (
            <MetaList
              size="sm"
              label="Proposta no palco"
              items={[
                <Segmented
                  key="side"
                  label="Slide no palco"
                  size="sm"
                  value={side}
                  onChange={(next) => setStageSide({ slideId: current.id, side: next })}
                  options={[
                    { value: 'current', label: 'Atual' },
                    { value: 'proposal', label: 'Proposta' },
                  ]}
                />,
                side === 'proposal' ? (proposalFit ? `≈ ${proposalFit.message ?? 'Texto não cabe no slide'}` : 'Cabe no slide') : null,
              ]}
            />
          ) : null}
          <SlideStage
            body={stageBody}
            template={template}
            selectedIndex={index}
            onSelect={select}
            view={view}
            narrow={narrow}
            writing={running}
            articleCover={articleCover}
          />
          {narrow ? strip('horizontal') : null}
        </PageStack>
      </WorkspaceLayout>
      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title={`Restaurar a ${restoring?.label ?? 'versão'}?`}
        description="O rascunho atual fica salvo como versão antes. A versão escolhida volta como uma versão nova."
        confirmLabel="Restaurar versão"
        onConfirm={async () => {
          if (restoring) await restoreVersion(restoring);
          setRestoring(null);
        }}
      />
      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        title="Gerar nova versão do carrossel?"
        description={`O rascunho atual fica salvo como versão. Os textos novos saem do artigo v${approvedRef?.number ?? inputRef?.number ?? ''}.`}
        confirmLabel="Gerar nova versão"
        onConfirm={async () => {
          await regenerate();
          setConfirmRegenerate(false);
        }}
      />
    </>
  );
}
