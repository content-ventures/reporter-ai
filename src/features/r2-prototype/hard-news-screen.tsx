'use client';
import { useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, CardHeader, Checkbox, DescriptionList, EmptyState, Field, Input, List, ListItem, MediaFrame, MetaList, PageHeader, PageStack, Panel, Prose, Section, SplitLayout, Tabs, Textarea, toast } from '@content-ventures/design-system/v3';
import { ArrowRight, Search, Sparkles } from '@content-ventures/design-system/v3/icons';
import { DEMO_ARTICLE, IMAGES, QUOTES, RESEARCH } from './demo-data';
import { usePrototype } from './prototype-state';
import { PrototypeDetail } from './prototype-detail';
import type { R2Navigate } from './r2-prototype';

type Stage = 'research' | 'outline' | 'article' | 'evidence' | 'enrich';
const UNSUPPORTED = 'O fornecedor afirma que a tecnologia elimina todas as perdas.';
export function HardNewsScreen({ navigate }: { navigate: R2Navigate }) {
  const { hardNewsStage: stage, setHardNewsStage: setStage, brief, setBrief, sourceIds, setSourceIds, outline, setOutline, article, setArticle, imageId, credits, quoteIds, setQuoteIds, linkIds, setLinkIds, archive, map, guide } = usePrototype();
  const [query, setQuery] = useState(brief);
  const [searched, setSearched] = useState(false);
  const [source, setSource] = useState<string>();
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [requestedStage, setRequestedStage] = useState<Stage>();
  const image = IMAGES.find(item => item.id === imageId);
  const evidenceIssue = article.includes(UNSUPPORTED);
  const hasResearch = RESEARCH.filter(item => item.reliable).every(item => sourceIds.includes(item.id));
  const citationSelected = QUOTES.filter(item => quoteIds.includes(item.id));
  const linksSelected = archive.filter(item => linkIds.includes(item.id));
  const sourceDetail = RESEARCH.find(item => item.id === source);
  function go(next: Stage) {
    if (next !== 'research' && !hasResearch) { setRequestedStage(next); return; }
    if ((next === 'evidence' || next === 'enrich') && !article) { setRequestedStage(next); return; }
    setStage(next);
  }
  const editArticle = (value: string) => { setArticle(value); setReviewed(false); setSaved(false); };
  return <PageStack>
    <PageHeader title="Hard News" description="Pesquise a pauta, prepare a notícia e confira suas referências." status={<Badge tone="gray">Rascunho de exemplo</Badge>}
      actions={<Button disabled={!article || !reviewed || evidenceIssue} onClick={() => { setSaved(true); toast('Rascunho mantido nesta sessão; nada enviado à R1 ou ao CMS'); }}>{saved ? 'Rascunho conferido nesta sessão' : 'Concluir revisão de exemplo'}</Button>} />
    <Tabs label="Etapas de Hard News" value={stage} onChange={go} items={[
      { value: 'research', label: '1. Pesquisa' }, { value: 'outline', label: '2. Outline' }, { value: 'article', label: '3. Redação' }, { value: 'evidence', label: '4. Evidências', count: evidenceIssue ? 1 : undefined }, { value: 'enrich', label: '5. Enriquecimento' },
    ]} />
    <SplitLayout main={<PageStack>
      {stage === 'research' && <>
        <Panel><Section title="Pauta e pesquisa"><PageStack>
          <Field label="Pauta selecionada">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={brief} onChange={event => setBrief(event.target.value)} />}</Field>
          <Field label="Pesquisar contexto e fontes">{props => <Input id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} value={query} onChange={event => { setQuery(event.target.value); setSearched(false); }} />}</Field>
          <Button icon={Search} variant="primary" disabled={!query.trim()} onClick={() => setSearched(true)}>Simular pesquisa web</Button>
        </PageStack></Section></Panel>
        {(searched || sourceIds.length > 0) && <Panel><Section title="Fontes encontradas" meta="Resultados de exemplo"><PageStack>
          {RESEARCH.map(item => <Card key={item.id} padding="lg"><PageStack>
            <CardHeader titleAs="h3" title={item.title} description={`${item.publisher} · ${item.type}`}
              actions={<Badge tone={item.reliable ? 'gray' : 'amber'}>{item.reliable ? 'Referência de apuração' : 'Confirmar com outra fonte'}</Badge>} />
            <Prose variant="compact" measure="wide">{item.excerpt}</Prose>
            <MetaList items={[
              <Checkbox key="select" label={`Selecionar ${item.title}`} checked={sourceIds.includes(item.id)} onChange={() => setSourceIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id])} />,
              <Button key="detail" size="sm" variant="ghost" onClick={() => setSource(item.id)}>Ver fonte</Button>,
            ]} />
          </PageStack></Card>)}
          <Button icon={ArrowRight} variant="primary" disabled={!hasResearch} onClick={() => go('outline')}>Montar outline</Button>
        </PageStack></Section></Panel>}
      </>}
      {stage === 'outline' && <Panel><Section title="Estrutura da notícia"><PageStack>
        <Field label="Outline editável">{props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={8} value={outline} onChange={event => setOutline(event.target.value)} />}</Field>
        <DescriptionList items={[{ label: 'Fontes selecionadas', value: `${sourceIds.length} referências` }, { label: 'Recorte', value: brief }]} />
        <Button variant="primary" icon={Sparkles} disabled={!outline.trim() || !hasResearch || Boolean(article)} onClick={() => {
          // Fixed specimen, deliberately not an imitation of an actual model response.
          editArticle(DEMO_ARTICLE); setStage('article'); toast('Texto demonstrativo carregado; não houve geração por IA');
        }}>{article ? 'Rascunho já carregado' : 'Carregar exemplo de Hard News'}</Button>
        {article && <Button onClick={() => go('article')}>Continuar no rascunho</Button>}
      </PageStack></Section></Panel>}
      {stage === 'article' && (article ? <Panel><Section title="Rascunho e referências" meta="Texto fictício"><PageStack>
        <Field label="Texto da notícia">{props => <Textarea id={props.id} aria-describedby={props.describedBy} invalid={props.invalid} rows={16} value={article} onChange={event => editArticle(event.target.value)} />}</Field>
        <List label="Referências do exemplo">{RESEARCH.filter(item => item.reliable).map((item, index) => <ListItem key={item.id} title={`[${index + 1}] ${item.title}`} description={item.publisher} onClick={() => setSource(item.id)} />)}</List>
        <Button variant="primary" icon={ArrowRight} onClick={() => go('evidence')}>Revisar evidências</Button>
      </PageStack></Section></Panel> : <EmptyState title="Prepare o outline primeiro" description="Selecione fontes e carregue o texto demonstrativo." actions={<Button onClick={() => go('outline')}>Abrir outline</Button>} />)}
      {stage === 'evidence' && <Panel><Section title="Evidências e atribuição"><PageStack>
        {evidenceIssue ? <>
          <Alert tone="warning" title="Alegação sem evidência suficiente">A fonte comercial não apresenta dados que sustentem a promessa de eliminar perdas.</Alert>
          <Prose variant="read">{UNSUPPORTED}</Prose>
          <DescriptionList items={[{ label: 'Origem', value: 'Blog do fornecedor · exemplo' }, { label: 'Problema', value: 'Afirmação absoluta sem método ou resultado verificável' }, { label: 'Ação necessária', value: 'Apurar a afirmação, contextualizar ou remover o trecho' }]} />
          <ButtonGroup label="Resolver evidência"><Button onClick={() => go('article')}>Editar no texto</Button><Button variant="primary" onClick={() => editArticle(article.replace(`${UNSUPPORTED}\n\n`, '').replace(UNSUPPORTED, ''))}>Remover alegação do exemplo</Button></ButtonGroup>
        </> : <>
          <Badge tone="green">Alerta do exemplo resolvido</Badge>
          <Prose variant="compact">A conferência final é editorial. Nesta demonstração, somente a alegação marcada acima é verificada.</Prose>
          <Button variant="primary" disabled={reviewed} onClick={() => { setReviewed(true); setSaved(false); }}>{reviewed ? 'Conferência registrada' : 'Marcar conferência editorial'}</Button>
        </>}
        <Button disabled={evidenceIssue} onClick={() => go('enrich')}>Continuar para enriquecimento</Button>
      </PageStack></Section></Panel>}
      {stage === 'enrich' && <>
        <Panel><Section title="Citações com atribuição"><PageStack>
          <List label="Citações para enriquecer">{QUOTES.filter(item => item.verified).map(item => <ListItem key={item.id} checkbox title={item.text} titleLines={2} description={`${item.author} · ${item.source} · ${item.locator}`} selected={quoteIds.includes(item.id)} onClick={() => setQuoteIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id])} />)}</List>
          <Button disabled={!citationSelected.some(item => !article.includes(item.text))} onClick={() => {
            editArticle(article + citationSelected.filter(item => !article.includes(item.text)).map(item => `\n\n“${item.text}”, afirma ${item.author}, em ${item.source} (${item.locator}). [Citação fictícia]`).join('')); toast('Citação inserida no rascunho de exemplo');
          }}>Inserir citações selecionadas</Button>
        </PageStack></Section></Panel>
        <Panel><Section title="Links internos"><PageStack>
          <List label="Matérias relacionadas">{archive.filter(item => item.state === 'indexed').map(item => <ListItem key={item.id} checkbox title={item.title} titleLines={2} description={item.excerpt} selected={linkIds.includes(item.id)} onClick={() => setLinkIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id])} />)}</List>
          <Button disabled={!linksSelected.some(item => !article.includes(item.url))} onClick={() => {
            editArticle(article + linksSelected.filter(item => !article.includes(item.url)).map(item => `\n\nLeia também: ${item.title} (${item.url})`).join('')); toast('Referência interna inserida no rascunho');
          }}>Inserir links selecionados</Button>
        </PageStack></Section></Panel>
        <Button onClick={() => go('article')}>Conferir texto enriquecido</Button>
      </>}
    </PageStack>} asideLabel="Contexto da pauta" aside={<PageStack>
      <Panel><Section title="Dossiê da pauta"><PageStack>
        <Prose variant="read">{brief}</Prose>
        <MetaList items={[`${sourceIds.length} fontes`, `${quoteIds.length} citações`, `${linkIds.length} links internos`]} size="sm" />
        <MetaList items={[<Badge key="research" tone={hasResearch ? 'blue' : 'amber'}>{hasResearch ? 'Referências selecionadas' : 'Selecionar referências para avançar'}</Badge>]} />
      </PageStack></Section></Panel>
      <Panel><Section title="Direção editorial"><DescriptionList items={[{ label: 'Veículo', value: 'Portal de demonstração' }, { label: 'Cobertura', value: map.topics.join(', ') }, { label: 'Tom', value: guide.tone }, { label: 'Fontes selecionadas', value: String(sourceIds.length) }]} /></Section></Panel>
      <Panel><Section title="Imagem de destaque" action={<Button size="sm" onClick={() => navigate('images')}>{image ? 'Trocar imagem' : 'Selecionar imagem'}</Button>}>
        {image ? <PageStack><MediaFrame ratio="16/9" src={image.src} alt={image.description} /><MetaList items={[credits[image.id] ?? image.credit, image.license]} /></PageStack>
          : <EmptyState size="inline" title="Nenhuma imagem selecionada" />}
      </Section></Panel>
      {article && <Panel><Section title="Conferência"><DescriptionList items={[{ label: 'Alegação do exemplo', value: evidenceIssue ? 'Precisa de revisão' : 'Resolvida' }, { label: 'Revisão editorial', value: reviewed ? 'Registrada' : 'Pendente' }, { label: 'Destino', value: 'Apenas este protótipo' }]} /></Section></Panel>}
    </PageStack>} />
    {sourceDetail && <PrototypeDetail title={sourceDetail.title} onClose={() => setSource(undefined)}><PageStack>
      <Badge tone={sourceDetail.reliable ? 'gray' : 'amber'}>{sourceDetail.type} · exemplo</Badge><Prose variant="read">{sourceDetail.excerpt}</Prose>
      <DescriptionList items={[{ label: 'Publicação', value: sourceDetail.publisher }, { label: 'URL de referência', value: sourceDetail.url }, { label: 'Uso', value: sourceDetail.reliable ? 'Contexto e referência do exemplo' : 'Exige confirmação independente' }]} />
    </PageStack></PrototypeDetail>}
    {requestedStage && <PrototypeDetail title={!hasResearch ? 'Selecione as fontes primeiro' : 'Prepare o rascunho primeiro'} onClose={() => setRequestedStage(undefined)} footer={<>
      <Button onClick={() => setRequestedStage(undefined)}>Cancelar</Button><Button variant="primary" onClick={() => { setStage(!hasResearch ? 'research' : 'outline'); setRequestedStage(undefined); }}>Continuar</Button>
    </>}><Prose>{!hasResearch ? 'Para avançar, pesquise o contexto e selecione a apresentação do projeto e o guia técnico, as duas referências do exemplo. Continuar abre a pesquisa.' : 'Esta etapa precisa de um texto. Continuar abre o outline para carregar o exemplo de Hard News.'}</Prose></PrototypeDetail>}
  </PageStack>;
}
