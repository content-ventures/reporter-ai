'use client';

import { useCallback, useEffect } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import { setArticleDecorations } from '@/editor';
import type { PieceView } from '@/ports';
import type { Commands } from '@/state';
import type { StudioText } from './use-studio-text';

/**
 * Versions and the approval cycle of the article in the studio: "Salvar versão" (⌘S), restoring a
 * version from "Histórico de versões" (what is on screen becomes a version first, so restoring never
 * loses work), "Desfazer mudanças" after an approval, the reviewer's note pointed in the text, and
 * `prepareSend` — the text saved before the pre-send dialog sends it.
 */
export function useStudioReview({ commands, piece, text }: { commands: Commands; piece: PieceView; text: StudioText }) {
  const pieceId = piece.id;
  const { editor, prepare, sync, setLocalTitle, awaitReload } = text;

  // ——— The reviewer's note, pointed in the text ———
  const reviewNote = piece.status === 'changes_requested' && piece.lastDecision?.decision === 'changes_requested' ? piece.lastDecision : undefined;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setArticleDecorations(editor.view, { pointed: reviewNote?.anchors?.map(({ blockId, from, to }) => ({ blockId, from, to })) ?? [] });
  }, [editor, reviewNote]);

  // ——— Versions ———
  const saveVersion = useCallback(async () => {
    await prepare();
    const result = await commands.production.createVersion(pieceId);
    if (result.ok) {
      sync.adopt(result.value.revision);
      toast('Versão salva');
    } else {
      toast(result.refusal.code === 'unchanged' ? 'Nada novo para salvar' : 'Versão não salva', {
        tone: result.refusal.code === 'unchanged' ? 'info' : 'error',
        description: result.refusal.message,
      });
    }
  }, [prepare, commands, pieceId, sync]);

  /**
   * The text of `versionId` back on screen: what is on screen is kept as a version first. Throws
   * when refused (a confirmation dialog stays open); `quiet` leaves the success toast to the caller.
   */
  const restoreTo = useCallback(
    async (versionId: string, options: { quiet?: boolean } = {}) => {
      await prepare();
      const frozen = await commands.production.createVersion(pieceId);
      if (frozen.ok) sync.adopt(frozen.value.revision);
      awaitReload(true);
      const result = await commands.production.restoreVersion(pieceId, versionId);
      if (!result.ok) {
        awaitReload(false);
        toast(options.quiet ? 'Mudanças não desfeitas' : 'Versão não restaurada', { tone: 'error', description: result.refusal.message });
        throw new Error(result.refusal.code);
      }
      setLocalTitle(null);
      if (!options.quiet) toast('Versão restaurada');
    },
    [prepare, commands, pieceId, sync, awaitReload, setLocalTitle],
  );
  const restoreVersion = useCallback((versionId: string) => restoreTo(versionId), [restoreTo]);

  /** "Desfazer mudanças" (approval outdated): back to the approved text; the banner says it in its toast. */
  const approvedId = piece.approvedVersion?.id;
  const undoChanges = useCallback(async () => {
    if (approvedId) await restoreTo(approvedId, { quiet: true });
  }, [approvedId, restoreTo]);

  /** Before the pre-send dialog sends: pending edits saved; a conflict with another tab stops it. */
  const prepareSend = useCallback(async () => {
    await prepare();
    if (sync.status.conflict) {
      toast('Não foi enviado', { tone: 'error', description: 'O texto foi alterado em outra aba. Recarregue a página.' });
      return false;
    }
    return true;
  }, [prepare, sync.status.conflict]);

  // ——— Keyboard: ⌘S saves a version ———
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveVersion();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveVersion]);

  return { reviewNote, saveVersion, restoreVersion, undoChanges, prepareSend };
}
