'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Carousel,
  DescriptionList,
  Gallery,
  Grid,
  MediaFrame,
  PageHeader,
  PageStack,
  Panel,
  Section,
  toast,
} from '@content-ventures/design-system/v3';
import { Check, Plus } from '@content-ventures/design-system/v3/icons';
import type { AssetId } from '@/domain';
import type { TemplateInfo } from '@/ports';
import { useCan } from '@/state';
import { useRememberTemplate } from '@/features/library/last-template';
import { statusBadge, templateLine, type LibraryParams } from '@/features/library/library-model';
import { useTemplatePreview } from '@/features/library/use-template-images';
import { ModelCover } from './model-card';
import { StartDrawer } from './start-drawer';
import { galleryItems, layoutLimits, modelFacts, modelHref, otherModels } from './templates-model';

/** 810 px wide pages: the stage shows a 4:5 page up to ~680 px wide. */
const STAGE_SCALE = 0.75;
const DEFAULT_NOTE = 'Padrão';
/** Both lists share the value column ("Imagem de destaque" on one line). */
const LABEL_WIDTH = 144;

/** A `data:` PNG as a Blob, decoded in the click (no await before the new tab). */
function dataUrlBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (!head.endsWith(';base64')) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

/** The lightbox's "Baixar": the page's PNG in a new tab, as the R1 review does. */
function openImage(dataUrl: string) {
  const url = URL.createObjectURL(dataUrlBlob(dataUrl));
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * A model's page (`?model=`): every page of its sample on a stage (the DS Gallery: arrows,
 * thumbnails, swipe, the lightbox), the text limits of the page on stage, its ficha and the other
 * models of the format. "Criar carrossel" starts one in this model; "Usar como padrão" makes it
 * the model the next carousels start from.
 */
export function ModelView({
  template,
  templates,
  params,
  articleCover,
  samplePhoto,
  isDefault,
  workspaceSlug,
}: {
  template: TemplateInfo;
  templates: readonly TemplateInfo[];
  params: Pick<LibraryParams, 'format' | 'query'>;
  /** The photo this model's pages draw. */
  articleCover?: AssetId;
  /** The library's sample photo, for the other models without their own. */
  samplePhoto?: AssetId;
  isDefault: boolean;
  workspaceSlug?:string;
}) {
  const rememberTemplate=useRememberTemplate();
  const workspaceHrefFor = useWorkspaceHref();
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  // Starting a carousel is for whoever edits pieces (the carousel stage asks the same).
  const canStart = useCan('piece.edit');
  const preview = useTemplatePreview(template.id, { articleCover, scale: STAGE_SCALE });
  const items = galleryItems(preview.slides, template);
  // The pages follow the model's layouts, so the limits are known before the render arrives.
  const layout = template.layouts[Math.min(index, template.layouts.length - 1)];
  const others = otherModels(templates, template);
  const badge = statusBadge(template.status);

  const makeDefault = () => {
    rememberTemplate(template.id);
    toast(`${template.name} é o modelo padrão`, { description: 'Os próximos carrosséis começam nele.' });
  };

  return (
    <>
      <PageStack>
        <PageHeader
          title={template.name}
          status={
            badge ? (
              <Badge variant="text" tone={badge.tone}>
                {badge.label}
              </Badge>
            ) : undefined
          }
          meta={isDefault ? [templateLine(template), DEFAULT_NOTE] : [templateLine(template)]}
          actions={
            <>
              {canStart ? (
                <Button variant="primary" icon={Plus} onClick={() => setStarting(true)}>
                  Criar carrossel
                </Button>
              ) : null}
              {isDefault ? null : (
                <Button icon={Check} onClick={makeDefault}>
                  Usar como padrão
                </Button>
              )}
            </>
          }
        />
        <Grid columns="2:1" collapseBelow={1024} align="start">
          {preview.status === 'error' ? (
            <Alert tone="warning" title="Prévia indisponível neste navegador">
              {preview.reason}
            </Alert>
          ) : preview.status === 'ready' ? (
            <Gallery
              items={items}
              index={index}
              onIndexChange={setIndex}
              label={`Páginas do modelo ${template.name}`}
              stageRatio={template.formatInfo.ratio}
              fitHeight
              onDownload={(item) => {
                if (item.src) openImage(item.src);
              }}
            />
          ) : (
            <MediaFrame ratio={template.formatInfo.ratio} alt="" state="loading" fitHeight />
          )}
          <Panel>
            <Section title="Limites de texto" meta={layout?.label}>
              {layout ? <DescriptionList labelWidth={LABEL_WIDTH} items={layoutLimits(layout)} /> : null}
            </Section>
            <Section title="Ficha">
              <DescriptionList labelWidth={LABEL_WIDTH} items={modelFacts(template)} />
            </Section>
          </Panel>
        </Grid>
        {others.length > 0 ? (
          <Carousel label="Outros modelos" title="Outros modelos" perView={5}>
            {others.map((other) => (
              <ModelCover key={other.id} template={other} href={workspaceHrefFor(modelHref(params, other.id,workspaceSlug))} articleCover={other.previewPhoto ?? samplePhoto} />
            ))}
          </Carousel>
        ) : null}
      </PageStack>
      {canStart ? <StartDrawer template={template} open={starting} onClose={() => setStarting(false)} /> : null}
    </>
  );
}
