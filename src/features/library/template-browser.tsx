'use client';

import { useId } from 'react';
import { Button, EmptyState, FilterBar, Grid, PageStack, SearchField, Tabs } from '@content-ventures/design-system/v3';
import { SearchX } from '@content-ventures/design-system/v3/icons';
import type { CarouselFormatId, TemplateId } from '@/domain';
import type { TemplateInfo } from '@/ports';
import { applyFilter, formatTabs, otherFormatMatch, type LibraryFilter } from './library-model';
import { TemplateCard, TemplateChoice, type TemplateCover } from './template-card';

/**
 * The library as one block, the same on the "Modelos" page, at the carousel's start and in
 * "Trocar modelo": format tabs with counts (Stories "Em breve"), the search and the grid of cards
 * of that format — one format at a time, so every card shares its proportion. A search with
 * nothing in this format offers the format that has it. `browse` cards open the model; `pick`
 * cards are a radio group with "Ver modelo" on each.
 */

export type TemplateBrowserProps = {
  templates: readonly TemplateInfo[];
  filter: LibraryFilter;
  onFilterChange: (patch: Partial<LibraryFilter>) => void;
  /** Accessible name of the cards ("Modelos de carrossel"). */
  label: string;
  mode: 'browse' | 'pick';
  /** `pick`: the chosen model. */
  value?: TemplateId;
  onChange?: (id: TemplateId) => void;
  /** "Ver modelo" (the whole card in `browse`). */
  onOpen: (id: TemplateId) => void;
  /** Cover image and texts the thumbnails draw (the carousel's own, or the sample photo), per model. */
  coverFor?: (template: TemplateInfo) => TemplateCover | undefined;
  /** A short mark after a card's line ("Em uso", "Padrão"). */
  noteFor?: (template: TemplateInfo) => string | undefined;
  /** Short width (drawer, phone): small tabs. */
  compact?: boolean;
  /** Without the search (a drawer on a phone opens on the cards, not under the keyboard). */
  searchable?: boolean;
  /** Narrowest card, px. */
  min?: number;
};

export function TemplateBrowser({
  templates,
  filter,
  onFilterChange,
  label,
  mode,
  value,
  onChange,
  onOpen,
  coverFor,
  noteFor,
  compact = false,
  searchable = true,
  min = 184,
}: TemplateBrowserProps) {
  const name = useId();
  const shown = applyFilter(templates, filter);
  const tabs = formatTabs(templates, filter);
  const elsewhere = shown.length === 0 ? otherFormatMatch(templates, filter) : undefined;

  return (
    <PageStack>
      <FilterBar
        tabs={
          <Tabs<CarouselFormatId>
            label="Formato"
            size={compact ? 'sm' : 'md'}
            value={filter.format}
            onChange={(format) => onFilterChange({ format })}
            items={tabs.map((tab) => ({ value: tab.value, label: tab.label, count: tab.count, disabled: tab.disabled }))}
          />
        }
        search={
          searchable ? (
            <SearchField size="sm" value={filter.query} onValueChange={(query) => onFilterChange({ query })} placeholder="Nome, estilo ou uso" label="Buscar modelo" />
          ) : undefined
        }
        filters={false}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum modelo encontrado"
          size="panel"
          heading="p"
          actions={
            elsewhere ? (
              <Button size="sm" onClick={() => onFilterChange({ format: elsewhere.value })}>
                {`Ver em ${elsewhere.label} · ${elsewhere.count}`}
              </Button>
            ) : filter.query.trim() ? (
              <Button size="sm" onClick={() => onFilterChange({ query: '' })}>
                Limpar busca
              </Button>
            ) : undefined
          }
        />
      ) : mode === 'browse' ? (
        <Grid as="ul" columns="auto" min={min} label={label}>
          {shown.map((template) => (
            <TemplateCard key={template.id} template={template} cover={coverFor?.(template)} note={noteFor?.(template)} onOpen={onOpen} />
          ))}
        </Grid>
      ) : (
        <Grid columns="auto" min={min} role="radiogroup" aria-label={label}>
          {shown.map((template) => (
            <TemplateChoice
              key={template.id}
              template={template}
              name={name}
              checked={template.id === value}
              onChange={(id) => onChange?.(id)}
              onPreview={onOpen}
              cover={coverFor?.(template)}
              note={noteFor?.(template)}
            />
          ))}
        </Grid>
      )}
    </PageStack>
  );
}
