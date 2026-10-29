'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Alert, ButtonLink, LiveRegion } from '@content-ventures/design-system/v3';
import type { MemoryLibrary } from '@/ports/editorial-memory';

export function MemoryOriginalDownload(props: { port: MemoryLibrary; id: string }) {
  const binding = useMemo(() => ({ port: props.port, id: props.id, key: crypto.randomUUID() }), [props.port, props.id]);
  return <OriginalDownload key={binding.key} {...props} />;
}
function OriginalDownload({ port, id }: { port: MemoryLibrary; id: string }) {
  const anchor = useRef<HTMLAnchorElement>(null), live = useRef(true), running = useRef(false), dispatching = useRef(false);
  const [file, setFile] = useState<{ name: string; href: string }>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return <>
    <ButtonLink ref={anchor} href={file?.href ?? '#'} download={file?.name} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={async event => {
      if (dispatching.current) return;
      event.preventDefault(); if (running.current) return;
      running.current = true; setBusy(true); setError(undefined);
      try {
        const result = await port.downloadOriginal(id);
        if (!live.current) return;
        // Match delivery: activate an already-rendered DS anchor, then discard private bytes.
        flushSync(() => setFile(result)); dispatching.current = true;
        try { anchor.current?.click(); } finally { dispatching.current = false; flushSync(() => setFile(undefined)); }
      } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível baixar. Tente novamente.'); }
      finally { running.current = false; if (live.current) setBusy(false); }
    }}>{busy ? 'Baixando original…' : 'Baixar arquivo enviado'}</ButtonLink>
    <LiveRegion message={busy ? 'Preparando download do arquivo enviado.' : error ?? ''} />
    {error && <Alert tone="danger" title={error} />}
  </>;
}
