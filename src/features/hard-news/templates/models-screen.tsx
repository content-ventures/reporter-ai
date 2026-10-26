'use client';

import { useState } from 'react';
import {usePathname} from 'next/navigation';
import {workspaceAddress} from '@/domain/workspace-address';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  FilterBar,
  Grid,
  GridItem,
  MediaFrame,
  PageHeader,
  PageStack,
  SearchField,
  Segmented,
  SkeletonRegion,
  Tabs,
  Tray,
} from '@content-ventures/design-system/v3';
import { Plus, SearchX } from '@content-ventures/design-system/v3/icons';
import { TEMPLATE_FAMILIES, formatById, type CarouselFormatId } from '@/domain';
import type { TemplateInfo } from '@/ports';
import { useLastTemplate } from '@/features/library/last-template';
import { DEFAULT_LIBRARY_PARAMS, FIRST_FORMAT, initialTemplate, otherFormatMatch, type LibraryParams } from '@/features/library/library-model';
import { useLibraryParams, type SetLibraryParams } from '@/features/library/use-library-params';
import { useCan, useRuntime,useTemplateCatalog } from '@/state';
import { useBreadcrumb } from '@/ui/shell';
import { usePhone } from '@/ui/use-phone';
import { ModelCard, ModelCardSkeleton } from './model-card';
import { ModelView } from './model-view';
import { StartDrawer } from './start-drawer';
import { familyShelves, formatOptions, kindTabs, libraryHref, modelHref, type PieceTab, type Shelf } from './templates-model';

/**
 * Modelos in R2 (`/library/templates`): the carousel models as shelves by family — Notícia,
 * Explica, Podcast — each model a contact sheet of three real pages. The header names the model the
 * next carousel starts from and "Criar carrossel" picks the production. `?model=` opens a model's
 * page. The format, the search and the open model live in the R1 address (`?format&q&model`), so
 * R1 links keep working. Static posts show as "Em breve": nothing draws a one-page piece yet.
 */
export function ModelsScreen() {
  const [params, setParams] = useLibraryParams();
  return params.model ? <ModelPage params={params} /> : <ModelsGallery params={params} setParams={setParams} />;
}

const noop: SetLibraryParams = () => undefined;

/** The server render and first paint, before the address is read (inside `<Suspense>`). */
export function ModelsScreenFallback() {
  return <ModelsGallery params={DEFAULT_LIBRARY_PARAMS} setParams={noop} />;
}

/** From this many shelves they sit side by side (content over 1280 px); fewer stack. */
const SHELVES_SIDE_BY_SIDE = 3;
const PHONE_CARD_MIN = 150;
const CARD_MIN = 440;

function useLibrary() {
  const { runtime, status } = useRuntime();
  const catalog=useTemplateCatalog(),templates=catalog.data?.templates??[];
  const lastUsed = useLastTemplate();
  const standard = initialTemplate(templates, { lastUsed });
  const workspaceSlug=workspaceAddress(usePathname())?.slug;
  return { runtime:catalog.data?runtime:undefined,status:catalog.status==='error'?'error':status,templates,samplePhoto:catalog.data?.samplePhoto,standard,workspaceSlug };
}

/** Feed is the address default: it stays out of the links. */
function shownFormat(format: CarouselFormatId): CarouselFormatId | null {
  return format === FIRST_FORMAT ? null : format;
}

function ModelsGallery({ params, setParams }: { params: LibraryParams; setParams: SetLibraryParams }) {
  const phone = usePhone();
  const { runtime, status, templates, samplePhoto, standard,workspaceSlug } = useLibrary();
  // What is on screen answers each keystroke; the address follows (a shared link opens the same view).
  const [query, setQuery] = useState(params.query);
  const [format, setFormat] = useState<CarouselFormatId>(params.format ?? FIRST_FORMAT);
  const [starting, setStarting] = useState(false);
  // Starting a carousel is for whoever edits pieces (the carousel stage asks the same).
  const canStart = useCan('piece.edit');
  const shown = { format: shownFormat(format), query };
  const shelves = familyShelves(templates, { format, query });
  const elsewhere = runtime && shelves.length === 0 ? otherFormatMatch(templates, { format, query }) : undefined;
  const standardTemplate = templates.find((entry) => entry.id === standard);
  const ratio = formatById(format)?.ratio ?? '4/5';

  const changeQuery = (next: string) => {
    setQuery(next);
    setParams({ query: next });
  };
  const changeFormat = (next: CarouselFormatId) => {
    setFormat(next);
    setParams({ format: shownFormat(next) });
  };

  const shelf = (entry: Shelf<TemplateInfo>) => (
    <Tray title={entry.title} meta={entry.meta}>
      <Grid as="ul" columns="auto" min={phone ? PHONE_CARD_MIN : CARD_MIN} label={entry.label}>
        {entry.templates.map((template) => (
          <ModelCard
            key={template.id}
            template={template}
            href={modelHref(shown, template.id,workspaceSlug)}
            articleCover={template.previewPhoto ?? samplePhoto}
            isDefault={template.id === standard}
            compact={phone}
          />
        ))}
      </Grid>
    </Tray>
  );

  return (
    <>
      <PageStack>
        <PageHeader
          title="Modelos"
          meta={standardTemplate ? [`Padrão: ${standardTemplate.name}`] : undefined}
          actions={
            canStart ? (
              <Button variant="primary" icon={Plus} disabled={!standardTemplate} onClick={() => setStarting(true)}>
                Criar carrossel
              </Button>
            ) : undefined
          }
        />
        {status === 'error' ? (
          <ErrorState title="Não foi possível abrir os modelos" size="page" onRetry={() => window.location.reload()} />
        ) : (
          <>
            <FilterBar
              spacing="comfortable"
              filters={false}
              tabs={
                <Tabs<PieceTab>
                  label="Peça"
                  value="carousel"
                  onChange={() => undefined}
                  items={kindTabs(templates, query).map((tab) => ({ value: tab.value, label: tab.label, count: tab.value === 'carousel' && !runtime ? undefined : tab.count, disabled: tab.disabled }))}
                />
              }
              search={<SearchField size="sm" value={query} onValueChange={changeQuery} placeholder="Nome, estilo ou uso" label="Buscar modelo" />}
              actions={<Segmented<CarouselFormatId> size="sm" label="Formato" value={format} onChange={changeFormat} options={formatOptions()} />}
            />
            {!runtime ? (
              <ShelvesSkeleton format={format} ratio={ratio} compact={phone} />
            ) : shelves.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum modelo encontrado"
                size="panel"
                heading="p"
                actions={
                  elsewhere ? (
                    <Button size="sm" onClick={() => changeFormat(elsewhere.value)}>
                      {`Ver em ${elsewhere.label} · ${elsewhere.count}`}
                    </Button>
                  ) : query.trim() ? (
                    <Button size="sm" onClick={() => changeQuery('')}>
                      Limpar busca
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Grid columns="1:1:1" collapseBelow={1280}>
                {shelves.map((entry) =>
                  shelves.length >= SHELVES_SIDE_BY_SIDE ? (
                    <GridItem key={entry.id}>{shelf(entry)}</GridItem>
                  ) : (
                    <GridItem key={entry.id} span="full">
                      {shelf(entry)}
                    </GridItem>
                  ),
                )}
              </Grid>
            )}
          </>
        )}
      </PageStack>
      {canStart ? <StartDrawer template={standardTemplate} open={starting} onClose={() => setStarting(false)} /> : null}
    </>
  );
}

const SKELETON_CARDS = [0, 1];
const SQUARE_SKELETON = [0, 1, 2];

/** The shelves while the library loads: the Feed families (or one Quadrado shelf), same geometry. */
function ShelvesSkeleton({ format, ratio, compact }: { format: CarouselFormatId; ratio: string; compact: boolean }) {
  const families = format === FIRST_FORMAT ? TEMPLATE_FAMILIES : [];
  return (
    <SkeletonRegion label="Carregando os modelos">
      <Grid columns="1:1:1" collapseBelow={1280}>
        {families.length > 0 ? (
          families.map((family) => (
            <GridItem key={family.id}>
              <Tray title={family.label} meta={family.use.replace(/\.$/, '')}>
                <Grid columns="auto" min={compact ? PHONE_CARD_MIN : CARD_MIN}>
                  {SKELETON_CARDS.map((card) => (
                    <ModelCardSkeleton key={card} ratio={ratio} compact={compact} />
                  ))}
                </Grid>
              </Tray>
            </GridItem>
          ))
        ) : (
          <GridItem span="full">
            <Tray>
              <Grid columns="auto" min={compact ? PHONE_CARD_MIN : CARD_MIN}>
                {SQUARE_SKELETON.map((card) => (
                  <ModelCardSkeleton key={card} ratio={ratio} compact={compact} />
                ))}
              </Grid>
            </Tray>
          </GridItem>
        )}
      </Grid>
    </SkeletonRegion>
  );
}

/** `?model=`: the model's page once the library is in, or why it is not there. */
function ModelPage({ params }: { params: LibraryParams }) {
  const { runtime, status, templates, samplePhoto, standard,workspaceSlug } = useLibrary();
  const template = templates.find((entry) => entry.id === params.model);
  const shown = { format: params.format ?? (template ? shownFormat(template.format) : null), query: params.query };
  const back = libraryHref(shown,workspaceSlug);
  useBreadcrumb(runtime ? [{ label: 'Modelos', href: back }, { label: template?.name ?? 'Modelo não encontrado' }] : null);

  if (status === 'error') {
    return <ErrorState title="Não foi possível abrir os modelos" size="page" onRetry={() => window.location.reload()} />;
  }
  if (!runtime) {
    return (
      <PageStack>
        <SkeletonRegion label="Carregando o modelo">
          <MediaFrame ratio="4/5" alt="" state="loading" maxHeight={480} />
        </SkeletonRegion>
      </PageStack>
    );
  }
  if (!template) {
    return <EmptyState icon={SearchX} size="page" heading="h1" title="Modelo não encontrado" actions={<ButtonLink href={back}>Ver modelos</ButtonLink>} />;
  }
  return (
    <ModelView
      key={template.id}
      template={template}
      templates={templates}
      params={shown}
      articleCover={template.previewPhoto ?? samplePhoto}
      samplePhoto={samplePhoto}
      isDefault={template.id === standard}
      workspaceSlug={workspaceSlug}
    />
  );
}
