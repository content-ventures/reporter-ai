'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RejectedFile } from '@content-ventures/design-system/v3';
import type { SourceIntake } from '@/registries';
import type { MaterialReadPhase, MaterialReadProgress } from '@/ports';
import { useCommands } from '@/state';
import { isPermissionRefusal, notifyRefusal } from '@/ui/permission-dialog';
import type { MaterialFile } from './form';

/**
 * "Enviar arquivo": reads a .txt/.md/.srt/.vtt through SourceIngest.read and reports progress
 * with provider-reported stages and bytes. Instant reads remain visible briefly, without
 * inventing transfer progress. Refusals keep the file's name and offer the right retry.
 */

export type FileReadState =
  | ({ status: 'reading'; name: string; size: number } & MaterialReadProgress)
  | { status: 'error'; name: string; size: number; message: string; retry: 'reread' | 'pick'; phase: MaterialReadPhase };

const MIN_READ_MS = 650;

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function listOf(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}` : (items[0] ?? '');
}

export function rejectionMessage(reason: RejectedFile['reason'], intake: SourceIntake): string {
  return reason === 'size' ? `O arquivo passa de ${megabytes(intake.maxBytes)}.` : `Envie um arquivo ${listOf(intake.extensions)}.`;
}

export function useFileReader(intake: SourceIntake, onLoaded: (file: MaterialFile) => void) {
  const commands = useCommands();
  const [state, setState] = useState<FileReadState | null>(null);
  const run = useRef(0);
  const lastFile = useRef<File | null>(null);
  const controller = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      run.current += 1;
      controller.current?.abort();
    },
    [],
  );

  const read = useCallback(
    (file: File) => {
      run.current += 1;
      const token = run.current;
      lastFile.current = file;
      controller.current?.abort();
      controller.current = new AbortController();
      const text = /\.(txt|md|srt|vtt)$/i.test(file.name);
      setState({ status: 'reading', name: file.name, size: file.size, phase: text ? 'reading' : 'uploading',message: text ? 'Lendo arquivo' : 'Preparando envio' });
      const started = performance.now();
      void commands.ingest.read(file,{ signal: controller.current.signal,onStatus(progress) {
        if (token !== run.current) return;
        setState({ status: 'reading',name: file.name,size: file.size,...progress });
      } }).then(async (result) => {
        const rest = MIN_READ_MS - (performance.now() - started);
        if (rest > 0) await new Promise((resolve) => window.setTimeout(resolve, rest));
        if (token !== run.current) return;
        if (!result.ok && isPermissionRefusal(result.refusal)) {
          // Not an upload failure: the popup says who can, and the row goes away.
          setState(null);
          notifyRefusal(undefined, result.refusal);
          return;
        }
        if (!result.ok) {
          setState((current) => ({
            status: 'error',
            name: file.name,
            size: file.size,
            message: result.refusal.message,
            retry: result.refusal.code === 'read_failed' ? 'reread' : 'pick',
            phase: current?.phase ?? 'reading',
          }));
          return;
        }
        setState(null);
        onLoaded({ name: result.value.fileName, size: result.value.bytes, text: result.value.text,...(result.value.transcriptId ? { transcriptId: result.value.transcriptId } : {}) });
      }).catch(() => {
        // An unexpected failure (not a refusal) must not leave the row "reading" forever.
        if (token !== run.current) return;
        setState((current) => ({ status: 'error', name: file.name, size: file.size, message: 'Não foi possível ler o arquivo. Tente de novo.', retry: 'reread',phase: current?.phase ?? 'reading' }));
      });
    },
    [commands, onLoaded],
  );

  const reject = useCallback(
    (rejected: RejectedFile) => {
      run.current += 1;
      controller.current?.abort();
      setState({
        status: 'error',
        name: rejected.file.name,
        size: rejected.file.size,
        message: rejectionMessage(rejected.reason, intake),
        retry: 'pick',
        phase: 'reading',
      });
    },
    [intake],
  );

  /** "Cancelar envio" or "Escolher outro": back to the drop area. */
  const reset = useCallback(() => {
    run.current += 1;
    controller.current?.abort();
    setState(null);
  }, []);

  const retry = useCallback(() => {
    const file = lastFile.current;
    if (state?.status === 'error' && state.retry === 'reread' && file) read(file);
    else reset();
  }, [read, reset, state]);

  return { state, read, reject, reset, retry };
}
