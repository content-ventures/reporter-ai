'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  ErrorState,
  ErrorSummary,
  FixedFrame,
  FormRow,
  FormSection,
  Grid,
  GridItem,
  IconButton,
  LinkButton,
  LiveRegion,
  PageHeader,
  PageStack,
  Section,
  Stepper,
  Tooltip,
  focusField,
  toast,
  type FormError,
  type SectionState,
  type StepState,
} from '@content-ventures/design-system/v3';
import { FileText, Sparkles, X } from '@content-ventures/design-system/v3/icons';
import { sizeOf } from '@/domain';
import type { PersonSummary, SourceAnalysis } from '@/ports';
import { sourceKind, type SourceIntake } from '@/registries';
import { useCommands, usePeople, useProduction, useSource } from '@/state';
import { formatLaudas, plural } from '@/ui/format';
import { PRODUCTIONS_HREF, pieceHref, structureHref } from '@/ui/routes';
import { takeArmedSimulation, useCommandGroup, useLeaveGuard } from '@/ui/shell';
import { useNow } from '@/ui/time';
import { BriefStep } from './brief-sections';
import {
  EMPTY_DRAFT,
  NEW_PRODUCTION_STEPS,
  STEP_LABELS,
  briefBlocker,
  briefSummary,
  defaultTitle,
  draftMaterial,
  hasMaterial,
  isDraftDirty,
  materialBlocker,
  toCreateInput,
  validateMaterial,
  withoutPersonLabel,
  type DraftField,
  type MaterialFile,
  type MaterialMode,
  type NewProductionDraft,
  type NewProductionStep,
  type SpeakerChoice,
} from './form';
import { MaterialSection, materialState } from './material-section';
import { outlineBlocker, outlineFromProposal, toOutlineInput, type OutlineDraft } from './outline-model';
import type { QuoteMaterial } from './outline-quotes';
import { usePreviewSpeakers } from './preview-speakers';
import {
  SAMPLE_ANGLE,
  SAMPLE_SIZE,
  SAMPLE_NEW_SPEAKER,
  SAMPLE_ORIGIN,
  SAMPLE_SECTIONS,
  SAMPLE_TITLE,
  SAMPLE_TRANSCRIPT,
} from './sample-material';
import { SpeakersSection } from './speakers-section';
import { StructureStep } from './structure-step';
import { useFileReader } from './use-file-reader';
import { useMaterialAnalysis } from './use-material-analysis';
import { useOutlineRun } from './use-outline-run';

/**
 * Nova produção (`/productions/new`, CONTRACT §3.9): a creation page, never a modal, in three
 * steps with one decision each. Material (the transcript, who speaks, the speakers' consent) →
 * Pauta (size, sections, angle, pieces, internal title) → Estrutura (the outline the AI proposes,
 * edited before drafting). "Montar estrutura" saves the source and the production (authorised
 * material, REQ-T.1) and opens step 3 on `?producao=`, where the outline run proposes the
 * structure; "Redigir artigo" starts the draft from the reviewed structure and opens the studio,
 * where the stream continues (REQ-1.1, REQ-1.2). Every blocked primary says why, next to it.
 */

const FALLBACK_INTAKE: SourceIntake = { extensions: ['.txt', '.md', '.srt', '.vtt'], maxBytes: 2 * 1024 * 1024, paste: true };
const INTAKE: SourceIntake = sourceKind('transcript')?.intake ?? FALLBACK_INTAKE;
const NO_PEOPLE: readonly PersonSummary[] = [];
const PASTE_PAUSE_MS = 350;

/** `create`: saving the material (or the new pauta); `draft`: starting the article from the structure. */
type Busy = 'create' | 'draft' | null;
type Attempt = { key: number; ids: Partial<Record<DraftField, string>> };

const STEP_ITEMS = NEW_PRODUCTION_STEPS.map((id) => ({ id, label: STEP_LABELS[id] }));

const pad = (value: number) => String(value).padStart(2, '0');

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDay(date);
}

export function NewProductionScreen({ productionId: routeId }: { productionId?: string }) {
  const router = useRouter();
  const commands = useCommands();
  const peopleQuery = usePeople();
  const people = peopleQuery.data ?? NO_PEOPLE;
  // From the shared page clock after hydration (the server never computes "today").
  const now = useNow();
  const today = now ? isoDay(now) : undefined;

  const [draft, setDraft] = useState<NewProductionDraft>(EMPTY_DRAFT);
  const update = useCallback((patch: Partial<NewProductionDraft>) => setDraft((current) => ({ ...current, ...patch })), []);

  // The production of step 3: the one in the URL (reload, "Montar estrutura" elsewhere) or the one this page created.
  const [createdId, setCreatedId] = useState<string>();
  const activeId = routeId ?? createdId;
  const [view, setView] = useState<'material' | 'brief'>('material');
  const [editingBrief, setEditingBrief] = useState(false);
  const step: NewProductionStep = activeId ? (editingBrief ? 'brief' : 'structure') : view;

  // ── The production, once it exists ──
  const production = useProduction(activeId);
  const detail = production.data;
  const article = detail?.pieces.find((piece) => piece.kind === 'article');
  const outline = useOutlineRun(activeId, detail, step === 'structure');
  const runState = outline.state;
  const source = useSource(detail?.sources[0]?.id);
  const quotes = useMemo<QuoteMaterial>(
    () => ({ segments: source.data?.version.content.segments ?? [], speakers: source.data?.speakers ?? [] }),
    [source.data],
  );
  const [outlineDraft, setOutlineDraft] = useState<OutlineDraft | null>(null);
  // A new proposal (first run, "Tentar de novo", a changed pauta) replaces the structure being edited.
  if (runState.status === 'ready' && outlineDraft?.runId !== runState.runId) {
    setOutlineDraft(outlineFromProposal(runState.proposal, detail?.brief.size ?? draft.size, runState.runId));
  }

  // ── Material ──
  const material = draftMaterial(draft);
  const analysisState = useMaterialAnalysis(material.text, material.fileName, draft.mode === 'paste' ? PASTE_PAUSE_MS : 0);
  const analysis = analysisState.analysis;
  const readyAnalysis = analysisState.status === 'ready' ? analysis : undefined;

  const onFileLoaded = useCallback((file: MaterialFile) => setDraft((current) => ({ ...current, file, speakers: {} })), []);
  const fileReader = useFileReader(INTAKE, onFileLoaded);

  // ── Field ids for ErrorSummary (read in handlers only) ──
  const dropzoneId = useId();
  const authorizationId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const nameRef = useCallback(
    (label: string) => (node: HTMLInputElement | null) => {
      if (node) nameInputs.current.set(label, node);
      else nameInputs.current.delete(label);
    },
    [],
  );
  const pickerIds = useRef(new Map<string, string>());
  const registerPicker = useCallback((label: string, id: string | null) => {
    if (id) pickerIds.current.set(label, id);
    else pickerIds.current.delete(label);
  }, []);

  // ── Derived state ──
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [triedBrief, setTriedBrief] = useState(false);
  const [triedStructure, setTriedStructure] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const issues = useMemo(() => (attempt ? validateMaterial(draft, readyAnalysis, people) : []), [attempt, draft, readyAnalysis, people]);
  const issueOf = (field: DraftField) => issues.find((issue) => issue.field === field)?.message;
  const speakerErrors = useMemo(
    () => Object.fromEntries(issues.filter((issue) => issue.field.startsWith('speaker:')).map((issue) => [issue.field.slice('speaker:'.length), issue.message])),
    [issues],
  );
  // Speakers without a person are one line of the summary ("2 falantes sem pessoa"), linked to the first.
  const summaryErrors = useMemo<FormError[]>(() => {
    const undecided = issues.filter((issue) => issue.unattributed);
    const errors: FormError[] = [];
    for (const issue of issues) {
      if (issue.unattributed && issue !== undecided[0]) continue;
      errors.push(
        issue.unattributed
          ? { id: attempt?.ids[issue.field] ?? '', label: 'Falantes', message: withoutPersonLabel(undecided.length) }
          : { id: attempt?.ids[issue.field] ?? '', label: issue.label, message: issue.message },
      );
    }
    return errors;
  }, [attempt, issues]);

  const previewSpeakers = usePreviewSpeakers(draft.speakers, analysis, people);
  const speakerCount = analysis?.speakers.length ?? detail?.sources[0]?.speakers.length ?? 0;
  const materialIssue = issueOf('material');
  const speakersState: SectionState = Object.keys(speakerErrors).length > 0 ? 'error' : previewSpeakers.length > 0 ? 'done' : 'empty';

  /** Why the primary of the step cannot run yet (COPY §6.1), shown next to it; `undefined` when it can. */
  const structureBlocker = (): string | undefined => {
    if (runState.status === 'failed') return 'Tente montar a estrutura de novo.';
    if (!detail || runState.status !== 'ready' || !outlineDraft) return 'Aguarde a estrutura.';
    if (!outlineDraft.title.trim()) return 'Dê um título ao artigo.';
    return outlineBlocker(outlineDraft);
  };
  const blocker =
    step === 'material'
      ? materialBlocker(draft)
      : step === 'brief'
        ? briefBlocker(activeId ? { ...draft, title: detail?.title ?? 'Produção' } : draft)
        : structureBlocker();

  // ── Leaving: steps 1–2 lose what was typed; step 3 keeps the production (it is saved) ──
  const dirty = !activeId && isDraftDirty(draft);
  const departing = useRef(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  /** Where the person was going when the dialog opened (menu, breadcrumb, ⌘K). */
  const [exitTo, setExitTo] = useState<string>(PRODUCTIONS_HREF);
  useLeaveGuard(busy === null && (activeId ? step === 'structure' : dirty), (href) => {
    setExitTo(href);
    setConfirmExit(true);
  });
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!departing.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // An article that already has text lives in the studio: Estrutura is only for one not started.
  useEffect(() => {
    if (!detail || !article || departing.current || busy) return;
    if (article.status !== 'not_started') {
      departing.current = true;
      router.replace(pieceHref(detail.id, 'article'));
    }
  }, [article, busy, detail, router]);

  // ── Actions ──
  const setMode = (mode: MaterialMode) => update({ mode, speakers: {} });
  const setSpeaker = (label: string, choice: SpeakerChoice) => setDraft((current) => ({ ...current, speakers: { ...current.speakers, [label]: choice } }));

  const fillSample = useCallback(() => {
    fileReader.reset();
    setDraft((current) => ({
      ...current,
      mode: 'paste',
      pasted: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      origin: SAMPLE_ORIGIN,
      recordedOn: daysAgoIso(2),
      angle: SAMPLE_ANGLE,
      sections: SAMPLE_SECTIONS,
      sectionsCustom: SAMPLE_SECTIONS !== sizeOf(SAMPLE_SIZE).sections.default,
      size: SAMPLE_SIZE,
      plan: 'article-carousel',
      speakers: { [SAMPLE_NEW_SPEAKER]: { kind: 'new', name: SAMPLE_NEW_SPEAKER } },
    }));
  }, [fileReader]);

  const fieldIds = (): Attempt['ids'] => {
    const ids: Attempt['ids'] = { material: draft.mode === 'paste' ? textareaRef.current?.id : `${dropzoneId}-dropzone` };
    for (const [label, id] of pickerIds.current) ids[`speaker:${label}`] = id;
    for (const [label, node] of nameInputs.current) ids[`speaker:${label}`] = node.id || undefined;
    return ids;
  };

  /** The analysis of exactly the text on screen (waits for the pending read, if any). */
  const freshAnalysis = async (): Promise<SourceAnalysis | undefined> => {
    if (readyAnalysis) return readyAnalysis;
    if (!hasMaterial(draft)) return undefined;
    const result = await commands.ingest.analyze(material.text, material.fileName ? { fileName: material.fileName, format: 'auto' } : { format: 'auto' });
    return result.ok ? result.value : undefined;
  };

  // The internal title is prefilled from who speaks, until the person writes their own.
  const autoTitle = useRef('');
  const isStaff = useCallback((personId: string) => !people.find((person) => person.id === personId)?.organization, [people]);

  /** Step 1 → 2: the material is there, authorised, and every speaker has an answer. */
  const continueFromMaterial = async () => {
    if (busy) return;
    if (materialBlocker(draft)) {
      focusField(hasMaterial(draft) ? authorizationId : draft.mode === 'paste' ? (textareaRef.current?.id ?? '') : `${dropzoneId}-dropzone`);
      return;
    }
    const current = await freshAnalysis();
    if (validateMaterial(draft, current, people).length > 0) {
      const ids = fieldIds();
      setAttempt((previous) => ({ key: (previous?.key ?? 0) + 1, ids }));
      return;
    }
    setAttempt(null);
    if (!draft.title.trim() || draft.title === autoTitle.current) {
      autoTitle.current = defaultTitle(draft, current, people, isStaff);
      update({ title: autoTitle.current });
    }
    setView('brief');
  };

  /** Step 2 → 3: saves the source and the production, then the outline run proposes the structure. */
  const buildStructure = async () => {
    if (busy) return;
    if (briefBlocker(draft)) {
      setTriedBrief(true);
      if (!draft.title.trim()) titleRef.current?.focus();
      return;
    }
    setBusy('create');
    const current = await freshAnalysis();
    const created = await commands.production.createFromSource(toCreateInput(draft, current, people));
    if (!created.ok) {
      setBusy(null);
      toast('Produção não criada', { tone: 'error', description: created.refusal.message });
      return;
    }
    setCreatedId(created.value.productionId);
    setBusy(null);
    router.replace(structureHref(created.value.productionId));
  };

  /** Step 3 → the pauta of the production that exists (changing it builds a new structure). */
  const backToBrief = () => {
    const brief = detail?.brief;
    if (!brief || busy) return;
    setDraft((current) => ({
      ...current,
      size: brief.size,
      sections: brief.sections,
      sectionsCustom: brief.sections !== sizeOf(brief.size).sections.default,
      angle: brief.angle ?? '',
    }));
    setTriedBrief(false);
    setEditingBrief(true);
  };

  const applyBrief = () => {
    if (busy || !detail) return;
    if (blocker) return;
    const angle = draft.angle.trim();
    const changed = draft.size !== detail.brief.size || draft.sections !== detail.brief.sections || angle !== (detail.brief.angle ?? '').trim();
    if (!changed) setEditingBrief(false);
    else setConfirmRebuild(true);
  };

  const rebuildStructure = async () => {
    setConfirmRebuild(false);
    if (!detail) return;
    const angle = draft.angle.trim();
    setBusy('create');
    const saved = await commands.production.updateBrief(detail.id, { sections: draft.sections, size: draft.size, ...(angle ? { angle } : {}) }, detail.brief.revision);
    if (!saved.ok) {
      setBusy(null);
      toast('Pauta não salva', { tone: 'error', description: saved.refusal.message });
      return;
    }
    await outline.restart();
    setBusy(null);
    setTriedStructure(false);
    setEditingBrief(false);
  };

  /** Step 3 → the studio: the draft is written from the reviewed structure. */
  const writeArticle = async () => {
    if (busy) return;
    if (blocker || !detail || !article || !outlineDraft) {
      setTriedStructure(true);
      return;
    }
    setBusy('draft');
    const simulation = takeArmedSimulation('article.draft');
    const started = await commands.generation.start(
      'article.draft',
      { productionId: detail.id, pieceId: article.id, outline: toOutlineInput(outlineDraft) },
      simulation ? { simulation } : undefined,
    );
    if (!started.ok) {
      setBusy(null);
      toast('Geração não iniciada', { tone: 'error', description: started.refusal.message });
      return;
    }
    departing.current = true;
    router.push(pieceHref(detail.id, 'article'));
  };

  const cancel = () => {
    if (busy) return;
    if (activeId && step === 'brief') {
      setEditingBrief(false);
      return;
    }
    if (activeId || dirty) {
      setExitTo(PRODUCTIONS_HREF);
      setConfirmExit(true);
    } else router.push(PRODUCTIONS_HREF);
  };

  const selectStep = (index: number) => {
    const target = NEW_PRODUCTION_STEPS[index];
    if (busy) return;
    if (activeId) {
      if (target === 'brief' && step === 'structure') backToBrief();
    } else if (target === 'material' || target === 'brief') setView(target);
  };
  // Only steps already done are selectable; with the production saved, the Material is behind.
  const canSelectStep = (index: number, state: StepState) => state === 'done' && !busy && (!activeId || index === 1);

  const primary = {
    material: { label: 'Continuar', icon: undefined, run: continueFromMaterial, loading: false },
    brief: { label: 'Montar estrutura', icon: Sparkles, run: activeId ? applyBrief : buildStructure, loading: busy === 'create' },
    structure: { label: 'Redigir artigo', icon: Sparkles, run: writeArticle, loading: busy === 'draft' },
  }[step];
  const back =
    step === 'material'
      ? { label: 'Cancelar', onClick: cancel, hideNarrow: true }
      : step === 'brief' && activeId
        ? { label: 'Cancelar', onClick: () => setEditingBrief(false), hideNarrow: false }
        : step === 'brief'
          ? { label: 'Voltar', onClick: () => setView('material'), hideNarrow: false }
          : { label: 'Voltar', onClick: backToBrief, hideNarrow: false };

  useCommandGroup({
    label: 'Nova produção',
    items: [
      ...(step === 'material' && !hasMaterial(draft) ? [{ id: 'new-production-sample', label: 'Usar exemplo', icon: FileText, onSelect: fillSample }] : []),
      ...(blocker ? [] : [{ id: 'new-production-next', label: primary.label, icon: Sparkles, onSelect: () => void primary.run() }]),
    ],
  });

  // ── Footer state ──
  // Speakers without a person count once, as the summary lists them ("2 falantes sem pessoa").
  const errorCount = step === 'material' ? summaryErrors.length : 0;
  const statusText =
    busy === 'create' ? (activeId ? 'Montando a estrutura…' : 'Salvando material…') : busy === 'draft' ? 'Iniciando o artigo…' : errorCount > 0 ? `Revise ${plural(errorCount, 'campo', 'campos')}` : '';
  const summary = step === 'brief' ? briefSummary(draft.size, draft.sections, speakerCount) : '';
  const footerMeta = (narrow: boolean) => statusText || blocker || (narrow ? '' : summary) || undefined;

  const proposal = runState.status === 'ready' ? runState.proposal : undefined;
  const facts = [
    briefSummary(outlineDraft?.size ?? detail?.brief.size ?? draft.size, outlineDraft?.sections.length ?? detail?.brief.sections ?? draft.sections, 0),
    proposal?.shortfall
      ? `O material rende ≈ ${formatLaudas(proposal.shortfall.expectedChars)}. O texto sai com isso.`
      : proposal?.materialChars !== undefined
        ? `O material rende ≈ ${formatLaudas(proposal.materialChars)}`
        : '',
  ].filter(Boolean);

  const primaryButton = (
    <Button variant="primary" icon={primary.icon} aria-disabled={blocker ? true : undefined} loading={primary.loading} onClick={() => void primary.run()}>
      {primary.label}
    </Button>
  );

  return (
    <>
      <FixedFrame
        docked
        mainLabel="Nova produção"
        header={(narrow) => (
          <PageHeader
            variant="frame"
            title="Nova produção"
            steps={
              <Stepper
                label="Passos da nova produção"
                steps={STEP_ITEMS}
                current={NEW_PRODUCTION_STEPS.indexOf(step)}
                onStepSelect={selectStep}
                canSelect={canSelectStep}
                size="sm"
              />
            }
            more={
              narrow ? (
                <Tooltip content="Cancelar">
                  <IconButton label="Cancelar" icon={X} variant="ghost" onClick={cancel} />
                </Tooltip>
              ) : undefined
            }
          />
        )}
        footer={(narrow) => (
          // DS gap: the docked footer band already draws the rule and padding and does not stretch its
          // child, so an ActionBar would double both; Section's head (meta left, actions right) fills it.
          <Grid columns="1:1" collapseBelow={false}>
            <GridItem span="full">
              <Section
                meta={footerMeta(narrow)}
                metaTone={errorCount > 0 && !busy ? 'missing' : 'muted'}
                action={
                  <>
                    {narrow && back.hideNarrow ? null : (
                      <Button variant="ghost" disabled={busy !== null} onClick={back.onClick}>
                        {back.label}
                      </Button>
                    )}
                    {blocker ? <Tooltip content={blocker}>{primaryButton}</Tooltip> : primaryButton}
                  </>
                }
              />
            </GridItem>
          </Grid>
        )}
      >
        {step === 'material' ? (
          <PageStack>
            {attempt ? <ErrorSummary errors={summaryErrors} focusKey={attempt.key} /> : null}
            <MaterialSection
              draft={draft}
              material={analysisState}
              fileRead={fileReader.state}
              intake={INTAKE}
              error={materialIssue}
              state={materialState(draft, analysisState, fileReader.state, Boolean(materialIssue))}
              dropzoneId={dropzoneId}
              textareaRef={textareaRef}
              onModeChange={setMode}
              onPaste={(pasted) => update({ pasted })}
              onFile={fileReader.read}
              onReject={fileReader.reject}
              onRemoveFile={() => update({ file: null, speakers: {} })}
              onCancelRead={fileReader.reset}
              onRetryRead={fileReader.retry}
              onUseSample={fillSample}
            />
            <SpeakersSection
              draft={draft}
              analysis={analysis}
              people={people}
              peopleLoading={peopleQuery.status === 'loading'}
              state={speakersState}
              errors={speakerErrors}
              onChange={setSpeaker}
              nameRef={nameRef}
              registerPicker={registerPicker}
            />
            <FormSection title="Autorização" titleAs="h2" state={draft.authorized ? 'done' : 'empty'} open>
              <FormRow label="Uso do material" required description="Obrigatória para continuar">
                <Checkbox
                  id={authorizationId}
                  label="Os falantes autorizaram o uso"
                  checked={draft.authorized}
                  onChange={(event) => update({ authorized: event.target.checked })}
                />
              </FormRow>
            </FormSection>
          </PageStack>
        ) : step === 'brief' ? (
          <PageStack>
            <BriefStep
              draft={draft}
              update={update}
              charsAvailable={activeId ? detail?.charsAvailable : analysis?.outlook?.charsAvailable}
              existing={Boolean(activeId)}
              titleError={triedBrief && !draft.title.trim() ? 'Dê um título interno.' : undefined}
              titleRef={titleRef}
              today={today}
            />
          </PageStack>
        ) : production.status === 'error' && !detail ? (
          <ErrorState
            size="panel"
            title="Não encontramos esta produção."
            description={production.error.message}
            onRetry={production.retry}
            actions={<LinkButton onClick={() => router.push(PRODUCTIONS_HREF)}>Ir para Produções</LinkButton>}
          />
        ) : (
          <StructureStep
            run={runState}
            onRetry={() => void outline.restart()}
            retrying={runState.status === 'loading'}
            outline={outlineDraft}
            onChange={setOutlineDraft}
            material={quotes}
            facts={facts}
            showErrors={triedStructure}
          />
        )}
      </FixedFrame>
      <LiveRegion message={statusText} />
      <ConfirmDialog
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title={activeId ? 'Sair sem redigir?' : 'Descartar a nova produção?'}
        description={activeId ? 'A produção fica salva em Produções. Você pode redigir depois.' : 'O que você colou não fica salvo.'}
        confirmLabel={activeId ? 'Sair' : 'Descartar'}
        cancelLabel="Continuar aqui"
        tone={activeId ? 'default' : 'danger'}
        onConfirm={() => {
          departing.current = true;
          setConfirmExit(false);
          if (!activeId) setDraft(EMPTY_DRAFT);
          router.push(exitTo);
        }}
      />
      <ConfirmDialog
        open={confirmRebuild}
        onClose={() => setConfirmRebuild(false)}
        title="Montar a estrutura de novo?"
        description="A pauta mudou. A IA monta uma nova estrutura e as suas mudanças nesta se perdem."
        confirmLabel="Montar de novo"
        cancelLabel="Cancelar"
        onConfirm={() => void rebuildStructure()}
      />
    </>
  );
}
