'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ActionBar,
  Button,
  Field,
  LinkButton,
  MetaList,
  NumberField,
  PageStack,
  Section,
  toast,
  Tooltip,
  useWorkspace,
  WorkspaceLayout,
} from '@content-ventures/design-system/v3';
import { Sparkles } from '@content-ventures/design-system/v3/icons';
import { blockText, formatSize, plannedLayouts, SIMULATED_MODEL, type CarouselBody, type RunId, type TemplateId } from '@/domain';
import type { DraftView, PieceView, ProductionDetail, RunView, TemplateInfo } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { useCommands, useRuntime, useVersion } from '@/state';
import { ProductionHeader } from '@/features/production/production-frame';
import { rememberTemplate, useLastTemplate } from '@/features/library/last-template';
import { featuredNote, initialTemplate, libraryFilter, type LibraryFilter } from '@/features/library/library-model';
import { TemplateBrowser } from '@/features/library/template-browser';
import { TemplateDrawer } from '@/features/library/template-drawers';
import { RunTrace } from '@/ui/run-trace';
import { takeArmedSimulation } from '@/ui/shell';
import { usePhone } from '@/ui/use-phone';
import { SlideImage } from './slide-media';
import { articleTopic, coverKicker, mainOrganization } from '@/domain/text/kicker';
import { fitTitle } from '@/domain/text/slide-text';
import { useSlideRenders } from './use-slide-renders';

/**
 * Start of the carousel (PLAN §3.7, reference 3 "creation page with live preview"): the model
 * library (format and search; each card is the article's own cover drawn in that model, "Ver
 * modelo" opens every layout with the article's title on the cover), and beside it the cover in the
 * chosen model with the slide count and the structure it produces. The model in the address
 * (`?model=`, a link from "Modelos"), else the carousel's own, else the person's default comes
 * chosen. "Gerar textos a partir da versão N" derives the piece from the exact approved version
 * and starts the copy run.
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

/** The pane's first section: in a narrow frame the pane is a tab that already says its name. */
function PaneSection({ title, children }: { title: string; children: ReactNode }) {
  const workspace = useWorkspace();
  return <Section title={workspace?.narrow ? undefined : title}>{children}</Section>;
}

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
  const phone = usePhone();
  const templates = useMemo(() => runtime?.render.templates() ?? [], [runtime]);
  const lastUsed = useLastTemplate();
  const from = production.guards.derive.carousel?.from ?? article.approvedVersion?.ref;
  const fromVersion = useVersion(from?.versionId);
  const articleBody = fromVersion.data?.body.type === 'article' ? fromVersion.data.body : undefined;
  const articleTitle = articleBody?.title ?? production.title;
  const articleCover = articleBody?.cover?.assetId;
  // The cover's call as the generation writes it: "editoria · marca" (A12), the origin only as a last resort.
  const topic = useMemo(
    () => (articleBody ? articleTopic({ title: [articleBody.title, production.title].filter(Boolean).join(' · '), text: articleBody.blocks.map(blockText).join(' ') }) : undefined),
    [articleBody, production.title],
  );
  const brand = mainOrganization(production.participants.map((participant) => ({ organization: participant.person?.organization, weight: participant.segments })));
  const origin = production.sources[0]?.origin;
  const fallback = origin ? SOURCE_ORIGIN_LABELS[origin] : undefined;

  const existingTemplate = draft?.body.type === 'carousel' ? draft.body.templateId : undefined;
  const linked = useSearchParams().get('model');
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const templateId = picked ?? initialTemplate(templates, { existing: linked && templates.some((entry) => entry.id === linked) ? linked : existingTemplate, lastUsed });
  const template = templates.find((entry) => entry.id === templateId);
  const [count, setCount] = useState<number | null>(5);
  const total = template ? Math.min(template.maxSlides, Math.max(template.minSlides, count ?? 5)) : (count ?? 5);
  const planned = template ? plannedLayouts(template, total) : [];
  // The grid opens on the chosen model's format (Feed or Quadrado).
  const [filterEdit, setFilter] = useState<LibraryFilter | null>(null);
  const filter = filterEdit ?? libraryFilter(template?.format);
  const [viewing, setViewing] = useState<TemplateId | null>(null);

  // The article's cover in each model: its call and its title as "Conferindo limites" leaves them
  // (same candidates, same render measure), so a card shows what this carousel will look like.
  const coverSlots = useMemo(() => {
    const byTemplate = new Map<TemplateId, Record<string, string>>();
    for (const entry of templates) {
      const layout = entry.layouts.find((candidate) => candidate.id === entry.coverLayoutId);
      const slots: Record<string, string> = {};
      for (const slot of layout?.slots ?? []) {
        const kicker = slot.role === 'kicker' ? coverKicker({ topic, brand, fallback }, slot.maxChars) : undefined;
        if (kicker) slots[slot.id] = kicker;
      }
      const titleSlot = layout?.slots.find((slot) => slot.role === 'title');
      if (titleSlot && articleTitle) {
        const fits = (text: string) => {
          const slides = [{ id: 'preview-cover', layout: entry.coverLayoutId, slots: { ...slots, [titleSlot.id]: text }, sourceBlockIds: [] }];
          const measured = runtime?.render.measure({ type: 'carousel', templateId: entry.id, slides });
          return !measured?.ok || !measured.value.some((fit) => fit.slotId === titleSlot.id && fit.overflow);
        };
        slots[titleSlot.id] = fitTitle(articleTitle, titleSlot.maxChars, fits);
      }
      byTemplate.set(entry.id, slots);
    }
    return byTemplate;
  }, [articleTitle, brand, fallback, runtime, templates, topic]);
  const coverFor = (entry: TemplateInfo) => ({ articleCover, slots: coverSlots.get(entry.id) });

  // The planned slides follow the cover, so the preview carries the real page count ("1/5").
  const cover = ((): CarouselBody | undefined => {
    if (!template) return undefined;
    const rest = planned.slice(1).map((entry, at) => ({ id: `preview-${at + 2}`, layout: entry.id, slots: {}, sourceBlockIds: [] }));
    return { type: 'carousel', templateId: template.id, slides: [{ id: 'preview-cover', layout: template.coverLayoutId, slots: coverSlots.get(template.id) ?? {}, sourceBlockIds: [] }, ...rest] };
  })();
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
    rememberTemplate(template.id);
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

  const viewed = templates.find((entry) => entry.id === viewing);
  // "Ver modelo": every layout with the sample copy, the cover with this article's own call and title.
  const viewedBody = useMemo((): CarouselBody | undefined => {
    if (!viewed || !runtime) return undefined;
    const sampled = runtime.render.sample(viewed.id);
    if (!sampled.ok) return undefined;
    const own = coverSlots.get(viewed.id);
    return {
      ...sampled.value,
      slides: sampled.value.slides.map((slide) => (slide.layout === viewed.coverLayoutId && own ? { ...slide, slots: { ...slide.slots, ...own } } : slide)),
    };
  }, [viewed, runtime, coverSlots]);
  const featured = template ? featuredNote(template) : undefined;
  const side = (
    <>
      <PaneSection title="Prévia">
        <SlideImage
          render={preview}
          ratio={template?.formatInfo.ratio ?? '4/5'}
          alt={`Prévia da capa no modelo ${template?.name ?? ''}`}
          caption={
            template ? (
              <MetaList
                size="xs"
                items={[
                  template.name,
                  `Capa · ${formatSize(template.formatInfo)}`,
                  <LinkButton key="view" size="inherit" onClick={() => setViewing(template.id)}>
                    Ver modelo
                  </LinkButton>,
                ]}
              />
            ) : undefined
          }
        />
      </PaneSection>
      <Section title="Slides" meta={template ? `${template.minSlides} a ${template.maxSlides}` : undefined}>
        <Field label="Quantidade" hint={[sequenceText(planned.map((layout) => layout.label)), featured].filter(Boolean).join('. ')}>
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
    </>
  );

  // Same line as the studio (B02): the action closes the production header on a desktop; a narrow
  // frame has no room there, so the footer carries it. The cover, the model and the count sit in
  // the side pane (a tab of their own in a narrow frame).
  return (
    <>
      <WorkspaceLayout
        docked
        header={(narrow) => <ProductionHeader compact actions={narrow ? undefined : action('sm')} />}
        mainLabel="Modelos"
        end={{ label: 'Prévia', content: side, defaultSize: 360, min: 300, max: 440 }}
        footer={(narrow) =>
          narrow ? (
            <ActionBar position="static" start={<MetaList size="sm" items={[template?.name, SIMULATED_MODEL.label]} />}>
              {action()}
            </ActionBar>
          ) : null
        }
      >
        <PageStack>
          {lastRun && (lastRun.status === 'failed' || lastRun.status === 'cancelled') ? (
            <RunTrace run={lastRun} label="Textos do carrossel" onRetry={(stepId) => void retry(stepId)} />
          ) : null}
          <TemplateBrowser
            templates={templates}
            filter={filter}
            onFilterChange={(patch) => setFilter({ ...filter, ...patch })}
            label="Modelo do carrossel"
            mode="pick"
            value={templateId}
            onChange={setPicked}
            onOpen={setViewing}
            coverFor={coverFor}
            compact={phone}
            min={phone ? 148 : 176}
          />
        </PageStack>
      </WorkspaceLayout>
      <TemplateDrawer
        open={viewed !== undefined}
        onClose={() => setViewing(null)}
        template={viewed}
        articleCover={articleCover ?? runtime?.render.samplePhoto}
        body={viewedBody}
        footer={
          viewed && viewed.id !== templateId ? (
            <Button
              variant="primary"
              onClick={() => {
                setPicked(viewed.id);
                setViewing(null);
              }}
            >
              Usar este modelo
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
