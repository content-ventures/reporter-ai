'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, DataTable, DescriptionList, Field, FieldGroup, ResponsiveDialog, Section, Select, Spinner } from '@content-ventures/design-system/v3';
import type { MemoryMarketField, MemoryMarketMapping, MemoryMarketPreview } from '@/domain/editorial-memory-market';
import type { MemoryLibrary } from '@/ports/editorial-memory';

const fields: { key: MemoryMarketField; label: string; required: boolean }[] = [
  { key: 'institution', label: 'Instituição', required: true }, { key: 'indicator', label: 'Indicador', required: true },
  { key: 'value', label: 'Valor', required: true }, { key: 'unit', label: 'Unidade', required: true }, { key: 'period', label: 'Período', required: true },
  { key: 'geography', label: 'Geografia', required: false }, { key: 'population', label: 'População ou amostra', required: false },
  { key: 'qualifier', label: 'Ressalva', required: false },
];
type Draft = Partial<MemoryMarketMapping>;
const complete = (draft: Draft): draft is MemoryMarketMapping => fields.filter(field => field.required).every(field => draft[field.key]);

export function MemoryMarketMappingDialog({ port, materialId, open, onClose }: { port: MemoryLibrary; materialId: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<MemoryMarketPreview>(), [draft, setDraft] = useState<Draft>({}), [previewSignature, setPreviewSignature] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [stale, setStale] = useState(false);
  const live = useRef(true), inFlight = useRef(false), attempt = useRef<{ signature: string; key: string }>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!open || data) return;
    let active = true;
    void port.previewMarket(materialId, {}).then(result => {
      if (!active) return;
      setData(result);
      const saved = result.mapping;
      if (saved) {
        const same = saved.originalFileId === result.originalFileId && saved.checksum === result.checksum
          && saved.source.sourceId === result.source.sourceId && saved.source.sourceVersion === result.source.sourceVersion && saved.source.hash === result.source.hash;
        setStale(!same); if (same) setDraft(saved.mapping);
      }
    }, failure => { if (active) setError(failure instanceof Error ? failure.message : 'Não foi possível abrir a tabela.'); });
    return () => { active = false; };
  }, [open, data, materialId, port]);
  const options = [{ value: '', label: 'Selecionar' }, ...(data?.headers ?? []).flatMap((header, index) => [
    { value: `row:${index}`, label: `Coluna ${index + 1}: ${header || 'Sem título'}` },
    { value: `header:${index}`, label: `Cabeçalho ${index + 1}: ${header || 'Vazio'}` },
  ])];
  const inspect = async () => {
    if (!complete(draft) || inFlight.current) return; inFlight.current = true; setBusy(true); setError(undefined);
    try { const result = await port.previewMarket(materialId, { mapping: draft }); if (live.current) { setData(result); setPreviewSignature(JSON.stringify(draft)); } }
    catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível conferir a tabela.'); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  };
  const save = async () => {
    if (!data || !complete(draft) || previewSignature !== JSON.stringify(draft) || inFlight.current) return;
    const input = { mapping: draft, revision: data.mapping?.revision ?? 0, materialRevision: data.materialRevision }, signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError(undefined);
    try { const saved = await port.saveMarketMapping(materialId, input, attempt.current.key); if (live.current) { setData({ ...data, mapping: saved }); setStale(false); onClose(); } }
    catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível salvar o mapeamento.'); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  };
  return <ResponsiveDialog open={open} title="Mapear dados de mercado" onClose={onClose} dirty={Boolean(Object.keys(draft).length)} footer={<>
    <Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button>
    <Button variant="secondary" loading={busy} disabled={!complete(draft)} onClick={() => void inspect()}>Ver prévia</Button>
    <Button loading={busy} disabled={!data || !complete(draft) || previewSignature !== JSON.stringify(draft)} onClick={() => void save()}>Salvar mapeamento</Button>
  </>}>
    <Section>
      {error && <Alert tone="danger" title={error} />}
      {stale && <Alert tone="warning" title="O arquivo ou a versão do material mudou">Selecione novamente as colunas para esta versão.</Alert>}
      {!data ? !error && <Spinner label="Carregando tabela" /> : <>
        <DescriptionList items={[{ label: 'Resultado', value: 'O mapeamento salva as colunas, mas ainda não cria estatísticas.' }]} />
        <FieldGroup label="Colunas da tabela" columns={2}>
          {fields.map(field => <Field key={field.key} label={field.label} required={field.required} optional={!field.required}>{({ id }) => {
            const selected = draft[field.key];
            return <Select id={id} searchable disabled={busy} options={options} value={selected ? `${selected.record}:${selected.column}` : ''} onChange={value => {
              setPreviewSignature('');
              setDraft(current => { const next = { ...current }; if (!value) delete next[field.key]; else { const [record, column] = value.split(':'); next[field.key] = { record: record as 'header' | 'row', column: Number(column) }; } return next; });
            }} />;
          }}</Field>)}
        </FieldGroup>
        {data.preview && previewSignature === JSON.stringify(draft) && <Section title="Prévia dos registros" titleAs="h3" meta={`${data.preview.total} registros`}>
          <DataTable label="Prévia dos dados de mercado" rows={data.preview.rows} rowKey={row => String(row.record)} rowLabel={row => `Registro ${row.record}`}
            columns={[{ key: 'record', header: 'Registro', render: row => row.record }, { key: 'indicator', header: 'Indicador', render: row => row.fields.indicator?.value },
              { key: 'value', header: 'Valor', render: row => row.fields.value?.value }, { key: 'unit', header: 'Unidade', render: row => row.fields.unit?.value },
              { key: 'period', header: 'Período', render: row => row.fields.period?.value }, { key: 'missing', header: 'Pendências', render: row => row.missing.length ? row.missing.map(key => fields.find(field => field.key === key)?.label).join(', ') : '—' }]} />
          {data.preview.next !== null && <ButtonGroup label="Prévia"><Button variant="secondary" disabled={busy || !complete(draft)} onClick={async () => {
            if (!complete(draft)) return; setBusy(true); setError(undefined);
            try { const result = await port.previewMarket(materialId, { mapping: draft, start: data.preview!.next! }); if (live.current) setData(result); }
            catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar mais registros.'); }
            finally { if (live.current) setBusy(false); }
          }}>Próximos registros</Button></ButtonGroup>}
        </Section>}
      </>}
    </Section>
  </ResponsiveDialog>;
}
