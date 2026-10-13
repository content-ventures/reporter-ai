'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, Drawer, EmptyState, Field, Grid, Input, MediaFrame, MetaList, PageStack, SearchField, SwitchRow, Tabs } from '@content-ventures/design-system/v3';
import { DEFAULT_STOCK_PROVIDER, SEAFOOD_SEARCHES, libraryImageSource, type LibraryImage, type StockImage, type StockProvider, type VisualLibraryView } from '@/domain/visual-library';
import { useRuntime } from '@/state';

/** Shared library picker: the article and banner studio use exactly the same source records. */
export function LibraryBrowser({ onSelect, selectedId }: { onSelect?: (image: LibraryImage) => void; selectedId?: string }) {
  const { runtime, status } = useRuntime(),port = runtime?.visuals;
  const [view,setView] = useState<VisualLibraryView>();
  const [tab,setTab] = useState<'saved'|'search'>('search');
  const provider = DEFAULT_STOCK_PROVIDER;
  const [curated,setCurated] = useState(true);
  const [query,setQuery] = useState<string>(SEAFOOD_SEARCHES[0].query);
  const [result,setResult] = useState<{ images: StockImage[]; hasMore: boolean; page: number; query: string; provider: StockProvider }>();
  const [loading,setLoading] = useState(false),[failure,setFailure] = useState<string>();
  const [inspect,setInspect] = useState<StockImage>(),[confirmed,setConfirmed] = useState(false),[saving,setSaving] = useState(false);
  const [selectingId,setSelectingId] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const searchId = useId();
  useEffect(() => {
    if (!port) return;
    let live = true;
    void port.get().then(value => { if (live) setView(value); }).catch(error => { if (live) setFailure(error.message); });
    return () => { live = false; request.current?.abort(); };
  },[port]);
  async function search(term = query,page = 1) {
    if (!port || !view?.providers.find(item => item.id === provider)?.configured || term.trim().length < 2) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setQuery(term);setTab('search');setLoading(true);setFailure(undefined);
    try {
      const value = await port.search(provider,term,page,{ signal: controller.signal,curated });
      if (!controller.signal.aborted) setResult({ ...value,page,query: term,provider });
    } catch (error) { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'Não foi possível buscar imagens.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function open(image: StockImage) { setInspect(image);setConfirmed(false);setFailure(undefined); }
  async function keep() {
    if (!port || !inspect || !confirmed || saving) return;
    setSaving(true);setFailure(undefined);
    try {
      const image = await port.importImage(inspect.provider,inspect.providerId,true);
      setView(await port.get());setInspect(undefined);setTab('saved');onSelect?.(image);
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível guardar a imagem.'); }
    finally { setSaving(false); }
  }
  async function selectSaved(image: LibraryImage) {
    if (!port || !onSelect || saving) return;
    setSaving(true);setSelectingId(image.id);setFailure(undefined);
    try { onSelect(await port.importImage(image.provider,image.providerId,true)); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível selecionar a imagem.'); }
    finally { setSaving(false);setSelectingId(undefined); }
  }
  const configured = view?.providers.find(item => item.id === provider)?.configured;
  const inspectedSaved = inspect && view?.images.find(item => item.provider === inspect.provider && item.providerId === inspect.providerId);
  const shown = tab === 'saved' ? view?.images ?? [] : result?.provider === provider ? result.images : [];
  return <PageStack>
    <Tabs label="Biblioteca de imagens" value={tab} onChange={setTab} size="sm" items={[{ value: 'search',label: 'Buscar fotos de capa' },{ value: 'saved',label: 'Salvas',count: view?.images.length }]} />
    {!port && status !== 'loading' ? <EmptyState title="Conecte o backend local para usar a biblioteca" size="panel" heading="p" /> : null}
    {tab === 'search' ? <PageStack>
      <Field label="Banco de imagens" hint="Originais horizontais de pelo menos 2400 × 1350 px. Uso comercial gratuito e crédito opcional, conforme a licença do Pixabay.">{({ id,describedBy }) => <Input id={id} aria-describedby={describedBy} value="Pixabay · fotografias" readOnly />}</Field>
      {view && !configured ? <Alert tone="warning" title="Configure o Pixabay para buscar fotos">Adicione PIXABAY_API_KEY no .env.local e reinicie o servidor. Os originais em alta resolução exigem acesso completo à API. <ButtonLink href="https://pixabay.com/api/docs/" target="_blank" rel="noopener noreferrer" size="sm">Obter chave no Pixabay</ButtonLink></Alert> : null}
      <SearchField id={searchId} label="Buscar imagens" value={query} onValueChange={setQuery} placeholder="Pescado em detalhe, pesca em alto-mar…" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault();void search(); } }} />
      <SwitchRow label="Mostrar somente a seleção editorial do Pixabay" checked={curated} onCheckedChange={value => { request.current?.abort();setLoading(false);setCurated(value);setResult(undefined);setFailure(undefined); }} />
      <Grid columns="auto">{SEAFOOD_SEARCHES.map(item => <Button key={item.query} size="sm" disabled={loading || !configured} onClick={() => void search(item.query)}>{item.label}</Button>)}</Grid>
      <Button onClick={() => void search()} loading={loading} disabled={!configured || query.trim().length < 2}>Buscar imagens</Button>
      <MetaList size="sm" items={[<ButtonLink key="provider" href="https://pixabay.com" target="_blank" rel="noopener noreferrer" size="sm">Fotos fornecidas por Pixabay</ButtonLink>,'Imagens ilustrativas; não representam a feira ou pessoas citadas.']} />
    </PageStack> : null}
    {failure ? <Alert tone="danger" title="Não foi possível concluir">{failure}</Alert> : null}
    {tab === 'search' && result?.images.some(image => image.downloadLimited) ? <Alert tone="warning" title="Originais ainda não liberados pela API">Estas fotos têm originais grandes, mas sua chave só disponibiliza prévias reduzidas. A importação exige o original, sem ampliação artificial. <ButtonLink href="https://pixabay.com/api/docs/#api_support" target="_blank" rel="noopener noreferrer" size="sm">Solicitar acesso completo no Pixabay</ButtonLink></Alert> : null}
    {!view && port ? <MediaFrame ratio="16/9" state="loading" alt="Carregando a biblioteca" /> : loading ? <MediaFrame ratio="16/9" state="loading" alt="Buscando imagens" /> : shown.length ?
      <Grid columns="auto" min={280} aria-label="Imagens disponíveis">{shown.map(image => {
        const saved = 'id' in image ? image as LibraryImage : view?.images.find(item => item.provider === image.provider && item.providerId === image.providerId);
        return <Card key={image.provider+image.providerId} as="div" padding="sm">
          <MediaFrame ratio="16/9" src={saved ? libraryImageSource(saved,true) : image.previewUrl} alt={image.title} fit="contain" radius="sm" />
          <CardHeader titleAs="h3" size="sm" title={image.title} description={image.creatorUrl ? <ButtonLink href={image.creatorUrl} target="_blank" rel="noopener noreferrer" size="sm">{image.attribution}</ButtonLink> : image.creator} badge={saved && saved.id === selectedId ? <Badge>Selecionada</Badge> : undefined} />
          <MetaList size="sm" items={[image.license,`${image.downloadLimited ? 'Original na origem: ' : ''}${image.width} × ${image.height}`,image.provider === 'pixabay' ? image.downloadLimited ? 'Prévia de até 1280 px; original indisponível na API' : 'Original disponível · crédito opcional' : undefined]} />
          <Grid columns="auto" min={140}><Button size="sm" loading={Boolean(saved && selectingId === saved.id)} disabled={saving} onClick={() => saved && onSelect ? void selectSaved(saved) : open(image)}>{saved && onSelect ? 'Selecionar imagem' : saved ? 'Ver licença' : image.downloadLimited ? 'Ver foto e resolução' : 'Ver licença e guardar'}</Button>
            {saved && !onSelect ? <ButtonLink size="sm" href={`/banners?image=${saved.id}`}>Criar banner</ButtonLink> : null}</Grid>
        </Card>;
      })}</Grid> : view && (tab === 'saved' || result) ? <EmptyState title={tab === 'saved' ? 'Nenhuma imagem salva' : 'Nenhuma foto com a resolução mínima nesta página'} description={tab === 'search' && curated ? 'Desative a seleção editorial para ampliar a busca ou tente outro termo.' : undefined} size="panel" heading="p" actions={<Button onClick={() => { setTab('search');setResult(undefined); }}>Buscar outra imagem</Button>} /> : null}
    {tab === 'search' && result?.hasMore && result.provider === provider ? <Button disabled={loading} onClick={() => void search(result.query,result.page+1)}>Ver próxima página</Button> : null}
    <Drawer open={Boolean(inspect)} onClose={() => { if (!saving) setInspect(undefined); }} title="Conferir imagem e direitos" footer={inspectedSaved ? <Button onClick={() => setInspect(undefined)}>Fechar detalhes</Button> : <Button loading={saving} disabled={!confirmed || Boolean(inspect?.downloadLimited)} onClick={() => void keep()} variant="primary">{onSelect ? 'Guardar e selecionar' : 'Guardar na biblioteca'}</Button>}>
      {inspect ? <PageStack>
        <MediaFrame ratio="16/9" src={inspectedSaved ? libraryImageSource(inspectedSaved,true) : inspect.previewUrl} alt={inspect.title} fit="contain" />
        <MetaList items={[inspect.title,inspect.creatorUrl ? <ButtonLink key="creator" href={inspect.creatorUrl} target="_blank" rel="noopener noreferrer" size="sm">{inspect.attribution}</ButtonLink> : inspect.creator,inspect.license]} />
        <Grid columns="auto" min={180}><ButtonLink href={inspect.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir imagem na origem</ButtonLink><ButtonLink href={inspect.licenseUrl} target="_blank" rel="noopener noreferrer">Conferir licença</ButtonLink></Grid>
        {inspect.downloadLimited ? <Alert tone="warning" title="Esta é uma prévia reduzida">Solicite acesso completo à API para importar o original em alta resolução. <ButtonLink href="https://pixabay.com/api/docs/#api_support" target="_blank" rel="noopener noreferrer" size="sm">Solicitar acesso completo</ButtonLink></Alert> : null}
        {inspectedSaved ? <MetaList items={['Imagem já guardada; reavalie os direitos e o contexto antes de cada uso.']} /> : <SwitchRow label="Conferi a licença e o uso editorial" description="A licença não garante autorização de pessoas, marcas ou propriedades. Não usar como foto real da Seafood Brasil." checked={confirmed} onCheckedChange={setConfirmed} />}
        {failure ? <Alert tone="danger" title="A imagem não foi guardada">{failure}</Alert> : null}
      </PageStack> : null}
    </Drawer>
  </PageStack>;
}
