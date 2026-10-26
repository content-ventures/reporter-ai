import { clearStored, emptyDeskState, initialState, migrate, readStored, STORAGE_KEY, writeStored } from './hard-news-state.ts';
import type { HardNewsState } from './hard-news-state.ts';

/**
 * The desk's records outside React (read with `useSyncExternalStore`): the server and the first
 * paint render the placeholder, `load()` reads this browser after hydration, and every change is
 * written back. Nothing reads `window` during render.
 */

export type DeskSnapshot = { state: HardNewsState; ready: boolean };

export type DeskStore = {
  get(): DeskSnapshot;
  server(): DeskSnapshot;
  subscribe(listener: () => void): () => void;
  /** Reads this browser once; `?reset=1` (read before the runtime removes it) starts over. */
  load(): void;
  set(recipe: (current: HardNewsState) => HardNewsState): void;
  /** Back to the example ("Restaurar exemplo"). */
  reset(): void;
};

export function createDeskStore(options:{storageKey?:string;example?:boolean} = {storageKey:STORAGE_KEY,example:true}): DeskStore {
  const {storageKey,example=false}=options;
  const initial=(now?:number)=>example?initialState(now):emptyDeskState();
  const read=()=>storageKey?readStored(storageKey):undefined;
  const write=(state:HardNewsState)=>{if(storageKey)writeStored(state,storageKey);};
  const clear=()=>{if(storageKey)clearStored(storageKey);};
  const placeholder: DeskSnapshot = { state: initial(0), ready: false };
  let snapshot = placeholder;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  // Another tab of this browser changed the desk: adopt its records (never written back).
  const adopt = (event: StorageEvent) => {
    if (event.key !== storageKey || !snapshot.ready) return;
    const stored = read();
    if (!stored) return;
    snapshot = { state: stored, ready: true };
    emit();
  };

  return {
    get: () => snapshot,
    server: () => placeholder,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener('storage', adopt);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', adopt);
      };
    },
    load() {
      if (snapshot.ready) return;
      const reset = new URL(window.location.href).searchParams.get('reset') === '1';
      if (reset) clear();
      const now = Date.now();
      const stored = reset ? undefined : read();
      snapshot = { state: stored ? example?migrate(stored,now):stored : initial(now), ready: true };
      write(snapshot.state);
      emit();
    },
    set(recipe) {
      const changed = recipe(snapshot.state);
      if (changed === snapshot.state) return;
      // Every write moves the radar's anchor: the next visit counts the time away from here.
      const next = changed.radar ? { ...changed, radar: { ...changed.radar, anchoredAt: new Date().toISOString() } } : changed;
      snapshot = { ...snapshot, state: next };
      if (snapshot.ready) write(next);
      emit();
    },
    reset() {
      clear();
      snapshot = { state: initial(), ready: true };
      emit();
    },
  };
}
