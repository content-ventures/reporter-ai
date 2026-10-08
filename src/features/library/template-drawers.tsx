'use client';

import { useState, type ReactNode } from 'react';
import { Button, Drawer, List, ListItem, Section } from '@content-ventures/design-system/v3';
import type { AssetId, CarouselBody, TemplateId } from '@/domain';
import type { TemplateInfo, TemplateSwitchResult } from '@/ports';
import { usePhone } from '@/ui/use-phone';
import { libraryFilter, switchLines, switchSummary, type LibraryFilter } from './library-model';
import { TemplateBrowser } from './template-browser';
import type { TemplateCover } from './template-card';
import { TemplateDetail, TemplateFacts } from './template-detail';

/**
 * The library's drawers. `TemplateDrawer` shows one model ("Ver modelo"): "Usar como padrão" on the
 * "Modelos" page, "Usar este modelo" where a carousel is being started. `TemplatePickerDrawer` is
 * "Trocar modelo" in the studio: the library as a radio group, on the carousel's own format, and,
 * on "Ver modelo", this carousel's slides drawn in that model in a drawer over it (closing it
 * returns to the list where it was), each saying what the switch changes (approximate fit) before
 * anything is applied.
 */

export function TemplateDrawer({
  open,
  onClose,
  template,
  articleCover,
  body,
  own,
  footer,
  footerStart,
  children,
}: {
  open: boolean;
  onClose: () => void;
  template: TemplateInfo | undefined;
  articleCover?: AssetId;
  /** Slides to draw instead of the sample copy. */
  body?: CarouselBody;
  /** `body` is the carousel being edited (this carousel in that model). */
  own?: boolean;
  /** The action where a model can be used ("Usar este modelo"); none on the library page. */
  footer?: ReactNode;
  footerStart?: ReactNode;
  /** Sections after the layouts (what a switch changes in the carousel being edited). */
  children?: ReactNode;
}) {
  return (
    <Drawer
      open={open && Boolean(template)}
      onClose={onClose}
      size="lg"
      title={template?.name ?? 'Modelo'}
      description={template ? <TemplateFacts template={template} /> : undefined}
      closeLabel="Fechar modelo"
      footer={footer}
      footerStart={footerStart}
    >
      {template ? (
        <TemplateDetail template={template} articleCover={articleCover} body={body} own={own}>
          {children}
        </TemplateDetail>
      ) : null}
    </Drawer>
  );
}

export type TemplatePickerDrawerProps = {
  open: boolean;
  onClose: () => void;
  templates: readonly TemplateInfo[];
  /** The carousel's model. */
  current: TemplateId | undefined;
  /** The carousel's cover (image and texts), drawn on every card. */
  cover?: TemplateCover;
  /** The carousel moved to a model, measured: what moves, joins, is left out or does not fit. */
  check: (templateId: TemplateId) => TemplateSwitchResult | undefined;
  onApply: (templateId: TemplateId) => void | Promise<void>;
};

const IN_USE = 'Em uso neste carrossel';

export function TemplatePickerDrawer({ open, onClose, templates, current, cover, check, onApply }: TemplatePickerDrawerProps) {
  const phone = usePhone();
  const [opened, setOpened] = useState(false);
  const [candidate, setCandidate] = useState<TemplateId | undefined>(current);
  const [detail, setDetail] = useState<TemplateId | null>(null);
  const formatOf = (templateId: TemplateId | undefined) => templates.find((template) => template.id === templateId)?.format;
  const [filter, setFilter] = useState<LibraryFilter>(() => libraryFilter(formatOf(current)));
  const [applying, setApplying] = useState(false);
  // Each opening starts on the carousel's own model, in the list of its format.
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setCandidate(current);
      setDetail(null);
      setFilter(libraryFilter(formatOf(current)));
    }
  }

  const summaryOf = (templateId: TemplateId | undefined) => {
    if (!templateId || templateId === current) return undefined;
    const switched = check(templateId);
    return switched ? { summary: switchSummary(switched.issues), lines: switchLines(switched.issues) } : undefined;
  };
  const chosen = summaryOf(candidate);
  const viewing = detail ? templates.find((template) => template.id === detail) : undefined;
  const viewed = viewing ? summaryOf(viewing.id) : undefined;
  // "Ver modelo" draws this carousel's own slides in that model (its own model included).
  const viewedBody = viewing ? check(viewing.id)?.body : undefined;

  const apply = async (templateId: TemplateId | undefined) => {
    if (!templateId || templateId === current) return;
    setApplying(true);
    await onApply(templateId);
    setApplying(false);
  };
  const actions = (templateId: TemplateId | undefined, back: { label: string; onClick: () => void }) =>
    templateId && templateId !== current ? (
      <>
        <Button onClick={back.onClick}>{back.label}</Button>
        <Button variant="primary" loading={applying} onClick={() => void apply(templateId)}>
          Usar este modelo
        </Button>
      </>
    ) : (
      <Button onClick={back.onClick}>{back.label}</Button>
    );

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="lg"
        title="Trocar modelo"
        closeLabel="Fechar modelos"
        footerStart={candidate === current ? IN_USE : chosen?.summary.text}
        footer={actions(candidate, { label: candidate === current ? 'Fechar' : 'Cancelar', onClick: onClose })}
      >
        <TemplateBrowser
          templates={templates}
          filter={filter}
          onFilterChange={(patch) => setFilter((value) => ({ ...value, ...patch }))}
          label="Modelos de carrossel"
          mode="pick"
          value={candidate}
          onChange={setCandidate}
          onOpen={setDetail}
          coverFor={() => cover}
          noteFor={(template) => (template.id === current ? 'Em uso' : undefined)}
          compact
          searchable={!phone}
          min={phone ? 148 : 164}
        />
      </Drawer>
      <TemplateDrawer
        open={open && viewing !== undefined}
        onClose={() => setDetail(null)}
        template={viewing}
        articleCover={cover?.articleCover}
        body={viewedBody}
        own
        footerStart={viewing?.id === current ? IN_USE : viewed?.summary.text}
        footer={actions(viewing?.id, { label: 'Voltar', onClick: () => setDetail(null) })}
      >
        {viewing && viewed && viewed.lines.length > 0 ? (
          <Section title="Neste carrossel" titleAs="h3">
            <List label={`O que muda no modelo ${viewing.name}`} framed={false} bleed>
              {viewed.lines.map((line, index) => (
                <ListItem key={`${index}-${line}`} density="sm" title={line} titleLines={2} />
              ))}
            </List>
          </Section>
        ) : null}
      </TemplateDrawer>
    </>
  );
}
