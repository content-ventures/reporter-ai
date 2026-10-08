'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RejectedFile } from '@content-ventures/design-system/v3';
import type { SourceIntake } from '@/registries';
import { useCommands } from '@/state';
import type { MaterialFile } from './form';

/**
 * "Enviar arquivo": reads a .txt/.md/.srt/.vtt through SourceIngest.read and reports progress
 * in the FileRow. A local read is instant, so the bar runs for a short minimum: the person sees
 * the file being taken in. Refusals keep the file's name and offer the right retry.
 */

export type FileReadState =
  | { status: 'reading'; name: string; size: number; progress: number }
  | { status: 'error'; name: string; size: number; message: string; retry: 'reread' | 'pick' };

const MIN_READ_MS = 650;
const TICK_MS = 70;

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
  const ticker = useRef<number | undefined>(undefined);
  const lastFile = useRef<File | null>(null);

  useEffect(
    () => () => {
      run.current += 1;
      window.clearInterval(ticker.current);
    },
    [],
  );

  const read = useCallback(
    (file: File) => {
      run.current += 1;
      const token = run.current;
      lastFile.current = file;
      window.clearInterval(ticker.current);
      setState({ status: 'reading', name: file.name, size: file.size, progress: 6 });
      ticker.current = window.setInterval(() => {
        setState((current) => (current?.status === 'reading' ? { ...current, progress: Math.min(92, current.progress + 13) } : current));
      }, TICK_MS);
      const started = performance.now();
      void commands.ingest.read(file).then(async (result) => {
        const rest = MIN_READ_MS - (performance.now() - started);
        if (rest > 0) await new Promise((resolve) => window.setTimeout(resolve, rest));
        if (token !== run.current) return;
        window.clearInterval(ticker.current);
        if (!result.ok) {
          setState({
            status: 'error',
            name: file.name,
            size: file.size,
            message: result.refusal.message,
            retry: result.refusal.code === 'read_failed' ? 'reread' : 'pick',
          });
          return;
        }
        setState(null);
        onLoaded({ name: result.value.fileName, size: result.value.bytes, text: result.value.text });
      }).catch(() => {
        // An unexpected failure (not a refusal) must not leave the row "reading" forever.
        if (token !== run.current) return;
        window.clearInterval(ticker.current);
        setState({ status: 'error', name: file.name, size: file.size, message: 'Não foi possível ler o arquivo. Tente de novo.', retry: 'reread' });
      });
    },
    [commands, onLoaded],
  );

  const reject = useCallback(
    (rejected: RejectedFile) => {
      run.current += 1;
      window.clearInterval(ticker.current);
      setState({
        status: 'error',
        name: rejected.file.name,
        size: rejected.file.size,
        message: rejectionMessage(rejected.reason, intake),
        retry: 'pick',
      });
    },
    [intake],
  );

  /** "Cancelar envio" or "Escolher outro": back to the drop area. */
  const reset = useCallback(() => {
    run.current += 1;
    window.clearInterval(ticker.current);
    setState(null);
  }, []);

  const retry = useCallback(() => {
    const file = lastFile.current;
    if (state?.status === 'error' && state.retry === 'reread' && file) read(file);
    else reset();
  }, [read, reset, state]);

  return { state, read, reject, reset, retry };
}
