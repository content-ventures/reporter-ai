'use client';

import { useCallback,useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleBody, PieceId } from '@/domain';
import type { SaveState } from '@/ports';
import { useCommands, useSaveStatus } from '@/state';
import { isPermissionRefusal } from '@/ui/permission-dialog';
import { draftSnapshotHash } from './studio-model';

/**
 * Autosave of the studio draft slot (PLAN §3.5 "Versões"): the editor's debounced body goes to
 * `saveDraft` one write at a time, always against the last revision the store acknowledged; a
 * stale revision is a conflict, never a silent overwrite. The save status is the store's honest
 * one ("Salvo neste navegador", quota error + "Tentar de novo"), plus this tab's pending write.
 */

export type DraftSyncStatus = {
  status: 'saved' | 'saving' | 'error';
  /** "Salvo neste navegador" · "Salvo nesta aba" · "Não foi possível salvar". */
  label: string;
  savedAt?: string;
  error?: string;
  /** The store refused a stale revision (another tab saved first). */
  conflict: boolean;
};

export type DraftSync = {
  /** Queues the body (the latest queued body wins). */
  save: (body: ArticleBody) => Promise<void>;
  /** Resolves when every queued write has been answered. */
  idle: () => Promise<void>;
  settle:()=>Promise<boolean>;
  /** A write is queued or in flight. */
  busy: () => boolean;
  /** Last revision the store acknowledged for this tab's writes. */
  base: () => number;
  /** Body the store holds as far as this tab knows, including review and evidence. */
  syncedBody: () => ArticleBody;
  /** Takes the store's revision as the new base (external change already on screen). */
  adopt: (revision: number, body?: ArticleBody) => void;
  status: DraftSyncStatus;
  retry: () => void;
  clearConflict: () => void;
};

function scopeLabel(state: SaveState): string {
  if (state.scope === 'memory') return 'Salvo nesta aba';
  if (state.scope === 'remote') return 'Salvo';
  return 'Salvo neste navegador';
}

export function useDraftSync(pieceId: PieceId, initial: { revision: number; body: ArticleBody }): DraftSync {
  const commands = useCommands();
  const port = useSaveStatus();
  const base = useRef(initial.revision);
  const synced = useRef(initial.body);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef<ArticleBody | null>(null);
  const requested=useRef(initial.body);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [lastOwnSave, setLastOwnSave] = useState<string | undefined>(undefined);
  const savedSnapshot = useRef(draftSnapshotHash(initial.body));

  const syncedBody = useCallback(() => synced.current, []);

  const save = useCallback(
    (body: ArticleBody) => {
      requested.current=body;
      queued.current = body;
      setPending(true);
      queue.current = queue.current.then(async () => {
        const next = queued.current;
        if (!next) return;
        queued.current = null;
        const snapshotHash = draftSnapshotHash(next);
        if (snapshotHash !== savedSnapshot.current) {
          writing.current = true;
          try {
            const result = await commands.production.saveDraft(pieceId, next, base.current);
            if (result.ok) {
              base.current = result.value.revision;
              synced.current = next;
              savedSnapshot.current = snapshotHash;
              setRefused(null);
              setLastOwnSave(result.value.updatedAt);
            } else if (result.refusal.code === 'conflict') {
              setConflict(true);
            } else if (!isPermissionRefusal(result.refusal)) {
              // An autosave never reports a permission limit (no popup, no red text).
              setRefused(result.refusal.message);
            }
          } catch {
            setRefused('Não foi possível salvar o rascunho.');
          } finally {
            writing.current = false;
          }
        }
        if (!queued.current) setPending(false);
      });
      return queue.current;
    },
    [commands, pieceId],
  );

  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(writing.current||queued.current||savedSnapshot.current!==draftSnapshotHash(requested.current))event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
  const settle=useCallback(async()=>{let pending;do{pending=queue.current;await pending;}while(pending!==queue.current);return savedSnapshot.current===draftSnapshotHash(requested.current);},[]);
  const idle = useCallback(() => queue.current, []);
  const busy = useCallback(() => writing.current || queued.current !== null, []);
  const getBase = useCallback(() => base.current, []);
  const adopt = useCallback((revision: number, body?: ArticleBody) => {
    base.current = revision;
    if (body) {
      synced.current = body;
      requested.current=body;
      savedSnapshot.current = draftSnapshotHash(body);
    }
  }, []);
  const retry = useCallback(() => {
    setRefused(null);
    void commands.save.retry();
  }, [commands]);
  const clearConflict = useCallback(() => setConflict(false), []);

  const status = useMemo<DraftSyncStatus>(() => {
    if (conflict) return { status: 'error', label: 'Texto alterado em outra aba', conflict: true };
    if (refused) return { status: 'error', label: 'Não foi possível salvar', error: refused, conflict: false };
    if (port.status === 'error') return { status: 'error', label: 'Não foi possível salvar', error: port.error?.message, conflict: false };
    if (pending || port.status === 'saving') return { status: 'saving', label: 'Salvando…', conflict: false };
    const savedAt = port.savedAt ?? lastOwnSave;
    return { status: 'saved', label: scopeLabel(port), ...(savedAt ? { savedAt } : {}), conflict: false };
  }, [conflict, refused, port, pending, lastOwnSave]);

  return useMemo(
    () => ({ save, idle, settle,busy, base: getBase, syncedBody, adopt, status, retry, clearConflict }),
    [save, idle, settle,busy, getBase, syncedBody, adopt, status, retry, clearConflict],
  );
}
