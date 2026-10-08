'use client';

import { useMemo, useState } from 'react';
import {
  ActionBar,
  Button,
  ChoiceCard,
  Field,
  Grid,
  MetaList,
  NumberField,
  PageStack,
  Panel,
  Section,
  toast,
  Tooltip,
  WorkspaceLayout,
} from '@content-ventures/design-system/v3';
import { Sparkles } from '@content-ventures/design-system/v3/icons';
import { blockText, plannedLayouts, SIMULATED_MODEL, type CarouselBody, type RunId, type TemplateId } from '@/domain';
import type { DraftView, PieceView, ProductionDetail, RunView } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { useCommands, useRuntime, useVersion } from '@/state';
import { ProductionHeader } from '@/features/production/production-frame';
import { RunTrace } from '@/ui/run-trace';
import { takeArmedSimulation } from '@/ui/shell';
import { SlideImage } from './slide-media';
import { articleTopic, coverKicker, mainOrganization } from '@/domain/text/kicker';
import { fitTitle } from '@/domain/text/slide-text';
import { useSlideRenders } from './use-slide-renders';

/**
 * Start of the carousel (PLAN §3.7, reference 3 "creation page with live preview"): the
 * template as ChoiceCards, the slide count with the structure it produces, and the cover
 * rendered live in the chosen template. "Gerar textos a partir da versão N" derives the piece
 * from the exact approved article version and starts the copy run.
 */

/** "Capa · Contexto · Ponto principal ×2 · Citação · Conclusão". */
function sequenceText(labels: readonly string[]): string {
  const parts: { label: string; count: number }[] = [];
  for (const label of labels) {
    const last = parts[parts.length - 1];
    if (last && last.label === label) last.count += 1;
    else parts.push({ label, count: 1 });
  }
  return parts.map((part) => (part.count > 1 ? `${part.label} ×${part.count}` : part.label)).join(' · ');
}

const COVER_ONLY = ['preview-cover'];

export type CarouselStartProps = {
  production: ProductionDetail;
  article: PieceView;
  /** The carousel piece when it already exists without slides. */
  carousel?: PieceView;
  draft?: DraftView;
  /** A failed or interrupted run that left no slides ("Tentar de novo a partir desta etapa"). */
  lastRun?: RunView;
  onRunStarted: (runId: RunId) => void;
};

export function CarouselStart({ production, article, carousel, draft, lastRun, onRunStarted }: CarouselStartProps) {
  const commands = useCommands();
  const { runtime } = useRuntime();
  const templates = useMemo(() => runtime?.render.templates() ?? [], [runtime]);
  const from = production.guards.derive.carousel?.from ?? article.approvedVersion?.ref;
  const fromVersion = useVersion(from?.versionId);
  const articleBody = fromVersion.data?.body.type === 'article' ? fromVersion.data.body : undefined;
  const articleTitle = articleBody?.title ?? production.title;
  // The cover's call as the generation writes it: "editoria · marca" (A12), the origin only as a last resort.
  const topic = articleBody ? articleTopic({ title: [articleBody.title, production.title].filter(Boolean).join(' · '), text: articleBody.blocks.map(blockText).join(' ') }) : undefined;
  const brand = mainOrganization(production.participants.map((participant) => ({ organization: participant.person?.organization, weight: participant.segments })));
  const origin = production.sources[0]?.origin;

  const existingTemplate = draft?.body.type === 'carousel' ? draft.body.templateId : undefined;
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const templateId = picked ?? existingTemplate ?? templates[0]?.id;
  const template = templates.find((entry) => entry.id === templateId);
  const [count, setCount] = useState<number | null>(5);
  const total = template ? Math.min(template.maxSlides, Math.max(template.minSlides, count ?? 5)) : (count ?? 5);
  const planned = template ? plannedLayouts(template, total) : [];

  const cover = ((): CarouselBody | undefined => {
    if (!template) return undefined;
    const layout = template.layouts.find((entry) => entry.id === template.coverLayoutId);
    const slots: Record<string, string> = {};
    for (const slot of layout?.slots ?? []) {
      const kicker = slot.role === 'kicker' ? coverKicker({ topic, brand, fallback: origin ? SOURCE_ORIGIN_LABELS[origin] : undefined }, slot.maxChars) : undefined;
      if (kicker) slots[slot.id] = kicker;
    }
    // The title as "Conferindo limites" leaves it (same candidates, same render measure).
    const titleSlot = layout?.slots.find((slot) => slot.role === 'title');
    if (titleSlot && articleTitle) {
      const fits = (text: string) => {
        const slides = [{ id: 'preview-cover', layout: template.coverLayoutId, slots: { ...slots, [titleSlot.id]: text }, sourceBlockIds: [] }];
        const measured = runtime?.render.measure({ type: 'carousel', templateId: template.id, slides });
        return !measured?.ok || !measured.value.some((fit) => fit.slotId === titleSlot.id && fit.overflow);
      };
      slots[titleSlot.id] = fitTitle(articleTitle, titleSlot.maxChars, fits);
    }
    // The planned slides follow the cover, so the preview carries the real page count ("1/5").
    const rest = planned.slice(1).map((entry, at) => ({ id: `preview-${at + 2}`, layout: entry.id, slots: {}, sourceBlockIds: [] }));
    return { type: 'carousel', templateId: template.id, slides: [{ id: 'preview-cover', layout: template.coverLayoutId, slots, sourceBlockIds: [] }, ...rest] };
  })();
  const articleCover = fromVersion.data?.body.type === 'article' ? fromVersion.data.body.cover?.assetId : undefined;
  const preview = useSlideRenders(cover, { scale: 0.5, delay: 0, slideIds: COVER_ONLY, articleCover })['preview-cover'];

  const generateGuard = production.guards.pieces.carousel?.generate;
  const blockedReason = !from ? 'Disponível após aprovar o artigo.' : generateGuard && !generateGuard.allowed && carousel ? generateGuard.reason : !template ? 'Carregando os modelos.' : undefined;
  const [starting, setStarting] = useState(false);

  const start = async () => {
    if (!from || !template) return;
    setStarting(true);
    let pieceId = carousel?.id;
    if (!pieceId) {
      const derived = await commands.production.derive({ productionId: production.id, kind: 'carousel', from, templateId: template.id });
      if (!derived.ok) {
        setStarting(false);
        toast('Não foi possível criar o carrossel', { tone: 'error', description: derived.refusal.message });
        return;
      }
      pieceId = derived.value.pieceId;
    } else if (draft && existingTemplate !== template.id) {
      await commands.production.saveDraft(pieceId, { type: 'carousel', templateId: template.id, slides: [] }, draft.revision);
    }
    const started = await commands.generation.start(
      'carousel.copy',
      { productionId: production.id, pieceId, from, templateId: template.id, slides: total },
      { simulation: takeArmedSimulation('carousel.copy') },
    );
    setStarting(false);
    if (!started.ok) {
      toast('Não foi possível gerar os textos', { tone: 'error', description: started.refusal.message });
      return;
    }
    onRunStarted(started.value.runId);
  };

  const retry = async (stepId: string) => {
    if (!lastRun) return;
    const retried = await commands.generation.retry(lastRun.id, stepId);
    if (retried.ok) onRunStarted(retried.value.runId);
    else toast('Não foi possível continuar', { tone: 'error', description: retried.refusal.message });
  };

  const label = from ? `Gerar textos a partir da versão ${from.number}` : 'Gerar textos';
  const action = (size?: 'sm') =>
    blockedReason ? (
      <Tooltip content={blockedReason}>
        <Button variant="primary" icon={Sparkles} size={size} aria-disabled>
          {label}
        </Button>
      </Tooltip>
    ) : (
      <Button variant="primary" icon={Sparkles} size={size} loading={starting} onClick={() => void start()}>
        {label}
      </Button>
    );

  // Same line as the studio (B02): the action closes the production header on a desktop; a narrow
  // frame has no room there, so the footer carries it.
  return (
    <WorkspaceLayout
      docked
      header={(narrow) => <ProductionHeader compact actions={narrow ? undefined : action('sm')} />}
      mainLabel="Carrossel"
      footer={(narrow) =>
        narrow ? (
          <ActionBar position="static" start={<MetaList size="sm" items={[SIMULATED_MODEL.label]} />}>
            {action()}
          </ActionBar>
        ) : null
      }
    >
      <PageStack>
        {lastRun && (lastRun.status === 'failed' || lastRun.status === 'cancelled') ? (
          <RunTrace run={lastRun} label="Textos do carrossel" onRetry={(stepId) => void retry(stepId)} />
        ) : null}
        <Grid columns="3:2" collapseBelow={960} align="start">
          <Panel>
            <Section title="Modelo">
              <Grid columns="1:1" collapseBelow={480} gap="sm" role="radiogroup" aria-label="Modelo do carrossel">
                {templates.map((entry) => (
                  <ChoiceCard
                    key={entry.id}
                    name="carousel-template"
                    value={entry.id}
                    checked={entry.id === templateId}
                    onChange={(value) => setPicked(value)}
                    title={entry.name}
                    description={entry.description}
                    layout="stacked"
                  />
                ))}
              </Grid>
            </Section>
            <Section title="Slides" meta={template ? `${template.minSlides} a ${template.maxSlides}` : undefined}>
              <Field label="Quantidade" hint={sequenceText(planned.map((layout) => layout.label))}>
                {({ id, describedBy }) => (
                  <NumberField
                    id={id}
                    aria-describedby={describedBy}
                    value={count}
                    onChange={setCount}
                    min={template?.minSlides ?? 3}
                    max={template?.maxSlides ?? 10}
                    stepper
                    fit
                  />
                )}
              </Field>
            </Section>
          </Panel>
          <Panel>
            <Section title="Prévia" meta="Capa · 1080 × 1350 px">
              <SlideImage render={preview} ratio="4/5" alt={`Prévia da capa no modelo ${template?.name ?? ''}`} />
            </Section>
          </Panel>
        </Grid>
      </PageStack>
    </WorkspaceLayout>
  );
}
