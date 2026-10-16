'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast, type ToastAction } from '@content-ventures/design-system/v3';
import type { PieceId, PieceKind, ProductionId } from '@/domain';
import { useCommands } from '@/state';
import { movedToast, NOTICE_VERBS, withdrawnToast } from './approval-copy';
import { boardHref, pieceHref } from './routes';
import { notifyRefusal } from './permission-dialog';

/** Long enough to read who acts now once the board opens (the DS default is 5 s). */
export const MOVED_TOAST_MS = 8000;

export type StageMoveToast = { title: string; description: string };

export type StageMove = {
  /**
   * After a send: "Enviado para Pedro" · "Agora é só aguardar a aprovação." with "Retirar envio",
   * which takes the send back and reopens the piece for editing. Then the board.
   */
  sent: (input: { productionId: ProductionId; pieceId: PieceId; kind: PieceKind; assigneeName?: string | null }) => void;
  /** After a decision: the toast (from `movedToast`) with at most one action, then the board. */
  decided: (input: { productionId: ProductionId; copy: StageMoveToast; action?: ToastAction }) => void;
};

/**
 * Every stage move ends on the board (`boardHref`), where the moved card shows its new column and
 * who has it now, with ONE toast saying who acts next. The toast outlives the screen that moved
 * the card, so its action calls the commands directly, never a hook of that screen.
 */
export function useStageMove(): StageMove {
  const router = useRouter();
  const commands = useCommands();
  return useMemo(() => {
    const land = (productionId: ProductionId, copy: StageMoveToast, action?: ToastAction) => {
      toast(copy.title, { description: copy.description, duration: MOVED_TOAST_MS, ...(action ? { action } : {}) });
      router.push(boardHref(productionId));
    };
    return {
      sent({ productionId, pieceId, kind, assigneeName }) {
        const withdraw = async () => {
          const result = await commands.production.withdrawReview(pieceId);
          if (!result.ok) {
            notifyRefusal('Envio não retirado', result.refusal);
            return;
          }
          const copy = withdrawnToast(kind === 'carousel' ? 'carousel' : 'article');
          toast(copy.title, { description: copy.description });
          router.push(pieceHref(productionId, kind));
        };
        land(productionId, movedToast({ transition: { kind: 'sent' }, actorName: assigneeName }), {
          label: NOTICE_VERBS.withdrawMenu,
          onClick: () => void withdraw(),
        });
      },
      decided({ productionId, copy, action }) {
        land(productionId, copy, action);
      },
    };
  }, [commands, router]);
}
