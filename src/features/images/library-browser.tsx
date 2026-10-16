'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Grid, MediaFrame, PageStack, SearchField } from '@content-ventures/design-system/v3';
import { bankImages, libraryImageSource, photoBanks, type LibraryImage, type StockImage, type StockProvider, type VisualLibraryView } from '@/domain/visual-library';
import { useRuntime } from '@/state';

/** The connected library, read once when first `enabled`; undefined while it loads or without a backend. */
function useLibraryView(enabled = true) {
  const { runtime } = useRuntime(),port = runtime?.visuals;
  const [view,setView] = useState<VisualLibraryView>();
  const [failure,setFailure] = useState<string>();
  const loaded = view !== undefined;
  useEffect(() => {
    if (!port || !enabled || loaded) return;
    let live = true;
    void port.get().then(value => { if (live) setView(value); }).catch(error => { if (live) setFailure(error instanceof Error ? error.message : 'Não foi possível abrir a biblioteca.'); });
    return () => { live = false; };
  },[port,enabled,loaded]);
  return { view,setView,failure };
}

/** Photo banks that work here (a key and real originals); empty until `enabled`, while loading or without any. */
export function usePhotoBanks(enabled = true): StockProvider[] {
  return photoBanks(useLibraryView(enabled).view);
}

const keyOf = (image: StockImage) => image.provider+':'+image.providerId;

/**
 * Shared library picker (article, banner, Imagens): the search bar of the working bank and the
 * photos. Without a search it shows the saved photos; a click keeps the photo and selects it.
 */
export function LibraryBrowser({ onSelect, selectedId }: { onSelect?: (image: LibraryImage) => void; selectedId?: string }) {
  const { runtime,status } = useRuntime(),port = runtime?.visuals;
  const { view,setView,failure: loadFailure } = useLibraryView();
  const bank = photoBanks(view)[0];
  const [query,setQuery] = useState('');
  const [result,setResult] = useState<{ images: StockImage[]; hasMore: boolean; page: number; query: string }>();
  const [loading,setLoading] = useState(false),[failure,setFailure] = useState<string>();
  const [busyId,setBusyId] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const searchId = useId();
  useEffect(() => () => request.current?.abort(),[]);

  async function search(term = query,page = 1) {
    if (!port || !bank || term.trim().length < 2) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true);setFailure(undefined);
    try {
      const value = await port.search(bank,term.trim(),page,{ signal: controller.signal });
      if (!controller.signal.aborted) setResult({ images: page > 1 && result ? [...result.images,...value.images] : value.images,hasMore: value.hasMore,page,query: term });
    } catch (error) { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'Não foi possível buscar imagens.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function choose(image: StockImage) {
    if (!port || busyId) return;
    setBusyId(keyOf(image));setFailure(undefined);
    try {
      const saved = await port.importImage(image.provider,image.providerId,true);
      if (onSelect) onSelect(saved); else setView(await port.get());
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível guardar a imagem.'); }
    finally { setBusyId(undefined); }
  }

  const saved = bankImages(view?.images ?? []);
  const shown: StockImage[] = result ? result.images : saved;
  const problem = failure ?? loadFailure;
  return <PageStack>
    {!port && status !== 'loading' ? <EmptyState title="Conecte o backend local para usar a biblioteca" size="panel" heading="p" /> : null}
    {bank ? <SearchField id={searchId} label="Buscar imagens" value={query} loading={loading} enterKeyHint="search"
      onValueChange={value => { setQuery(value); if (!value.trim()) { request.current?.abort();setLoading(false);setResult(undefined); } }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault();void search(); } }} /> : null}
    {problem ? <Alert tone="danger" title="Não foi possível concluir">{problem}</Alert> : null}
    {port && !view && !loadFailure ? <MediaFrame ratio="16/9" state="loading" alt="Carregando a biblioteca" /> : shown.length ?
      <Grid columns="auto" min={240} aria-label="Imagens">{shown.map(image => {
        const kept = 'id' in image ? image as LibraryImage : view?.images.find(item => item.provider === image.provider && item.providerId === image.providerId);
        return <Card key={keyOf(image)} as="div" padding="sm">
          <MediaFrame ratio="16/9" src={kept ? libraryImageSource(kept,true) : image.previewUrl} alt={image.title} radius="sm" />
          <CardHeader titleAs="h3" size="sm" title={image.title} description={image.attribution} badge={kept && kept.id === selectedId ? <Badge>Selecionada</Badge> : undefined} />
          {onSelect || !kept ? <Button size="sm" loading={busyId === keyOf(image)} disabled={Boolean(busyId)} onClick={() => void choose(image)}>{onSelect ? 'Selecionar' : 'Guardar'}</Button>
            : <ButtonLink size="sm" href={`/banners?image=${kept.id}`}>Criar banner</ButtonLink>}
        </Card>;
      })}</Grid> : view ? <EmptyState title={result ? 'Nenhuma imagem encontrada' : 'Nenhuma imagem salva'} size="panel" heading="p" /> : null}
    {result?.hasMore ? <Button disabled={loading} onClick={() => void search(result.query,result.page+1)}>Ver mais</Button> : null}
  </PageStack>;
}
