'use client';

import { useEffect, useState } from 'react';
import { useWorkspace, WorkspaceLayout } from '@content-ventures/design-system/v3';
import { StatusBadge } from '@/ui/status-badge';
import { PanelPane, PanelTabs } from './copilot-pane';
import { EditorCanvas } from './editor-canvas';
import { EditorToolbar } from './editor-toolbar';
import { FloatingBars, LinkDialog } from './floating-bars';
import { ImagePicker } from './image-picker';
import { StudioContext, useStudio } from './studio-context';
import { StudioDialogs } from './studio-dialogs';
import { StudioFooter } from './studio-footer';
import { StudioHeader, StudioPrimaryBar } from './studio-header';
import type { StudioBadge } from './studio-session-model';
import { useArticleStudio, type StudioInputs } from './use-article-studio';

/**
 * The article studio frame (CONTRACT §3.8): DS `WorkspaceLayout docked` with the production header
 * on one line (and the one task notice under it), the text in the middle with its toolbar above and
 * the two-item footer below, and ONE panel on the right ("Painel": Material · Assistente ·
 * Checagem · Comentários), closed when the studio opens. At 1024 px or less the panel is the second
 * tab of the frame ("Painel") without unmounting the editor, the footer moves into the bottom bar
 * with the primary.
 */
export function ArticleWorkspace(inputs: StudioInputs) {
  const studio = useArticleStudio(inputs);
  const { panes } = studio;
  const [linking, setLinking] = useState(false);
  const tab = panes.panelTab;
  // The interview and the conversation own their scroll (and touch the pane's edges).
  const owned = tab === 'material' || tab === 'assistant' || (tab === 'comments' && Boolean(studio.reviewNote));

  return (
    <StudioContext value={studio}>
      <WorkspaceLayout
        docked
        header={(narrow) => <StudioHeader withPrimary={!narrow} />}
        // Narrow (tabs, phone): the header has no room for the primary — the bottom bar holds it
        // with the footer's short facts ("1,5 de 2 laudas · Falta 5").
        footer={(narrow) => (narrow ? <StudioPrimaryBar detail={<StudioFooter narrow />} /> : null)}
        mainLabel="Texto"
        mainFlush
        mainHeader={<EditorToolbar onLink={() => setLinking(true)} />}
        mainFooter={<MainFooter />}
        end={{
          label: 'Painel',
          defaultSize: 360,
          min: 300,
          max: 520,
          collapsed: !panes.panelOpen,
          onCollapsedChange: (collapsed) => panes.setPanelOpen(!collapsed),
          header: <PanelTabs />,
          content: <PanelPane />,
          scroll: !owned,
          flush: owned,
        }}
        view={panes.view}
        onViewChange={panes.setView}
      >
        <WorkspaceBridge />
        <EditorCanvas />
        <FloatingBars onLink={() => setLinking(true)} />
      </WorkspaceLayout>
      <StudioDialogs />
      <LinkDialog open={linking} onClose={() => setLinking(false)} />
      <ImagePicker
        request={studio.images.picker}
        productionId={studio.production.id}
        onClose={studio.images.closePicker}
        onDone={(request, picked) => void studio.images.applyPicked(request, picked)}
        inUse={studio.images.inUse}
      />
    </StudioContext>
  );
}

/** Under the text: the footer on a desktop; on a phone it moves into the bottom bar. */
function MainFooter() {
  const narrow = useWorkspace()?.narrow ?? false;
  return narrow ? null : <StudioFooter />;
}

/** Lets studio actions open the panel (the layout state lives inside the frame). */
function WorkspaceBridge() {
  const workspace = useWorkspace();
  const { panes } = useStudio();
  const { bindWorkspace } = panes;
  useEffect(() => bindWorkspace(workspace));
  return null;
}

/** The studio header's badge (`studioBadge`): the article's status, or why nothing can start. */
export function StudioStatusBadge({ badge }: { badge: StudioBadge }) {
  return badge.kind === 'production' ? (
    <StatusBadge kind="production" status={badge.status} label={badge.label} />
  ) : (
    <StatusBadge kind="piece" status={badge.status} label={badge.label} />
  );
}
