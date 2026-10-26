'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {useWorkspaceStorageKey} from '@/state/workspace-storage';
import {useRuntime} from '@/state';
import { rebase } from './integrations-model';
import type { ActivityEntry, AppId, AppRecord, IntegrationsState, WebhookDelivery, WebhookEndpoint } from './integrations-model';
import { seedIntegrations } from './integrations-seed';

/**
 * The connections of the R2 preview outside React (read with `useSyncExternalStore`), in this
 * browser only: the server and the first paint render the placeholder, `load()` reads the browser
 * after hydration and every change is written back. WordPress stays in the desk (`state.cms`),
 * because the Entrega sends through it; the RSS feeds stay there too.
 */

export const INTEGRATIONS_KEY = 'reporter.r2-integrations.v1';

type Snapshot = { state: IntegrationsState; ready: boolean };

export type IntegrationsActions = {
  updateApp(id: AppId, patch: Partial<AppRecord>): void;
  /** Ends the connect flow: the app is on, with who connected it and when. */
  connectApp(id: AppId, patch: Partial<AppRecord>, by: string): void;
  disconnectApp(id: AppId): void;
  log(entry: Omit<ActivityEntry, 'id' | 'at'>): void;
  addEndpoint(endpoint: Omit<WebhookEndpoint, 'id' | 'createdAt' | 'state'>): string;
  updateEndpoint(id: string, patch: Partial<WebhookEndpoint>): void;
  removeEndpoint(id: string): void;
  /** Records a delivery; without `ms`, the preview draws a plausible answer time. */
  deliver(delivery: Omit<WebhookDelivery, 'id' | 'at' | 'ms'> & { ms?: number }): void;
  mapCategory(topicId: string, categoryId: string): void;
};

function createIntegrationsStore(key:string|undefined,example:boolean){
  const initial=(now:number):IntegrationsState=>example?seedIntegrations(now):{version:1,savedAt:new Date(now).toISOString(),apps:{},endpoints:[],deliveries:[],activity:[],categoryMap:{}};
function read(): IntegrationsState | undefined {
  try {
    const raw = window.localStorage.getItem(key??'');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as IntegrationsState;
    return parsed?.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function write(state: IntegrationsState) {
  if(!key)return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* private window or full storage: the preview keeps working in memory */
  }
}

const placeholder: Snapshot = { state: initial(0), ready: false };
let snapshot = placeholder;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of [...listeners]) listener();
};
// Another tab of this browser changed the connections: adopt them (never written back).
const adopt = (event: StorageEvent) => {
  if (event.key !== key || !snapshot.ready) return;
  const stored = read();
  if (!stored) return;
  snapshot = { state: stored, ready: true };
  emit();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', adopt);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', adopt);
  };
}

function load() {
  if (snapshot.ready) return;
  const now = Date.now();
  const reset = new URL(window.location.href).searchParams.get('reset') === '1';
  const stored = reset ? undefined : read();
  snapshot = { state: stored ? example?rebase(stored,now):stored : initial(now), ready: true };
  write(snapshot.state);
  emit();
}

function set(recipe: (current: IntegrationsState) => IntegrationsState) {
  const changed = recipe(snapshot.state);
  if (changed === snapshot.state) return;
  snapshot = { ...snapshot, state: { ...changed, savedAt: new Date().toISOString() } };
  if (snapshot.ready) write(snapshot.state);
  emit();
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(sequence += 1).toString(36)}`;

const actions: IntegrationsActions = {
  updateApp(id, patch) {
    set((current) => ({ ...current, apps: { ...current.apps, [id]: { state: 'disconnected', ...current.apps[id], ...patch } } }));
  },
  connectApp(id, patch, by) {
    const at = new Date().toISOString();
    set((current) => ({
      ...current,
      apps: { ...current.apps, [id]: { ...current.apps[id], ...patch, state: 'connected', connectedAt: at, connectedBy: by, checkedAt: at, setup: undefined, error: undefined } },
    }));
  },
  disconnectApp(id) {
    set((current) => {
      const record = current.apps[id];
      if (!record) return current;
      return { ...current, apps: { ...current.apps, [id]: { ...record, state: 'disconnected', account: undefined, connectedAt: undefined, connectedBy: undefined, setup: undefined } } };
    });
  },
  log(entry) {
    set((current) => ({ ...current, activity: [{ ...entry, id: nextId('a'), at: new Date().toISOString() }, ...current.activity].slice(0, 80) }));
  },
  addEndpoint(endpoint) {
    const id = nextId('wh');
    set((current) => ({ ...current, endpoints: [...current.endpoints, { ...endpoint, id, state: 'active', createdAt: new Date().toISOString() }] }));
    return id;
  },
  updateEndpoint(id, patch) {
    set((current) => ({ ...current, endpoints: current.endpoints.map((endpoint) => (endpoint.id === id ? { ...endpoint, ...patch } : endpoint)) }));
  },
  removeEndpoint(id) {
    set((current) => ({
      ...current,
      endpoints: current.endpoints.filter((endpoint) => endpoint.id !== id),
      deliveries: current.deliveries.filter((delivery) => delivery.endpointId !== id),
    }));
  },
  deliver(delivery) {
    const ms = delivery.ms ?? 140 + Math.round(Math.random() * 120);
    set((current) => ({ ...current, deliveries: [{ ...delivery, ms, id: nextId('d'), at: new Date().toISOString() }, ...current.deliveries].slice(0, 200) }));
  },
  mapCategory(topicId, categoryId) {
    set((current) => ({ ...current, categoryMap: { ...current.categoryMap, [topicId]: categoryId } }));
  },
};

return{subscribe,get:()=>snapshot,server:()=>placeholder,load,actions};
}
/** Connections belong to the current account and client, including two independent tabs. */
export function useIntegrations(): {state:IntegrationsState;ready:boolean;actions:IntegrationsActions}{
  const key=useWorkspaceStorageKey(INTEGRATIONS_KEY),{runtime}=useRuntime(),example=runtime?.mode==='simulated';
  const store=useMemo(()=>createIntegrationsStore(key,example),[key,example]);
  const current=useSyncExternalStore(store.subscribe,store.get,store.server);
  useEffect(()=>{if(key)store.load();},[key,store]);
  return{...current,actions:store.actions};
}
