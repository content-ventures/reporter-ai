'use client';
import { useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, CardHeader, CardLink, CopyButton, DescriptionList, EmptyState, Field, FilterBar, Grid, Input, List, ListItem, MediaFrame, MetaList, PageHeader, PageStack, Panel, Prose, SearchField, Section, Select, SplitLayout, Tabs, toast } from '@content-ventures/design-system/v3';
import { Plus, Search, RotateCw } from '@content-ventures/design-system/v3/icons';
import { ARCHIVE, IMAGES, QUOTES, matches, validWebUrl } from './demo-data';
import { usePrototype } from './prototype-state';
import { PrototypeDetail } from './prototype-detail';
import type { R2Navigate } from './r2-prototype';

export function LibraryScreen({ kind, navigate }: { kind: 'images' | 'quotes' | 'archive'; navigate: R2Navigate }) {
  const { credits, setCredits, imageId, setImageId, quoteIds, setQuoteIds, archive, setArchive } = usePrototype();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string>();
  const [credit, setCredit] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'browse' | 'ask'>('browse');
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState(false);
  const image = IMAGES.find(item => item.id === selected);
  const quote = QUOTES.find(item => item.id === selected);
  const archived = archive.find(item => item.id === selected);
  const titles = { images: 'Imagens', quotes: 'Banco de citações', archive: 'Acervo publicado' };
  return <PageStack>
    <PageHeader title={titles[kind]} description={kind === 'images' ? 'Escolha a imagem e confira os direitos e créditos.' : kind === 'quotes' ? 'Falas com autor, contexto e localização na fonte.' : 'Consulte matérias publicadas e suas referências.'}
      actions={kind === 'archive' ? <Button icon={Plus} variant="primary" onClick={() => { setAdding(true); setError(''); }}>Adicionar URL</Button> : undefined} />
    {kind === 'archive' && <Tabs label="Consultar acervo" value={tab} onChange={setTab} items={[{ value: 'browse', label: 'Matérias', count: archive.length }, { value: 'ask', label: 'Perguntar ao acervo' }]} />}
    {kind !== 'archive' || tab === 'browse' ? <>
      <FilterBar spacing="comfortable" filters={false} search={<SearchField label="Buscar no acervo" value={query} onValueChange={setQuery} placeholder={kind === 'quotes' ? 'Buscar fala, autor ou assunto' : 'Buscar título ou assunto'} />}
        actions={<Select aria-label="Filtrar acervo" value={filter} onChange={setFilter} options={kind === 'images' ? [{ value: 'all', label: 'Todas as licenças' }, { value: 'allowed', label: 'Liberadas no protótipo' }, { value: 'pending', label: 'Créditos pendentes' }]
          : kind === 'quotes' ? [{ value: 'all', label: 'Todas as falas' }, { value: 'verified', label: 'Conferidas' }, { value: 'pending', label: 'A conferir' }]
            : [{ value: 'all', label: 'Todos os estados' }, { value: 'indexed', label: 'Indexadas' }, { value: 'error', label: 'Com falha' }, { value: 'pending', label: 'Aguardando' }]} />} />
      {kind === 'images' && <>
        <Grid columns="1:1:1" collapseBelow={960}>{IMAGES.filter(item => matches(query, item.title, item.description) && (filter === 'all' || (filter === 'allowed' ? item.allowed : !item.allowed))).map(item => <Card key={item.id} interactive padding="md"><PageStack>
          <MediaFrame ratio="16/9" src={item.src} alt={item.description} />
          <CardHeader titleAs="h2" size="md" title={<CardLink onClick={() => { setSelected(item.id); setCredit(credits[item.id] ?? item.credit); }}>{item.title}</CardLink>} description={credits[item.id] ?? item.credit} />
          <MetaList items={[<Badge key="license" tone={item.allowed ? 'gray' : 'amber'}>{item.license}</Badge>, imageId === item.id ? 'Selecionada' : undefined]} />
        </PageStack></Card>)}</Grid>
        {!IMAGES.some(item => matches(query, item.title, item.description) && (filter === 'all' || (filter === 'allowed' ? item.allowed : !item.allowed))) && <EmptyState size="panel" title="Nenhuma imagem encontrada" />}
      </>}
      {kind === 'quotes' && <SplitLayout main={<PageStack>
        {QUOTES.filter(item => matches(query, item.text, item.author, item.topic) && (filter === 'all' || (filter === 'verified' ? item.verified : !item.verified))).map(item => <Card key={item.id} as="article" interactive padding="lg"><PageStack>
          <CardHeader titleAs="h2" title={<CardLink onClick={() => setSelected(item.id)}>{item.author}</CardLink>} leading={<Avatar name={item.author} size="sm" />} description={item.role}
            actions={<Badge tone={item.verified ? 'gray' : 'amber'}>{quoteIds.includes(item.id) ? 'Na seleção' : item.verified ? 'Conferida' : 'A conferir'}</Badge>} />
          <Prose variant="read" measure="wide">{`“${item.text}”`}</Prose>
          <MetaList items={[item.source, item.locator, item.date]} size="sm" />
        </PageStack></Card>)}
        {!QUOTES.some(item => matches(query, item.text, item.author, item.topic) && (filter === 'all' || (filter === 'verified' ? item.verified : !item.verified))) && <EmptyState size="panel" title="Nenhuma citação encontrada" description="Tente outro autor ou assunto." />}
      </PageStack>} asideLabel="Seleção de citações" aside={<PageStack>
        <Panel><Section title="Selecionadas para a pauta" meta={String(quoteIds.length)}><PageStack>
          {quoteIds.length ? <List framed={false} label="Citações selecionadas">{QUOTES.filter(item => quoteIds.includes(item.id)).map(item => <ListItem key={item.id} title={item.author} description={item.text} onClick={() => setSelected(item.id)} />)}</List>
            : <EmptyState size="inline" title="Sua seleção começa aqui" description="Abra uma fala para conferir o contexto e incluí-la na pauta." />}
          <Button disabled={!quoteIds.length} onClick={() => navigate('hard-news')}>Abrir pauta</Button>
        </PageStack></Section></Panel>
        <Panel><Section title="Conferência da fonte"><List framed={false} label="Critérios para usar uma fala">
          <ListItem title="Autoria identificada" description="Nome e função de quem fala." />
          <ListItem title="Trecho localizável" description="Gravação ou transcrição com marcação." />
          <ListItem title="Contexto preservado" description="Sem alterar o sentido da declaração." />
        </List></Section></Panel>
      </PageStack>} />}
      {kind === 'archive' && <SplitLayout main={<PageStack>
        {archive.filter(item => matches(query, item.title, item.topic) && (filter === 'all' || item.state === filter)).map(item => <Card key={item.id} as="article" padding="lg"><PageStack>
          <MetaList items={[item.topic, item.date]} size="sm" />
          <CardHeader titleAs="h2" size="md" title={item.title} />
          <Prose variant="compact" measure="wide">{item.excerpt}</Prose>
          <CardHeader titleAs="h3" title={<Badge tone={item.state === 'error' ? 'amber' : 'gray'}>{item.state === 'indexed' ? 'Disponível para consulta' : item.state === 'error' ? 'Falha de leitura' : 'Aguardando indexação'}</Badge>}
            actions={item.state === 'indexed' ? <Button size="sm" onClick={() => setSelected(item.id)}>Ver trechos</Button> : <Button size="sm" icon={RotateCw} onClick={() => { setArchive(items => items.map(row => row.id === item.id ? { ...row, state: 'indexed' } : row)); toast('Indexação simulada concluída'); }}>Simular indexação</Button>} />
        </PageStack></Card>)}
        {!archive.some(item => matches(query, item.title, item.topic) && (filter === 'all' || item.state === filter)) && <EmptyState size="panel" title="Nenhuma matéria encontrada" />}
      </PageStack>} asideLabel="Pesquisa no acervo" aside={<PageStack>
        <Panel><Section title="Recupere a cobertura anterior"><PageStack>
          <Prose variant="read">O que o veículo já publicou sobre esta pauta?</Prose>
          <Prose variant="compact">Consulte o contexto das matérias e escolha as referências que ajudam a avançar a apuração.</Prose>
          <Button icon={Search} onClick={() => setTab('ask')}>Perguntar ao acervo</Button>
        </PageStack></Section></Panel>
        <Panel><Section title="Saúde do acervo"><List framed={false} label="Estado da indexação">
          <ListItem title="Prontas para pesquisa" meta={String(archive.filter(item => item.state === 'indexed').length)} onClick={() => setFilter('indexed')} />
          <ListItem title="Precisam de atenção" meta={String(archive.filter(item => item.state === 'error').length)} onClick={() => setFilter('error')} />
          <ListItem title="Na fila de indexação" meta={String(archive.filter(item => item.state === 'pending').length)} onClick={() => setFilter('pending')} />
        </List></Section></Panel>
      </PageStack>} />}

    </> : <Panel><Section title="Pesquisa no conteúdo publicado"><PageStack>
      <Field label="O que você quer encontrar?">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={question} onChange={event => { setQuestion(event.target.value); setAsked(false); }} placeholder="Ex.: o que já publicamos sobre rastreabilidade?" />}</Field>
      <Button icon={Search} variant="primary" disabled={!question.trim()} onClick={() => setAsked(true)}>Simular consulta</Button>
      {asked && <>
        <Badge tone="blue">Resposta demonstrativa · não gerada por IA</Badge>
        <Prose>O acervo de exemplo aborda registros por lote e monitoramento de temperatura na cadeia do pescado. A informação está nos trechos abaixo; consulte o contexto antes de reutilizá-la.</Prose>
        <List label="Referências da resposta">{archive.filter(item => item.state === 'indexed').slice(0, 2).map((item, index) => <ListItem key={item.id} title={`[${index + 1}] ${item.title}`} titleLines={2} description={item.excerpt} onClick={() => setSelected(item.id)} />)}</List>
      </>}
    </PageStack></Section></Panel>}
    {kind === 'images' && image && <PrototypeDetail title={image.title} onClose={() => setSelected(undefined)} footer={<>
      <Button disabled={!credit.trim()} onClick={() => { setCredits(value => ({ ...value, [image.id]: credit.trim() })); toast('Crédito salvo nesta sessão'); }}>Salvar crédito</Button>
      <Button variant="primary" disabled={!image.allowed || !credit.trim()} onClick={() => { setCredits(value => ({ ...value, [image.id]: credit.trim() })); setImageId(image.id); setSelected(undefined); navigate('hard-news'); }}>Usar no rascunho de exemplo</Button>
    </>}><PageStack>
      <MediaFrame ratio="16/9" src={image.src} alt={image.description} />
      <DescriptionList items={[{ label: 'Origem', value: image.origin }, { label: 'Licença', value: image.license }]} />
      {!image.allowed && <Alert tone="warning" title="Direitos ainda não validados">Registrar o crédito não libera o uso da imagem. A seleção permanece bloqueada.</Alert>}
      <Field label="Crédito publicado">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={credit} onChange={event => setCredit(event.target.value)} />}</Field>
    </PageStack></PrototypeDetail>}
    {kind === 'quotes' && quote && <PrototypeDetail title="Citação e contexto" onClose={() => setSelected(undefined)} footer={<>
      <CopyButton text={`“${quote.text}” — ${quote.author}. ${quote.source}, ${quote.locator}. [Exemplo fictício]`} label="Copiar com atribuição" />
      <Button variant="primary" disabled={!quote.verified || quoteIds.includes(quote.id)} onClick={() => { setQuoteIds(ids => [...ids, quote.id]); toast('Citação adicionada à seleção do protótipo'); }}>{quoteIds.includes(quote.id) ? 'Adicionada à seleção' : 'Selecionar citação'}</Button>
    </>}><PageStack><Badge tone="amber">Fala e pessoa fictícias</Badge><Prose variant="read">{quote.text}</Prose>
      <DescriptionList items={[{ label: 'Autor', value: quote.author }, { label: 'Identificação', value: quote.role }, { label: 'Fonte', value: quote.source }, { label: 'Trecho', value: quote.locator }, { label: 'Contexto', value: quote.context }, { label: 'Data', value: quote.date }]} />
      {!quote.verified && <Alert tone="warning" title="Confira a fala antes de usar">O trecho ainda não foi conferido com a gravação de origem.</Alert>}
    </PageStack></PrototypeDetail>}
    {kind === 'archive' && archived && <PrototypeDetail title="Trecho do acervo" onClose={() => setSelected(undefined)}><PageStack>
      <Prose variant="read">{archived.title}</Prose><DescriptionList items={[{ label: 'Publicação', value: archived.date }, { label: 'URL demonstrativa', value: archived.url }, { label: 'Estado', value: archived.state === 'indexed' ? 'Indexada no protótipo' : 'Ainda não disponível para consulta' }]} />
      <Panel><Section title="Trecho recuperado"><Prose>{archived.excerpt}</Prose></Section></Panel>
    </PageStack></PrototypeDetail>}
    {adding && <PrototypeDetail title="Adicionar matéria ao acervo" onClose={() => setAdding(false)} footer={<Button variant="primary" onClick={() => {
      if (!validWebUrl(newUrl)) { setError('Informe uma URL http ou https válida.'); return; }
      if (archive.some(item => new URL(item.url).href === new URL(newUrl).href)) { setError('Esta matéria já está no acervo.'); return; }
      setArchive(items => [...items, { ...ARCHIVE[0], id: crypto.randomUUID(), title: 'Matéria adicionada por URL · exemplo', url: new URL(newUrl).href, state: 'pending' }]); setAdding(false); setNewUrl(''); toast('URL adicionada ao acervo de demonstração');
    }}>Adicionar ao protótipo</Button>}><PageStack>
      {error && <Alert tone="danger" title="Revise a URL">{error}</Alert>}
      <Field label="URL da matéria">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} type="url" value={newUrl} onChange={event => setNewUrl(event.target.value)} />}</Field>
      <Prose variant="compact">A URL não será acessada. A indexação pode ser simulada na lista.</Prose>
    </PageStack></PrototypeDetail>}
  </PageStack>;
}
