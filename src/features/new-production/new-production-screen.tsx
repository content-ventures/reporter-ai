'use client';

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccessState,
  Button,
  ButtonLink,
  Checkbox,
  ConfirmDialog,
  ErrorSummary,
  FixedFrame,
  FormRow,
  FormSection,
  Grid,
  GridItem,
  IconButton,
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
import { materialMinutes, sizeOf } from '@/domain';
import { sourceLinkMessage } from '@/domain/source-link';
import { correctTerm, replaceTerm, type TermCorrection } from '@/domain/text/terms';
import { MAX_UPLOAD_BYTES, MEDIA_EXTENSIONS } from '../../domain/reporter.ts';
import type { PersonSummary, SourceAnalysis } from '@/ports';
import { sourceKind, type SourceIntake } from '@/registries';
import { useCan, useCommands, usePeople, useSession } from '@/state';
import { plural } from '@/ui/format';
import { PRODUCTIONS_HREF, pieceHref } from '@/ui/routes';
import { takeArmedSimulation, useCommandGroup, useLeaveGuard } from '@/ui/shell';
import { useNow } from '@/ui/time';
import { BriefStep } from './brief-sections';
import {
  EMPTY_DRAFT,
  eventDraft,
  type EventDraft,
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
  withFormat,
  withoutPersonLabel,
  type DraftField,
  type MaterialFile,
  type MaterialMode,
  type NewProductionDraft,
  type NewProductionStep,
  type SpeakerChoice,
} from './form';
import { MaterialSection, materialState } from './material-section';
import { materialProgress } from './material-progress';
import { MaterialProgressDialog } from './material-progress-dialog';
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
import { useFileReader, type ReceivedExtras } from './use-file-reader';
import { useLinkReader, type ImportedLink } from './use-link-reader';
import { useMaterialAnalysis } from './use-material-analysis';
import { notifyRefusal } from '@/ui/permission-dialog';

/** Material and pauta are confirmed before opening the editor with a queued article run. */

const FALLBACK_INTAKE: SourceIntake = { extensions: ['.txt', '.md', '.srt', '.vtt'], maxBytes: 2 * 1024 * 1024, paste: true };
const INTAKE: SourceIntake = sourceKind('transcript')?.intake ?? FALLBACK_INTAKE;
const NO_PEOPLE: readonly PersonSummary[] = [];
const PASTE_PAUSE_MS = 350;

type Busy = 'create' | null;
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

/**
 * A role that does not create productions never reaches the upload: a deep link answers
 * AccessState (nothing while the session is unknown, so the form never flashes).
 */
export function NewProductionScreen({ received }: { received?: string } = {}) {
  const session = useSession();
  const creates = useCan('production.create');
  if (!session.data) return null;
  if (!creates) {
    return (
      <AccessState
        kind="restricted"
        heading="h1"
        title="Nova produção é para quem edita"
        description="Peça a um admin o papel de editor."
        actions={<ButtonLink href={PRODUCTIONS_HREF} variant="primary">Ver produções</ButtonLink>}
      />
    );
  }
  return <NewProductionForm received={received} />;
}

/** `received`: a file the Drive folder brought in, opened as if it had just been uploaded here. */
function NewProductionForm({ received }: { received?: string }) {
  const router = useRouter();
  const commands = useCommands();
  const intake: SourceIntake = { ...INTAKE,extensions: [...INTAKE.extensions,...MEDIA_EXTENSIONS],maxBytes: MAX_UPLOAD_BYTES };
  const peopleQuery = usePeople();
  const people = peopleQuery.data ?? NO_PEOPLE;
  // From the shared page clock after hydration (the server never computes "today").
  const now = useNow();
  const today = now ? isoDay(now) : undefined;

  // A Drive file opens on "Arquivo", its progress on screen, as an upload just started would.
  const [draft, setDraft] = useState<NewProductionDraft>(() => (received ? { ...EMPTY_DRAFT, mode: 'file' } : EMPTY_DRAFT));
  // A coverage offers the event typed for the previous one on this device, never fills it by itself:
  // a material from another fair would otherwise go out with the wrong box. Undefined: not read yet.
  const [eventSuggestion, setEventSuggestion] = useState<EventDraft | null>();
  const update = useCallback((patch: Partial<NewProductionDraft>) => {
    if (patch.format) setEventSuggestion((current) => (current === undefined ? lastEvent() ?? null : current));
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const [step, setView] = useState<NewProductionStep>('material');

  // ── Material ──
  const material = draftMaterial(draft);
  const analysisState = useMaterialAnalysis(material.text, material.fileName, draft.mode === 'paste' ? PASTE_PAUSE_MS : 0);
  const analysis = analysisState.analysis;
  const readyAnalysis = analysisState.status === 'ready' ? analysis : undefined;

  const onFileLoaded = useCallback((file: MaterialFile, extras?: ReceivedExtras) => {
    // A Drive subfolder that names a format offers the previous event, as choosing the format does.
    if (extras?.format) setEventSuggestion((current) => (current === undefined ? lastEvent() ?? null : current));
    setDraft((current) => {
      const next: NewProductionDraft = { ...current, file, speakers: {} };
      if (!extras) return next;
      // The Drive subfolder names the format and the file's day dates the interview; both stay editable.
      if (extras.recordedOn && !current.recordedOn) next.recordedOn = extras.recordedOn;
      if (!extras.format || current.format) return next;
      return { ...next, ...withFormat(extras.format) };
    });
  }, []);
  // "Corrigir termo": a misheard name is fixed in the material itself, before the production exists.
  // A corrected speaker name keeps the choice the reporter already made for that speaker; when two
  // labels become one, the choice already made for the right name wins.
  const replaceMaterialTerm = (from: string, to: string): TermCorrection => {
    const result = correctTerm(draftMaterial(draft).text, from, to);
    if (result.refused || !result.count) return result;
    const speakers: Record<string, SpeakerChoice> = {};
    const moved = Object.entries(draft.speakers).map(([label, choice]) => ({ label, choice, next: replaceTerm(label, from, to) }));
    for (const { label, choice, next } of moved) if (!next.count) speakers[label.normalize('NFC')] = choice;
    for (const { choice, next } of moved) if (next.count && !(next.text.normalize('NFC') in speakers)) speakers[next.text.normalize('NFC')] = choice;
    const { text } = result;
    if (draft.mode === 'paste') update({ pasted: text, speakers });
    else if (draft.mode === 'file' && draft.file) update({ file: { ...draft.file, text }, speakers });
    else if (draft.mode === 'link' && draft.linkFile) update({ linkFile: { ...draft.linkFile, text }, speakers });
    return result;
  };
  const fileReader = useFileReader(intake, onFileLoaded);
  const onLinkLoaded = useCallback((value: ImportedLink) => setDraft((current) => ({
    ...current,linkFile: value.file,sourceUrl: value.sourceUrl,programName: current.programName?.trim() ? current.programName : value.programName,speakers: {},
  })),[]);
  const linkReader = useLinkReader(onLinkLoaded);
  const [progressVisible,setProgressVisible] = useState(Boolean(received));
  const showProgress = useCallback(() => setProgressVisible(true),[]);
  const closeProgress = useCallback(() => setProgressVisible(false),[]);
  const progress = materialProgress(draft,analysisState,fileReader.state,linkReader.state);
  // Opened from a Drive card: the file arrives as an upload would. A remount (Strict Mode)
  // cancels the reader's read, so every mount starts it again.
  const loadReceived = useEffectEvent((id: string) => fileReader.load(id));
  useEffect(() => {
    if (received) loadReceived(received);
  }, [received]);

  // ── Field ids for ErrorSummary (read in handlers only) ──
  const dropzoneId = useId();
  const authorizationId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
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
  const speakerCount = analysis?.speakers.length ?? 0;
  const materialIssue = issueOf('material');
  const speakersState: SectionState = Object.keys(speakerErrors).length > 0 ? 'error' : previewSpeakers.length > 0 ? 'done' : 'empty';

  const blocker = step === 'material'
    ? materialBlocker(draft) ?? (analysisState.status === 'analyzing' ? 'Aguarde a análise do material.' :
      analysisState.status === 'error' ? 'Tente analisar o material novamente.' : undefined)
    : briefBlocker(draft);

  // Both form steps contain an unsaved draft until the production is created.
  const dirty = isDraftDirty(draft);
  const departing = useRef(false);
  const [confirmExit, setConfirmExit] = useState(false);
  /** Where the person was going when the dialog opened (menu, breadcrumb, ⌘K). */
  const [exitTo, setExitTo] = useState<string>(PRODUCTIONS_HREF);
  useLeaveGuard(busy === null && dirty, (href) => {
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

  // ── Actions ──
  const setMode = (mode: MaterialMode) => {
    closeProgress();
    if (mode!=='file') fileReader.reset();
    if (mode!=='link') linkReader.reset();
    update({ mode,speakers: {} });
  };
  const changeLink = (sourceUrl: string) => {
    linkReader.reset();
    update({ sourceUrl,linkFile: null,speakers: {} });
  };
  const importLink = () => {
    const message = sourceLinkMessage(draft.sourceUrl ?? '');
    if (message) { toast('Link não importado',{ tone: 'error',description: message });linkRef.current?.focus();return; }
    update({ linkFile: null,speakers: {} });
    showProgress();
    linkReader.read(draft.sourceUrl ?? '');
  };
  const importFile = (file: File) => {
    update({ file: null,speakers: {} });
    showProgress();
    fileReader.read(file);
  };
  const cancelPreparation = () => {
    if (draft.mode === 'file') fileReader.reset();
    if (draft.mode === 'link') linkReader.reset();
    closeProgress();
  };
  const retryPreparation = () => {
    if (progress?.retry === 'pick') { fileReader.retry();closeProgress();return; }
    showProgress();
    if (progress?.retry === 'file') fileReader.retry();
    else if (progress?.retry === 'link') linkReader.retry();
    else analysisState.retry?.();
  };
  const setSpeaker = (label: string, choice: SpeakerChoice) => setDraft((current) => ({ ...current, speakers: { ...current.speakers, [label]: choice } }));

  const fillSample = useCallback(() => {
    fileReader.reset();
    linkReader.reset();
    showProgress();
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
  }, [fileReader,linkReader,showProgress]);

  const fieldIds = (): Attempt['ids'] => {
    const ids: Attempt['ids'] = { material: draft.mode === 'paste' ? textareaRef.current?.id : draft.mode === 'link' ? linkRef.current?.id : `${dropzoneId}-dropzone` };
    for (const [label, id] of pickerIds.current) ids[`speaker:${label}`] = id;
    for (const [label, node] of nameInputs.current) ids[`speaker:${label}`] = node.id || undefined;
    return ids;
  };

  /** The analysis of exactly the text on screen (waits for the pending read, if any). */
  const freshAnalysis = async (): Promise<SourceAnalysis | undefined> => {
    if (readyAnalysis) return readyAnalysis;
    if (!hasMaterial(draft)) return undefined;
    const result = await commands.ingest.analyze(material.text, material.fileName ? { fileName: material.fileName, format: 'auto' } : { format: 'auto' });
    if (!result.ok) notifyRefusal('Material não analisado', result.refusal);
    return result.ok ? result.value : undefined;
  };

  // Prefer the material's topic; a human-written internal title is never overwritten.
  const autoTitle = useRef('');
  const isStaff = useCallback((personId: string) => !people.find((person) => person.id === personId)?.organization, [people]);

  /** Step 1 → 2: the material is there, authorised, and every speaker has an answer. */
  const continueFromMaterial = async () => {
    if (busy) return;
    if (analysisState.status !== 'ready') return;
    if (materialBlocker(draft)) {
      focusField(hasMaterial(draft) ? authorizationId : draft.mode === 'paste' ? (textareaRef.current?.id ?? '') :
        draft.mode === 'link' ? (linkRef.current?.id ?? '') : `${dropzoneId}-dropzone`);
      return;
    }
    const current = await freshAnalysis();
    if (!current) return;
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

  /** Enqueue only; source preparation and writing happen in the editor, reload-safe. */
  const createArticle = async () => {
    if (busy) return;
    if (briefBlocker(draft)) {
      setTriedBrief(true);
      if (!draft.title.trim()) titleRef.current?.focus();
      return;
    }
    setBusy('create');
    const current = await freshAnalysis();
    if (!current) { setBusy(null); return; }
    const created = await commands.production.createFromSource(toCreateInput(draft, current, people));
    if (created.ok && draft.format && draft.event.name.trim()) rememberEvent(draft.event);
    if (!created.ok) {
      setBusy(null);
      notifyRefusal('Produção não criada', created.refusal);
      return;
    }
    const article = created.value.pieces.find((piece) => piece.kind === 'article');
    if (article) {
      const simulation = takeArmedSimulation('article.draft');
      const started = await commands.generation.start('article.draft',
        { productionId: created.value.productionId, pieceId: article.pieceId }, simulation ? { simulation } : undefined);
      if (!started.ok) notifyRefusal('Produção salva; geração não iniciada', started.refusal);
    }
    departing.current = true;
    router.replace(pieceHref(created.value.productionId, 'article'));
  };

  const cancel = () => {
    if (busy) return;
    if (dirty) {
      setExitTo(PRODUCTIONS_HREF);
      setConfirmExit(true);
    } else router.push(PRODUCTIONS_HREF);
  };

  const selectStep = (index: number) => {
    if (!busy && NEW_PRODUCTION_STEPS[index]) setView(NEW_PRODUCTION_STEPS[index]);
  };
  const canSelectStep = (_index: number, state: StepState) => state === 'done' && !busy;
  const primary = {
    material: { label: 'Continuar', icon: undefined, run: continueFromMaterial, loading: false },
    brief: { label: draft.format ? 'Gerar texto' : 'Gerar artigo', icon: Sparkles, run: createArticle, loading: busy === 'create' },
  }[step];
  const back = step === 'material'
    ? { label: 'Cancelar', onClick: cancel, hideNarrow: true }
    : { label: 'Voltar', onClick: () => setView('material'), hideNarrow: false };

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
    busy === 'create' ? 'Abrindo o editor…' : errorCount > 0 ? `Revise ${plural(errorCount, 'campo', 'campos')}` : '';
  const summary = step === 'brief' ? briefSummary(draft.size, draft.sections, speakerCount, draft) : '';
  const footerMeta = (narrow: boolean) => statusText || blocker || (narrow ? '' : summary) || undefined;

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
            toolbar={
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
              linkRead={linkReader.state}
              intake={intake}
              error={materialIssue}
              state={materialState(draft, analysisState, fileReader.state, linkReader.state, Boolean(materialIssue))}
              dropzoneId={dropzoneId}
              textareaRef={textareaRef}
              linkRef={linkRef}
              onModeChange={setMode}
              onPaste={(pasted) => update({ pasted })}
              onBeginProcessing={showProgress}
              onShowProgress={showProgress}
              onLinkChange={changeLink}
              onImportLink={importLink}
              onFile={importFile}
              onReject={(rejected) => { fileReader.reject(rejected);showProgress(); }}
              onRemoveFile={() => update({ file: null, speakers: {} })}
              onCancelRead={cancelPreparation}
              onRetryRead={retryPreparation}
              onCancelLink={cancelPreparation}
              onRetryLink={retryPreparation}
              onRemoveLink={() => { linkReader.reset();update({ linkFile: null,sourceUrl: '',speakers: {} }); }}
              onUseSample={fillSample}
              onReplaceTerm={replaceMaterialTerm}
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
        ) : (
          <PageStack>
            <BriefStep
              draft={draft}
              update={update}
              charsAvailable={analysis?.outlook?.charsAvailable}
              materialMinutes={analysis ? materialMinutes(analysis.stats) : undefined}
              existing={false}
              titleError={triedBrief && !draft.title.trim() ? 'Dê um título interno.' : undefined}
              titleRef={titleRef}
              today={today}
              eventSuggestion={eventSuggestion && !draft.event.name.trim() ? eventSuggestion : undefined}
              onEventSuggestion={(use) => {
                if (use && eventSuggestion) update({ event: eventSuggestion });
                setEventSuggestion(null);
              }}
            />
          </PageStack>
        )}
      </FixedFrame>
      <MaterialProgressDialog open={progressVisible && step === 'material'} progress={progress}
        onClose={closeProgress} onCancel={cancelPreparation} onRetry={retryPreparation} />
      <LiveRegion message={statusText} />
      <ConfirmDialog
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Descartar a nova produção?"
        description="O que você colou não fica salvo."
        confirmLabel="Descartar"
        cancelLabel="Continuar aqui"
        tone="danger"
        onConfirm={() => {
          departing.current = true;
          setConfirmExit(false);
          setDraft(EMPTY_DRAFT);
          router.push(exitTo);
        }}
      />
    </>
  );
}

const LAST_EVENT_KEY = 'reporter.new-production.last-event';

/** The event of the last coverage created on this device, as the form edits it. */
function lastEvent(): EventDraft | undefined {
  try {
    const stored = JSON.parse(window.localStorage.getItem(LAST_EVENT_KEY) ?? 'null') as Partial<EventDraft> | null;
    return stored?.name ? eventDraft(stored) : undefined;
  } catch {
    return undefined;
  }
}

function rememberEvent(event: EventDraft) {
  try {
    window.localStorage.setItem(LAST_EVENT_KEY, JSON.stringify(event));
  } catch {
    /* Private windows and blocked storage only lose the convenience. */
  }
}
