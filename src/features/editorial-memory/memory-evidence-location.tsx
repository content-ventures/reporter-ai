'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DescriptionList, LiveRegion } from '@content-ventures/design-system/v3';
import type { MemoryDocumentEvidenceLocation } from '@/domain/editorial-memory-document-location';

export function MemoryEvidenceLocation({ load }: { load: () => Promise<MemoryDocumentEvidenceLocation | null> }) {
  const live = useRef(true), running = useRef(false);
  const [busy, setBusy] = useState(false), [result, setResult] = useState<MemoryDocumentEvidenceLocation | null>(), [error, setError] = useState<string>();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const locate = async () => {
    if (running.current) return; running.current = true; setBusy(true); setError(undefined); setResult(undefined);
    try { const value = await load(); if (live.current) setResult(value); }
    catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível consultar o arquivo.'); }
    finally { running.current = false; if (live.current) setBusy(false); }
  };
  const records = result?.records ?? [], first = records[0], last = records.at(-1), tabular = result?.format === 'csv' || result?.format === 'tsv';
  return <>
    <Button variant="secondary" loading={busy} onClick={() => void locate()}>{result === undefined ? 'Localizar no arquivo' : 'Atualizar localização'}</Button>
    <LiveRegion message={busy ? 'Consultando localização no arquivo.' : result === null ? 'Localização indisponível.' : result ? 'Localização encontrada.' : ''} />
    {error && <Alert tone="danger" title={error} />}
    {result === null && <Alert tone="info" title="Não foi possível localizar este trecho no arquivo enviado." />}
    {result && <DescriptionList items={[{ label: 'Arquivo', value: result.fileName },
      { label: result.firstLine === result.lastLine ? 'Linha' : 'Linhas', value: result.firstLine === result.lastLine ? `${result.firstLine}` : `${result.firstLine}–${result.lastLine}` },
      ...(tabular && first && last ? [{ label: first.record === last.record ? 'Registro' : 'Registros', value: first.record === last.record ? `${first.record}` : `${first.record}–${last.record}` }] : []),
      ...(tabular && records.length === 1 && first.columns.length ? [{ label: first.columns.length === 1 ? 'Coluna' : 'Colunas', value: first.columns.join(', ') }] : [])]} />}
  </>;
}
