'use client';

import { useMemo } from 'react';
import {
  Counter,
  DiffView,
  EmptyState,
  Field,
  Grid,
  Input,
  MetaList,
  Section,
  SkeletonText,
  SourceChip,
  SuggestionCard,
  Textarea,
  Toolbar,
  ToolbarButton,
  type DiffBlock,
  type DiffBlockType,
} from '@content-ventures/design-system/v3';
import { ArrowLeftRight, Scissors, Sparkles, Type } from '@content-ventures/design-system/v3/icons';
import { blockText, diffWords, SIMULATED_MODEL, type ArticleBody, type CarouselBody, type CarouselTemplate, type Slide, type SlideAssistAction, type SlideLayout, type SlotRole } from '@/domain';
import type { RunView, SlotFit } from '@/ports';
import { copilotToolsFor } from '@/registries';
import { Provenance } from '@/ui/provenance';
import { slideRatio, SlideThumb } from './slide-media';
import { applyProposal } from './slide-proposal';
import type { AssistRequest, PendingAssist } from './use-slide-assist';
import { useSlideRenders } from './use-slide-renders';

/**
 * End pane of the carousel studio: the selected slide's slot fields (template budget + the
 * renderer's approximate fit), the AI actions on the slide and where its copy came from.
 */

const DIFF_TYPE: Record<SlotRole, DiffBlockType> = {
  kicker: 'caption',
  title: 'h3',
  body: 'paragraph',
  quote: 'quote',
  attribution: 'caption',
  cta: 'caption',
  stat: 'h3',
  list: 'paragraph',
};

const TOOL_ICON = { rewrite: Sparkles, fit: Scissors, swap: ArrowLeftRight } as const;
const TOOL_KIND: Record<string, AssistRequest> = { 'slide.rewrite': 'rewrite', 'slide.fit': 'fit', 'slide.swap-point': 'swap' };

export type SlidePanelProps = {
  body: CarouselBody | undefined;
  slide: Slide | undefined;
  index: number;
  layout: SlideLayout | undefined;
  template: CarouselTemplate | undefined;
  fits: readonly SlotFit[];
  /** Fields and actions locked (generation running), with the reason. */
  lockedReason?: string;
  onSlotChange: (slotId: string, value: string) => void;
  /** Approved article version the slides come from. */
  article: ArticleBody | undefined;
  articleNumber: number | undefined;
  onOpenArticle: () => void;
  generationRun?: RunView;
  /** The run behind the slide's open proposal (its provenance). */
  assistRun?: RunView;
  assist: PendingAssist | undefined;
  updateLabel?: string;
  onAssist: (kind: AssistRequest) => void;
  onAccept: () => void;
  onDiscard: () => void;
  loading: boolean;
};

export function SlidePanel(props: SlidePanelProps) {
  const { slide, layout, loading } = props;
  if (loading) {
    return (
      <Section title="Slide">
        <SkeletonText lines={6} label="Carregando slide" />
      </Section>
    );
  }
  if (!slide || !layout) {
    return <EmptyState icon={Type} title="Nenhum slide escolhido" size="inline" />;
  }
  return (
    <>
      <SlotFields {...props} slide={slide} layout={layout} />
      <AssistSection {...props} slide={slide} layout={layout} />
      <OriginSection {...props} slide={slide} />
    </>
  );
}

function SlotFields({ slide, index, layout, fits, lockedReason, onSlotChange }: SlidePanelProps & { slide: Slide; layout: SlideLayout }) {
  const issues = fits.filter((fit) => fit.overflow).length + layout.slots.filter((slot) => slot.required && !slide.slots[slot.id]?.trim()).length;
  return (
    <Section title={`Slide ${index + 1} · ${layout.label}`} meta={issues > 0 ? (issues === 1 ? '1 aviso' : `${issues} avisos`) : undefined}>
      {layout.slots.map((slot) => {
        const value = slide.slots[slot.id] ?? '';
        const fit = fits.find((entry) => entry.slotId === slot.id);
        const missing = Boolean(slot.required && !value.trim());
        return (
          <Field
            key={slot.id}
            label={slot.label}
            required={slot.required}
            meta={<Counter value={value.length} max={slot.maxChars} />}
            // Why the field is read-only reads under it (a native title is not seen on touch or by keyboard).
            hint={lockedReason}
            notice={fit?.overflow ? fit.message : undefined}
            error={missing ? 'Falta' : undefined}
          >
            {({ id, describedBy, invalid }) =>
              slot.maxLines === 1 ? (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={value}
                  readOnly={Boolean(lockedReason)}
                  onChange={(event) => onSlotChange(slot.id, event.target.value)}
                />
              ) : (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={value}
                  readOnly={Boolean(lockedReason)}
                  autoSize={{ minRows: slot.role === 'title' ? 1 : 2, maxRows: 8 }}
                  onChange={(event) => onSlotChange(slot.id, event.target.value)}
                />
              )
            }
          </Field>
        );
      })}
    </Section>
  );
}

function assistTitle(kind: SlideAssistAction, updateLabel: string | undefined): string {
  if (kind === 'update') return updateLabel ?? 'Atualizar slide';
  return copilotToolsFor('carousel').find((tool) => TOOL_KIND[tool.id] === kind)?.label ?? 'Sugestão';
}

function proposalDiff(slide: Slide, layout: SlideLayout, slots: Record<string, string>): DiffBlock[] {
  return layout.slots
    .filter((slot) => slots[slot.id] !== undefined)
    .map((slot) => ({ id: slot.id, change: 'modified' as const, type: DIFF_TYPE[slot.role], hunks: diffWords(slide.slots[slot.id] ?? '', slots[slot.id] ?? '') }));
}

function AssistSection({
  body,
  slide,
  index,
  layout,
  template,
  fits,
  lockedReason,
  assist,
  assistRun,
  updateLabel,
  article,
  onAssist,
  onAccept,
  onDiscard,
}: SlidePanelProps & { slide: Slide; layout: SlideLayout }) {
  const tools = copilotToolsFor('carousel').filter((tool) => TOOL_KIND[tool.id]);
  const cover = slide.layout === (template?.coverLayoutId ?? 'cover');
  const overflowing = fits.some((fit) => fit.overflow) || layout.slots.some((slot) => (slide.slots[slot.id]?.length ?? 0) > slot.maxChars);
  const busy = assist?.state === 'streaming';

  const reasonFor = (kind: AssistRequest): string | undefined => {
    if (lockedReason) return lockedReason;
    if (busy) return 'Aguarde a sugestão em andamento.';
    if (kind === 'fit' && !overflowing) return 'Todos os textos cabem.';
    if (kind === 'swap' && cover) return 'A capa segue o título do artigo.';
    return undefined;
  };

  const proposed = useMemo(() => {
    if (!body || !assist?.proposal) return undefined;
    const proposal = assist.proposal;
    return { ...body, slides: body.slides.map((entry) => (entry.id === proposal.slideId ? applyProposal(entry, proposal) : entry)) };
  }, [assist?.proposal, body]);
  const only = useMemo(() => [slide.id], [slide.id]);
  const preview = useSlideRenders(proposed, { scale: 0.25, slideIds: only, articleCover: article?.cover?.assetId })[slide.id];

  const showCard = assist && (assist.state !== 'ready' || assist.proposal);
  return (
    <Section title="IA" meta={SIMULATED_MODEL.label}>
      <Toolbar label="IA no slide" size="sm" overflow="wrap" keepFocus={false}>
        {tools.map((tool) => {
          const kind = TOOL_KIND[tool.id];
          const reason = reasonFor(kind);
          return (
            <ToolbarButton
              key={tool.id}
              label={tool.label}
              icon={TOOL_ICON[kind]}
              showLabel
              disabled={Boolean(reason)}
              disabledReason={reason}
              onClick={() => onAssist(kind)}
            />
          );
        })}
      </Toolbar>
      {showCard ? (
        <SuggestionCard
          key={`${slide.id}:${assist.kind}`}
          title={assistTitle(assist.kind, updateLabel)}
          provenance={[assistRun?.model.label ?? SIMULATED_MODEL.label]}
          state={assist.state}
          error={assist.reason}
          acceptLabel="Aplicar ao slide"
          onAccept={onAccept}
          onDiscard={onDiscard}
          onRetry={assist.kind === 'update' ? undefined : () => onAssist(assist.kind as AssistRequest)}
          onReapply={assist.kind === 'update' ? undefined : () => onAssist(assist.kind as AssistRequest)}
        >
          {assist.proposal && (assist.state === 'ready' || assist.state === 'stale') ? (
            <>
              <Grid columns="1:2" collapseBelow={false} gap="md">
                <SlideThumb render={preview} ratio={slideRatio(template)} />
                <DiffView blocks={proposalDiff(slide, layout, assist.proposal.slots)} size="compact" summary={false} label={`Proposta para o slide ${index + 1}`} />
              </Grid>
              {assistRun ? <Provenance run={assistRun} size="xs" /> : null}
            </>
          ) : undefined}
        </SuggestionCard>
      ) : null}
    </Section>
  );
}

function OriginSection({ slide, article, articleNumber, onOpenArticle, generationRun }: SlidePanelProps & { slide: Slide }) {
  const blocks = article?.blocks ?? [];
  const chips = slide.sourceBlockIds
    .map((id) => ({ id, at: blocks.findIndex((block) => block.id === id) }))
    .filter(({ at }) => at < 0 || blocks[at]?.type !== 'heading');
  const version = articleNumber ? `Artigo v${articleNumber}` : 'Artigo';
  return (
    <Section title="Origem">
      <MetaList
        size="sm"
        items={
          chips.length === 0
            ? [
                <SourceChip
                  key="title"
                  kind="file"
                  label={`${version} · título`}
                  preview={article ? `“${article.title}”` : undefined}
                  onOpen={onOpenArticle}
                  openLabel="Abrir no artigo"
                />,
              ]
            : chips.map(({ id, at }) => {
                const block = at >= 0 ? blocks[at] : undefined;
                return (
                  <SourceChip
                    key={id}
                    kind={block?.type === 'quote' ? 'quote' : 'excerpt'}
                    label={`${version} · §${at + 1}`}
                    state={article && !block ? 'missing' : 'default'}
                    preview={block ? `“${blockText(block)}”` : undefined}
                    onOpen={onOpenArticle}
                    openLabel="Abrir no artigo"
                  />
                );
              })
        }
        separator=" "
      />
      {generationRun ? <Provenance run={generationRun} size="xs" /> : null}
    </Section>
  );
}
