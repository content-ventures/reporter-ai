'use client';

import type { Ref } from 'react';
import {
  Alert,
  AgentTrace,
  ControlButton,
  Dropzone,
  FileGlyph,
  FileRow,
  FormRow,
  FormSection,
  Input,
  LinkButton,
  List,
  ListItem,
  RowActions,
  Segmented,
  TextLink,
  Textarea,
  formatTimestamp,
  formatBytes,
  type RejectedFile,
  type RowAction,
  type SectionState,
  type SegmentOption,
} from '@content-ventures/design-system/v3';
import { ArrowDown, ArrowDownToLine, ArrowUp, ClipboardList, FileUp, Link2, RotateCcw, Trash2, X } from '@content-ventures/design-system/v3/icons';
import { parseSourceLink } from '@/domain/source-link';
import type { SourceAnalysis } from '@/ports';
import type { SourceIntake } from '@/registries';
import { formatCount } from '@/ui/format';
import { productionHref } from '@/ui/routes';
import { analysisLine, draftMaterial, type MaterialMode, type NewProductionDraft } from './form';
import { TermFix } from './term-fix';
import type { TermCorrection } from '@/domain/text/terms';
import type { FileReadState } from './use-file-reader';
import type { LinkReadState } from './use-link-reader';
import type { MaterialAnalysis } from './use-material-analysis';
import type { PartReads } from './use-file-reader';
import { plural } from '@/ui/format';
import { partsIssue } from './form';
import { partSlots, partViews, type PartView } from './material-parts';

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

/** What one part of the material is doing: "5,0 MB de 6,0 MB · 83%", "Transcrevendo áudio · 2 de 6 trechos", "12 falas". */
export function partLine({ status }: Pick<PartView, 'status'>): string {
  if (status.kind === 'error') return status.message;
  if (status.kind === 'reading') {
    if (status.upload) return `${formatBytes(status.upload.sent)} de ${formatBytes(status.upload.total)} · ${status.upload.percent}%`;
    return status.chunks ? `Transcrevendo áudio · ${status.chunks.done} de ${status.chunks.total} trechos` : status.message;
  }
  if (status.empty) return 'Sem falas';
  return status.segments !== undefined ? plural(status.segments, 'fala', 'falas') : 'Pronta';
}

function specOf(intake: SourceIntake): string {
  const formats = intake.extensions.map((extension) => extension.replace('.', '').toUpperCase());
  const last = formats.pop();
  const limit = intake.extensions.includes('.mp3') ? 'áudio/vídeo até 2 GB e 3 h; texto até 1 MB' : `até ${Math.round(intake.maxBytes / (1024 * 1024))} MB`;
  return `${formats.join(', ')} ou ${last} · ${limit}`;
}

export function materialState(draft: NewProductionDraft, material: MaterialAnalysis, fileReads: PartReads, linkRead: LinkReadState | null, invalid: boolean): SectionState {
  const reads = Object.values(fileReads);
  if (invalid || material.status === 'error' || reads.some((read) => read.status === 'error') || linkRead?.status === 'error') return 'error';
  if (partsIssue(draft, material.status === 'ready' ? material.analysis : undefined)) return 'error';
  if (material.status === 'ready') return 'done';
  if (material.status === 'analyzing' || reads.some((read) => read.status === 'reading') || linkRead?.status === 'reading') return 'active';
  return (draft.mode === 'paste' && draft.pasted) || (draft.mode === 'link' && draft.sourceUrl) ? 'active' : 'empty';
}

export type MaterialSectionProps = {
  draft: NewProductionDraft;
  material: MaterialAnalysis;
  /** Reads of the parts still being read or that failed, by part id. */
  fileReads: PartReads;
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
  onFiles: (files: File[], rejected: RejectedFile[]) => void;
  onRemovePart: (id: string) => void;
  onRetryPart: (id: string) => void;
  onCancelPart: (id: string) => void;
  onMovePart: (from: number, to: number) => void;
  onCancelLink: () => void;
  onRetryLink: () => void;
  onRemoveLink: () => void;
  onUseSample: () => void;
  /** "Corrigir termo": replaces a misheard name across the material, unless it would change how it is read. */
  onReplaceTerm: (from: string, to: string) => TermCorrection;
};

export function MaterialSection({
  draft,
  material,
  fileReads,
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
  onFiles,
  onRemovePart,
  onRetryPart,
  onCancelPart,
  onMovePart,
  onCancelLink,
  onRetryLink,
  onRemoveLink,
  onUseSample,
  onReplaceTerm,
}: MaterialSectionProps) {
  const analysis = material.analysis;
  const ready = material.status === 'ready' ? analysis : undefined;
  const duplicate = ready?.duplicate;
  const firstUse = duplicate?.productions[0];
  const only = draft.parts.length === 1 ? draft.parts[0] : undefined;
  const fileRead: FileReadState | undefined = only ? fileReads[only.id] : undefined;
  const blank = draft.mode === 'paste' ? draft.pasted.trim() === '' : draft.mode === 'file' ? draft.parts.length === 0 : !draft.linkFile && !linkRead && !draft.sourceUrl?.trim();
  // Several parts are a list, each part with its own read; one part keeps its single row.
  const views = draft.mode === 'file' && draft.parts.length > 1 ? partViews(draft, fileReads, ready) : [];
  const slots = partSlots(draft);
  const failedParts = views.flatMap((view) => (view.status.kind === 'error' ? [`Parte ${view.number}: ${view.status.message}`] : []));
  // "Acompanhar envio" only while a part is on its way; beside a failed part nothing is analysed either.
  const sending = views.some((view) => view.status.kind === 'reading');
  const hint = draft.mode === 'link' && blank ? 'YouTube com legendas ou Spotify com feed público' : blank ? (
    <LinkButton onClick={onUseSample}>Usar exemplo</LinkButton>
  ) : sending ? (
    <LinkButton onClick={onShowProgress}>Acompanhar envio</LinkButton>
  ) : failedParts.length > 0 ? undefined : material.status === 'analyzing' ? (
    <LinkButton onClick={onShowProgress}>Acompanhar análise</LinkButton>
  ) : material.status === 'error' && material.retry ? (
    <LinkButton onClick={material.retry}>Tentar analisar novamente</LinkButton>
  ) : draft.mode === 'paste' && analysis && material.status !== 'error' ? (
    readLine(analysis)
  ) : views.length > 0 && ready ? readLine(ready) : undefined;
  const partsError = failedParts.length > 1 ? `${failedParts.length} partes não concluídas.` : failedParts[0];
  const rowError = error ?? partsError ?? partsIssue(draft, ready) ?? (material.status === 'error' ? material.message : linkRead?.status === 'error' ? linkRead.message : undefined);
  const partActions = (view: PartView, index: number): RowAction[] => {
    const moves: RowAction[] = [
      { id: 'up', label: 'Mover para cima', icon: ArrowUp, hidden: index === 0, onSelect: () => onMovePart(index, index - 1) },
      { id: 'down', label: 'Mover para baixo', icon: ArrowDown, hidden: index === views.length - 1, onSelect: () => onMovePart(index, index + 1) },
    ];
    const remove: RowAction = { id: 'remove', label: `Remover ${view.name}`, icon: Trash2, danger: true, onSelect: () => onRemovePart(view.id) };
    const { status } = view;
    if (status.kind === 'error') {
      const reread = status.retry === 'reread';
      return [{ id: 'retry', label: reread ? 'Tentar de novo' : 'Escolher outro', icon: reread ? RotateCcw : FileUp, onSelect: () => onRetryPart(view.id) }, ...moves, remove];
    }
    if (status.kind === 'reading' && status.cancellable) return [{ id: 'cancel', label: `Cancelar envio de ${view.name}`, icon: X, onSelect: () => onCancelPart(view.id) }, ...moves];
    return [remove, ...moves];
  };
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
            ) : views.length > 0 ? (
              <List label="Partes do material" onReorder={onMovePart}>
                {views.map((view, index) => (
                  <ListItem
                    key={view.id}
                    draggable
                    leading={<FileGlyph name={view.name} />}
                    title={view.name}
                    titleLines={2}
                    description={`Parte ${view.number} · ${partLine(view)}`}
                    meta={view.status.kind === 'ready' && view.status.durationMs !== undefined ? formatTimestamp(view.status.durationMs) : view.size ? formatBytes(view.size) : undefined}
                    actions={<RowActions max={2} label={`Ações de ${view.name}`} overflowLabel={`Mais ações de ${view.name}`} actions={partActions(view, index)} />}
                  />
                ))}
              </List>
            ) : fileRead?.status === 'reading' ? (
              <AgentTrace label={fileRead.name} steps={[{ id: 'read',label: fileRead.message,state: 'current',meta: formatBytes(fileRead.size) }]}
                variant="compact" announce={false} action={<LinkButton onClick={onShowProgress}>Acompanhar</LinkButton>} />
            ) : fileRead?.status === 'error' && only ? (
              <FileRow
                name={fileRead.name}
                size={fileRead.size}
                status="error"
                message={fileRead.message}
                onRetry={() => onRetryPart(only.id)}
                retryLabel={fileRead.retry === 'reread' ? 'Tentar de novo' : 'Escolher outro'}
                onRemove={() => onRemovePart(only.id)}
              />
            ) : only?.text !== undefined ? (
              <FileRow
                name={only.name}
                size={only.size}
                status="done"
                message={ready ? readLine(ready) : undefined}
                onRemove={() => onRemovePart(only.id)}
              />
            ) : null}
            {slots !== 'closed' ? (
              <Dropzone
                id={dropzoneId}
                describedBy={describedBy}
                accept={intake.extensions.join(',')}
                maxSize={intake.maxBytes}
                multiple
                title={draft.parts.length > 0 ? 'Adicionar parte' : 'Solte o arquivo aqui ou escolha'}
                spec={specOf(intake)}
                disabled={slots === 'full'}
                disabledText="Limite de 10 partes"
                invalid={draft.parts.length === 0 && invalid}
                error={draft.parts.length === 0 ? rowError : undefined}
                onFiles={onFiles}
              />
            ) : null}
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
                {(duplicate.part ? `Parte ${duplicate.part} · ` : '') + (duplicate.productions.length > 1 ? `${firstUse.title} e mais ${duplicate.productions.length - 1}` : firstUse.title)}
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
      {/* Stays on screen while the corrected material is analyzed again: the last analysis is kept meanwhile. */}
      {!blank && !draftMaterial(draft).pending && analysis?.segments.length ? (
        <FormRow label="Corrigir termo" optional>
          <TermFix text={draftMaterial(draft).text} onReplace={onReplaceTerm} />
        </FormRow>
      ) : null}
    </FormSection>
  );
}
