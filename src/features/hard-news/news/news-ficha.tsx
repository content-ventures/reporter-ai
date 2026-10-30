'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { newsLogoUrl } from '@/domain/news-branding';
import { sourceForNews } from '@/domain/news-source-match';
import { SOURCE_RELEVANCE_LABELS } from '@/domain/news-source-rating';
import { SourceRatingBadge } from '../source-rating';
import { usePhone } from '@/ui/use-phone';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionBar,
  Alert,
  AgentTrace,
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  CardHeader,
  Disclosure,
  DonutMeter,
  EditableTitle,
  IconButton,
  IconTile,
  List,
  ListItem,
  MediaFrame,
  Menu,
  MetaList,
  ReadingColumn,
  Panel,
  Prose,
  Section,
  Segmented,
  Spinner,
  TextLink,
  Timeline,
  Tooltip,
  toast,
  VisuallyHidden,
  formatRelative,
} from '@content-ventures/design-system/v3';
import type { AgentTraceStep } from '@content-ventures/design-system/v3';
import { ArrowDown, ArrowUp, ChevronDown, Clock, Ellipsis, Telescope } from '@content-ventures/design-system/v3/icons';
import { paragraphBlock } from '@/domain';
import type { ArticleBody } from '@/domain';
import { DISCARD_REASONS, priorityOf, PRIORITY_LABELS } from '@/domain/hard-news';
import type { HardNewsDossier, NewsItem, NewsPriority } from '@/domain/hard-news';
import { EditorContent, useArticleReader } from '@/editor';
import { useCan } from '@/state';
import { pieceHref } from '@/ui/routes';
import { researchHref } from '../routes';
import { useDossier, useHardNews } from '../state/hard-news-provider';
import { POSTPONE_OPTIONS } from './news-model';
import { photoOf } from './news-photo';
import { NewsRow } from './news-row';
import { arrivedAt, PRIORITY_COLOR, returnLabel } from './radar-model';

const PRIORITIES: { value: NewsPriority; label: string }[] = [
  { value: 'high', label: PRIORITY_LABELS.high },
  { value: 'medium', label: PRIORITY_LABELS.medium },
  { value: 'low', label: PRIORITY_LABELS.low },
];

const at = (iso: string, now: number) => formatRelative(new Date(Math.min(Date.parse(iso), now)), new Date(now));

/**
 * The selected story opens with its publication details, its photo and the available source text
 * ready to read. A separate lead remains visible only when the body does not already contain it in
 * full. Other open stories on the same subjects follow the text.
 */
export function NewsFicha({ item, now, related = [], onOpen }: {
  item: NewsItem; now: number; related?: readonly NewsItem[]; onOpen?: (id: string) => void;
}) {
  const workspaceHrefFor = useWorkspaceHref();
  const dossier = useDossier(item.productionId);
  const { live, actions, state } = useHardNews();
  const source = sourceForNews(item, state.feeds);
  const canEdit = useCan('production.edit');
  // News on the server come without their text: the open story reads it once.
  const pending = live && item.paragraphs !== undefined;
  // Feeds often truncate the same opening with an ellipsis; don't repeat it above the body.
  const excerpt = item.excerpt.replace(/\s+/g, ' ').trim().replace(/(?:…|\.{3})$/, '').trim();
  const excerptInBody = !pending && excerpt !== '' && item.body.join(' ').replace(/\s+/g, ' ').includes(excerpt);
  const [failedId, setFailedId] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [translating, setTranslating] = useState(false);
  const retryingTranslation = useRef(false);
  useEffect(() => {
    let active = true;
    if (pending) void actions.loadBody(item.id).then((ok) => {
      if (active) setFailedId(ok ? undefined : item.id);
    });
    return () => { active = false; };
  }, [actions, item.id, pending, attempt]);
  const photo = photoOf(item);
  const facts = [at(item.publishedAt, now)];
  if (item.via === 'tavily') facts.push('Encontrada na web · data estimada');
  if (item.via === 'url') facts.push('Link colado');
  if (item.status === 'later' && item.laterUntil) facts.push(returnLabel(item.laterUntil, now));
  if (item.status === 'discarded' && item.discardReason) facts.push(item.discardReason);

  async function retryTranslation() {
    if (!canEdit || retryingTranslation.current) return;
    retryingTranslation.current = true;
    setTranslating(true);
    try {
      const result = await actions.retryTranslation(item.id);
      if (!result.ok) toast('Não foi possível traduzir', { tone: 'error', description: result.message });
    } finally {
      retryingTranslation.current = false;
      setTranslating(false);
    }
  }

  return (
    <ReadingColumn label="Leitura da notícia">
      <MetaList size="sm" label="Publicação original" items={[
        <BrandMark key="logo" name={item.source} src={newsLogoUrl(item.url)} size="xs" />,
        item.source,
        ...facts,
        // A text link sits on the line of the facts; a button would stand taller than them.
        <TextLink key="original" href={workspaceHrefFor(item.url)} external tone="text">Ver original</TextLink>,
      ]} />
      <EditableTitle value={item.title} label="Título da notícia" readOnly as="h2" size="document" onCommit={() => undefined} />
      <MetaList size="sm" label="Avaliação e tradução" items={[
        <SourceRatingBadge key="rating" rating={source?.rating} />,
        source?.rating ? `Relevância ${SOURCE_RELEVANCE_LABELS[source.rating.relevance].toLowerCase()}` : null,
        item.translation?.status === 'translated' ? <Badge key="translation" variant="text" tone="gray" size="sm">Tradução automática · pt-BR</Badge> : null,
        item.translation?.status === 'pending' ? 'Preparando tradução · exibindo original' : null,
      ]} />
      {photo ? <MediaFrame src={photo} ratio="16/9" alt={`Imagem da notícia: ${item.title}`} radius="lg" /> : null}
      {item.translation?.status === 'failed' ? (
        <Alert tone="warning" title="Tradução indisponível" action={canEdit
          ? <Button variant="secondary" size="sm" loading={translating} onClick={() => void retryTranslation()}>Tentar tradução novamente</Button>
          : undefined}>Exibindo o texto original.</Alert>
      ) : null}
      {item.status === 'covered' && dossier ? <ResearchTrace dossier={dossier} /> : null}
      {excerpt && !excerptInBody ? <Prose variant="read" size="sm" measure="wide">{item.excerpt}</Prose> : null}
      {live ? null : <AiReading item={item} />}
      {item.duplicates.length > 0 ? <WhoPublished item={item} now={now} /> : null}
      {pending ? failedId === item.id
        ? <Alert tone="danger" title="Não foi possível carregar o texto" action={<Button variant="secondary" size="sm" onClick={() => { setFailedId(undefined); setAttempt((value) => value + 1); }}>Tentar de novo</Button>} />
        : <Spinner label="Carregando texto da notícia" />
        : item.body.length ? <NewsText item={item} /> : null}
      {related.length && onOpen ? <Related items={related} now={now} onOpen={onOpen} /> : null}
    </ReadingColumn>
  );
}

/** "Na mesma pauta": where to go next without returning to the radar. */
function Related({ items, now, onOpen }: { items: readonly NewsItem[]; now: number; onOpen: (id: string) => void }) {
  const { state } = useHardNews();
  const phone = usePhone();
  return (
    <Panel label="Na mesma pauta">
      <Section title="Na mesma pauta" titleAs="h3" meta={`${items.length} ${items.length === 1 ? 'notícia' : 'notícias'}`}>
        <List label="Na mesma pauta" framed={false} bleed>
          {items.map((story) => <NewsRow key={story.id} item={story} rating={sourceForNews(story, state.feeds)?.rating} now={now} compact={phone} onSelect={onOpen} />)}
        </List>
      </Section>
    </Panel>
  );
}

/** "Cobrir" opened the story: the AI's research, live; "Abrir apuração" below leads into it. */
function ResearchTrace({ dossier }: { dossier: HardNewsDossier }) {
  const found = dossier.sources.length;
  const searching = dossier.research !== 'done';
  const steps: AgentTraceStep[] = [
    { id: 'open', label: 'Pauta aberta em Produções', state: 'done' },
    { id: 'search', label: 'Buscando na web e no acervo', state: searching ? 'current' : 'done', meta: searching ? undefined : `${found} ${found === 1 ? 'fonte' : 'fontes'}` },
  ];
  return (
    <Panel label="Apuração">
      <Section>
        <AgentTrace label="Apuração" steps={steps} collapsible={false} summary={searching ? undefined : `${found} ${found === 1 ? 'fonte encontrada' : 'fontes encontradas'}`} />
      </Section>
    </Panel>
  );
}

/** The AI's reading: a score dial, the one-line why, each criterion that moved it, the person's call. */
function AiReading({ item }: { item: NewsItem }) {
  const { actions, state, live } = useHardNews();
  const classification = item.classification;
  const priority = priorityOf(item);
  const heading = live ? 'Score do radar' : 'Leitura da IA';

  if (!classification || !priority) {
    return (
      <Panel label={heading}>
        <Section title={heading} titleAs="h3" meta={`Mapa editorial v${state.map.version}`}>
          <CardHeader titleAs="h4" leading={<Spinner size={24} tone="muted" label={live ? 'Calculando score do radar' : 'A IA está lendo'} />} title={live ? 'Calculando prioridade' : 'A IA está lendo'} />
        </Section>
      </Panel>
    );
  }

  const automatic = priorityOf({ classification: { ...classification, correction: undefined } }) ?? 'low';
  return (
    <Panel label={heading}>
      <Section title={heading} titleAs="h3" meta={`Mapa editorial v${classification.mapVersion}`}>
        <CardHeader
          titleAs="h4"
          size="md"
          leading={<DonutMeter value={classification.score} label={live ? 'Score do radar' : 'Nota da IA'} size={56} thickness={6} color={PRIORITY_COLOR[priority]} />}
          title={`${classification.score} · Prioridade ${PRIORITY_LABELS[priority].toLowerCase()}`}
          badge={classification.correction ? <Badge variant="text" tone="gray" size="sm">Corrigida</Badge> : undefined}
          description={classification.summary}
        />
        <Timeline
          variant="activity"
          label="Motivos da nota"
          items={classification.reasons.map((reason) => ({
            id: reason.criterion,
            marker: <IconTile icon={reason.effect === 'up' ? ArrowUp : ArrowDown} size="xs" />,
            title: <>{reason.criterion}<VisuallyHidden>{reason.effect === 'up' ? ': aumenta a nota' : ': reduz a nota'}</VisuallyHidden></>,
            description: reason.detail,
          }))}
        />
        {!live ? <List label="Sua avaliação" framed={false} dividers={false} bleed>
          <ListItem
            density="sm"
            title="Sua avaliação"
            description={classification.correction
              ? `${classification.correction.by} corrigiu; a IA sugeriu ${PRIORITY_LABELS[automatic].toLowerCase()}`
              : undefined}
            actions={(
              <Segmented
                label="Prioridade"
                size="sm"
                options={PRIORITIES}
                value={priority}
                onChange={(value) => actions.correct(item.id, value)}
                disabled={item.status !== 'new'}
                disabledReason="A notícia já foi decidida."
              />
            )}
          />
        </List> : null}
      </Section>
    </Panel>
  );
}

/** Every outlet that ran the story, oldest first (REQ-2.1: duplicates keep their origin). */
function WhoPublished({ item, now }: { item: NewsItem; now: number }) {
  const workspaceHrefFor = useWorkspaceHref();
  const outlets = [
    { source: item.source, url: item.url, publishedAt: item.publishedAt },
    ...item.duplicates,
  ].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  return (
    <Panel label="Quem publicou">
      <Section title="Quem publicou" titleAs="h3" meta={`${outlets.length} veículos`}>
        <Timeline
          variant="activity"
          label="Quem publicou"
          items={outlets.map((outlet) => ({
            id: outlet.url,
            marker: <BrandMark name={outlet.source} src={newsLogoUrl(outlet.url)} size="xs" variant="soft" decorative />,
            title: <TextLink href={workspaceHrefFor(outlet.url)} external tone="text">{outlet.source}</TextLink>,
            date: at(outlet.publishedAt, now),
            dateTime: outlet.publishedAt,
          }))}
        />
      </Section>
    </Panel>
  );
}

function NewsText({ item }: { item: NewsItem }) {
  const body = useMemo<ArticleBody>(() => ({
    type: 'article',
    title: item.title,
    blocks: item.body.map((text, index) => paragraphBlock(`${item.id}-p${index}`, text)),
  }), [item]);
  const editor = useArticleReader({ body });
  const translated = item.translation?.status === 'translated';
  const summary = item.contentKind === 'search' ? (translated ? 'Trecho da busca · traduzido' : 'Trecho da busca') : translated ? item.contentKind === 'feed' ? 'Texto recebido do feed · traduzido' : 'Notícia traduzida'
    : item.contentKind === 'feed' ? 'Texto recebido do feed' : item.contentKind === 'article' ? 'Texto extraído da página' : 'Texto original';
  return (
    <Disclosure summary={summary} meta={`${item.body.length} ${item.body.length === 1 ? 'parágrafo' : 'parágrafos'}`} headingLevel="h3" defaultOpen>
      <Prose variant="read" size="sm" measure="wide" label={translated ? 'Texto traduzido' : 'Texto original'}>
        <EditorContent editor={editor} />
      </Prose>
    </Disclosure>
  );
}

export type DecisionProps = {
  item: NewsItem;
  covering: boolean;
  canCover: boolean;
  canOpenProduction?: boolean;
  /** The R1 build's demonstration: "Cobrir" waits, with the reason in view. */
  demo?: boolean;
  onCover: (item: NewsItem) => void;
  onPostpone: (item: NewsItem, hours: number, label: string) => void;
  onDiscard: (item: NewsItem, reason: string) => void;
  onRestore: (item: NewsItem) => void;
};

/** "Descartar" and "Adiar" as menus of their reasons and times, beside the story's main decision. */
function LaterAndDiscard({ item, disabled = false, onPostpone, onDiscard }: Pick<DecisionProps, 'item' | 'onPostpone' | 'onDiscard'> & { disabled?: boolean }) {
  return (
    <>
      <Menu
        label="Descartar"
        align="end"
        side="top"
        sections={[{ label: 'Motivo', items: DISCARD_REASONS.map((reason) => ({ label: reason, onSelect: () => onDiscard(item, reason) })) }]}
        trigger={(props) => <Button {...props} variant="ghost" trailingIcon={ChevronDown} aria-disabled={disabled || undefined}>Descartar</Button>}
      />
      <Menu
        label="Adiar"
        align="end"
        side="top"
        sections={[{ items: POSTPONE_OPTIONS.map((option) => ({ label: option.label, icon: Clock, shortcut: option.hours === 18 ? 'A' : undefined, onSelect: () => onPostpone(item, option.hours, option.label) })) }]}
        trigger={(props) => <Button {...props} variant="secondary" trailingIcon={ChevronDown} aria-disabled={disabled || undefined}>Adiar</Button>}
      />
    </>
  );
}

/** The one decision under the story: Descartar, Adiar, Cobrir (the only blue button of the desk). */
export function DecisionBar({ item, covering, canCover, canOpenProduction = false, demo = false, onCover, onPostpone, onDiscard, onRestore }: DecisionProps) {
  const workspaceHrefFor = useWorkspaceHref();
  const { live } = useHardNews();
  const dossier = useDossier(item.productionId);
  if (live) return <LiveDecisionBar item={item} covering={covering} canCover={canCover} canOpenProduction={canOpenProduction} onCover={onCover} onPostpone={onPostpone} onDiscard={onDiscard} onRestore={onRestore} />;
  if (item.status === 'covered' && item.productionId) {
    const written = dossier?.stage === 'article';
    return (
      <ActionBar position="static" detail={item.decidedAt ? `Coberta ${formatRelative(new Date(item.decidedAt))}` : undefined}>
        {written ? <ButtonLink href={workspaceHrefFor(researchHref(item.productionId))} variant="secondary">Ver apuração</ButtonLink> : null}
        {written
          ? <ButtonLink href={workspaceHrefFor(pieceHref(item.productionId, 'article'))} variant="primary">Abrir artigo</ButtonLink>
          : <ButtonLink href={workspaceHrefFor(researchHref(item.productionId))} variant="primary" icon={Telescope} data-testid="news-open-research">Abrir apuração</ButtonLink>}
      </ActionBar>
    );
  }
  // The demonstration seeds no productions: a story the example marks as covered has none to open.
  if (item.status === 'covered' && demo) {
    const reasonId = `decision-${item.id}`;
    return (
      <ActionBar position="static" detail="Na demonstração, a apuração não abre." detailId={reasonId}>
        <Button variant="primary" icon={Telescope} aria-disabled aria-describedby={reasonId}>Abrir apuração</Button>
      </ActionBar>
    );
  }
  if (item.status !== 'new') {
    return (
      <ActionBar position="static">
        <Button variant="secondary" onClick={() => onRestore(item)}>Voltar para a fila</Button>
      </ActionBar>
    );
  }
  const reading = !item.classification;
  const reasonId = `decision-${item.id}`;
  const available = !reading && canCover;
  const cover = (
    <Button
      variant="primary"
      icon={Telescope}
      loading={covering}
      aria-disabled={!available || undefined}
      aria-describedby={available ? undefined : reasonId}
      onClick={() => { if (available) onCover(item); }}
    >
      Cobrir
    </Button>
  );
  return (
    <ActionBar position="static" detail={reading ? 'Aguarde a IA terminar a leitura.' : demo ? 'Na demonstração, Cobrir não abre pauta.' : !canCover ? 'Só editor ou admin abre pautas.' : undefined} detailId={reasonId}>
      <LaterAndDiscard item={item} onPostpone={onPostpone} onDiscard={onDiscard} />
      {/* Unavailable, the bar's visible reason explains it: no tooltip promising what it will not do. */}
      <Tooltip content="Abre a pauta e começa a apuração" shortcut="C" disabled={!available}>{cover}</Tooltip>
    </ActionBar>
  );
}

/** A durable selection keeps the source material ready for the writing workflow. */
function LiveDecisionBar({ item, covering, canCover, canOpenProduction = false, onCover, onPostpone, onDiscard, onRestore }: DecisionProps) {
  const phone = usePhone();
  if (item.status !== 'new') return (
    <ActionBar position="static" detail={item.status === 'selected' ? 'Selecionada para redação' : item.status === 'covered' ? 'Hard news em produção' : item.status === 'later' ? 'Notícia adiada' : 'Notícia descartada'}>
      {item.status === 'covered' && item.productionId && canOpenProduction ? <Button variant="primary" loading={covering} onClick={() => onCover(item)}>Abrir artigo</Button> : null}
      {item.status === 'selected' && canCover ? <Button variant="primary" loading={covering} onClick={() => onCover(item)}>Gerar hard news</Button> : null}
      {item.status !== 'covered' && canCover ? <Button variant="secondary" loading={covering} onClick={() => onRestore(item)}>Voltar para a fila</Button> : null}
    </ActionBar>
  );
  const reasonId = `decision-${item.id}`;
  const select = (
    <Button variant="primary" loading={covering} aria-disabled={!canCover || undefined} aria-describedby={canCover ? undefined : reasonId}
      onClick={() => { if (canCover) onCover(item); }}>Selecionar para redação</Button>
  );
  return (
    <ActionBar position="static" detail={!canCover ? 'Só editor ou admin pode selecionar notícias.' : undefined} detailId={reasonId}>
      {/* On a phone the reasons and times share one menu, so the main decision keeps its width. */}
      {phone ? <Menu label="Outras ações da notícia" align="end" side="top"
        sections={[
          { label: 'Adiar', items: POSTPONE_OPTIONS.map(option => ({ label: option.label, icon: Clock, onSelect: () => onPostpone(item, option.hours, option.label) })) },
          { label: 'Descartar', items: DISCARD_REASONS.map(reason => ({ label: reason, onSelect: () => onDiscard(item, reason) })) },
        ]}
        trigger={props => <IconButton {...props} label="Outras ações da notícia" icon={Ellipsis} variant="secondary" aria-disabled={!canCover || covering || undefined} />} />
        : <LaterAndDiscard item={item} disabled={!canCover || covering} onPostpone={onPostpone} onDiscard={onDiscard} />}
      <Tooltip content="Guarda a notícia como material para a redação" shortcut="C" disabled={!canCover}>{select}</Tooltip>
    </ActionBar>
  );
}

/** When the story arrived, for a row: "há 12 min", or "Voltou · há 3 min" for a returned one. */
export function arrivalLabel(item: NewsItem, now: number): string {
  return item.returnedAt ? `Voltou ${at(item.returnedAt, now)}` : at(arrivedAt(item), now);
}
