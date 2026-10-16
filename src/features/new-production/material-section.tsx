'use client';

import type { Ref } from 'react';
import {
  Alert,
  AgentTrace,
  ControlButton,
  Dropzone,
  FileRow,
  FormRow,
  FormSection,
  Input,
  LinkButton,
  Segmented,
  TextLink,
  Textarea,
  formatTimestamp,
  formatBytes,
  type RejectedFile,
  type SectionState,
  type SegmentOption,
} from '@content-ventures/design-system/v3';
import { ArrowDownToLine, ClipboardList, FileUp, Link2 } from '@content-ventures/design-system/v3/icons';
import { parseSourceLink } from '@/domain/source-link';
import type { SourceAnalysis } from '@/ports';
import type { SourceIntake } from '@/registries';
import { formatCount } from '@/ui/format';
import { productionHref } from '@/ui/routes';
import { analysisLine, type MaterialMode, type NewProductionDraft } from './form';
import type { FileReadState } from './use-file-reader';
import type { LinkReadState } from './use-link-reader';
import type { MaterialAnalysis } from './use-material-analysis';

/**
 * "Material" (step 1, CONTRACT §3.9): paste or send the transcript, see what was understood
 * ("36 falas · 2 falantes · 16:48") and the two warnings that matter before going on: the same
 * material already lives in another production (amber, with the link) and a material too short
 * for a full article.
 */

const MODES: SegmentOption<MaterialMode>[] = [
  { value: 'paste', label: 'Texto', icon: ClipboardList },
  { value: 'file', label: 'Arquivo', icon: FileUp },
  // Link import (YouTube/Spotify) is off until it works end to end in every runtime.
  { value: 'link', label: 'Link', icon: Link2, disabled: true, disabledReason: 'Em breve' },
];

const PLACEHOLDER = 'Cole aqui a transcrição da entrevista';

/** "36 falas · 2 falantes · 16:48" (the duration only when the material has timestamps). */
function readLine(analysis: SourceAnalysis): string {
  const { durationMs } = analysis.stats;
  return analysisLine(analysis, durationMs !== undefined ? formatTimestamp(durationMs) : undefined);
}

function specOf(intake: SourceIntake): string {
  const formats = intake.extensions.map((extension) => extension.replace('.', '').toUpperCase());
  const last = formats.pop();
  const limit = intake.extensions.includes('.mp3') ? 'áudio/vídeo até 2 GB e 3 h; texto até 1 MB' : `até ${Math.round(intake.maxBytes / (1024 * 1024))} MB`;
  return `${formats.join(', ')} ou ${last} · ${limit}`;
}

export function materialState(draft: NewProductionDraft, material: MaterialAnalysis, fileRead: FileReadState | null, linkRead: LinkReadState | null, invalid: boolean): SectionState {
  if (invalid || material.status === 'error' || fileRead?.status === 'error' || linkRead?.status === 'error') return 'error';
  if (material.status === 'ready') return 'done';
  if (material.status === 'analyzing' || fileRead?.status === 'reading' || linkRead?.status === 'reading') return 'active';
  return (draft.mode === 'paste' && draft.pasted) || (draft.mode === 'link' && draft.sourceUrl) ? 'active' : 'empty';
}

export type MaterialSectionProps = {
  draft: NewProductionDraft;
  material: MaterialAnalysis;
  fileRead: FileReadState | null;
  linkRead: LinkReadState | null;
  intake: SourceIntake;
  /** Validation message after a save attempt. */
  error: string | undefined;
  state: SectionState;
  dropzoneId: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  linkRef: Ref<HTMLInputElement>;
  onModeChange: (mode: MaterialMode) => void;
  onPaste: (text: string) => void;
  onBeginProcessing: () => void;
  onShowProgress: () => void;
  onLinkChange: (url: string) => void;
  onImportLink: () => void;
  onFile: (file: File) => void;
  onReject: (rejected: RejectedFile) => void;
  onRemoveFile: () => void;
  onCancelRead: () => void;
  onRetryRead: () => void;
  onCancelLink: () => void;
  onRetryLink: () => void;
  onRemoveLink: () => void;
  onUseSample: () => void;
};

export function MaterialSection({
  draft,
  material,
  fileRead,
  linkRead,
  intake,
  error,
  state,
  dropzoneId,
  textareaRef,
  linkRef,
  onModeChange,
  onPaste,
  onBeginProcessing,
  onShowProgress,
  onLinkChange,
  onImportLink,
  onFile,
  onReject,
  onRemoveFile,
  onCancelRead,
  onRetryRead,
  onCancelLink,
  onRetryLink,
  onRemoveLink,
  onUseSample,
}: MaterialSectionProps) {
  const analysis = material.analysis;
  const ready = material.status === 'ready' ? analysis : undefined;
  const duplicate = ready?.duplicate;
  const firstUse = duplicate?.productions[0];
  const blank = draft.mode === 'paste' ? draft.pasted.trim() === '' : draft.mode === 'file' ? !draft.file && !fileRead : !draft.linkFile && !linkRead && !draft.sourceUrl?.trim();
  const hint = draft.mode === 'link' && blank ? 'YouTube com legendas ou Spotify com feed público' : blank ? (
    <LinkButton onClick={onUseSample}>Usar exemplo</LinkButton>
  ) : material.status === 'analyzing' ? (
    <LinkButton onClick={onShowProgress}>Acompanhar análise</LinkButton>
  ) : material.status === 'error' && material.retry ? (
    <LinkButton onClick={material.retry}>Tentar analisar novamente</LinkButton>
  ) : draft.mode === 'paste' && analysis && material.status !== 'error' ? (
    readLine(analysis)
  ) : undefined;
  const rowError = error ?? (material.status === 'error' ? material.message : linkRead?.status === 'error' ? linkRead.message : undefined);
  const linkProvider = parseSourceLink(draft.sourceUrl ?? '')?.provider;

  return (
    <FormSection title="Material" titleAs="h2" state={state} open>
      <FormRow label="Transcrição" required hint={hint} error={rowError}>
        {({ id, describedBy, invalid }) => (
          <>
            <Segmented label="Como trazer o material" options={MODES} value={draft.mode} onChange={onModeChange} size="sm" />
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
                onPaste={(event) => { if (event.clipboardData.getData('text').trim()) onBeginProcessing(); }}
              />
            ) : draft.mode === 'link' ? (
              <>
                <Input
                  id={id}
                  ref={linkRef}
                  aria-describedby={describedBy}
                  invalid={invalid || linkRead?.status === 'error'}
                  status={linkRead?.status === 'reading' ? 'loading' : draft.linkFile ? 'valid' : undefined}
                  icon={Link2}
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={draft.sourceUrl ?? ''}
                  placeholder="https://youtube.com/… ou https://open.spotify.com/episode/…"
                  onChange={(event) => onLinkChange(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault();onImportLink(); } }}
                  trailing={linkRead?.status === 'reading' || draft.linkFile ? undefined : (
                    <ControlButton label="Importar link" icon={ArrowDownToLine} disabled={!draft.sourceUrl?.trim()} onClick={onImportLink} />
                  )}
                />
                {linkRead?.status === 'reading' ? (
                  <AgentTrace label={linkProvider === 'spotify' ? 'Episódio do Spotify' : 'Vídeo do YouTube'}
                    steps={[{ id: 'read',label: linkRead.message,state: 'current' }]} variant="compact" announce={false}
                    action={<LinkButton onClick={onShowProgress}>Acompanhar</LinkButton>} />
                ) : linkRead?.status === 'error' ? (
                  <FileRow name={linkProvider === 'spotify' ? 'Episódio do Spotify' : 'Vídeo do YouTube'} size={0} status="error" message={linkRead.message} onRetry={onRetryLink} retryLabel="Tentar de novo" onRemove={onCancelLink} />
                ) : draft.linkFile ? (
                  <FileRow name={draft.linkFile.name} size={draft.linkFile.size} status="done" message={ready ? readLine(ready) : undefined} onRemove={onRemoveLink} />
                ) : null}
              </>
            ) : fileRead?.status === 'reading' ? (
              <AgentTrace label={fileRead.name} steps={[{ id: 'read',label: fileRead.message,state: 'current',meta: formatBytes(fileRead.size) }]}
                variant="compact" announce={false} action={<LinkButton onClick={onShowProgress}>Acompanhar</LinkButton>} />
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
                message={ready ? readLine(ready) : undefined}
                onRemove={onRemoveFile}
              />
            ) : (
              <Dropzone
                id={dropzoneId}
                describedBy={describedBy}
                accept={intake.extensions.join(',')}
                maxSize={intake.maxBytes}
                title="Solte o arquivo aqui ou escolha"
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
                {`${formatCount(ready.stats.words)} palavras: o texto deve sair com menos de 1 lauda.`}
              </Alert>
            ) : null}
          </>
        )}
      </FormRow>
    </FormSection>
  );
}
