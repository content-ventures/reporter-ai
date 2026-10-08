'use client';

import { useCallback, useState, type ReactElement } from 'react';
import { ConfirmDialog, toast } from '@content-ventures/design-system/v3';
import type { PieceKind } from '@/domain';
import type { ApprovalItem, PieceApproval } from '@/ports';
import { useCommands } from '@/state';
import {
  approvalNoticeKind,
  approvalOutdatedNotice,
  approvedNotice,
  awaitingYouNotice,
  changesNotice,
  decidedNotice,
  NOTICE_VERBS,
  sentNotice,
  undoChangesConfirm,
  withdrawnToast,
  type ApprovalSubject,
  type ApprovedNext,
  type ApprovedUsers,
} from './approval-copy';
import { approvalsHref, reviewHref } from './routes';
import { StatusBanner } from './status-banner';
import { useNow } from './time';

/**
 * Where a piece stands at its approval, as the one task notice above the text (D10, COPY §5.1):
 * - the sender: "Enviado para Pedro há 5 min · prazo: hoje. O texto fica travado até a decisão."
 *   with "Retirar envio para editar" (when allowed);
 * - the person asked: "Juliana Prates pediu sua aprovação há 2 h." (no verb: the screen primary is
 *   "Revisar artigo");
 * - "Pedro pediu ajustes: “…”" · Ver comentários; "Aprovado por Pedro · 08/10, 14:20. Próximo
 *   passo: o carrossel."; "Você mudou o texto aprovado…" · Desfazer mudanças (back to the approved
 *   text after a confirmation);
 * - the approver right after deciding: "Aprovado · Juliana recebeu o aviso. Próxima: … · Revisar".
 */

export type ApprovalBannerProps = {
  approval: PieceApproval;
  /** "Ver comentários" (adjustments requested): opens the Comentários tab. Absent: no verb. */
  onShowComments?: () => void;
  /** After "Retirar envio para editar" succeeded (the banner calls `withdrawReview` and toasts). */
  onWithdrawn?: () => void;
  /** The approver has just decided here: who was told and the next item of their queue. */
  decided?: { decision: 'approved' | 'changes_requested'; requesterName: string; next?: ApprovalItem };
  /** Approved: "Próximo passo: o carrossel / a entrega / baixar o pacote" (from the production's next step). */
  approvedNext?: ApprovedNext;
  /** Approval outdated: who keeps the approved version (default: carousel and delivery for the article). */
  usedBy?: ApprovedUsers;
  /**
   * "Desfazer mudanças" done by the screen (flush the editor, restore, reload its text); it throws
   * to keep the confirmation open. Default: the current text becomes a version (it stays in the
   * history), then the approved version is restored.
   */
  onUndo?: () => Promise<void>;
};

export function subjectOf(kind: PieceKind): ApprovalSubject {
  return kind === 'carousel' ? 'carousel' : 'article';
}

/**
 * "Retirar envio" for the banner and the ⋯ menus: calls `withdrawReview`, says so in a toast and
 * reports success. `allowed`: the viewer may withdraw this pending send.
 */
export function useWithdrawReview(
  approval: Pick<PieceApproval, 'pieceId' | 'kind' | 'state' | 'viewer'>,
  onWithdrawn?: () => void,
): { allowed: boolean; withdrawing: boolean; withdraw: () => Promise<boolean> } {
  const commands = useCommands();
  const [withdrawing, setWithdrawing] = useState(false);
  const { pieceId, kind } = approval;
  const withdraw = useCallback(async () => {
    setWithdrawing(true);
    const result = await commands.production.withdrawReview(pieceId);
    setWithdrawing(false);
    if (!result.ok) {
      toast('Envio não retirado', { tone: 'error', description: result.refusal.message });
      return false;
    }
    const copy = withdrawnToast(subjectOf(kind));
    toast(copy.title, { description: copy.description });
    onWithdrawn?.();
    return true;
  }, [commands, pieceId, kind, onWithdrawn]);
  return { allowed: approval.state === 'awaiting' && approval.viewer.canWithdraw, withdrawing, withdraw };
}

/** When the approved version was approved (its decision, else the latest approval). */
function approvedAt(approval: PieceApproval): string | undefined {
  const own = approval.approvedVersion?.decision;
  if (own?.kind === 'approved') return own.at;
  return [...approval.decisions].reverse().find((decision) => decision.kind === 'approved')?.at;
}

export function ApprovalBanner({
  approval,
  onShowComments,
  onWithdrawn,
  decided,
  approvedNext,
  usedBy,
  onUndo,
}: ApprovalBannerProps): ReactElement | null {
  const commands = useCommands();
  const now = useNow();
  const subject = subjectOf(approval.kind);
  const withdrawal = useWithdrawReview(approval, onWithdrawn);
  const [confirming, setConfirming] = useState(false);
  const kind = approvalNoticeKind(approval, Boolean(decided));
  const { request, decision } = approval;

  const undo = useCallback(async () => {
    const approved = approval.approvedVersion;
    if (!approved) return;
    if (onUndo) {
      await onUndo();
    } else {
      // The edited text stays in the history before the approved one comes back.
      await commands.production.createVersion(approval.pieceId);
      const result = await commands.production.restoreVersion(approval.pieceId, approved.id);
      if (!result.ok) {
        toast('Mudanças não desfeitas', { tone: 'error', description: result.refusal.message });
        throw new Error(result.refusal.code);
      }
    }
    toast(undoChangesConfirm({ subject, approvedAt: approvedAt(approval) ?? approved.createdAt }).toast);
  }, [approval, commands, onUndo, subject]);

  switch (kind) {
    case 'decided': {
      if (!decided) return null;
      const next = decided.next;
      return (
        <StatusBanner
          kind="decided"
          action={
            next
              ? { label: NOTICE_VERBS.review, href: reviewHref(next.productionId, next.kind) }
              : { label: NOTICE_VERBS.approvals, href: approvalsHref() }
          }
        >
          {decidedNotice({ decision: decided.decision, requesterName: decided.requesterName, nextTitle: next?.productionTitle })}
        </StatusBanner>
      );
    }
    case 'sent':
      return (
        <StatusBanner
          kind="sent"
          action={
            withdrawal.allowed
              ? { label: NOTICE_VERBS.withdraw, onClick: () => void withdrawal.withdraw(), loading: withdrawal.withdrawing }
              : undefined
          }
        >
          {sentNotice({ subject, assigneeName: request?.assignee?.name, at: request?.requestedAt ?? '', now, dueOn: request?.dueOn })}
        </StatusBanner>
      );
    case 'awaiting_you':
      return (
        <StatusBanner kind="awaiting_you">
          {awaitingYouNotice({ requesterName: request?.requester?.name, at: request?.requestedAt ?? '', now, dueOn: request?.dueOn })}
        </StatusBanner>
      );
    case 'changes':
      return (
        <StatusBanner kind="changes" action={onShowComments ? { label: NOTICE_VERBS.comments, onClick: onShowComments } : undefined}>
          {changesNotice({ deciderName: decision?.decider?.name, note: decision?.note })}
        </StatusBanner>
      );
    case 'approved': {
      const at = decision?.kind === 'approved' ? decision.at : approvedAt(approval);
      return (
        <StatusBanner kind="approved">
          {approvedNotice({ deciderName: decision?.decider?.name, at: at ?? '', now, next: approvedNext })}
        </StatusBanner>
      );
    }
    case 'approval_outdated': {
      const at = approvedAt(approval) ?? approval.approvedVersion?.createdAt;
      if (!at) return null;
      const confirm = undoChangesConfirm({ subject, approvedAt: at, now });
      const canUndo = approval.viewer.canEdit && approval.approvedVersion !== undefined;
      return (
        <>
          <StatusBanner kind="approval_outdated" action={canUndo ? { label: NOTICE_VERBS.undo, onClick: () => setConfirming(true) } : undefined}>
            {approvalOutdatedNotice({ subject, approvedAt: at, now, usedBy })}
          </StatusBanner>
          <ConfirmDialog
            open={confirming}
            onClose={() => setConfirming(false)}
            title={confirm.title}
            description={confirm.description}
            confirmLabel={confirm.confirm}
            onConfirm={undo}
          />
        </>
      );
    }
    default:
      return null;
  }
}
