'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCommands } from '@/state';
import { isPermissionRefusal, notifyRefusal } from '@/ui/permission-dialog';
import type { MaterialReadPhase, MaterialReadProgress } from '@/ports';
import type { MaterialFile } from './form';

export type ImportedLink = {
  file: MaterialFile;
  sourceUrl: string;
  provider: 'youtube' | 'spotify';
  title?: string;
  programName?: string;
};

export type LinkReadState =
  | ({ status: 'reading'; name: string } & MaterialReadProgress)
  | { status: 'error'; name: string; message: string; phase: MaterialReadPhase };

export function useLinkReader(onLoaded: (value: ImportedLink) => void) {
  const commands = useCommands();
  const [state,setState] = useState<LinkReadState | null>(null);
  const run = useRef(0),last = useRef(''),controller = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => { run.current += 1;controller.current?.abort(); },[]);

  const read = useCallback((url: string) => {
    run.current += 1;
    const token = run.current;
    last.current = url;
    controller.current?.abort();
    controller.current = new AbortController();
    setState({ status: 'reading',name: url,phase: 'locating',message: 'Localizando episódio' });
    void commands.ingest.readLink(url,{ signal: controller.current.signal,onStatus(progress) {
      if (token===run.current) setState({ status: 'reading',name: url,...progress });
    } }).then(result => {
      if (token!==run.current) return;
      if (!result.ok && isPermissionRefusal(result.refusal)) { setState(null); notifyRefusal(undefined,result.refusal); return; }
      if (!result.ok) { setState(current => ({ status: 'error',name: url,message: result.refusal.message,phase: current?.phase ?? 'locating' }));return; }
      setState(null);
      onLoaded({ file: { name: result.value.fileName,size: result.value.bytes,text: result.value.text,
        ...(result.value.transcriptId ? { transcriptId: result.value.transcriptId } : {}) },sourceUrl: result.value.sourceUrl,
        provider: result.value.provider,...(result.value.title ? { title: result.value.title } : {}),
        ...(result.value.programName ? { programName: result.value.programName } : {}) });
    }).catch(() => {
      if (token===run.current) setState(current => ({ status: 'error',name: url,message: 'Não foi possível importar este link. Tente de novo.',phase: current?.phase ?? 'locating' }));
    });
  },[commands,onLoaded]);

  const reset = useCallback(() => { run.current += 1;controller.current?.abort();setState(null); },[]);
  const retry = useCallback(() => { if (last.current) read(last.current); },[read]);
  return { state,read,reset,retry };
}
