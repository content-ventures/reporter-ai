'use client';

import { useEffect, useState } from 'react';
import { useWorkspace, WorkspaceLayout } from '@content-ventures/design-system/v3';
import { ProductionHeader } from '@/features/production/production-frame';
import { StatusBadge } from '@/ui/status-badge';
import { CopilotPane, CopilotTabs } from './copilot-pane';
import { EditorCanvas } from './editor-canvas';
import { EditorToolbar } from './editor-toolbar';
import { FloatingBars, LinkDialog } from './floating-bars';
import { ImagePicker } from './image-picker';
import { SourcePane, SourceTabs } from './source-pane';
import { StatusLine } from './status-line';
import { StudioContext, useStudio } from './studio-context';
import { StudioFooter, StudioHeaderActions } from './studio-footer';
import { useArticleStudio, type StudioInputs } from './use-article-studio';
import type { StudioBadge } from './studio-session-model';

/** Pane sizes are kept per browser; v2 since the panes got narrower defaults. */
export const STUDIO_STORAGE_KEY = 'reporter:studio:article:v2';

/** Below this window width the Fonte pane starts collapsed, so the text keeps ≈68 characters. */
const ROOMY_WIDTH = 1360;

/**
 * The article studio frame (PLAN §3.5): DS `WorkspaceLayout docked` with the production header
 * on one line, "Fonte" (280, collapsible; collapsed on narrower desktops) · "Texto" · "Copiloto"
 * (340, collapsible). The shell menu is a rail here, so the text is the widest region. At
 * 1024 px or less it turns into tabs Fonte · Texto · Copiloto without unmounting the editor;
 * focus mode collapses both panes and Esc leaves it.
 */
export function ArticleWorkspace(inputs: StudioInputs) {
  const studio = useArticleStudio(inputs);
  const [linking, setLinking] = useState(false);
  // Rendered only on the client (the studio waits for the runtime), so the window is known here.
  const [roomy] = useState(() => typeof window === 'undefined' || window.innerWidth >= ROOMY_WIDTH);
  const transcript = studio.sourceTab === 'transcript';
  const conversation = studio.copilotTab === 'ai';

  return (
    <StudioContext value={studio}>
      <WorkspaceLayout
        docked
        storageKey={STUDIO_STORAGE_KEY}
        header={(narrow) => (
          <ProductionHeader
            // The article's own status ("Aprovado · v2"), not the production's (which follows the carousel).
            status={<StudioStatusBadge badge={studio.articleStatus} />}
            actions={narrow ? undefined : <StudioHeaderActions />}
          />
        )}
        // Desktop: actions in the header line, save state and version in the status line, so the
        // text keeps the height. Narrow (tabs, phone): the header has no room — the footer returns.
        footer={(narrow) => (narrow ? <StudioFooter /> : null)}
        mainLabel="Texto"
        mainFlush
        mainHeader={<EditorToolbar onLink={() => setLinking(true)} />}
        mainFooter={<StatusLine />}
        start={{
          label: 'Fonte',
          defaultSize: 280,
          defaultCollapsed: !roomy,
          min: 240,
          max: 480,
          header: <SourceTabs />,
          content: <SourcePane />,
          scroll: !transcript,
          flush: transcript,
        }}
        end={{
          label: 'Copiloto',
          defaultSize: 340,
          min: 300,
          max: 520,
          header: <CopilotTabs />,
          content: <CopilotPane />,
          scroll: !conversation,
          flush: conversation,
        }}
        view={studio.view}
        onViewChange={studio.setView}
        focus={studio.focusMode.focus}
        onFocusChange={studio.focusMode.setFocus}
      >
        <WorkspaceBridge />
        <EditorCanvas />
        <FloatingBars onLink={() => setLinking(true)} />
      </WorkspaceLayout>
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

/** Lets studio actions open a collapsed pane (the layout state lives inside the frame). */
function WorkspaceBridge() {
  const workspace = useWorkspace();
  const { bindWorkspace } = useStudio();
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
