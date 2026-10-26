'use client';
import {useBrowserPreference} from '@/state/browser-preference';
import {useWorkspaceStorageKey} from '@/state/workspace-storage';
/** An account's last model is a hint; the owned catalog still validates every choice. */
function useTemplatePreference(){return useBrowserPreference(useWorkspaceStorageKey('reporter:ui:last-template'));}
export function useLastTemplate(){return useTemplatePreference()[0];}
export function useRememberTemplate(){return useTemplatePreference()[1];}
