'use client';

import type { ReactNode } from 'react';
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator, ToolbarToggle } from '@content-ventures/design-system/v3';
import { CircleStop, GalleryHorizontal, Image as ImageIcon, LayoutTemplate, Sparkles } from '@content-ventures/design-system/v3/icons';
import type { StageView } from './slide-stage';

/**
 * Strip on top of the slide canvas: Slide | Sequência and "Trocar modelo", which opens the model
 * library (the switch keeps the texts and says what no longer fits before applying). On a desktop
 * `end` closes it with the document's state (save state and versions) and the generation control
 * lives in the header; a narrow frame has no header room, so "Gerar nova versão" (or "Parar"
 * while running) stays here (`generate`).
 */
export function StudioToolbar({
  view,
  onView,
  onTemplates,
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
  /** "Trocar modelo": opens the library. */
  onTemplates: () => void;
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
  return (
    <Toolbar label="Carrossel" overflow="menu" keepFocus={false} end={end}>
      <ToolbarGroup label="Visualização">
        <ToolbarToggle label="Slide" icon={ImageIcon} showLabel keep pressed={view === 'slide'} onPressedChange={() => onView('slide')} />
        <ToolbarToggle label="Sequência" icon={GalleryHorizontal} showLabel keep pressed={view === 'sequence'} onPressedChange={() => onView('sequence')} />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarButton
        label="Trocar modelo"
        icon={LayoutTemplate}
        showLabel
        keep
        disabled={Boolean(lockedReason)}
        disabledReason={lockedReason}
        onClick={onTemplates}
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
