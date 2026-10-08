'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptComposerHandle, WorkspaceState, WorkspaceView } from '@content-ventures/design-system/v3';
import type { PanelTab, StudioDialog } from './studio-types';

/**
 * What the studio shows around the text (D2, P5): ONE panel on the right ("Painel"), closed when
 * the studio opens and never remembered between visits, with its tab (Material · Assistente ·
 * Checagem · Comentários); on a narrow screen the panel is the second tab of the frame. Also the
 * one drawer or dialog open over the studio (history, structure, how the AI wrote, send…).
 */
export function useStudioPanes() {
  const [view, setView] = useState<WorkspaceView>('main');
  const showText = useCallback(() => setView('main'), []);
  const [panelTab, setPanelTab] = useState<PanelTab>('material');
  const [panelOpen, setPanelOpen] = useState(false);
  const workspace = useRef<WorkspaceState | null>(null);
  /** The frame is in tabs (≤1024 px): the panel is a tab, not a column. */
  const [narrow, setNarrow] = useState(false);
  const bindWorkspace = useCallback((state: WorkspaceState | null) => {
    workspace.current = state;
    setNarrow(state?.narrow ?? false);
  }, []);
  const composerRef = useRef<PromptComposerHandle | null>(null);
  const bindComposer = useCallback((handle: PromptComposerHandle | null) => {
    composerRef.current = handle;
  }, []);

  /** The panel on `tab`: opened on a desktop, brought on screen on a narrow one. */
  const showPanel = useCallback((tab: PanelTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
    if (workspace.current?.narrow) setView('end');
  }, []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setView('main');
  }, []);
  /** The toolbar's "Material" / "Assistente": opens the panel on that tab, or closes it when it already shows it. */
  const showing = narrow ? view === 'end' : panelOpen;
  const togglePanel = useCallback(
    (tab: PanelTab) => {
      if (showing && panelTab === tab) closePanel();
      else showPanel(tab);
    },
    [showing, panelTab, closePanel, showPanel],
  );
  /** The tab on screen, when the panel is (the toolbar marks its button as pressed). */
  const visibleTab: PanelTab | null = showing ? panelTab : null;

  const focusTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(focusTimer.current), []);
  const focusComposer = useCallback(() => {
    showPanel('assistant');
    window.clearTimeout(focusTimer.current);
    // The panel may be opening (narrow tabs, closed panel): focus once it is on screen.
    focusTimer.current = window.setTimeout(() => composerRef.current?.focus(), 60);
  }, [showPanel]);

  /** The Assistente is off screen (closed panel, another tab, narrow text view): what joins it gets a toast. */
  const assistantHidden = useCallback(() => !showing || panelTab !== 'assistant', [showing, panelTab]);

  // ——— The one dialog or drawer over the studio ———
  const [dialog, setDialog] = useState<StudioDialog | null>(null);
  const openDialog = useCallback((next: StudioDialog) => setDialog(next), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  return {
    view,
    setView,
    showText,
    panelTab,
    setPanelTab,
    panelOpen,
    setPanelOpen,
    visibleTab,
    narrow,
    bindWorkspace,
    bindComposer,
    showPanel,
    closePanel,
    togglePanel,
    focusComposer,
    assistantHidden,
    dialog,
    openDialog,
    closeDialog,
  };
}

export type StudioPanes = ReturnType<typeof useStudioPanes>;
