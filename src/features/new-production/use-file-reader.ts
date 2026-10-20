'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RejectedFile } from '@content-ventures/design-system/v3';
import type { SourceIntake } from '@/registries';
import type { EditorialFormat } from '@/domain';
import type { MaterialReadPhase, MaterialReadProgress, ReadFile, ReadRefusal } from '@/ports';
import type { Result } from '@/domain';
import { useCommands } from '@/state';
import { isPermissionRefusal, notifyRefusal } from '@/ui/permission-dialog';
import type { MaterialFile } from './form';

/**
 * "Enviar arquivo": reads each part of the material (.txt/.md/.srt/.vtt or media) through
 * SourceIngest.read and reports its progress with provider-reported stages and bytes. Every part
 * keeps its own slot, so one read never cancels another. Instant reads remain visible briefly,
 * without inventing transfer progress. Refusals keep the file's name and offer the right retry.
 */

export type FileReadState =
  | ({ status: 'reading'; name: string; size: number } & MaterialReadProgress)
  | { status: 'error'; name: string; size: number; message: string; retry: 'reread' | 'pick'; phase: MaterialReadPhase };

/** The read state of every part still being read or that failed, by part id. */
export type PartReads = Readonly<Record<string, FileReadState>>;

/** What a part needs to be read again: the file picked, or the Drive file it came from. */
type Slot = { token: number; controller: AbortController; file?: File; received?: string };

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

/** What a file received from the Drive folder brings besides the text. */
export type ReceivedExtras = { format?: EditorialFormat; recordedOn?: string };

function without(reads: PartReads, id: string): PartReads {
  if (!(id in reads)) return reads;
  const next = { ...reads };
  delete next[id];
  return next;
}

/** `onLoaded(id, undefined)`: the part's read was refused by permission and its row goes away. */
export function useFileReader(intake: SourceIntake, onLoaded: (id: string, file: MaterialFile | undefined, received?: ReceivedExtras) => void) {
  const commands = useCommands();
  const [reads, setReads] = useState<PartReads>({});
  const slots = useRef(new Map<string, Slot>());
  const run = useRef(0);

  useEffect(() => {
    const held = slots.current;
    return () => {
      for (const slot of held.values()) slot.controller.abort();
      held.clear();
    };
  }, []);

  const live = useCallback((id: string, token: number) => slots.current.get(id)?.token === token, []);
  const put = useCallback((id: string, state: FileReadState) => setReads((current) => ({ ...current, [id]: state })), []);

  /** A new read of the part: any earlier read of it stops answering. */
  const open = useCallback((id: string, source: Pick<Slot, 'file' | 'received'>): Slot => {
    slots.current.get(id)?.controller.abort();
    run.current += 1;
    const slot: Slot = { token: run.current, controller: new AbortController(), ...source };
    slots.current.set(id, slot);
    return slot;
  }, []);

  /** One read's answer, shown at least briefly: the file, a refusal with its retry, or a permission popup. */
  const settle = useCallback(
    (id: string, slot: Slot, file: () => { name: string; size: number }, reading: Promise<Result<ReadFile & { editorialFormat?: EditorialFormat; recordedOn?: string }, ReadRefusal | 'unavailable'>>) => {
      const started = performance.now();
      void reading.then(async (result) => {
        const rest = MIN_READ_MS - (performance.now() - started);
        if (rest > 0) await new Promise((resolve) => window.setTimeout(resolve, rest));
        if (!live(id, slot.token)) return;
        if (!result.ok && isPermissionRefusal(result.refusal)) {
          // Not an upload failure: the popup says who can, and the row goes away.
          slots.current.delete(id);
          setReads((current) => without(current, id));
          notifyRefusal(undefined, result.refusal);
          onLoaded(id, undefined);
          return;
        }
        if (!result.ok) {
          setReads((current) => ({ ...current, [id]: {
            status: 'error',
            name: file().name,
            size: file().size,
            message: result.refusal.message,
            retry: result.refusal.code === 'read_failed' ? 'reread' : 'pick',
            phase: current[id]?.phase ?? 'reading',
          } }));
          return;
        }
        slots.current.delete(id);
        setReads((current) => without(current, id));
        const value = result.value;
        onLoaded(id, { name: value.fileName, size: value.bytes, text: value.text,...(value.transcriptId ? { transcriptId: value.transcriptId } : {}) },
          slot.received ? { ...(value.editorialFormat ? { format: value.editorialFormat } : {}),...(value.recordedOn ? { recordedOn: value.recordedOn } : {}) } : undefined);
      }).catch(() => {
        // An unexpected failure (not a refusal) must not leave the row "reading" forever.
        if (!live(id, slot.token)) return;
        setReads((current) => ({ ...current, [id]: { status: 'error', name: file().name, size: file().size, message: 'Não foi possível ler o arquivo. Tente de novo.', retry: 'reread',phase: current[id]?.phase ?? 'reading' } }));
      });
    },
    [live, onLoaded],
  );

  const read = useCallback(
    (id: string, file: File) => {
      const slot = open(id, { file });
      const text = /\.(txt|md|srt|vtt)$/i.test(file.name);
      put(id, { status: 'reading', name: file.name, size: file.size, phase: text ? 'reading' : 'uploading',message: text ? 'Lendo arquivo' : 'Preparando envio' });
      settle(id, slot, () => file, commands.ingest.read(file,{ signal: slot.controller.signal,onStatus(progress) {
        if (!live(id, slot.token)) return;
        put(id, { status: 'reading',name: file.name,size: file.size,...progress });
      } }));
    },
    [commands, live, open, put, settle],
  );

  /** A file the Drive folder brought in: read like an upload that already reached the server. */
  const load = useCallback(
    (id: string, receivedId: string) => {
      const slot = open(id, { received: receivedId });
      const found = { name: 'Arquivo do Drive', size: 0 };
      const opening = { phase: 'preparing' as const, message: 'Abrindo arquivo do Drive' };
      put(id, { status: 'reading', ...found, ...opening });
      settle(id, slot, () => found, commands.ingest.readReceived(receivedId, { signal: slot.controller.signal,
        onFound(file) {
          if (!live(id, slot.token)) return;
          Object.assign(found, file);
          put(id, { status: 'reading', ...found, ...opening });
        },
        onStatus(progress) {
          if (!live(id, slot.token)) return;
          put(id, { status: 'reading', ...found, ...progress });
        } }));
    },
    [commands, live, open, put, settle],
  );

  /** "Cancelar envio" or "Remover": the part's read stops and its state goes away. */
  const cancel = useCallback((id: string) => {
    slots.current.get(id)?.controller.abort();
    slots.current.delete(id);
    setReads((current) => without(current, id));
  }, []);

  /** Leaving "Arquivo": every read stops. */
  const cancelAll = useCallback(() => {
    for (const slot of slots.current.values()) slot.controller.abort();
    slots.current.clear();
    setReads({});
  }, []);

  /** "Tentar de novo" reads the same file again; anything else gives the part up. */
  const retry = useCallback((id: string) => {
    const slot = slots.current.get(id), state = reads[id];
    if (state?.status === 'error' && state.retry === 'reread' && slot?.file) read(id, slot.file);
    else if (state?.status === 'error' && state.retry === 'reread' && slot?.received) load(id, slot.received);
    else cancel(id);
  }, [cancel, load, read, reads]);

  return { reads, read, load, cancel, cancelAll, retry };
}
