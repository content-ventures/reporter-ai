'use client';

import {
  createContext,
  use,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CommandGroup } from '@content-ventures/design-system/v3';

/**
 * ⌘K is the single place for every command, each with its shortcut shown (it replaces a
 * shortcuts sheet). The shell adds the global groups (Ações, Ir para, Produções, Simulação);
 * a screen adds its own while mounted with `useCommandGroup` — e.g. the article studio's
 * "Salvar versão ⌘S", "Próxima citação não conferida", "Alternar painéis", "Modo foco".
 */

type RegistryApi = {
  set(id: string, group: CommandGroup): void;
  remove(id: string): void;
  openPalette(): void;
};

const ApiContext = createContext<RegistryApi | null>(null);
const GroupsContext = createContext<CommandGroup[]>([]);

export function CommandRegistryProvider({ children, onOpenPalette }: { children: ReactNode; onOpenPalette: () => void }) {
  const [groups, setGroups] = useState<ReadonlyMap<string, CommandGroup>>(() => new Map());
  const openRef = useRef(onOpenPalette);
  useLayoutEffect(() => {
    openRef.current = onOpenPalette;
  });
  const set = useCallback((id: string, group: CommandGroup) => setGroups((previous) => new Map(previous).set(id, group)), []);
  const remove = useCallback((id: string) => {
    setGroups((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }, []);
  const openPalette = useCallback(() => openRef.current(), []);
  const api = useMemo(() => ({ set, remove, openPalette }), [set, remove, openPalette]);
  const list = useMemo(() => [...groups.values()], [groups]);
  return (
    <ApiContext value={api}>
      <GroupsContext value={list}>{children}</GroupsContext>
    </ApiContext>
  );
}

const groupKey = (group: CommandGroup) =>
  [group.label, String(group.showWhenEmpty ?? ''), ...group.items.map((item) => [item.id, item.label, item.description ?? '', item.hint ?? '', item.keywords ?? ''].join('\u0000'))].join('\u0001');

/**
 * Adds a group of commands to ⌘K while the calling screen is mounted. `onSelect` handlers may
 * change between renders (the palette always calls the latest); the group re-registers only
 * when what it shows changes. `null` registers nothing.
 */
export function useCommandGroup(group: CommandGroup | null): void {
  const api = use(ApiContext);
  const id = useId();
  const latest = useRef(group);
  useLayoutEffect(() => {
    latest.current = group;
  });
  const key = group ? groupKey(group) : null;
  useLayoutEffect(() => {
    const current = latest.current;
    if (!api || key === null || !current) return undefined;
    api.set(id, {
      ...current,
      items: current.items.map((item) => ({
        ...item,
        onSelect: () => latest.current?.items.find((candidate) => candidate.id === item.id)?.onSelect?.(),
      })),
    });
    return () => api.remove(id);
  }, [api, id, key]);
}

/** Groups registered by the mounted screens (the shell palette shows them first). */
export function useRegisteredCommandGroups(): CommandGroup[] {
  return use(GroupsContext);
}

/** Opens ⌘K from a button or a status-line jump. */
export function useCommandPalette(): { open: () => void } {
  const api = use(ApiContext);
  return useMemo(() => ({ open: () => api?.openPalette() }), [api]);
}
