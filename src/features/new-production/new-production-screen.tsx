'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  ConfirmDialog,
  ErrorSummary,
  FixedFrame,
  Grid,
  GridItem,
  IconButton,
  LiveRegion,
  LinkButton,
  PageHeader,
  PageStack,
  Section,
  Stepper,
  Tooltip,
  focusField,
  toast,
  type FormError,
  type SectionState,
  type StepItem,
} from '@content-ventures/design-system/v3';
import { FileText, Sparkles, X } from '@content-ventures/design-system/v3/icons';
import type { PersonSummary, SourceAnalysis } from '@/ports';
import { sourceKind, type SourceIntake } from '@/registries';
import { useCommands, usePeople } from '@/state';
import { plural } from '@/ui/format';
import { PRODUCTIONS_HREF, materialHref, pieceHref } from '@/ui/routes';
import { takeArmedSimulation, useCommandGroup, useLeaveGuard } from '@/ui/shell';
import { useNow } from '@/ui/time';
import { ArticleSection, ContextSection, DeliverySection } from './brief-sections';
import {
  EMPTY_DRAFT,
  draftMaterial,
  generationBlocker,
  hasMaterial,
  isDraftDirty,
  plannedStages,
  titleFromFileName,
  toCreateInput,
  validateDraft,
  withoutPersonLabel,
  type DraftField,
  type MaterialFile,
  type MaterialMode,
  type NewProductionDraft,
  type SpeakerChoice,
} from './form';
import { LivePreview, namesForOutlook, usePreviewSpeakers } from './live-preview';
import { MaterialSection, materialState } from './material-section';
import {
  SAMPLE_ANGLE,
  SAMPLE_LENGTH,
  SAMPLE_NEW_SPEAKER,
  SAMPLE_ORIGIN,
  SAMPLE_SECTIONS,
  SAMPLE_TITLE,
  SAMPLE_TRANSCRIPT,
} from './sample-material';
import { SpeakersSection } from './speakers-section';
import { useFileReader } from './use-file-reader';
import { useMaterialAnalysis } from './use-material-analysis';

/**
 * Nova produção (`/productions/new`, PLAN §3.3, reference 3): a creation page, never a modal.
 * Material → Falantes → Contexto → Artigo → Entregas on the left, the live preview on the right,
 * and the fixed action bar. "Gerar artigo" stays unavailable, with its reason, until the
 * material is authorised (registry check, REQ-T.1); it saves the source first, starts the
 * generation run and opens the article studio, where the stream continues (REQ-1.1, REQ-1.2).
 */

const FALLBACK_INTAKE: SourceIntake = { extensions: ['.txt', '.md', '.srt', '.vtt'], maxBytes: 2 * 1024 * 1024, paste: true };
const INTAKE: SourceIntake = sourceKind('transcript')?.intake ?? FALLBACK_INTAKE;
const NO_PEOPLE: readonly PersonSummary[] = [];
const PASTE_PAUSE_MS = 350;

type Busy = 'draft' | 'generate' | null;
type Attempt = { key: number; ids: Partial<Record<DraftField, string>>; intent: Exclude<Busy, null> };

const pad = (value: number) => String(value).padStart(2, '0');

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDay(date);
}

export function NewProductionScreen() {
  const router = useRouter();
  const commands = useCommands();
  const peopleQuery = usePeople();
  const people = peopleQuery.data ?? NO_PEOPLE;
  // From the shared page clock after hydration (the server never computes "today").
  const now = useNow();
  const today = now ? isoDay(now) : undefined;

  const [draft, setDraft] = useState<NewProductionDraft>(EMPTY_DRAFT);
  const update = useCallback((patch: Partial<NewProductionDraft>) => setDraft((current) => ({ ...current, ...patch })), []);

  const material = draftMaterial(draft);
  // Names the draft will write ("diz Lucas Ferraz"), fed back from "Falantes" once the speakers are known.
  const [speakerNames, setSpeakerNames] = useState<Readonly<Record<string, string>>>({});
  const analysisState = useMaterialAnalysis(material.text, material.fileName, draft.mode === 'paste' ? PASTE_PAUSE_MS : 0, {
    angle: draft.angle,
    speakerNames,
  });
  const analysis = analysisState.analysis;
  const readyAnalysis = analysisState.status === 'ready' ? analysis : undefined;

  const onFileLoaded = useCallback(
    (file: MaterialFile) =>
      setDraft((current) => ({ ...current, file, speakers: {}, title: current.title.trim() ? current.title : titleFromFileName(file.name) })),
    [],
  );
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
  const [busy, setBusy] = useState<Busy>(null);
  const issues = useMemo(() => (attempt ? validateDraft(draft, readyAnalysis, people, attempt.intent) : []), [attempt, draft, readyAnalysis, people]);
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

  const blocker = generationBlocker(draft, analysis);
  const dirty = isDraftDirty(draft);
  const steps = useMemo<StepItem[]>(() => plannedStages(draft.plan).map((stage) => ({ id: stage.id, label: stage.label })), [draft.plan]);
  const previewSpeakers = usePreviewSpeakers(draft.speakers, analysis, people);
  const namedSpeakers = namesForOutlook(previewSpeakers);
  if (JSON.stringify(namedSpeakers) !== JSON.stringify(speakerNames)) setSpeakerNames(namedSpeakers);
  const [confirmExit, setConfirmExit] = useState(false);
  /** Where the person was going when "Descartar a nova produção?" opened (menu, breadcrumb, ⌘K). */
  const [exitTo, setExitTo] = useState<string>(PRODUCTIONS_HREF);
  useLeaveGuard(dirty && busy === null, (href) => {
    setExitTo(href);
    setConfirmExit(true);
  });

  const materialIssue = issueOf('material');
  const speakersState: SectionState = Object.keys(speakerErrors).length > 0 ? 'error' : previewSpeakers.length > 0 ? 'done' : 'empty';

  // Leaving with typed material asks first (a reload or closing the tab).
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

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
      length: SAMPLE_LENGTH,
      plan: 'article-carousel',
      speakers: { [SAMPLE_NEW_SPEAKER]: { kind: 'new', name: SAMPLE_NEW_SPEAKER } },
    }));
  }, [fileReader]);

  const fieldIds = (): Attempt['ids'] => {
    const ids: Attempt['ids'] = {
      material: draft.mode === 'paste' ? textareaRef.current?.id : `${dropzoneId}-dropzone`,
      title: titleRef.current?.id,
    };
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

  const submit = async (kind: Exclude<Busy, null>) => {
    if (busy) return;
    if (kind === 'generate' && blocker) {
      focusField(authorizationId);
      return;
    }
    const current = await freshAnalysis();
    const problems = validateDraft(draft, current, people, kind);
    if (problems.length > 0) {
      const ids = fieldIds();
      setAttempt((previous) => ({ key: (previous?.key ?? 0) + 1, ids, intent: kind }));
      return;
    }
    setAttempt(null);
    setBusy(kind);
    const created = await commands.production.createFromSource(toCreateInput(draft, current, people));
    if (!created.ok) {
      setBusy(null);
      toast('Produção não criada', { tone: 'error', description: created.refusal.message });
      return;
    }
    leaving.current = true;
    const { productionId, pieces } = created.value;
    if (kind === 'draft') {
      toast('Rascunho salvo', { description: draft.title.trim() });
      router.push(materialHref(productionId));
      return;
    }
    const article = pieces.find((piece) => piece.kind === 'article');
    if (article) {
      const simulation = takeArmedSimulation('article.draft');
      const started = await commands.generation.start('article.draft', { productionId, pieceId: article.pieceId }, simulation ? { simulation } : undefined);
      if (!started.ok) toast('Geração não iniciada', { tone: 'error', description: started.refusal.message });
    }
    router.push(pieceHref(productionId, 'article'));
  };

  const cancel = () => {
    if (busy) return;
    if (dirty) {
      setExitTo(PRODUCTIONS_HREF);
      setConfirmExit(true);
    } else router.push(PRODUCTIONS_HREF);
  };

  useCommandGroup({
    label: 'Nova produção',
    items: [
      ...(hasMaterial(draft) ? [] : [{ id: 'new-production-sample', label: 'Usar exemplo', icon: FileText, onSelect: fillSample }]),
      ...(blocker ? [] : [{ id: 'new-production-generate', label: 'Gerar artigo', icon: Sparkles, onSelect: () => void submit('generate') }]),
    ],
  });

  // ── Footer state ──
  // Speakers without a person count once, as the summary lists them ("2 falantes sem pessoa").
  const errorCount = summaryErrors.length;
  const statusText = busy ? 'Salvando material…' : errorCount > 0 ? `Revise ${plural(errorCount, 'campo', 'campos')}` : '';
  const needsAuthorization = Boolean(blocker) && hasMaterial(draft) && !draft.authorized;
  const footerMeta = (narrow: boolean) => {
    if (statusText) return statusText;
    if (needsAuthorization && !narrow) return <LinkButton onClick={() => focusField(authorizationId)}>Autorizar material</LinkButton>;
    return undefined;
  };

  const generateButton = (
    <Button
      variant="primary"
      icon={Sparkles}
      aria-disabled={blocker ? true : undefined}
      loading={busy === 'generate'}
      onClick={() => void submit('generate')}
    >
      Gerar artigo
    </Button>
  );

  const words = analysis?.stats.words;
  const asideSummary = ['Prévia', words !== undefined ? plural(words, 'palavra', 'palavras') : null, previewSpeakers.length > 0 ? plural(previewSpeakers.length, 'falante', 'falantes') : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <FixedFrame
        docked
        mainLabel="Nova produção"
        asideLabel="Prévia da produção"
        asideSummary={asideSummary}
        header={(narrow) => (
          <PageHeader
            variant="frame"
            title="Nova produção"
            actions={<Stepper label="Etapas da produção" steps={steps} current={0} size="sm" fit={narrow ? 'fill' : 'content'} align="end" />}
            more={
              narrow ? (
                <Tooltip content="Cancelar">
                  <IconButton label="Cancelar" icon={X} variant="ghost" onClick={cancel} />
                </Tooltip>
              ) : undefined
            }
          />
        )}
        aside={
          <LivePreview
            draft={draft}
            analysis={analysis}
            loading={analysisState.status === 'analyzing' && !analysis}
            speakers={previewSpeakers}
          />
        }
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
                    {narrow ? null : (
                      <Button variant="ghost" disabled={busy !== null} onClick={cancel}>
                        Cancelar
                      </Button>
                    )}
                    <Button variant="ghost" loading={busy === 'draft'} disabled={busy === 'generate'} onClick={() => void submit('draft')}>
                      Salvar rascunho
                    </Button>
                    {blocker ? <Tooltip content={blocker}>{generateButton}</Tooltip> : generateButton}
                  </>
                }
              />
            </GridItem>
          </Grid>
        )}
      >
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
          <ContextSection
            draft={draft}
            update={update}
            titleError={issueOf('title')}
            titleRef={titleRef}
            authorizationId={authorizationId}
            today={today}
          />
          <ArticleSection draft={draft} update={update} wordsAvailable={analysis?.outlook?.wordsAvailable} />
          <DeliverySection draft={draft} update={update} />
        </PageStack>
      </FixedFrame>
      <LiveRegion message={statusText} />
      <ConfirmDialog
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Descartar a nova produção?"
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        tone="danger"
        onConfirm={() => {
          leaving.current = true;
          setConfirmExit(false);
          setDraft(EMPTY_DRAFT);
          router.push(exitTo);
        }}
      />
    </>
  );
}
