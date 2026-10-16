'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, DataTable, DatePicker, DescriptionList, Drawer, EmptyState, ErrorState, Field, FieldGroup, FilterBar, Input, List, ListItem, ListItemSkeleton, PageHeader, PageStack, Pagination, Panel, Prose, SearchField, Section, Select, SwitchRow, Tabs, Textarea, toast, type Column } from '@content-ventures/design-system/v3';
import { Plus, Quote } from '@content-ventures/design-system/v3/icons';
import { citationCopy, type CitationInput, type CitationLibraryView, type CitationView } from '@/domain/citation-library';
import { foldForMatch, type ArticleBody } from '@/domain';
import { EditorContent, useArticleReader } from '@/editor';
import { useCan, useRuntime } from '@/state';
import { isPermissionRefusal, notifyRefusal, refusalOf } from '@/ui/permission-dialog';
import { usePhone } from '@/ui/use-phone';
import { materialHref } from '@/ui/routes';

type Filter = 'all' | 'ready' | 'pending';
const PAGE_SIZE = 12;
const moment = (ms?: number) => ms === undefined ? 'Sem minutagem' : `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function QuoteReading({ text }: { text: string }) {
  const body = useMemo<ArticleBody>(() => ({ type: 'article',title: '',blocks: [{ id: 'citation',type: 'quote',inlines: [{ text }] }] }),[text]);
  const editor = useArticleReader({ body });
  return <Prose variant="read" size="sm" label="Citação literal"><EditorContent editor={editor} /></Prose>;
}
export function CitationsScreen() {
  const { runtime,status } = useRuntime(), port = runtime?.citations, phone = usePhone();
  // A role that only reviews reads and copies citations; adding and curating is for who edits.
  const edits = useCan('library.edit'), creates = useCan('production.create');
  const [view,setView] = useState<CitationLibraryView>(),[failure,setFailure] = useState<string>();
  const [query,setQuery] = useState(''),[filter,setFilter] = useState<Filter>('all'),[page,setPage] = useState(1);
  const [selected,setSelected] = useState<CitationView>(),[adding,setAdding] = useState(false),[saving,setSaving] = useState(false);
  const [input,setInput] = useState<CitationInput>(),[formError,setFormError] = useState<string>();
  const load = useCallback(async () => {
    if (!port) return;
    try { setView(await port.get());setFailure(undefined); } catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível carregar as citações.'); }
  },[port]);
  useEffect(() => { if (!port) return;let live = true;void port.get().then(value => { if (live) setView(value); }).catch(error => { if (live) setFailure(error.message); });return () => { live = false; }; },[port]);
  useEffect(() => {
    if (!port) return;let live = true,reading = false;
    const timer = window.setInterval(() => {
      if (reading) return;reading = true;
      void port.get().then(value => { if (live) setView(value); }).catch(() => {}).finally(() => { reading = false; });
    },5000);
    return () => { live = false;window.clearInterval(timer); };
  },[port]);
  const rows = (view?.items ?? []).filter(item => (filter === 'all' || (filter === 'ready' ? item.ready : !item.ready))
    && foldForMatch([item.text,item.speaker,item.podcast,item.relevance,item.location,item.recordedOn].filter(Boolean).join(' ')).includes(foldForMatch(query)));
  const pages = Math.max(1,Math.ceil(rows.length/PAGE_SIZE)), currentPage = Math.min(page,pages);
  const shown = rows.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  function open(item: CitationView) {
    setSelected(item);setAdding(false);setFormError(undefined);
    setInput({ sourceId: item.ref.sourceId,sourceVersion: item.ref.sourceVersion,text: item.text,productionId: item.productionId,
      personId: item.personId,authorConfirmed: item.authorConfirmed,relevance: item.relevance,
      podcastName: item.podcastName ?? (item.podcast === 'Podcast não informado' ? undefined : item.podcast),podcastUrl: item.podcastUrl,recordedOn: item.recordedOn,location: item.location });
  }
  function add() {
    const source = view?.sources[0];if (!source) return;
    setSelected(undefined);setAdding(true);setFormError(undefined);
    setInput({ sourceId: source.id,sourceVersion: source.version,productionId: source.productionId,text: '',authorConfirmed: false,relevance: '' });
  }
  const close = () => { if (!saving) { setInput(undefined);setSelected(undefined);setAdding(false);setFormError(undefined); } };
  const patch = (value: Partial<CitationInput>) => setInput(previous => previous ? { ...previous,...value } : previous);
  async function save() {
    if (!port || !input || saving) return;
    setSaving(true);setFormError(undefined);
    try {
      const next = await port.save(input,selected?.id,selected?.revision ?? 0);
      setView(previous => previous ? { ...previous,items: [next,...previous.items.filter(item => item.id !== next.id)] } : previous);
      open(next);toast('Citação salva');void load();
    }
    catch (error) {
      const refusal = refusalOf(error,'Não foi possível salvar. Seus campos continuam aqui.');
      if (isPermissionRefusal(refusal)) notifyRefusal(undefined,refusal); else setFormError(refusal.message);
    }
    finally { setSaving(false); }
  }
  async function copy(item: CitationView) {
    try { await navigator.clipboard.writeText(citationCopy(item));toast('Citação e origem copiadas'); }
    catch { toast('Não foi possível copiar. Selecione o texto na prévia.',{ tone: 'error' }); }
  }
  const columns: Column<CitationView>[] = [
    { key: 'text',header: 'Citação',render: item => <ListItem title={`“${item.text}”`} description={`${item.speaker} · ${item.podcast}`} /> },
    ...(!phone ? [{ key: 'date',header: 'Data / momento',width: 180,render: (item: CitationView) => <ListItem title={item.recordedOn ?? 'Data não informada'} description={moment(item.startMs)} /> }] : []),
    { key: 'state',header: 'Curadoria',width: 110,render: item => <Badge tone={item.ready ? 'green' : 'gray'}>{item.ready ? 'Selecionada' : 'Conferir'}</Badge> },
  ];
  if (failure && !view) return <ErrorState heading="h1" size="page" title="Não foi possível abrir as citações" description={failure} onRetry={() => void load()} />;
  if (!port && status !== 'loading') return <EmptyState heading="h1" title="Citações disponíveis no backend local" description="Abra o Reporter AI conectado ao PostgreSQL." size="page" />;
  return <>
    <PageStack>
      <PageHeader title="Citações" description="Falas literais dos podcasts, com origem verificável e curadoria editorial." actions={edits ? <Button icon={Plus} disabled={!view?.sources.length} onClick={add}>Adicionar citação</Button> : undefined} />
      <FilterBar filters={false} tabs={<Tabs<Filter> label="Curadoria das citações" value={filter} onChange={value => { setFilter(value);setPage(1); }} items={[{ value: 'all',label: 'Todas',count: view?.items.length },{ value: 'ready',label: 'Selecionadas',count: view?.items.filter(item => item.ready).length },{ value: 'pending',label: 'Para conferir',count: view?.items.filter(item => !item.ready).length }]} />}
        search={<SearchField label="Buscar citações" value={query} onValueChange={value => { setQuery(value);setPage(1); }} placeholder="Fala, participante, podcast ou assunto" />} />
      {!view ? <List label="Carregando citações"><ListItemSkeleton /><ListItemSkeleton /><ListItemSkeleton /></List> : rows.length ? <>
        <DataTable<CitationView> label="Banco de citações" rows={shown} columns={columns} rowKey={item => item.id} onRowClick={open} />
        <Pagination page={currentPage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} />
      </> : <EmptyState icon={Quote} title={query || filter !== 'all' ? 'Nenhuma citação neste filtro' : 'O banco começa com as falas dos seus artigos'} description={query ? 'Tente outro termo ou limpe a busca.' : 'Gere um artigo ou adicione um trecho literal de um material autorizado.'} actions={query ? <Button onClick={() => { setQuery('');setFilter('all'); }}>Limpar filtros</Button> : view.sources.length ? (edits ? <Button onClick={add}>Adicionar citação</Button> : undefined) : (creates ? <ButtonLink href="/productions/new">Criar produção</ButtonLink> : undefined)} />}
    </PageStack>
    <Drawer open={Boolean(input)} title={adding ? 'Adicionar citação' : 'Conferir citação'} onClose={close} size="lg" footer={edits ? <Button loading={saving} disabled={!input?.text.trim()} onClick={() => void save()} variant="primary">Salvar citação</Button> : undefined}>
      {input ? <PageStack>
        {selected ? <>
          <QuoteReading text={selected.text} />
          <DescriptionList items={[{ label: 'Quem falou',value: selected.speaker },{ label: 'Podcast',value: selected.podcast },{ label: 'Material',value: selected.sourceTitle },{ label: 'Data',value: selected.recordedOn ?? 'Não informada' },{ label: 'Momento',value: moment(selected.startMs) },{ label: 'Onde',value: selected.location || 'Não informado' },{ label: 'Verificação',value: selected.authorized ? 'Texto encontrado na transcrição original' : 'Material indisponível ou sem autorização' }]} />
          <Field label="Contexto original">{props => <Textarea id={props.id} aria-describedby={props.describedBy} value={selected.evidence} rows={5} readOnly />}</Field>
          <FieldGroup label="Usar citação" columns={2}><Button disabled={!selected.authorized} onClick={() => void copy(selected)}>Copiar citação e origem</Button><ButtonLink href={materialHref(selected.productionId)}>Conferir material</ButtonLink></FieldGroup>
          {selected.podcastUrl ? <ButtonLink href={selected.podcastUrl} target="_blank" rel="noopener noreferrer">Abrir episódio original</ButtonLink> : null}
        </> : <>
          <Field label="Material de origem">{props => <Select {...props} value={input.sourceId} options={(view?.sources ?? []).map(source => ({ value: source.id,label: source.title }))} onChange={value => { const source = view?.sources.find(source => source.id === value);if (source) patch({ sourceId: source.id,sourceVersion: source.version,productionId: source.productionId,personId: undefined,authorConfirmed: false }); }} />}</Field>
          <Field label="Aspas literais" hint="Copie um trecho contínuo da transcrição, sem reescrever.">{props => <Textarea id={props.id} aria-describedby={props.describedBy} value={input.text} rows={6} maxLength={1200} onChange={event => patch({ text: event.target.value })} />}</Field>
        </>}
        <Panel><Section title="Autoria e origem"><FieldGroup label="Curadoria editorial" columns={1}>
          {selected ? <>
            <Field label="Quem falou">{props => <Select {...props} value={input.personId ?? ''} options={[{ value: '',label: 'Autoria a confirmar' },...selected.participants.map(person => ({ value: person.id,label: person.name }))]} onChange={personId => patch({ personId: personId || undefined,authorConfirmed: false })} />}</Field>
            <SwitchRow label="Conferi que esta pessoa disse a fala" checked={input.authorConfirmed} disabled={!input.personId} onCheckedChange={authorConfirmed => patch({ authorConfirmed })} />
          </> : null}
          <Field label="Podcast ou programa">{props => <Input {...props} value={input.podcastName ?? ''} maxLength={160} onChange={event => patch({ podcastName: event.target.value })} />}</Field>
          <Field label="Link do episódio">{props => <Input {...props} value={input.podcastUrl ?? ''} maxLength={2000} inputMode="url" placeholder="https://" onChange={event => patch({ podcastUrl: event.target.value })} />}</Field>
          <Field label="Data do episódio">{props => <DatePicker {...props} value={input.recordedOn ?? ''} editable onChange={recordedOn => patch({ recordedOn })} />}</Field>
          <Field label="Onde foi dito">{props => <Input {...props} value={input.location ?? ''} maxLength={160} onChange={event => patch({ location: event.target.value })} />}</Field>
          <Field label="Por que essa fala é relevante para o mercado?">{props => <Textarea id={props.id} aria-describedby={props.describedBy} value={input.relevance} rows={3} maxLength={600} onChange={event => patch({ relevance: event.target.value })} />}</Field>
        </FieldGroup></Section></Panel>
        {formError ? <Alert tone="danger" title="A citação não foi salva">{formError}</Alert> : null}
      </PageStack> : null}
    </Drawer>
  </>;
}
