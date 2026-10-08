'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { TabState } from '../runtime/runtime.ts';
import { useRuntime } from './use-runtime.ts';

/**
 * A10: this tab and the other tabs of the browser on the same saved workspace. While `elsewhere`,
 * every write is refused (`read_only`) and the shell shows "Aberta em outra aba" with
 * "Usar esta aba", which reloads what the other tab saved and lets this tab edit again.
 */

const ACTIVE: TabState = Object.freeze({ status: 'active' });
const noop = () => undefined;

export type TabSyncState = {
  state: TabState;
  /** True while another tab owns the workspace: show the notice, keep this tab read-only. */
  readOnly: boolean;
  claim(): void;
};

export function useTabSync(): TabSyncState {
  const { runtime } = useRuntime();
  const tabs = runtime?.tabs;
  const subscribe = useCallback((onChange: () => void) => (tabs ? tabs.subscribe(onChange) : noop), [tabs]);
  const getSnapshot = useCallback(() => (tabs ? tabs.current() : ACTIVE), [tabs]);
  const state = useSyncExternalStore(subscribe, getSnapshot, () => ACTIVE);
  const claim = useCallback(() => tabs?.claim(), [tabs]);
  return { state, readOnly: state.status === 'elsewhere', claim };
}
