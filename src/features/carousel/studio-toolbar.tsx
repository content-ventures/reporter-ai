'use client';

import type { ReactNode } from 'react';
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarMenu, ToolbarSeparator, ToolbarToggle } from '@content-ventures/design-system/v3';
import { CircleStop, GalleryHorizontal, Image as ImageIcon, LayoutTemplate, Sparkles } from '@content-ventures/design-system/v3/icons';
import type { TemplateId } from '@/domain';
import type { TemplateInfo } from '@/ports';
import type { StageView } from './slide-stage';

/**
 * Strip on top of the slide canvas: Slide | Sequência and the template (creative data from the
 * render service). On a desktop `end` closes it with the document's state (save state and
 * versions) and the generation control lives in the header; a narrow frame has no header room,
 * so "Gerar nova versão" (or "Parar" while running) stays here (`generate`).
 */
export function StudioToolbar({
  view,
  onView,
  templates,
  templateId,
  onTemplate,
  lockedReason,
  running,
  stopping,
  onStop,
  onRegenerate,
  regenerateReason,
  generate,
  end,
}: {
  view: StageView;
  onView: (view: StageView) => void;
  templates: readonly TemplateInfo[];
  templateId: TemplateId | undefined;
  onTemplate: (id: TemplateId) => void;
  lockedReason?: string;
  running: boolean;
  stopping: boolean;
  onStop: () => void;
  onRegenerate: () => void;
  regenerateReason?: string;
  /** Show the generation control in the strip (narrow frames). */
  generate: boolean;
  end?: ReactNode;
}) {
  const current = templates.find((template) => template.id === templateId);
  return (
    <Toolbar label="Carrossel" overflow="menu" keepFocus={false} end={end}>
      <ToolbarGroup label="Visualização">
        <ToolbarToggle label="Slide" icon={ImageIcon} showLabel keep pressed={view === 'slide'} onPressedChange={() => onView('slide')} />
        <ToolbarToggle label="Sequência" icon={GalleryHorizontal} showLabel keep pressed={view === 'sequence'} onPressedChange={() => onView('sequence')} />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarMenu
        label="Modelo"
        icon={LayoutTemplate}
        value={current?.name ?? 'Modelo'}
        disabled={Boolean(lockedReason)}
        disabledReason={lockedReason}
        sections={[
          {
            label: 'Modelo do carrossel',
            items: templates.map((template) => ({
              label: template.name,
              description: template.description,
              checked: template.id === templateId,
              onSelect: () => onTemplate(template.id),
            })),
          },
        ]}
      />
      {generate ? <ToolbarSeparator /> : null}
      {!generate ? null : running ? (
        <ToolbarButton label="Parar" icon={CircleStop} showLabel keep loading={stopping} onClick={onStop} />
      ) : (
        <ToolbarButton
          label="Gerar nova versão"
          icon={Sparkles}
          showLabel
          keep
          disabled={Boolean(regenerateReason)}
          disabledReason={regenerateReason}
          onClick={onRegenerate}
        />
      )}
    </Toolbar>
  );
}
