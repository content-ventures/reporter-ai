'use client';

import type { Ref } from 'react';
import {
  Alert,
  Dropzone,
  FileRow,
  FormRow,
  FormSection,
  LinkButton,
  Segmented,
  TextLink,
  Textarea,
  type RejectedFile,
  type SectionState,
  type SegmentOption,
} from '@content-ventures/design-system/v3';
import { ClipboardList, FileUp } from '@content-ventures/design-system/v3/icons';
import type { SourceAnalysis } from '@/ports';
import type { SourceIntake } from '@/registries';
import { formatCount, plural } from '@/ui/format';
import { productionHref } from '@/ui/routes';
import { FORMAT_LABELS, type MaterialMode, type NewProductionDraft } from './form';
import type { FileReadState } from './use-file-reader';
import type { MaterialAnalysis } from './use-material-analysis';

/**
 * "Material" (PLAN §3.3): paste or send the transcript, see what was understood (format, words,
 * speakers) and the two warnings that matter before saving: the same material already lives in
 * another production (amber, with the link) and a material too short for a full article.
 */

const MODES: SegmentOption<MaterialMode>[] = [
  { value: 'paste', label: 'Colar texto', icon: ClipboardList },
  { value: 'file', label: 'Enviar arquivo', icon: FileUp },
];

const PLACEHOLDER = 'Clara Souto: Bom dia, Marina. Pra começar, conta pra quem não conhece…';

/** "Falas com nome · 1.042 palavras · 3 falantes". */
export function analysisLine(analysis: SourceAnalysis): string {
  const speakers = analysis.speakers.length;
  return [
    FORMAT_LABELS[analysis.format],
    plural(analysis.stats.words, 'palavra', 'palavras'),
    speakers > 0 ? plural(speakers, 'falante', 'falantes') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function specOf(intake: SourceIntake): string {
  const formats = intake.extensions.map((extension) => extension.replace('.', '').toUpperCase());
  const last = formats.pop();
  return `${formats.join(', ')} ou ${last} · até ${Math.round(intake.maxBytes / (1024 * 1024))} MB`;
}

export function materialState(draft: NewProductionDraft, material: MaterialAnalysis, fileRead: FileReadState | null, invalid: boolean): SectionState {
  if (invalid || material.status === 'error' || fileRead?.status === 'error') return 'error';
  if (material.status === 'ready') return 'done';
  if (material.status === 'analyzing' || fileRead?.status === 'reading') return 'active';
  return draft.mode === 'paste' && draft.pasted ? 'active' : 'empty';
}

export type MaterialSectionProps = {
  draft: NewProductionDraft;
  material: MaterialAnalysis;
  fileRead: FileReadState | null;
  intake: SourceIntake;
  /** Validation message after a save attempt. */
  error: string | undefined;
  state: SectionState;
  dropzoneId: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  onModeChange: (mode: MaterialMode) => void;
  onPaste: (text: string) => void;
  onFile: (file: File) => void;
  onReject: (rejected: RejectedFile) => void;
  onRemoveFile: () => void;
  onCancelRead: () => void;
  onRetryRead: () => void;
  onUseSample: () => void;
};

export function MaterialSection({
  draft,
  material,
  fileRead,
  intake,
  error,
  state,
  dropzoneId,
  textareaRef,
  onModeChange,
  onPaste,
  onFile,
  onReject,
  onRemoveFile,
  onCancelRead,
  onRetryRead,
  onUseSample,
}: MaterialSectionProps) {
  const analysis = material.analysis;
  const ready = material.status === 'ready' ? analysis : undefined;
  const duplicate = ready?.duplicate;
  const firstUse = duplicate?.productions[0];
  const blank = draft.mode === 'paste' ? draft.pasted.trim() === '' : !draft.file && !fileRead;
  const hint = blank ? (
    <LinkButton onClick={onUseSample}>Usar exemplo</LinkButton>
  ) : material.status === 'analyzing' && !analysis ? (
    'Lendo material…'
  ) : draft.mode === 'paste' && analysis && material.status !== 'error' ? (
    analysisLine(analysis)
  ) : undefined;
  const rowError = error ?? (material.status === 'error' ? material.message : undefined);

  return (
    <FormSection title="Material" titleAs="h2" state={state} open>
      <FormRow label="Transcrição" required hint={hint} error={rowError}>
        {({ id, describedBy, invalid }) => (
          <>
            <Segmented label="Forma de envio" options={MODES} value={draft.mode} onChange={onModeChange} size="sm" />
            {draft.mode === 'paste' ? (
              <Textarea
                id={id}
                ref={textareaRef}
                aria-describedby={describedBy}
                invalid={invalid}
                autoSize={{ minRows: 8, maxRows: 18 }}
                value={draft.pasted}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                onChange={(event) => onPaste(event.target.value)}
              />
            ) : fileRead?.status === 'reading' ? (
              <FileRow name={fileRead.name} size={fileRead.size} status="uploading" progress={fileRead.progress} onCancel={onCancelRead} />
            ) : fileRead?.status === 'error' ? (
              <FileRow
                name={fileRead.name}
                size={fileRead.size}
                status="error"
                message={fileRead.message}
                onRetry={onRetryRead}
                retryLabel={fileRead.retry === 'reread' ? 'Tentar de novo' : 'Escolher outro'}
                onRemove={onCancelRead}
              />
            ) : draft.file ? (
              <FileRow
                name={draft.file.name}
                size={draft.file.size}
                status="done"
                message={ready ? analysisLine(ready) : undefined}
                onRemove={onRemoveFile}
              />
            ) : (
              <Dropzone
                id={dropzoneId}
                describedBy={describedBy}
                accept={intake.extensions.join(',')}
                maxSize={intake.maxBytes}
                title="Arraste a transcrição aqui ou escolha um arquivo"
                spec={specOf(intake)}
                invalid={invalid}
                error={rowError}
                onFiles={(files, rejected) => {
                  if (files[0]) onFile(files[0]);
                  else if (rejected[0]) onReject(rejected[0]);
                }}
              />
            )}
            {duplicate && firstUse ? (
              <Alert
                tone="warning"
                title="Material já usado"
                action={
                  <TextLink href={productionHref(firstUse.id)} tone="inherit" size="sm">
                    Abrir produção
                  </TextLink>
                }
              >
                {duplicate.productions.length > 1 ? `${firstUse.title} e mais ${duplicate.productions.length - 1}` : firstUse.title}
              </Alert>
            ) : null}
            {ready?.short ? (
              <Alert tone="warning" compact title="Material curto">
                {`${formatCount(ready.stats.words)} palavras`}
              </Alert>
            ) : null}
          </>
        )}
      </FormRow>
    </FormSection>
  );
}
