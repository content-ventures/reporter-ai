'use client';
import { useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, CardHeader, CardLink, DataTable, DescriptionList, EmptyState, Field, FieldGroup, FilterBar, Input, List, ListItem, MetaList, PageHeader, PageStack, Panel, Prose, SearchField, Section, Select, SplitLayout, Tabs, toast } from '@content-ventures/design-system/v3';
import { Plus, RotateCw, Rss, Sparkles } from '@content-ventures/design-system/v3/icons';
import { usePrototype } from './prototype-state';
import { matches, validWebUrl, type News } from './demo-data';
import { PrototypeDetail } from './prototype-detail';
import type { R2Navigate } from './r2-prototype';

export function NewsScreen({ navigate }: { navigate: R2Navigate }) {
  const { news, setNews, feeds, setFeeds, setBrief, map } = usePrototype();
  const [tab, setTab] = useState<'inbox' | 'selected' | 'dismissed' | 'feeds'>('inbox');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [sort, setSort] = useState('score');
  const [detailId, setDetailId] = useState<string>();
  const [form, setForm] = useState<'url' | 'rss'>();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [interval, setInterval] = useState('30');
  const [error, setError] = useState('');
  const detail = news.find(item => item.id === detailId);
  const filtered = news.filter(item => item.status === tab && matches(query, item.title, item.source) && (topic === 'all' || topic === item.topic));
  if (sort === 'score') filtered.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const update = (id: string, status: News['status']) => { setNews(items => items.map(item => item.id === id ? { ...item, status } : item)); setDetailId(undefined); };
  function openForm(kind: 'url' | 'rss') { setForm(kind); setUrl(''); setName(''); setError(''); }
  function importExample() {
    if (!validWebUrl(url) || (form === 'rss' && !name.trim())) { setError('Informe uma URL válida e preencha os campos obrigatórios.'); return; }
    const normalized = new URL(url).href;
    if ((form === 'url' ? news : feeds).some(item => new URL(item.url).href === normalized)) { setError('Esta URL já está cadastrada.'); return; }
    if (form === 'rss') setFeeds(items => [...items, { id: crypto.randomUUID(), name: name.trim(), url: normalized, interval, state: 'active' }]);
    else setNews(items => [{ id: crypto.randomUUID(), title: 'Notícia importada por URL · exemplo', url: normalized, source: new URL(url).hostname, topic: 'Indústria', age: 'Agora', summary: 'Conteúdo demonstrativo para revisar a experiência de importação. O endereço informado não foi consultado.', score: null, status: 'inbox', reason: 'Aguardando classificação.' }, ...items]);
    setTab(form === 'rss' ? 'feeds' : 'inbox'); setForm(undefined); toast('Importação simulada nesta sessão');
  }
  return <PageStack>
    <PageHeader title="Notícias" actions={<ButtonGroup label="Importar notícias">
      <Button icon={Rss} onClick={() => openForm('rss')}>Adicionar RSS</Button><Button variant="primary" icon={Plus} onClick={() => openForm('url')}>Importar URL</Button>
    </ButtonGroup>} />
    <FilterBar spacing="comfortable" filters={false} tabs={<Tabs label="Fila de notícias" value={tab} onChange={setTab} items={[
      { value: 'inbox', label: 'Para avaliar', count: news.filter(item => item.status === 'inbox').length },
      { value: 'selected', label: 'Pautas selecionadas', count: news.filter(item => item.status === 'selected').length },
      { value: 'dismissed', label: 'Descartadas', count: news.filter(item => item.status === 'dismissed').length },
      { value: 'feeds', label: 'Fontes RSS', count: feeds.length },
    ]} />} search={<SearchField label="Buscar notícias ou fontes" value={query} onValueChange={setQuery} placeholder="Buscar título ou fonte" />} />
    {tab === 'feeds' ? <DataTable label="Fontes RSS" rows={feeds.filter(item => matches(query, item.name, item.url))} rowKey={item => item.id} columns={[
      { key: 'name', header: 'Fonte', render: item => item.name },
      { key: 'url', header: 'Endereço', render: item => item.url, truncate: true },
      { key: 'interval', header: 'Frequência', render: item => `${item.interval} min` },
      { key: 'state', header: 'Estado', render: item => <Badge tone={item.state === 'error' ? 'amber' : 'gray'}>{item.state === 'error' ? 'Falha de leitura' : item.state === 'paused' ? 'Pausada' : 'Ativa no protótipo'}</Badge> },
      { key: 'action', header: 'Ações', render: item => <Button size="sm" icon={item.state === 'error' ? RotateCw : undefined} onClick={() => {
        setFeeds(items => items.map(feed => feed.id === item.id ? { ...feed, state: feed.state === 'active' ? 'paused' : 'active' } : feed));
        toast(item.state === 'error' ? 'Nova leitura simulada com sucesso' : 'Fonte atualizada nesta sessão');
      }}>{item.state === 'error' ? 'Tentar novamente' : item.state === 'active' ? 'Pausar' : 'Ativar'}</Button> },
    ]} empty={<EmptyState size="panel" title="Nenhuma fonte encontrada" />} /> : <>
      <FilterBar filters={false} actions={<>
        <Select key="topic" aria-label="Editoria" value={topic} onChange={setTopic} options={['all', 'Indústria', 'Mercado', 'Aquicultura', 'Consumo'].map(value => ({ value, label: value === 'all' ? 'Todas as editorias' : value }))} />
        <Select key="sort" aria-label="Ordenar notícias" value={sort} onChange={setSort} options={[{ value: 'score', label: 'Maior pontuação' }, { value: 'recent', label: 'Mais recentes' }]} />
        <Button key="classify" icon={Sparkles} disabled={!news.some(item => item.status === 'inbox' && item.score === null)} onClick={() => {
          setNews(items => items.map(item => item.status === 'inbox' && item.score === null ? { ...item, score: 74, reason: 'Exemplo de classificação: aderência temática alta, impacto moderado e necessidade de confirmar as evidências.' } : item)); toast('Classificação simulada concluída');
        }}>Simular classificação</Button>
      </>} />
      <SplitLayout main={<PageStack>
        {filtered.map(item => <Card key={item.id} as="article" interactive padding="lg">
          <PageStack>
            <MetaList items={[item.topic, item.source, item.age]} size="sm" />
            <CardHeader titleAs="h2" size="md" title={<CardLink onClick={() => setDetailId(item.id)}>{item.title}</CardLink>}
              actions={<Badge tone={item.score !== null && item.score >= 80 ? 'blue' : 'gray'}>{item.score === null ? 'A classificar' : `${item.score}/100`}</Badge>} />
            <Prose variant="compact" measure="wide">{item.summary}</Prose>
            <MetaList items={[item.score === null ? 'Aguardando análise editorial' : item.score >= 80 ? 'Prioridade alta para apuração' : 'Avaliar aderência à cobertura', item.status === 'selected' ? 'Pauta selecionada' : item.status === 'dismissed' ? 'Descartada' : 'Em triagem']} size="sm" />
          </PageStack>
        </Card>)}
        {!filtered.length && <EmptyState size="panel" title="Nenhuma notícia neste recorte" description="Tente outra busca ou importe uma URL." />}
      </PageStack>} asideLabel="Mesa de pauta" aside={<PageStack>
        {tab !== 'selected' && <Panel><Section title="Pautas em preparação" meta={String(news.filter(item => item.status === 'selected').length)}>
          <List label="Pautas em preparação" framed={false}>{news.filter(item => item.status === 'selected').map(item => <ListItem key={item.id} title={item.title} titleLines={2} description={`${item.topic} · Próximo passo: pesquisa`} onClick={() => setDetailId(item.id)} />)}
            {!news.some(item => item.status === 'selected') && <ListItem title="Nenhuma pauta selecionada" description="Avalie as notícias para começar a cobertura." />}
          </List>
        </Section></Panel>}
        <Panel><Section title="Monitoramento de fontes" action={<Button size="sm" variant="ghost" onClick={() => setTab('feeds')}>Gerenciar</Button>}>
          <List label="Estado das fontes" framed={false}>{feeds.map(item => <ListItem key={item.id} icon={Rss} title={item.name} description={item.state === 'error' ? 'Leitura interrompida · precisa de revisão' : item.state === 'paused' ? 'Atualização pausada' : `Atualização a cada ${item.interval} min`} onClick={() => setTab('feeds')} actions={item.state === 'error' ? <Badge tone="amber">Atenção</Badge> : undefined} />)}</List>
        </Section></Panel>
        <Panel><Section title="Recorte editorial" action={<Button size="sm" variant="ghost" onClick={() => navigate('editorial-map')}>Ajustar</Button>}><PageStack>
          <MetaList items={map.topics.map(topic => <Badge key={topic} tone="gray">{topic}</Badge>)} />
          <Prose variant="compact">{map.audience}</Prose>
          <MetaList items={[map.geography]} size="sm" />
        </PageStack></Section></Panel>
      </PageStack>} />
    </>}
    {detail && <PrototypeDetail title="Avaliar pauta" onClose={() => setDetailId(undefined)} footer={<ButtonGroup label="Decidir pauta">
      <Button onClick={() => update(detail.id, detail.status === 'dismissed' ? 'inbox' : 'dismissed')}>{detail.status === 'dismissed' ? 'Restaurar' : 'Descartar'}</Button>
      <Button variant="primary" onClick={() => {
        if (detail.status === 'selected') { setBrief(detail.title); setDetailId(undefined); navigate('hard-news'); }
        else update(detail.id, 'selected');
      }}>{detail.status === 'selected' ? 'Abrir Hard News' : 'Selecionar pauta'}</Button>
    </ButtonGroup>}><PageStack>
      <Prose variant="read">{detail.title}</Prose><Prose>{detail.summary}</Prose>
      <DescriptionList items={[{ label: 'Fonte', value: detail.source }, { label: 'URL de referência', value: detail.url }, { label: 'Editoria', value: detail.topic }, { label: 'Pontuação simulada', value: detail.score === null ? 'Ainda não classificada' : `${detail.score}/100` }]} />
      <Panel><Section title="Por que esta notícia?">
        <Prose variant="compact">{detail.reason}</Prose>
        <DescriptionList items={[{ label: 'Critérios', value: 'Aderência ao veículo, impacto e atualidade' }, { label: 'Decisão final', value: 'Seleção editorial humana' }]} />
      </Section></Panel>
    </PageStack></PrototypeDetail>}
    {form && <PrototypeDetail title={form === 'rss' ? 'Adicionar fonte RSS' : 'Importar notícia por URL'} onClose={() => setForm(undefined)} footer={<>
      <Button onClick={() => setForm(undefined)}>Cancelar</Button><Button variant="primary" onClick={importExample}>Simular importação</Button>
    </>}><PageStack><Prose variant="compact">O protótipo usa dados de exemplo. Nenhum endereço será consultado.</Prose>
      {error && <Alert tone="danger" title="Revise a importação">{error}</Alert>}
      <FieldGroup label="Origem da notícia" columns={1}>
        {form === 'rss' && <Field label="Nome da fonte">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={name} onChange={event => setName(event.target.value)} />}</Field>}
        <Field label={form === 'rss' ? 'URL do feed RSS' : 'URL da notícia'}>{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" />}</Field>
        {form === 'rss' && <Field label="Frequência de atualização">{props => <Select {...props} value={interval} onChange={setInterval} options={[{ value: '30', label: 'A cada 30 minutos' }, { value: '60', label: 'A cada hora' }, { value: '120', label: 'A cada 2 horas' }]} />}</Field>}
      </FieldGroup>
    </PageStack></PrototypeDetail>}
  </PageStack>;
}
