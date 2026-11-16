'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Disclosure, Dropzone, FileRow, FormRow, FormSection, Input, Textarea, TextLink, toast } from '@content-ventures/design-system/v3';
import type { SourceIntake } from '@/registries';
import type { MaterialFile, NewProductionDraft } from './form';
import { useCommands } from '@/state';
import { useFileReader } from './use-file-reader';
import { useLinkReader } from './use-link-reader';
export function AdditionalMaterials({ draft, update, intake }: { draft: NewProductionDraft; update: (patch: Partial<NewProductionDraft>) => void; intake: SourceIntake }) {
  const [text, setText] = useState(''), [url, setUrl] = useState('');
  const commands = useCommands();
  const latest = useRef(draft);
  useEffect(() => { latest.current = draft; }, [draft]);
  const [researching, setResearching] = useState(false);
  const append = (added: MaterialFile[]) => {
    const supplements = [...(latest.current.supplements ?? []), ...added];
    latest.current = { ...latest.current, supplements };
    update({ supplements });
  };
  const add = (file: MaterialFile) => append([file]);
  const files = useFileReader(intake, (_id, file) => { if (file) add(file); });
  const links = useLinkReader(value => { add({ ...value.file, name: value.sourceUrl }); setUrl(''); });
  return <FormSection title="Fontes complementares" titleAs="h2" state={draft.supplements?.length ? 'done' : 'empty'} open>
    {(draft.supplements ?? []).map((file, i) => <FileRow key={i} name={file.name} size={file.size} status="done" onRemove={() => update({ supplements: draft.supplements?.filter((_, n) => n !== i) })} />)}
    {(draft.supplements ?? []).filter(file => file.name.startsWith('https://')).map(file => <TextLink key={file.name} href={file.name} target="_blank" rel="noopener noreferrer">Abrir fonte original</TextLink>)}
    <Disclosure summary="Adicionar texto, arquivo ou link">
      <FormRow label="Texto complementar">{({ id }) => <Textarea id={id} value={text} maxLength={300000} autoSize={{ minRows: 3, maxRows: 10 }} onChange={e => setText(e.target.value)} />}</FormRow>
      <Button size="sm" disabled={!text.trim()} onClick={() => { add({ name: 'Texto complementar', text, size: new TextEncoder().encode(text).length }); setText(''); }}>Adicionar texto</Button>
      <FormRow label="Link complementar">{({ id }) => <Input id={id} value={url} inputMode="url" maxLength={2000} placeholder="https://" onChange={e => setUrl(e.target.value)} />}</FormRow>
      <Button size="sm" loading={links.state?.status === 'reading'} disabled={!url.trim()} onClick={() => links.read(url)}>Importar fonte</Button>
      {links.state?.status === 'error' && <FileRow name={url} size={0} status="error" message={links.state.message} onRetry={links.retry} />}
      <Dropzone spec="Áudio e vídeo até 80 GB; texto até 1 MB" accept={intake.extensions.join(',')} maxSize={intake.maxBytes} title="Adicionar áudio, vídeo ou transcrição" onFiles={accepted => { for (const file of accepted) files.read(crypto.randomUUID(), file); }} />
      {Object.entries(files.reads).map(([key, file]) => <FileRow key={key} name={file.name} size={file.size} status={file.status === 'reading' ? 'uploading' : 'error'} message={file.message} onCancel={() => files.cancel(key)} onRetry={() => files.retry(key)} />)}
      <Button size="sm" variant="ghost" loading={researching} disabled={researching || !draft.editorial?.mainTopic?.trim() || links.state?.status === 'reading'} onClick={async () => {
        try {
          setResearching(true);
          const response = await commands.ingest.research(draft.editorial?.mainTopic ?? '');
          if (!response.ok) throw new Error(response.refusal.message);
          const result = response.value;
          append(result.sources.map((source: { url: string; text: string }) => ({ name: source.url, text: source.text, size: new TextEncoder().encode(source.text).length })));
          toast('Fontes da pesquisa adicionadas', { description: 'Confira os links e as informações antes de publicar.' });
        } catch (error) { toast('Pesquisa não concluída', { tone: 'error', description: error instanceof Error ? error.message : 'Tente novamente.' }); } finally { setResearching(false); }
      }}>Pesquisar fontes para o tema</Button>
    </Disclosure>
  </FormSection>;
}
