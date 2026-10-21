'use client';

import { Accordion, Alert, ButtonLink, DescriptionList, PageStack, Prose } from '@content-ventures/design-system/v3';
import type { WritingResearchSnapshot } from '@/domain/writing-research';

const RESEARCH_STATUS: Record<string, string> = { completed: 'Concluída', partial: 'Concluída parcialmente', failed: 'Falhou', skipped: 'Não realizada' };
const dateTime = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : value;
const calendarDate = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
const safeLink = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };

export function researchSnapshotFrom(value: unknown): WritingResearchSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const snapshot = value as WritingResearchSnapshot;
  return typeof snapshot.status === 'string' && typeof snapshot.startedAt === 'string'
    && Array.isArray(snapshot.queries) && Array.isArray(snapshot.sources)
    && Array.isArray(snapshot.excludedDomains) && Array.isArray(snapshot.excludedUrls) ? snapshot : undefined;
}

/** Each link and excerpt belongs to the recorded retrieval, never the current workspace. */
export function WritingResearchDetails({ snapshot, showQueries = true }: {
  snapshot: WritingResearchSnapshot; showQueries?: boolean;
}) {
  return <PageStack>
    <Prose variant="compact" measure="wide">Contexto web suplementar. As fontes abaixo são externas ao conteúdo original e têm sua própria origem e data de consulta.</Prose>
    <DescriptionList items={[
      { label: 'Resultado da pesquisa', value: RESEARCH_STATUS[snapshot.status] ?? snapshot.status },
      { label: 'Consultas registradas', value: String(snapshot.queries.length) },
      { label: 'Fontes externas disponíveis', value: String(snapshot.sources.length) },
      { label: 'Início da pesquisa', value: dateTime(snapshot.startedAt) },
      ...(snapshot.completedAt ? [{ label: 'Fim da pesquisa', value: dateTime(snapshot.completedAt) }] : []),
      ...(snapshot.reason ? [{ label: 'Motivo registrado', value: snapshot.reason }] : []),
    ]} />
    {showQueries && snapshot.queries.length > 0 && <Accordion headingLevel="h4" items={snapshot.queries.map((query, index) => ({
      id: `research-query-${index}`, title: `Consulta ${index + 1} · ${query.query}`,
      status: query.status === 'failed' ? 'warning' as const : 'done' as const,
      content: <PageStack>
        <DescriptionList items={[
          { label: 'Consulta enviada', value: query.query },
          { label: 'Finalidade', value: query.purpose },
          { label: 'Evidências originais que motivaram a busca', value: query.evidenceIds.join(', ') || 'Não registradas.' },
          { label: 'Estado da consulta', value: RESEARCH_STATUS[query.status] ?? query.status },
          { label: 'Início', value: dateTime(query.startedAt) },
          { label: 'Fim', value: dateTime(query.completedAt) },
          { label: 'Fontes retornadas', value: query.sourceIds.join(', ') || 'Nenhuma.' },
          ...(query.requestId ? [{ label: 'Identificador no provedor', value: query.requestId }] : []),
          ...(query.credits == null ? [] : [{ label: 'Créditos informados pelo provedor', value: String(query.credits) }]),
          ...(query.reason ? [{ label: 'Observação da consulta', value: query.reason }] : []),
        ]} />
        {query.error && <Alert tone="warning" title="A consulta não foi concluída">{query.error}</Alert>}
      </PageStack>,
    }))} />}
    {snapshot.sources.length ? showQueries ? <Accordion headingLevel="h4" items={snapshot.sources.map(source => ({
      id: `research-source-${source.id}`, title: `Fonte externa · ${source.id} · ${source.title}`,
      content: <PageStack>
        <DescriptionList items={[
          { label: 'Origem', value: 'Web · Tavily' },
          { label: 'Identificador da evidência externa', value: source.id },
          { label: 'Título da página', value: source.title },
          { label: 'Site', value: source.site },
          { label: 'URL', value: source.url },
          { label: 'Data de publicação informada', value: source.publishedOn ? calendarDate(source.publishedOn) : 'Não informada.' },
          { label: 'Consultada em', value: dateTime(source.retrievedAt) },
          { label: 'Consulta de origem', value: source.query },
          { label: 'Trecho recebido da pesquisa', value: source.excerpt },
        ]} />
        {safeLink(source.url) && <ButtonLink href={source.url} target="_blank" rel="noreferrer" variant="secondary">Abrir fonte original</ButtonLink>}
      </PageStack>,
    }))} /> : <DescriptionList items={snapshot.sources.map(source => ({ label: `Fonte externa · ${source.id}`, value: `${source.title}\n${source.url}\n${source.excerpt}` }))} />
      : <Prose variant="compact" measure="wide">Nenhuma fonte externa foi disponibilizada nesta pesquisa.</Prose>}
    {(snapshot.excludedDomains.length > 0 || snapshot.excludedUrls.length > 0) && <DescriptionList items={[
      ...(snapshot.excludedDomains.length ? [{ label: 'Domínios excluídos nesta execução', value: snapshot.excludedDomains.join('\n') }] : []),
      ...(snapshot.excludedUrls.length ? [{ label: 'URLs excluídas nesta execução', value: snapshot.excludedUrls.join('\n') }] : []),
    ]} />}
  </PageStack>;
}
