'use client';

import type { ReactNode } from 'react';
import { Alert, Badge, Carousel, DescriptionList, Disclosure, LinkButton, MediaFrame, MetaList, Section, type DescriptionItem } from '@content-ventures/design-system/v3';
import { familyLabel, type AssetId, type CarouselBody } from '@/domain';
import type { TemplateInfo } from '@/ports';
import { coverLayouts, featuredNote, formatFacts, slotLimit, statusBadge, templateLine } from './library-model';
import { useCarouselPreview, useTemplatePreview } from './use-template-images';
import type { TemplateInspection, TemplatePreviewFrame } from './template-page-viewer';

/**
 * A model of the library in full (the body of its drawer): every layout drawn — with sample copy,
 * or with the slides of the carousel being edited (`body`, the carousel moved to this model) — in
 * the carousel's order, then what the model is (style, format, slide range, the article image it
 * uses) and, folded, each layout's limits. `children` adds what a screen needs on top of it (what
 * a switch of model changes in the carousel being edited).
 */

/** "Editorial · Feed 4:5", with "Aprovado" when Marketing approved it, under the drawer title. */
export function TemplateFacts({ template }: { template: TemplateInfo }) {
  const badge = statusBadge(template.status);
  return (
    <MetaList
      size="sm"
      items={[
        templateLine(template),
        badge ? (
          <Badge key="status" tone={badge.tone} size="sm">
            {badge.label}
          </Badge>
        ) : null,
      ]}
    />
  );
}

function facts(template: TemplateInfo, own: boolean): DescriptionItem[] {
  const cover = coverLayouts(template);
  const featured = featuredNote(template);
  return [
    ...(template.family ? [{ label: 'Família', value: familyLabel(template.family) }] : []),
    { label: 'Estilo', value: template.description },
    { label: 'Formato', value: formatFacts(template.formatInfo), numeric: true },
    { label: 'Slides', value: `${template.minSlides} a ${template.maxSlides}`, numeric: true },
    { label: 'Imagem de destaque', value: cover ?? 'Não usa' },
    ...(template.previewPhoto && !own ? [{ label: 'Prévia da biblioteca', value: 'Textos e imagem ilustrativos; a geração usa o artigo e a imagem de destaque escolhida.' }] : []),
    ...(featured ? [{ label: 'Estrutura', value: featured }] : []),
  ];
}

export function TemplateDetail({
  template,
  articleCover,
  body,
  own = false,
  children,
  onInspect,
}: {
  template: TemplateInfo;
  /** The article's featured image (or the sample photo) for the layouts that draw it. */
  articleCover?: AssetId;
  /** Slides to draw instead of the template's sample (the carousel moved to this model, or the sample with the article's cover). */
  body?: CarouselBody;
  /** `body` is the carousel being edited: "Este carrossel", each slide numbered. */
  own?: boolean;
  children?: ReactNode;
  /** Opens a snapshot of these rendered pages in the parent-owned, sibling Dialog. */
  onInspect: (inspection: TemplateInspection) => void;
}) {
  const sample = useTemplatePreview(body ? undefined : template.id, { articleCover, scale: 0.75 });
  const drawn = useCarouselPreview(body, { articleCover, scale: 0.75 });
  const preview = body ? drawn : sample;
  const labelOf = (layoutId: string) => template.layouts.find((layout) => layout.id === layoutId)?.label ?? layoutId;
  const frames: TemplatePreviewFrame[] = body
    ? body.slides.map((slide, index) => {
        const rendered = preview.slides.find(entry => entry.slideId === slide.id);
        return {
          key: slide.id,
          label: own ? `Slide ${index + 1} · ${labelOf(slide.layout)}` : labelOf(slide.layout),
          src: rendered?.image?.dataUrl,
          width: rendered?.width,
          height: rendered?.height,
        };
      })
    : template.layouts.map((layout) => {
        const rendered = preview.slides.find(entry => entry.layout === layout.id);
        return {
          key: layout.id,
          label: layout.label,
          src: rendered?.image?.dataUrl,
          width: rendered?.width,
          height: rendered?.height,
        };
      });
  return (
    <>
      <Section>
        {preview.status === 'error' && preview.slides.length === 0 ? (
          <Alert tone="warning" title="Prévia indisponível neste navegador">
            {preview.reason}
          </Alert>
        ) : (
          <Carousel label={`${own ? 'Slides deste carrossel' : 'Layouts'} no modelo ${template.name}`} title={own ? 'Este carrossel' : 'Layouts'} perView={2}>
            {frames.map((frame, index) => (
              <MediaFrame
                key={frame.key}
                ratio={template.formatInfo.ratio}
                src={frame.src}
                alt={`${frame.label} no modelo ${template.name}`}
                fit="contain"
                radius="sm"
                state={frame.src ? undefined : preview.status === 'loading' ? 'loading' : 'error'}
                caption={
                  <LinkButton size="inherit" tone="quiet" disabled={!frame.src} onClick={() => onInspect({ templateId: template.id, frames, index })} aria-label={`Ampliar ${frame.label} no modelo ${template.name}`}>
                    Ampliar {frame.label}
                  </LinkButton>
                }
              />
            ))}
          </Carousel>
        )}
      </Section>
      {children}
      <Section>
        <DescriptionList label={`Ficha do modelo ${template.name}`} items={facts(template, own)} labelWidth={128} />
        <Disclosure summary="Limites de texto" meta={`${template.layouts.length} layouts`}>
          <DescriptionList
            label={`Limites dos layouts do modelo ${template.name}`}
            labelWidth={128}
            items={template.layouts.map((layout) => ({ label: layout.label, value: <MetaList items={layout.slots.map(slotLimit)} /> }))}
          />
        </Disclosure>
      </Section>
    </>
  );
}
