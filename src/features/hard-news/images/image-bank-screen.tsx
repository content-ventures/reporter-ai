'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  ActiveFilters,
  Button,
  EmptyState,
  FilterBand,
  FilterBar,
  FilterField,
  formatCompact,
  Grid,
  PageHeader,
  PageStack,
  Pagination,
  SearchField,
  Segmented,
  Select,
  Tabs,
  toast,
  ToggleGroup,
} from '@content-ventures/design-system/v3';
import { Columns3, Images, LayoutGrid, SearchX, Upload } from '@content-ventures/design-system/v3/icons';
import { imageUsable } from '@/domain/hard-news';
import type { ArchiveImage } from '@/domain/hard-news';
import { formatCount, plural } from '@/ui/format';
import { ImageDrawer } from './image-drawer';
import {
  appliedFilters,
  COLOR_OPTIONS,
  DEFAULT_IMAGE_PARAMS,
  effectiveSort,
  filterCount,
  fromArchive,
  orientationValue,
  ORIENTATION_OPTIONS,
  PAGE_SIZE,
  pageCount,
  pageSlice,
  photosFor,
  pressedSuggestion,
  RIGHTS_OPTIONS,
  rightsValue,
  searchPhotos,
  serializeImageParams,
  SIZE_OPTIONS,
  SORT_OPTIONS,
  sortValue,
  SOURCE_LABELS,
  sourceCounts,
  suggestedSearches,
} from './images-model';
import type { ImageFilters, ImageParams, SourceTab, ViewMode } from './images-model';
import { MosaicSkeleton, PhotoGrid, PhotoMosaic } from './photo-mosaic';
import { UploadDrawer } from './upload-drawer';
import { useArchive, useBankPool, useBankResults, useImageParams } from './use-image-bank';
import type { SetImageParams } from './use-image-bank';

const TABS: readonly SourceTab[] = ['all', 'own', 'unsplash', 'pexels'];
const TAB_LABELS: Record<SourceTab, string> = { all: 'Todas', ...SOURCE_LABELS };
const ANY = 'all';
/** The field commits the search after this pause (Enter commits at once). */
const SEARCH_DELAY_MS = 300;

/** Imagens with its state in the address (inside `<Suspense>`). */
export function ImageBankFromUrl() {
  const [params, setParams] = useImageParams();
  return <ImageBank params={params} onParamsChange={setParams} />;
}

const KEEP: SetImageParams = () => undefined;

/**
 * Imagens (F2.9) as a photo bank: one search over the portal's own archive, Unsplash and Pexels,
 * with suggested searches, source tabs, filters, order and a photo mosaic. A photo opens its own
 * page; what can go into an article follows its rights (REQ-2.9).
 */
export function ImageBank({ params = DEFAULT_IMAGE_PARAMS, onParamsChange = KEEP }: { params?: ImageParams; onParamsChange?: SetImageParams }) {
  const { images: archive, ready, save } = useArchive();
  const bandId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Each opening gets its own drawer (`session`), so a cancelled edit never comes back. */
  const [editing, setEditing] = useState<{ image: ArchiveImage; open: boolean; session: number }>();
  const { q, source, filters, view } = params;
  const sort = effectiveSort(params.sort, q);
  const search = serializeImageParams(params);
  const change = useCallback((patch: Partial<ImageParams>) => onParamsChange({ page: 1, ...patch }), [onParamsChange]);

  // The field holds what is typed; the address holds the search. A new search from elsewhere (a
  // suggestion, a theme link) replaces the text, unless it is what is being typed.
  const [input, setInput] = useState(q);
  const [committed, setCommitted] = useState(q);
  if (committed !== q) {
    setCommitted(q);
    if (input.trim() !== q) setInput(q);
  }
  useEffect(() => {
    const term = input.trim();
    if (term === q) return undefined;
    const timer = window.setTimeout(() => change({ q: term }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input, q, change]);

  const ownPhotos = useMemo(() => archive.map(fromArchive), [archive]);
  const own = useMemo(() => searchPhotos(ownPhotos, q, filters, sort), [ownPhotos, q, filters, sort]);
  const bank = useBankResults(q, filters);
  const results = bank.results ? { own, ...bank.results } : undefined;
  const all = results ? photosFor('all', results, archive) : undefined;
  const shown = results ? photosFor(source, results, archive) : source === 'own' && ready ? own : undefined;
  const counts = results ? sourceCounts(results, archive) : undefined;

  // Suggestions count what each search finds among every photo the filters allow.
  const bankPool = useBankPool();
  const pool = useMemo(() => photosFor('all', {
    own: searchPhotos(ownPhotos, '', filters, 'recent'),
    unsplash: searchPhotos(bankPool.unsplash, '', filters, 'recent'),
    pexels: searchPhotos(bankPool.pexels, '', filters, 'recent'),
  }, archive), [ownPhotos, filters, archive, bankPool]);
  const suggestions = ready ? suggestedSearches(pool, all ?? pool, q, 8) : [];

  const total = shown?.length ?? 0;
  const page = Math.min(params.page, pageCount(total));
  const visible = shown ? pageSlice(shown, page) : [];
  const usable = archive.filter(imageUsable).length;
  const filtered = filterCount(filters) > 0;

  function count(tab: SourceTab) {
    if (!ready) return undefined;
    if (tab === 'own') return formatCompact(own.length);
    return counts && !bank.loading ? formatCompact(counts[tab]) : undefined;
  }

  function setFilter(patch: ImageFilters) {
    change({ filters: { ...filters, ...patch } });
  }

  async function saveEdit(image: ArchiveImage) {
    if (!(await save(image))) return;
    setEditing((previous) => ({ image, open: false, session: previous?.session ?? 0 }));
    toast('Imagem salva', imageUsable(image) ? undefined : { tone: 'info', description: 'Ela só vai para artigos depois de confirmar os direitos.' });
  }

  function sent(images: ArchiveImage[]) {
    setUploading(false);
    change({ q: '', source: 'own', filters: {} });
    const [first] = images;
    if (images.length === 1 && first) setEditing((previous) => ({ image: first, open: true, session: (previous?.session ?? 0) + 1 }));
    else toast(`${formatCount(images.length)} fotos enviadas`, { description: 'Informe crédito e licença para usar.' });
  }

  return (
    <>
      <PageHeader
        title="Imagens"
        meta={ready ? [plural(archive.length, 'foto no acervo', 'fotos no acervo'), `${formatCount(usable)} ${usable === 1 ? 'pronta' : 'prontas'} para usar`] : undefined}
        actions={<Button icon={Upload} onClick={() => setUploading(true)}>Enviar fotos</Button>}
        toolbar={(
          <Grid columns="auto" min={10000} gap="sm">
            <SearchField
              size="lg"
              label="Buscar fotos"
              placeholder="Tilápia, camarão, porto, frigorífico…"
              hotkey="/"
              shortcut="/"
              enterKeyHint="search"
              loading={bank.loading && ready}
              value={input}
              onValueChange={setInput}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                change({ q: input.trim() });
              }}
            />
            {suggestions.length > 0 ? (
              <ToggleGroup
                type="single"
                label="Buscas sugeridas"
                size="sm"
                value={pressedSuggestion(suggestions, q)}
                onChange={(value) => change({ q: value ?? '' })}
                items={suggestions}
              />
            ) : null}
          </Grid>
        )}
      />
      <FilterBar
        spacing="comfortable"
        bandId={bandId}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        filterCount={filterCount(filters)}
        tabs={(
          <Tabs<SourceTab>
            size="sm"
            label="Fonte"
            value={source}
            onChange={(value) => change({ source: value })}
            items={TABS.map((tab) => ({ value: tab, label: TAB_LABELS[tab], count: count(tab) }))}
          />
        )}
        actions={(
          <>
            <Select size="sm" label="Ordenar" value={sort} options={SORT_OPTIONS} onChange={(value) => change({ sort: sortValue(value) })} />
            <Segmented<ViewMode>
              size="sm"
              label="Vista"
              value={view}
              onChange={(value) => onParamsChange({ view: value })}
              options={[
                { value: 'mosaic', label: 'Mosaico', icon: Columns3, iconOnly: true },
                { value: 'grid', label: 'Grade', icon: LayoutGrid, iconOnly: true },
              ]}
            />
          </>
        )}
      />
      <PageStack>
        <FilterBand id={bandId} open={filtersOpen} label="Filtros das fotos" onClear={filtered ? () => change({ filters: {} }) : undefined}>
          <FilterField>
            <Select size="sm" label="Orientação" value={filters.orientation ?? ANY} options={ORIENTATION_OPTIONS} onChange={(value) => setFilter({ orientation: orientationValue(value) })} />
          </FilterField>
          <FilterField>
            <Select size="sm" label="Cor" value={filters.color ?? ANY} options={COLOR_OPTIONS} onChange={(value) => setFilter({ color: value === ANY ? undefined : value })} />
          </FilterField>
          <FilterField>
            <Select size="sm" label="Tamanho" value={filters.cover ? 'cover' : ANY} options={SIZE_OPTIONS} onChange={(value) => setFilter({ cover: value === 'cover' || undefined })} />
          </FilterField>
          <FilterField>
            <Select size="sm" label="Direitos" value={filters.rights ?? ANY} options={RIGHTS_OPTIONS} onChange={(value) => setFilter({ rights: rightsValue(value) })} />
          </FilterField>
        </FilterBand>
        {!filtersOpen && filtered ? (
          <ActiveFilters
            filters={appliedFilters(filters).map((item) => ({
              ...item,
              onRemove: () => setFilter({ [item.id]: undefined }),
              onEdit: () => setFiltersOpen(true),
            }))}
            onClearAll={() => change({ filters: {} })}
          />
        ) : null}
        {!shown ? (
          <MosaicSkeleton />
        ) : shown.length === 0 ? (
          source === 'own' && archive.length === 0 ? (
            <EmptyState icon={Images} size="page" title="Acervo vazio" actions={<Button icon={Upload} onClick={() => setUploading(true)}>Enviar fotos</Button>} />
          ) : (
            <EmptyState
              icon={SearchX}
              size="page"
              title={q ? `Nenhuma foto para “${q}”` : 'Nenhuma foto com esses filtros'}
              actions={(
                <>
                  {filtered ? <Button onClick={() => change({ filters: {} })}>Limpar filtros</Button> : null}
                  {source !== 'all' ? <Button onClick={() => change({ source: 'all' })}>Buscar em todas as fontes</Button> : null}
                  {!filtered && source === 'all' ? <Button onClick={() => change({ q: '' })}>Limpar busca</Button> : null}
                </>
              )}
            />
          )
        ) : (
          <>
            {view === 'grid' ? <PhotoGrid photos={visible} search={search} /> : <PhotoMosaic photos={visible} search={search} />}
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(next) => onParamsChange({ page: next })} noun="fotos" />
          </>
        )}
      </PageStack>
      <UploadDrawer open={uploading} onClose={() => setUploading(false)} onSent={sent} />
      {editing ? (
        <ImageDrawer
          key={editing.session}
          image={editing.image}
          open={editing.open}
          onClose={() => setEditing({ ...editing, open: false })}
          onSave={(next) => void saveEdit(next)}
        />
      ) : null}
    </>
  );
}
