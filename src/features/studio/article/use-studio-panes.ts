'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptComposerHandle, WorkspaceState, WorkspaceView } from '@content-ventures/design-system/v3';
import type { CopilotTab, SourceTab } from './studio-types';

/**
 * The three regions of the studio (Fonte, Texto, Copiloto): the region on screen on a narrow
 * screen, the tab of each side pane, the workspace and composer handles bound by the screens, and
 * the moves that bring a pane (or the composer) into view, reopening a collapsed rail.
 */
export function useStudioPanes() {
  const [view, setView] = useState<WorkspaceView>('main');
  const showText = useCallback(() => setView('main'), []);
  const [sourceTab, setSourceTab] = useState<SourceTab>('transcript');
  const [copilotTab, setCopilotTab] = useState<CopilotTab>('ai');
  const workspace = useRef<WorkspaceState | null>(null);
  const bindWorkspace = useCallback((state: WorkspaceState | null) => {
    workspace.current = state;
  }, []);
  const composerRef = useRef<PromptComposerHandle | null>(null);
  const bindComposer = useCallback((handle: PromptComposerHandle | null) => {
    composerRef.current = handle;
  }, []);

  const showCopilot = useCallback((tab: CopilotTab = 'ai') => {
    setCopilotTab(tab);
    setView('end');
    const current = workspace.current;
    if (current && !current.narrow && current.panes.end?.collapsed) current.setCollapsed('end', false);
  }, []);
  const showSource = useCallback((tab: SourceTab) => {
    setSourceTab(tab);
    setView('start');
    const current = workspace.current;
    if (current && !current.narrow && current.panes.start?.collapsed) current.setCollapsed('start', false);
  }, []);
  const focusTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(focusTimer.current), []);
  const focusComposer = useCallback(() => {
    showCopilot('ai');
    window.clearTimeout(focusTimer.current);
    // The pane may be opening (narrow tabs, collapsed rail): focus once it is on screen.
    focusTimer.current = window.setTimeout(() => composerRef.current?.focus(), 60);
  }, [showCopilot]);

  /** "Alternar painéis": both side panes close when one is open, else both open. */
  const togglePanels = useCallback(() => {
    const current = workspace.current;
    if (!current) return;
    const open = !current.panes.start?.collapsed || !current.panes.end?.collapsed;
    current.setCollapsed('start', open);
    current.setCollapsed('end', open);
  }, []);

  /** The Copiloto is off screen (narrow tabs or collapsed rail): what joins the composer gets a toast. */
  const copilotHidden = useCallback(() => Boolean(workspace.current?.narrow || workspace.current?.panes.end?.collapsed), []);

  return {
    view,
    setView,
    showText,
    sourceTab,
    setSourceTab,
    copilotTab,
    setCopilotTab,
    bindWorkspace,
    bindComposer,
    showCopilot,
    showSource,
    focusComposer,
    togglePanels,
    copilotHidden,
  };
}

export type StudioPanes = ReturnType<typeof useStudioPanes>;
