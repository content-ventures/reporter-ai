'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import type { CarouselBody, PieceId } from '@/domain';
import type { DraftView } from '@/ports';
import { useCommands } from '@/state';

/**
 * The carousel draft as the studio edits it: a local copy that answers every keystroke, written
 * to the single draft slot after a short pause (autosave, never a version). A newer draft from
 * elsewhere (a finished generation, an update) is adopted when nothing local is pending.
 */

type Local = { pieceId: PieceId; body: CarouselBody; revision: number; dirty: boolean };

export type CarouselDraft = {
  body: CarouselBody | undefined;
  /** Local edits not written yet. */
  pending: boolean;
  update: (change: (body: CarouselBody) => CarouselBody) => void;
  /** Writes pending edits now (before "Salvar versão" or "Enviar para aprovação"). */
  flush: () => Promise<boolean>;
};

const SAVE_DELAY_MS = 600;

export function useCarouselDraft(draft: DraftView | undefined): CarouselDraft {
  const commands = useCommands();
  const remote = draft && draft.body.type === 'carousel' ? { pieceId: draft.pieceId, body: draft.body, revision: draft.revision } : undefined;
  const [local, setLocal] = useState<Local | null>(null);
  const localRef = useRef(local);
  const remoteRevision = useRef(remote?.revision);
  const saving = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    localRef.current = local;
    remoteRevision.current = remote?.revision;
  });

  // Adopt the stored draft: first load, another piece, or a newer revision with nothing pending.
  if (remote && (!local || local.pieceId !== remote.pieceId || (!local.dirty && remote.revision > local.revision))) {
    setLocal({ ...remote, dirty: false });
  }

  const save = useCallback(async (): Promise<boolean> => {
    const snapshot = localRef.current;
    if (!snapshot || !snapshot.dirty) return true;
    let result = await commands.production.saveDraft(snapshot.pieceId, snapshot.body, snapshot.revision);
    if (!result.ok && result.refusal.code === 'conflict' && remoteRevision.current !== undefined) {
      // The slot moved (another tab, an applied suggestion): this screen's edits win — said out loud,
      // never silently (the newer draft stays in the version history once a version is saved).
      result = await commands.production.saveDraft(snapshot.pieceId, snapshot.body, remoteRevision.current);
      if (result.ok) toast('O rascunho mudou em outro lugar', { tone: 'info', description: 'As edições desta tela foram mantidas.' });
    }
    if (!result.ok) {
      toast('Não foi possível salvar o carrossel', { tone: 'error', description: result.refusal.message });
      return false;
    }
    const revision = result.value.revision;
    setLocal((current) =>
      current && current.pieceId === snapshot.pieceId ? { ...current, revision, dirty: current.body !== snapshot.body } : current,
    );
    return true;
  }, [commands]);

  const run = useCallback((): Promise<boolean> => {
    const previous = saving.current ?? Promise.resolve(true);
    const next = previous.then(() => save());
    saving.current = next;
    void next.finally(() => {
      if (saving.current === next) saving.current = null;
    });
    return next;
  }, [save]);

  useEffect(() => {
    if (!local?.dirty) return undefined;
    const timer = window.setTimeout(() => void run(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [local, run]);

  // Leaving the studio writes what is pending (the runtime itself lives on).
  useEffect(
    () => () => {
      if (localRef.current?.dirty) void run();
    },
    [run],
  );

  const update = useCallback((change: (body: CarouselBody) => CarouselBody) => {
    const current = localRef.current;
    if (!current) return;
    // The ref moves at once so a flush right after an edit (accept + send) writes it.
    const next = { ...current, body: change(current.body), dirty: true };
    localRef.current = next;
    setLocal(next);
  }, []);

  const flush = useCallback(async () => {
    if (saving.current) await saving.current;
    return localRef.current?.dirty ? run() : true;
  }, [run]);

  const body = local && remote && local.pieceId === remote.pieceId ? local.body : remote?.body;
  return { body, pending: Boolean(local?.dirty), update, flush };
}
