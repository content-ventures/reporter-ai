'use client';

import { useMemo } from 'react';
import {
  ActionBar,
  AgentTrace,
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  CardHeader,
  Disclosure,
  DonutMeter,
  IconTile,
  List,
  ListItem,
  Menu,
  PageStack,
  Panel,
  Prose,
  Section,
  Segmented,
  Spinner,
  TextLink,
  Timeline,
  Tooltip,
  VisuallyHidden,
  formatRelative,
} from '@content-ventures/design-system/v3';
import type { AgentTraceStep } from '@content-ventures/design-system/v3';
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, Clock, Telescope } from '@content-ventures/design-system/v3/icons';
import { paragraphBlock } from '@/domain';
import type { ArticleBody } from '@/domain';
import { DISCARD_REASONS, priorityOf, PRIORITY_LABELS } from '@/domain/hard-news';
import type { HardNewsDossier, NewsItem, NewsPriority } from '@/domain/hard-news';
import { EditorContent, useArticleReader } from '@/editor';
import { pieceHref } from '@/ui/routes';
import { researchHref } from '../routes';
import { useDossier, useHardNews } from '../state/hard-news-provider';
import { POSTPONE_OPTIONS } from './news-model';
import { arrivedAt, PRIORITY_COLOR, returnLabel } from './radar-model';

const PRIORITIES: { value: NewsPriority; label: string }[] = [
  { value: 'high', label: PRIORITY_LABELS.high },
  { value: 'medium', label: PRIORITY_LABELS.medium },
  { value: 'low', label: PRIORITY_LABELS.low },
];

const at = (iso: string, now: number) => formatRelative(new Date(Math.min(Date.parse(iso), now)), new Date(now));

/**
 * The open story beside the radar, in the order an editor decides: who published it and when,
 * what it says (the lead), why the AI ranked it (score, reasons, the person's own call), who
 * else ran it, and the original text on demand. After "Cobrir", the research starts right here.
 */
export function NewsFicha({ item, now }: { item: NewsItem; now: number }) {
  const dossier = useDossier(item.productionId);
  const facts = [at(item.publishedAt, now)];
  if (item.via === 'url') facts.push('Link colado');
  if (item.status === 'later' && item.laterUntil) facts.push(returnLabel(item.laterUntil, now));
  if (item.status === 'discarded' && item.discardReason) facts.push(item.discardReason);
  return (
    <PageStack>
      <CardHeader
        titleAs="h2"
        leading={<BrandMark name={item.source} size="md" />}
        title={item.title}
        description={`${item.source} · ${facts.join(' · ')}`}
        actions={(
          <ButtonLink href={item.url} target="_blank" rel="noopener noreferrer" variant="ghost" size="sm" trailingIcon={ArrowUpRight}>
            Original<VisuallyHidden> (abre em nova aba)</VisuallyHidden>
          </ButtonLink>
        )}
      />
      {item.status === 'covered' && dossier ? <ResearchTrace dossier={dossier} /> : null}
      <Prose variant="compact" measure="wide">{item.excerpt}</Prose>
      <AiReading item={item} />
      {item.duplicates.length > 0 ? <WhoPublished item={item} now={now} /> : null}
      {item.body.length > 1 ? <OriginalText item={item} /> : null}
    </PageStack>
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
  const { actions, state } = useHardNews();
  const classification = item.classification;
  const priority = priorityOf(item);

  if (!classification || !priority) {
    return (
      <Panel label="Leitura da IA">
        <Section title="Leitura da IA" titleAs="h3" meta={`Mapa editorial v${state.map.version}`}>
          <CardHeader titleAs="h4" leading={<Spinner size={24} tone="muted" label="A IA está lendo" />} title="A IA está lendo" />
        </Section>
      </Panel>
    );
  }

  const automatic = priorityOf({ classification: { ...classification, correction: undefined } }) ?? 'low';
  return (
    <Panel label="Leitura da IA">
      <Section title="Leitura da IA" titleAs="h3" meta={`Mapa editorial v${classification.mapVersion}`}>
        <CardHeader
          titleAs="h4"
          size="md"
          leading={<DonutMeter value={classification.score} label="Nota da IA" size={56} thickness={6} color={PRIORITY_COLOR[priority]} />}
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
        <List label="Sua avaliação" framed={false} dividers={false} bleed>
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
        </List>
      </Section>
    </Panel>
  );
}

/** Every outlet that ran the story, oldest first (REQ-2.1: duplicates keep their origin). */
function WhoPublished({ item, now }: { item: NewsItem; now: number }) {
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
            marker: <BrandMark name={outlet.source} size="xs" variant="soft" decorative />,
            title: <TextLink href={outlet.url} external tone="text">{outlet.source}</TextLink>,
            date: at(outlet.publishedAt, now),
            dateTime: outlet.publishedAt,
          }))}
        />
      </Section>
    </Panel>
  );
}

function OriginalText({ item }: { item: NewsItem }) {
  const body = useMemo<ArticleBody>(() => ({
    type: 'article',
    title: item.title,
    blocks: item.body.slice(1).map((text, index) => paragraphBlock(`${item.id}-p${index}`, text)),
  }), [item]);
  const editor = useArticleReader({ body });
  return (
    <Disclosure summary="Texto original" meta={`${item.body.length - 1} ${item.body.length === 2 ? 'parágrafo' : 'parágrafos'}`} headingLevel="h3">
      <Prose variant="compact" measure="wide" label="Texto original">
        <EditorContent editor={editor} />
      </Prose>
    </Disclosure>
  );
}

export type DecisionProps = {
  item: NewsItem;
  covering: boolean;
  canCover: boolean;
  onCover: (item: NewsItem) => void;
  onPostpone: (item: NewsItem, hours: number, label: string) => void;
  onDiscard: (item: NewsItem, reason: string) => void;
};

/** The one decision under the story: Descartar, Adiar, Cobrir (the only blue button of the desk). */
export function DecisionBar({ item, covering, canCover, onCover, onPostpone, onDiscard }: DecisionProps) {
  const { actions } = useHardNews();
  const dossier = useDossier(item.productionId);
  if (item.status === 'covered' && item.productionId) {
    const written = dossier?.stage === 'article';
    return (
      <ActionBar position="static" detail={item.decidedAt ? `Coberta ${formatRelative(new Date(item.decidedAt))}` : undefined}>
        {written ? <ButtonLink href={researchHref(item.productionId)} variant="secondary">Ver apuração</ButtonLink> : null}
        {written
          ? <ButtonLink href={pieceHref(item.productionId, 'article')} variant="primary">Abrir artigo</ButtonLink>
          : <ButtonLink href={researchHref(item.productionId)} variant="primary" icon={Telescope} data-testid="news-open-research">Abrir apuração</ButtonLink>}
      </ActionBar>
    );
  }
  if (item.status !== 'new') {
    return (
      <ActionBar position="static">
        <Button variant="secondary" onClick={() => actions.restore(item.id)}>Voltar para a fila</Button>
      </ActionBar>
    );
  }
  const reading = !item.classification;
  const reasonId = `decision-${item.id}`;
  return (
    <ActionBar position="static" detail={reading ? 'Aguarde a IA terminar a leitura.' : !canCover ? 'Só editor ou admin abre pautas.' : undefined} detailId={reasonId}>
      <Menu
        label="Descartar"
        align="end"
        side="top"
        sections={[{ label: 'Motivo', items: DISCARD_REASONS.map((reason) => ({ label: reason, onSelect: () => onDiscard(item, reason) })) }]}
        trigger={(props) => <Button {...props} variant="ghost" trailingIcon={ChevronDown}>Descartar</Button>}
      />
      <Menu
        label="Adiar"
        align="end"
        side="top"
        sections={[{ items: POSTPONE_OPTIONS.map((option) => ({ label: option.label, icon: Clock, shortcut: option.hours === 18 ? 'A' : undefined, onSelect: () => onPostpone(item, option.hours, option.label) })) }]}
        trigger={(props) => <Button {...props} variant="secondary" trailingIcon={ChevronDown}>Adiar</Button>}
      />
      <Tooltip content="Abre a pauta e começa a apuração" shortcut="C">
        <Button
          variant="primary"
          icon={Telescope}
          loading={covering}
          aria-disabled={reading || !canCover || undefined}
          aria-describedby={reading || !canCover ? reasonId : undefined}
          onClick={() => { if (!reading && canCover) onCover(item); }}
        >
          Cobrir
        </Button>
      </Tooltip>
    </ActionBar>
  );
}

/** When the story arrived, for a row: "há 12 min", or "Voltou · há 3 min" for a returned one. */
export function arrivalLabel(item: NewsItem, now: number): string {
  return item.returnedAt ? `Voltou ${at(item.returnedAt, now)}` : at(arrivedAt(item), now);
}
