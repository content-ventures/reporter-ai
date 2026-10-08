'use client';

import { Suspense, useMemo, useState } from 'react';
import { Button, Card, ErrorState, Grid, MediaFrame, PageHeader, PageStack, SkeletonText, toast } from '@content-ventures/design-system/v3';
import { Check } from '@content-ventures/design-system/v3/icons';
import type { TemplateId } from '@/domain';
import { useRuntime } from '@/state';
import { rememberTemplate, useLastTemplate } from './last-template';
import { DEFAULT_LIBRARY_PARAMS, initialTemplate, shownFormat, type LibraryFilter, type LibraryParams } from './library-model';
import { TemplateBrowser } from './template-browser';
import { TemplateDrawer } from './template-drawers';
import { useLibraryParams, type SetLibraryParams } from './use-library-params';
import { usePhone } from '@/ui/use-phone';

/**
 * Modelos (`/library/templates`, F1.5): the carousel models the studio offers, as a library —
 * format tabs with counts, a search, and a card per model with its cover drawn from the template
 * data (the photo models over the sample photo, "Foto de exemplo"). "Ver modelo" opens every
 * layout with sample copy and its limits, and "Usar como padrão" makes it the model the next
 * carousel starts from (kept in this browser). The format, the search and the open model live in
 * the URL.
 */
export function TemplatesScreen() {
  return (
    <Suspense fallback={<Library params={DEFAULT_LIBRARY_PARAMS} setParams={() => undefined} />}>
      <LibraryFromUrl />
    </Suspense>
  );
}

function LibraryFromUrl() {
  const [params, setParams] = useLibraryParams();
  return <Library params={params} setParams={setParams} />;
}

const SKELETON_CARDS = Array.from({ length: 8 }, (_, index) => index);

function LibrarySkeleton() {
  return (
    <Grid columns="auto" min={200} aria-busy="true" aria-label="Carregando os modelos">
      {SKELETON_CARDS.map((index) => (
        <Card key={index} as="div" padding="sm" loading>
          <MediaFrame ratio="4/5" alt="" radius="sm" state="loading" />
          <SkeletonText lines={2} />
        </Card>
      ))}
    </Grid>
  );
}

const DEFAULT_NOTE = 'Padrão';

function Library({ params, setParams }: { params: LibraryParams; setParams: SetLibraryParams }) {
  const phone = usePhone();
  const { runtime, status } = useRuntime();
  const templates = useMemo(() => runtime?.render.templates() ?? [], [runtime]);
  const samplePhoto = runtime?.render.samplePhoto;
  const lastUsed = useLastTemplate();
  const standard = initialTemplate(templates, { lastUsed });
  // What is on screen answers each keystroke; the address follows (a shared link opens the same view).
  const [query, setQuery] = useState(params.query);
  const [format, setFormat] = useState(params.format);
  const [open, setOpen] = useState<TemplateId | null>(params.model);
  const [urlModel, setUrlModel] = useState(params.model);
  if (params.model !== urlModel) {
    setUrlModel(params.model);
    setOpen(params.model);
  }
  const filter: LibraryFilter = { format: shownFormat({ format, model: open }, templates), query };
  const template = templates.find((entry) => entry.id === open);

  const changeFilter = (patch: Partial<LibraryFilter>) => {
    if (patch.query !== undefined) setQuery(patch.query);
    if (patch.format !== undefined) setFormat(patch.format);
    setParams(patch);
  };
  const openModel = (id: TemplateId | null) => {
    setOpen(id);
    // Closing keeps the format on screen (the model's), so the grid does not jump back.
    if (!id && template) {
      setFormat(filter.format);
      setParams({ model: null, format: filter.format });
      return;
    }
    setParams({ model: id });
  };
  const makeDefault = (id: TemplateId) => {
    const chosen = templates.find((entry) => entry.id === id);
    rememberTemplate(id);
    toast(`${chosen?.name ?? 'Modelo'} é o modelo padrão`, { description: 'Os próximos carrosséis começam nele.' });
  };

  return (
    <>
      <PageHeader title="Modelos" />
      {status === 'error' ? (
        <ErrorState title="Não foi possível abrir os modelos" size="page" onRetry={() => window.location.reload()} />
      ) : !runtime ? (
        <PageStack>
          <LibrarySkeleton />
        </PageStack>
      ) : (
        <TemplateBrowser
          templates={templates}
          filter={filter}
          onFilterChange={changeFilter}
          label="Modelos de carrossel"
          mode="browse"
          onOpen={(id) => openModel(id)}
          coverFor={() => (samplePhoto ? { articleCover: samplePhoto } : undefined)}
          noteFor={(entry) => (entry.id === standard ? DEFAULT_NOTE : undefined)}
          compact={phone}
          min={phone ? 150 : 208}
        />
      )}
      <TemplateDrawer
        open={Boolean(template)}
        onClose={() => openModel(null)}
        template={template}
        articleCover={samplePhoto}
        footerStart={template && template.id === standard ? 'Modelo padrão dos próximos carrosséis' : undefined}
        footer={
          template && template.id !== standard ? (
            <Button variant="primary" icon={Check} onClick={() => makeDefault(template.id)}>
              Usar como padrão
            </Button>
          ) : (
            <Button onClick={() => openModel(null)}>Fechar</Button>
          )
        }
      />
    </>
  );
}
