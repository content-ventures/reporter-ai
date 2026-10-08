'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@content-ventures/design-system/v3';
import type { CheckResult } from '@/domain';
import { setArticleDecorations } from '@/editor';
import type { PieceView, ProductionDetail } from '@/ports';
import type { Commands } from '@/state';
import { reviewHref } from '@/ui/routes';
import { approvedOnScreen, reviewRequestBlock } from './studio-session-model';
import type { StudioText } from './use-studio-text';

/**
 * Versions and the approval cycle of the article: "Salvar versão" (⌘S), restoring a version
 * (edits not yet frozen become a version first), the reviewer's note pointed in the text,
 * "Enviar para aprovação" with the reason it is blocked (a failing blocking check included), and
 * the notice that editing an approved article starts a new draft.
 */
export function useStudioReview({
  commands,
  production,
  piece,
  text,
  busy,
  openCount,
  empty,
  blockers,
}: {
  commands: Commands;
  production: ProductionDetail;
  piece: PieceView;
  text: StudioText;
  /** A generation or an assist run is writing. */
  busy: boolean;
  /** Open suggestions still to decide. */
  openCount: number;
  empty: boolean;
  /** Blocking checks that fail on the text on screen (`readiness.blockers`). */
  blockers: readonly CheckResult[];
}) {
  const router = useRouter();
  const pieceId = piece.id;
  const productionId = production.id;
  const { editor, prepare, sync, setLocalTitle, awaitReload } = text;
  const [highlightVersionId, setHighlightVersionId] = useState<string | null>(null);

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
      toast(`${result.value.version.label} salva`);
    } else {
      toast(result.refusal.code === 'unchanged' ? 'Nada novo para salvar' : 'Versão não salva', {
        tone: result.refusal.code === 'unchanged' ? 'info' : 'error',
        description: result.refusal.message,
      });
    }
  }, [prepare, commands, pieceId, sync]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      await prepare();
      // Edits not yet frozen become a version first: restoring never overwrites work.
      const frozen = await commands.production.createVersion(pieceId);
      if (frozen.ok) sync.adopt(frozen.value.revision);
      awaitReload(true);
      const result = await commands.production.restoreVersion(pieceId, versionId);
      if (!result.ok) {
        awaitReload(false);
        toast('Versão não restaurada', { tone: 'error', description: result.refusal.message });
        throw new Error(result.refusal.code);
      }
      setLocalTitle(null);
      setHighlightVersionId(result.value.version.id);
      toast(`${result.value.version.label} criada`);
    },
    [prepare, commands, pieceId, sync, awaitReload, setLocalTitle],
  );

  // ——— Approval ———
  const [requesting, setRequesting] = useState(false);
  const requestReview = useCallback(async () => {
    setRequesting(true);
    await prepare();
    const result = await commands.production.requestReview(pieceId);
    setRequesting(false);
    if (!result.ok) {
      toast('Não foi enviado', { tone: 'error', description: result.refusal.message });
      return;
    }
    toast(`${result.value.version.label} enviada para aprovação`);
    router.push(reviewHref(productionId, 'article'));
  }, [prepare, commands, pieceId, router, productionId]);

  const requestBlocked = reviewRequestBlock({
    busy,
    openCount,
    conflict: sync.status.conflict,
    empty,
    blockers,
    guard: production.guards.pieces.article?.requestReview,
    readOnly: text.readOnly,
  });
  /**
   * Nothing new to send: the text on screen is the version waiting for approval ("Abrir revisão") or
   * the approved one ("Ver v2 aprovada", a quiet link to its final text).
   */
  const guard = production.guards.pieces.article?.requestReview;
  const settled = guard && !guard.allowed && (guard.code === 'already_requested' || guard.code === 'already_approved') && !piece.draft.dirty ? guard.code : null;
  const reviewLink =
    settled === 'already_approved'
      ? { label: `Ver v${piece.approvedVersion?.number ?? piece.latestVersion?.number ?? ''} aprovada`, href: `${reviewHref(productionId, 'article')}?view=final`, quiet: true }
      : settled === 'already_requested'
        ? { label: 'Abrir revisão', href: reviewHref(productionId, 'article'), quiet: false }
        : null;
  const reviewHrefNow = reviewLink?.href;
  const openReview = useCallback(() => {
    if (reviewHrefNow) router.push(reviewHrefNow);
  }, [reviewHrefNow, router]);

  /** Where ⌘K takes the person when sending is blocked: the open suggestions, or the Checagem. */
  const requestFix: 'suggestions' | 'checks' | null =
    !requestBlocked || busy ? null : openCount > 0 ? 'suggestions' : sync.status.conflict || empty ? null : blockers.length > 0 ? 'checks' : null;

  // ——— Editing an approved article starts a new draft (said once, when it happens) ———
  const approved = approvedOnScreen(piece);
  const approvedBefore = useRef(approved);
  useEffect(() => {
    const before = approvedBefore.current;
    approvedBefore.current = approved;
    if (before && !approved && piece.draft.dirty) {
      toast(`Novo rascunho sobre a v${before.number} aprovada`, {
        tone: 'info',
        description: `A v${before.number} continua aprovada. Envie para aprovação quando terminar.`,
      });
    }
  }, [approved, piece.draft.dirty]);

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

  return {
    reviewNote,
    highlightVersionId,
    setHighlightVersionId,
    saveVersion,
    restoreVersion,
    requesting,
    requestReview,
    requestBlocked,
    requestFix,
    reviewLink,
    openReview,
    approved,
  };
}
