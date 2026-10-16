'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, Drawer, EmptyState, Field, Grid, Input, MediaFrame, MetaList, PageHeader, PageStack, Panel, Section, Select, Textarea, toast } from '@content-ventures/design-system/v3';
import { BANNER_FORMATS, BANNER_PALETTES, BANNER_TEMPLATES, bannerContentKey, initialBanner, type BannerContent, type BannerDraft, type LibraryImage, type VisualLibraryView } from '@/domain/visual-library';
import { useRuntime } from '@/state';
import { useLeaveGuard } from '@/ui/shell';
import { LibraryBrowser } from '@/features/images/library-browser';

export function BannersScreen() {
  return <Suspense fallback={<PageHeader title="Banners" />}><BannerStudio /></Suspense>;
}
function BannerStudio() {
  const { runtime,status } = useRuntime(),port = runtime?.visuals,params = useSearchParams(),router = useRouter();
  const [content,setContent] = useState<BannerContent>(initialBanner);
  const [saved,setSaved] = useState<BannerDraft>();
  const [view,setView] = useState<VisualLibraryView>();
  const [quotes,setQuotes] = useState<string[]>([]),[sourceState,setSourceState] = useState<string>();
  const [failure,setFailure] = useState<string>(),[previewFailure,setPreviewFailure] = useState<string>();
  const [preview,setPreview] = useState<{ src: string; key: string }>(),[rendering,setRendering] = useState(false);
  const [saving,setSaving] = useState(false),[picker,setPicker] = useState(false);
  const [exitTo,setExitTo] = useState<string>();
  const id = useRef<string | undefined>(undefined);
  const [departing,setDeparting] = useState(false);
  const contentKey = bannerContentKey(content),dirty = Boolean(content.title.trim() && (!saved || contentKey !== bannerContentKey(saved.content)));
  const routeKey = params.toString();
  useEffect(() => {
    if (!port) return;
    let live = true;
    void (async () => {
      try {
        const library = await port.get();if (!live) return;setView(library);
        const banner = library.banners.find(item => item.id === params.get('id'));
        if (banner) { id.current = banner.id;setSaved(banner);setContent(banner.content); }
        else { id.current = crypto.randomUUID();setSaved(undefined);setContent(initialBanner()); }
        const productionId = banner?.content.productionId ?? params.get('production');
        if (productionId) {
          const seed = await port.articleSeed(productionId);if (!live) return;
          setQuotes(seed.quotes);setSourceState(seed.sourceState);
          if (!banner) setContent(seed.content);
        } else { setQuotes([]);setSourceState(undefined); }
        const image = library.images.find(item => item.id === params.get('image'));
        if (image && !banner) {
          await port.importImage(image.provider,image.providerId,true);if (!live) return;
          setContent(current => ({ ...current,template: 'photo',imageId: image.id }));
        }
      } catch (error) { if (live) setFailure(error instanceof Error ? error.message : 'Não foi possível abrir o estúdio.'); }
    })();
    return () => { live = false; };
  },[port,routeKey,params]);
  useEffect(() => {
    if (!port || !content.title.trim()) return;
    const controller = new AbortController();let objectUrl: string | undefined;
    const timer = setTimeout(() => {
      setRendering(true);setPreviewFailure(undefined);
      void port.preview(content,controller.signal).then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);setPreview({ src: objectUrl,key: contentKey });
      }).catch(error => { if (!controller.signal.aborted) setPreviewFailure(error instanceof Error ? error.message : 'Não foi possível montar a prévia.'); })
        .finally(() => { if (!controller.signal.aborted) setRendering(false); });
    },500);
    return () => { clearTimeout(timer);controller.abort();if (objectUrl) URL.revokeObjectURL(objectUrl); };
  },[port,content,contentKey]);
  const leave = (href: string) => { if (dirty && !departing) { setExitTo(href);return false; } return true; };
  useLeaveGuard(dirty && !departing,setExitTo);
  useEffect(() => {
    if (!dirty || departing) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault();event.returnValue = ''; };
    window.addEventListener('beforeunload',beforeUnload);
    return () => window.removeEventListener('beforeunload',beforeUnload);
  },[dirty,departing]);
  function patch<K extends keyof BannerContent>(key: K,value: BannerContent[K]) { setContent(current => ({ ...current,[key]: value }));setFailure(undefined);setPreviewFailure(undefined); }
  function chooseImage(image: LibraryImage) { patch('imageId',image.id);setPicker(false);void port?.get().then(setView).catch(error => setFailure(error.message)); }
  async function save() {
    if (!port || saving || !id.current) return;
    setSaving(true);setFailure(undefined);
    try { const next = await port.saveBanner(id.current,saved?.revision ?? 0,content);setSaved(next);setView(await port.get());toast('Banner salvo como rascunho'); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  function openBanner(banner: BannerDraft) { const href = '/banners?id='+banner.id;if (leave(href)) router.push(href); }
  const format = BANNER_FORMATS[content.format],image = view?.images.find(item => item.id === content.imageId);
  const ready = Boolean(preview?.key === contentKey && !previewFailure && !rendering);
  const awaitingPreview = Boolean(port && content.title.trim() && !previewFailure && !ready);
  const exportable = saved && !dirty;
  return <PageStack>
    <PageHeader title="Banners" status={<Badge>Rascunho</Badge>} actions={<><Button variant="primary" loading={saving} disabled={!ready || !dirty} onClick={() => void save()}>Salvar banner</Button><ButtonLink href="/images" onClick={event => { if (!leave('/images')) event.preventDefault(); }}>Abrir biblioteca</ButtonLink></>} />
    {!port && status !== 'loading' ? <EmptyState title="Conecte o backend local para criar banners" size="panel" heading="p" /> : null}
    {failure ? <Alert tone="danger" title="Não foi possível concluir">{failure}</Alert> : null}
    <Grid columns="3:2" collapseBelow={760} align="start"><Panel><Section title="Composição"><PageStack>
      <Grid columns="1:1" collapseBelow={640}><Field label="Modelo">{({ id }) => <Select id={id} value={content.template} onChange={value => patch('template',value as BannerContent['template'])} options={BANNER_TEMPLATES.map(item => ({ value: item.id,label: item.label,disabled: item.id === 'quote' && !quotes.length,description: item.id === 'quote' && !quotes.length ? 'Abra pelo artigo com citações verificadas.' : undefined }))} />}</Field>
        <Field label="Formato">{({ id }) => <Select id={id} value={content.format} onChange={value => patch('format',value as BannerContent['format'])} options={Object.entries(BANNER_FORMATS).map(([value,item]) => ({ value,label: item.label }))} />}</Field></Grid>
      <Grid columns="1:1" collapseBelow={640}><Field label="Nome da marca">{({ id }) => <Input id={id} value={content.brand} maxLength={40} onChange={event => patch('brand',event.target.value)} />}</Field>
        <Field label="Direção visual">{({ id }) => <Select id={id} value={content.palette} onChange={value => patch('palette',value as BannerContent['palette'])} options={Object.entries(BANNER_PALETTES).map(([value,item]) => ({ value,label: item.label }))} />}</Field></Grid>
      <Field label="Editoria">{({ id }) => <Input id={id} value={content.kicker} maxLength={50} onChange={event => patch('kicker',event.target.value)} />}</Field>
      <Field label="Chamada">{({ id }) => <Textarea id={id} value={content.title} maxLength={150} rows={3} onChange={event => patch('title',event.target.value)} />}</Field>
      {content.template === 'quote' ? <PageStack><Field label="Citação literal do artigo">{({ id }) => <Select id={id} value={content.quote ?? ''} placeholder="Selecione uma fala verificada" onChange={value => patch('quote',value)} options={quotes.map(value => ({ value,label: value }))} />}</Field>
        <Field label="Atribuição confirmada">{({ id }) => <Input id={id} value={content.quoteCredit ?? ''} maxLength={80} onChange={event => patch('quoteCredit',event.target.value)} />}</Field></PageStack> :
        <Field label="Linha de apoio" optional>{({ id }) => <Textarea id={id} value={content.description} maxLength={240} rows={3} onChange={event => patch('description',event.target.value)} />}</Field>}
      <Field label="Chamada para ação">{({ id }) => <Input id={id} value={content.cta} maxLength={50} onChange={event => patch('cta',event.target.value)} />}</Field>
      {content.template === 'photo' ? <Section title="Foto" titleAs="h3"><Button onClick={() => setPicker(true)}>{image ? 'Trocar foto' : 'Selecionar foto da biblioteca'}</Button>{image ? <MetaList size="sm" items={[image.creatorUrl ? <ButtonLink key="creator" href={image.creatorUrl} target="_blank" rel="noopener noreferrer" size="sm">{image.attribution}</ButtonLink> : image.creator,image.license]} /> : null}</Section> : null}
      {sourceState ? <MetaList size="sm" items={[sourceState,<ButtonLink key="article" href={`/productions/${content.productionId}/article`} onClick={event => { if (!leave(`/productions/${content.productionId}/article`)) event.preventDefault(); }}>Abrir artigo</ButtonLink>]} /> : null}
    </PageStack></Section></Panel><Panel><Section title="Prévia e exportação" meta={`${format.width} × ${format.height}`}><PageStack>
      {ready || awaitingPreview ? <MediaFrame ratio={`${format.width}/${format.height}`} src={ready ? preview?.src : undefined} alt="Prévia do banner editorial" fit="contain" state={awaitingPreview ? 'loading' : undefined} /> : <EmptyState title={content.title.trim() ? 'A composição precisa de ajustes' : 'Escreva a chamada para visualizar o banner'} size="panel" heading="p" />}
      {previewFailure ? <Alert tone="warning" title="Ajuste a composição">{previewFailure}</Alert> : null}
      <MetaList size="sm" items={['Composição local; não é imagem gerada por IA.','Paleta de partida, sem logotipo ou identidade oficial da Seafood Brasil.']} />
      {exportable ? <Grid columns="auto" min={180}><ButtonLink href={`/api/reporter/visuals/banners/${saved.id}/png`} download>Baixar PNG</ButtonLink><ButtonLink href={`/api/reporter/visuals/banners/${saved.id}/svg`} download>Baixar SVG editável</ButtonLink><ButtonLink href={`/api/reporter/visuals/banners/${saved.id}/json`} download>Baixar créditos e composição</ButtonLink></Grid> : <MetaList size="sm" items={['Salve a composição para liberar os arquivos.']} />}
    </PageStack></Section></Panel></Grid>
    {view?.banners.length ? <Panel><Section title="Banners salvos"><Grid columns="auto" min={200}>{view.banners.map(banner => <Card key={banner.id} as="div" padding="sm"><MediaFrame ratio={`${BANNER_FORMATS[banner.content.format].width}/${BANNER_FORMATS[banner.content.format].height}`} src={`/api/reporter/visuals/banners/${banner.id}/png`} alt={banner.content.title} fit="contain" /><CardHeader titleAs="h3" title={banner.content.title} description={`${BANNER_TEMPLATES.find(item => item.id === banner.content.template)?.label} · ${BANNER_FORMATS[banner.content.format].label} · revisão ${banner.revision}`} /><Button onClick={() => openBanner(banner)}>Editar banner</Button></Card>)}</Grid></Section></Panel> : null}
    <Drawer open={picker} onClose={() => setPicker(false)} title="Selecionar foto"><LibraryBrowser selectedId={content.imageId} onSelect={chooseImage} /></Drawer>
    <ConfirmDialog open={Boolean(exitTo)} onClose={() => setExitTo(undefined)} title="Sair sem salvar o banner?" description="As alterações da composição ainda não foram salvas." confirmLabel="Sair sem salvar" onConfirm={() => { if (exitTo) { setDeparting(true);router.push(exitTo);setExitTo(undefined); } }} />
  </PageStack>;
}
