'use client';

import { useEffect } from 'react';
import { Button, PageStack, LiveRegion, Prose, Progress, ProgressSteps, ResponsiveDialog, Section, formatBytes } from '@content-ventures/design-system/v3';
import type { materialProgress } from './material-progress';

type ProgressState = NonNullable<ReturnType<typeof materialProgress>>;

export function MaterialProgressDialog({ open, progress, onClose, onCancel, onRetry }: {
  open: boolean;
  progress: ProgressState | null;
  onClose: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const status = progress?.status;
  useEffect(() => {
    if (!open || status !== 'ready') return;
    const timer = window.setTimeout(onClose,1200);
    return () => window.clearTimeout(timer);
  },[open,status,onClose]);

  const title = status === 'ready' ? 'Material pronto' : status === 'error' ? 'Material não concluído' : 'Preparando material';
  const source = progress ? [progress.name,progress.size !== undefined ? formatBytes(progress.size) : undefined].filter(Boolean).join(' · ') : undefined;
  const upload = progress?.upload;
  return (
    <ResponsiveDialog open={open && Boolean(progress)} onClose={onClose} title={title} size="md"
      footer={status === 'error' ? (
        <>
          <Button variant="ghost" onClick={onClose}>Voltar ao material</Button>
          <Button variant="primary" onClick={onRetry}>{progress?.retry === 'pick' ? 'Escolher outro arquivo' : 'Tentar novamente'}</Button>
        </>
      ) : status === 'ready' ? (
        <Button variant="primary" onClick={onClose}>Revisar material</Button>
      ) : (
        <>
          {progress?.canCancel ? <Button variant="ghost" onClick={onCancel}>{progress.phase === 'uploading' ? 'Cancelar envio' : 'Cancelar importação'}</Button> : null}
          <Button onClick={onClose}>Acompanhar na página</Button>
        </>
      )}
    >
      {progress ? (
        <Section>
          <PageStack>
            <Prose variant="compact" measure="wide">{source}</Prose>
            <ProgressSteps label="Preparo do material" steps={progress.steps} />
            {status !== 'error' ? <Progress aria-label={status === 'ready' ? 'Material pronto' : upload ? 'Envio do arquivo' : 'Processamento do material'}
              value={status === 'ready' ? 100 : upload?.percent}
              valueText={upload ? `${formatBytes(upload.sent)} de ${formatBytes(upload.total)} · ${upload.percent}%` : undefined} /> : null}
            {progress.largeUpload ? <Prose variant="compact" measure="wide">O envio depende da sua conexão. Mantenha esta página aberta até terminar.</Prose> : null}
          </PageStack>
          <LiveRegion message={status === 'ready' ? 'Material pronto para revisar os falantes e continuar.' : status === 'error' ? 'O preparo do material falhou. Tente novamente.' : ''} />
        </Section>
      ) : null}
    </ResponsiveDialog>
  );
}
