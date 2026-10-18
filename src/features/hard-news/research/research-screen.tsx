'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AgentTrace,
  BrandMark,
  Button,
  ButtonLink,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  Grid,
  Input,
  List,
  ListItem,
  MetaList,
  PageStack,
  Panel,
  Section,
  Stepper,
  SuggestionCard,
  Textarea,
  toast,
  WorkspaceLayout,
  formatRelative,
} from '@content-ventures/design-system/v3';
import type { AgentTraceStep, StepItem } from '@content-ventures/design-system/v3';
import { ArrowLeft, ArrowUpRight, CircleCheck, Link2, ListTree, RefreshCw, Sparkles } from '@content-ventures/design-system/v3/icons';
import { acceptedSources, RESEARCH_KIND_LABELS } from '@/domain/hard-news';
import type { HardNewsDossier, NewsItem, ResearchSource } from '@/domain/hard-news';
import { ProductionHeader, ProductionPrimaryBar, useProductionFrame } from '@/features/production/production-frame';
import type { HeaderPrimary, HeaderSecondary } from '@/features/production/production-frame';
import { plural } from '@/ui/format';
import { TaskNotice } from '@/ui/status-banner';
import { pieceHref } from '@/ui/routes';
import { useHardNews, WRITING_STEPS } from '../state/hard-news-provider';
import { ContextPane } from './context-pane';
import { OutlineEditor } from './outline-editor';

/**
 * Apuração (F2.6, F2.7): the dossier of a covered story before the article exists, one step at a
 * time. Fontes: the story, its angle and the sources the search found (use or discard each,
 * REQ-2.6). Outline: the plan the draft follows. Artigo: the AI writing it, then the studio. The
 * ruler on top opens a finished step again; the screen always opens where the work is. Under the
 * header line, one task notice says the decision of the step; the header's primary moves on.
 */
export function ResearchScreen() {
  const { productionId } = useProductionFrame();
  const { state, writing, actions } = useHardNews();
  const router = useRouter();
  const dossier = state.dossiers[productionId];
  const news = dossier ? state.news.find((item) => item.id === dossier.newsId) : undefined;
  const [adding, setAdding] = useState(false);
  const [viewed, setViewed] = useState<number>();

  if (!dossier || !news) {
    return (
      <WorkspaceLayout docked header={<ProductionHeader />} mainLabel="Apuração">
        <EmptyState icon={ListTree} title="Esta produção não tem apuração" description="Só pautas abertas em Notícias passam pela apuração." size="page" actions={<ButtonLink href={pieceHref(productionId, 'article')} variant="primary">Abrir artigo</ButtonLink>} />
      </WorkspaceLayout>
    );
  }

  const accepted = acceptedSources(dossier).length;
  const pending = dossier.sources.filter((source) => source.state === 'suggested').length;
  const isWriting = writing?.productionId === productionId || dossier.stage === 'writing';
  const work = workStepOf(dossier, isWriting);
  // A finished step stays open while the person reads it; otherwise the screen follows the work.
  const shown = Math.min(viewed ?? work, work);
  const go = (index: number) => setViewed(index === work ? undefined : index);
  const primary = primaryFor(dossier, shown, accepted, isWriting, {
    outline: () => { actions.buildOutline(productionId); setViewed(undefined); },
    review: () => go(1),
    write: async () => {
      setViewed(undefined);
      const ok = await actions.write(productionId);
      if (ok) router.push(pieceHref(productionId, 'article'));
      else toast('Não foi possível escrever o artigo', { tone: 'error' });
    },
    open: pieceHref(productionId, 'article'),
  });
  const secondary: HeaderSecondary | undefined = shown === 1 && !isWriting ? { label: 'Voltar às fontes', icon: ArrowLeft, onClick: () => go(0) } : undefined;
  const task = taskOf(dossier, shown, accepted, pending, isWriting);
  const notice = isWriting && shown !== 2
    ? <WritingTrace step={writing?.step ?? 0} />
    : task ? <TaskNotice kind="awaiting_you">{task}</TaskNotice> : undefined;

  return (
    <>
      {/* Its own key: the loading frame above is another layout, so the pane options apply on mount. */}
      <WorkspaceLayout
        key="research"
        docked
        storageKey="reporter.research.steps"
        header={(narrow) => <ProductionHeader primary={narrow ? undefined : primary} secondary={narrow ? undefined : secondary} notice={notice} />}
        footer={(narrow) => (narrow ? <ProductionPrimaryBar primary={primary} /> : null)}
        mainLabel="Apuração"
        end={{
          label: 'Contexto',
          defaultSize: 360,
          min: 300,
          max: 480,
          defaultCollapsed: true,
          content: <ContextPane dossier={dossier} news={news} />,
        }}
      >
        <PageStack>
          <Panel label="Etapas">
            <Section>
              <Stepper label="Etapas da apuração" steps={stepsOf(dossier, work, shown)} current={shown} onStepSelect={go} />
            </Section>
          </Panel>
          {shown === 0 ? (
            <>
              <StoryPanel dossier={dossier} news={news} />
              <SourcesPanel dossier={dossier} onAdd={() => setAdding(true)} />
            </>
          ) : shown === 1 ? (
            <OutlineEditor dossier={dossier} disabled={isWriting} />
          ) : (
            <ArticleStep dossier={dossier} writingStep={isWriting ? writing?.step ?? 0 : undefined} />
          )}
        </PageStack>
      </WorkspaceLayout>
      <AddSourceDialog productionId={productionId} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

const STEPS = [
  { id: 'sources', label: 'Fontes' },
  { id: 'outline', label: 'Outline', reason: 'Libera quando o outline for montado' },
  { id: 'article', label: 'Artigo', reason: 'Libera quando a IA escrever o artigo' },
] as const;

/** Where the work is: the sources until there is an outline, the outline until the AI writes. */
function workStepOf(dossier: HardNewsDossier, writing: boolean): number {
  if (writing || dossier.stage === 'article') return 2;
  return dossier.outline ? 1 : 0;
}

/**
 * The ruler: the step on screen is the current one; when it is an earlier step, the one where the
 * work stopped stays "em andamento" (a written story has every step done). Later steps say why
 * they are closed.
 */
function stepsOf(dossier: HardNewsDossier, work: number, shown: number): StepItem[] {
  const written = dossier.stage === 'article';
  return STEPS.map((step, index) => {
    if (index > work) return { id: step.id, label: step.label, reason: 'reason' in step ? step.reason : undefined };
    if (index <= shown) return { id: step.id, label: step.label };
    return { id: step.id, label: step.label, state: index === work && !written ? 'active' : 'done' };
  });
}

/** The one task notice of the step (one sentence, one verb). The search and the writing speak for themselves. */
function taskOf(dossier: HardNewsDossier, shown: number, accepted: number, pending: number, writing: boolean): string | undefined {
  if (writing || dossier.stage === 'article') return undefined;
  if (shown === 1) return 'Revise o outline antes da escrita.';
  if (shown !== 0 || dossier.research !== 'done') return undefined;
  if (pending > 0) return pending === 1 ? 'Decida a fonte sugerida pela IA.' : `Decida as ${pending} fontes sugeridas pela IA.`;
  if (dossier.outline || accepted === 0) return undefined;
  if (!dossier.angle.trim()) return 'Defina o ângulo da matéria.';
  return accepted === 1 ? 'Monte o outline com a fonte da matéria.' : `Monte o outline com as ${accepted} fontes da matéria.`;
}

function primaryFor(
  dossier: HardNewsDossier,
  shown: number,
  accepted: number,
  writing: boolean,
  run: { outline: () => void; review: () => void; write: () => Promise<void>; open: string },
): HeaderPrimary | undefined {
  if (writing) return undefined;
  if (dossier.stage === 'article') return { kind: 'link', label: 'Abrir artigo', href: run.open };
  if (shown === 0 && dossier.outline) return { kind: 'button', label: 'Revisar outline', icon: ListTree, onClick: run.review };
  if (shown === 0) {
    return {
      kind: 'button',
      label: 'Montar outline',
      icon: ListTree,
      onClick: run.outline,
      blockedReason: dossier.research !== 'done' ? 'Aguarde a pesquisa terminar.' : accepted === 0 ? 'Use ao menos uma fonte.' : undefined,
    };
  }
  return {
    kind: 'button',
    label: 'Escrever artigo',
    icon: Sparkles,
    onClick: () => void run.write(),
    blockedReason: accepted === 0 ? 'Use ao menos uma fonte.' : undefined,
  };
}

function writingSteps(step: number): AgentTraceStep[] {
  return WRITING_STEPS.map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    state: index < step ? 'done' : index === step ? 'current' : 'upcoming',
  }));
}

/** The writing, under the header line when the person reads another step. */
function WritingTrace({ step }: { step: number }) {
  return <AgentTrace label="Escrevendo o artigo" variant="compact" steps={writingSteps(step)} />;
}

/** Step 3: the AI writing the article, step by step; once written, where it is. */
function ArticleStep({ dossier, writingStep }: { dossier: HardNewsDossier; writingStep?: number }) {
  return (
    <Panel label="Artigo">
      <Section>
        {writingStep !== undefined ? (
          <AgentTrace label="Escrevendo o artigo" collapsible={false} steps={writingSteps(writingStep)} />
        ) : (
          <EmptyState
            icon={CircleCheck}
            title="Artigo no estúdio"
            description={[
              dossier.writtenAt ? `Escrito ${formatRelative(new Date(dossier.writtenAt))}` : '',
              dossier.guideVersion ? `guia de escrita v${dossier.guideVersion}` : '',
            ].filter(Boolean).join(' · ')}
          />
        )}
      </Section>
    </Panel>
  );
}

/** The story being covered and, in its own block, the desk's angle on it. */
function StoryPanel({ dossier, news }: { dossier: HardNewsDossier; news: NewsItem }) {
  const { actions } = useHardNews();
  const [angle, setAngle] = useState(dossier.angle);
  return (
    <Panel label="Pauta">
      <Section
        title="Pauta"
        meta={<MetaList size="sm" items={[news.source, formatRelative(new Date(news.publishedAt))]} />}
        action={<ButtonLink href={news.url} target="_blank" rel="noreferrer" variant="ghost" size="sm" trailingIcon={ArrowUpRight}>Original</ButtonLink>}
      >
        <List label="Notícia" framed={false} dividers={false} bleed>
          <ListItem leading={<BrandMark name={news.source} size="sm" decorative />} title={news.title} titleLines={2} description={news.excerpt} />
        </List>
      </Section>
      <Section>
        <Field label="Ângulo" hint="O que a matéria precisa responder.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={angle}
              rows={2}
              autoSize
              placeholder="Ex.: o que muda para quem exporta"
              onChange={(event) => setAngle(event.target.value)}
              onBlur={() => { if (angle !== dossier.angle) actions.setAngle(dossier.productionId, angle); }}
            />
          )}
        </Field>
      </Section>
    </Panel>
  );
}

/**
 * F2.6 · the sources: one line with what the search did (and a new search), then one block per
 * decision: what it suggests (use or discard each) and what the story uses (the outline and the
 * draft read only these, plus a link of the reporter's).
 */
function SourcesPanel({ dossier, onAdd }: { dossier: HardNewsDossier; onAdd: () => void }) {
  const { actions } = useHardNews();
  const suggested = dossier.sources.filter((source) => source.state === 'suggested');
  const accepted = acceptedSources(dossier);
  const discarded = dossier.sources.filter((source) => source.state === 'discarded');
  const searching = dossier.research !== 'done';
  const id = dossier.productionId;

  return (
    <Panel label="Fontes">
      <Section>
        <AgentTrace
          label={searching ? 'Pesquisando a pauta' : 'Pesquisa da IA'}
          variant="compact"
          summary={[plural(dossier.sources.length, 'fonte', 'fontes'), dossier.searchedAt ? formatRelative(new Date(dossier.searchedAt)) : ''].filter(Boolean).join(' · ')}
          steps={[
            { id: 'search', label: 'Buscando em sites oficiais, entidades e imprensa', state: 'done' },
            { id: 'read', label: 'Lendo as páginas encontradas', state: searching ? 'current' : 'done' },
            { id: 'excerpts', label: 'Separando os trechos que importam', state: searching ? 'upcoming' : 'done' },
          ]}
          action={<Button variant="ghost" size="sm" icon={RefreshCw} loading={searching} onClick={() => actions.research(id)}>Pesquisar de novo</Button>}
        />
      </Section>
      {suggested.length > 0 ? (
        <Section title="Para decidir" meta={String(suggested.length)}>
          <Grid columns="1:1" as="ul" label="Fontes sugeridas" align="start">
            {suggested.map((source) => (
              <SuggestionCard
                key={source.id}
                title={source.title}
                titleAs="h3"
                provenance={sourceFacts(source)}
                proposal={`“${source.excerpt}”`}
                state="ready"
                acceptLabel="Usar fonte"
                shortcuts={false}
                onAccept={() => actions.setSource(id, source.id, 'accepted')}
                onDiscard={() => actions.setSource(id, source.id, 'discarded')}
              />
            ))}
          </Grid>
        </Section>
      ) : null}
      <Section
        title="Na matéria"
        meta={String(accepted.length)}
        action={<Button variant="ghost" size="sm" icon={Link2} onClick={onAdd}>Adicionar link</Button>}
      >
        <List label="Fontes da matéria" framed={false} bleed empty="Nenhuma fonte na matéria.">
          {accepted.map((source) => (
            <ListItem
              key={source.id}
              leading={<BrandMark name={source.outlet} size="sm" decorative />}
              title={source.title}
              titleLines={2}
              description={<MetaList size="sm" items={sourceFacts(source)} />}
              href={source.url}
              actions={<Button variant="ghost" size="sm" onClick={() => actions.setSource(id, source.id, 'suggested')}>Tirar</Button>}
            />
          ))}
        </List>
      </Section>
      {discarded.length > 0 ? (
        <Section>
          <Disclosure summary="Descartadas" meta={discarded.length}>
            <List label="Fontes descartadas" framed={false} bleed>
              {discarded.map((source) => (
                <ListItem
                  key={source.id}
                  title={source.title}
                  description={source.outlet}
                  actions={<Button variant="ghost" size="sm" onClick={() => actions.setSource(id, source.id, 'suggested')}>Rever</Button>}
                />
              ))}
            </List>
          </Disclosure>
        </Section>
      ) : null}
    </Panel>
  );
}

function sourceFacts(source: ResearchSource): string[] {
  return [
    RESEARCH_KIND_LABELS[source.kind],
    source.outlet,
    source.publishedAt ? new Date(source.publishedAt).toLocaleDateString('pt-BR') : '',
    `consultada ${formatRelative(new Date(source.consultedAt))}`,
  ].filter(Boolean);
}

function AddSourceDialog({ productionId, open, onClose }: { productionId: string; open: boolean; onClose: () => void }) {
  const { actions } = useHardNews();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const close = () => { setUrl(''); setError(undefined); onClose(); };
  const submit = () => {
    const result = actions.addSource(productionId, url);
    if (!result.ok) setError(result.message);
    else close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Adicionar fonte"
      divided={false}
      dirty={url.trim().length > 0}
      footer={(
        <>
          <Button variant="secondary" onClick={close}>Cancelar</Button>
          <Button variant="primary" disabled={!url.trim()} onClick={submit}>Usar fonte</Button>
        </>
      )}
    >
      <Field label="Endereço" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} value={url} type="url" placeholder="https://" autoFocus
            onChange={(event) => { setUrl(event.target.value); setError(undefined); }}
            onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} />
        )}
      </Field>
    </Dialog>
  );
}
