'use client';

import { useState, type ReactNode } from 'react';
import type { MenuSection } from '@content-ventures/design-system/v3';
import { ClipboardList, History as HistoryIcon, ListTree, RotateCcw, Send, Sparkles, Undo2 } from '@content-ventures/design-system/v3/icons';
import { ProductionHeader, ProductionPrimaryBar, type HeaderPrimary } from '@/features/production/production-frame';
import { ApprovalBanner, GenerationBanner, StatusBadge, StatusBanner, useWithdrawReview } from '@/ui';
import { deliveryHref, materialHref, pieceHref, reviewHref, structureHref } from '@/ui/routes';
import { useStudio } from './studio-context';
import { studioPrimary } from './studio-session-model';

/**
 * The studio's header line (D2, CONTRACT §3.8): ← Produções · title · the article's status ·
 * "Artigo · 2 de 5 ▾" · ⋯ · ONE primary with the next step written on it. Under the line, ONE
 * task notice: the AI writing or stopped, where the approval stands, or (from the frame) the
 * other-tab notice. Behind ⋯: the brief, the structure, the version history, how the AI wrote,
 * "Reescrever o artigo do zero…" and, while the text waits, "Retirar envio".
 */

/** The header primary of the article, as `ProductionHeader` takes it (or none). */
export function useStudioPrimary(): HeaderPrimary | undefined {
  const studio = useStudio();
  const { production, piece, approval, generation, panes } = studio;
  const carousel = production.pieces.find((entry) => entry.kind === 'carousel');
  const primary = studioPrimary({
    status: piece.status,
    generating: generation.active,
    ...(approval ? { approval } : {}),
    authorized: production.sources.every((entry) => entry.authorized),
    ...(carousel ? { carousel: { status: carousel.status } } : {}),
    tabReadOnly: studio.readOnly,
  });
  if (!primary) return undefined;
  switch (primary.kind) {
    case 'send':
    case 'resend': {
      const blocked = primary.blockedReason;
      return {
        kind: 'button',
        label: primary.label,
        icon: Send,
        onClick: () => {
          if (!blocked) panes.openDialog('send');
        },
        ...(blocked ? { blockedReason: blocked } : {}),
      };
    }
    case 'review':
      return { kind: 'link', label: primary.label, href: reviewHref(production.id, 'article') };
    case 'create_carousel':
    case 'open_carousel':
      return { kind: 'link', label: primary.label, href: pieceHref(production.id, 'carousel') };
    case 'delivery':
      return { kind: 'link', label: primary.label, href: deliveryHref(production.id) };
    case 'structure':
      return { kind: 'link', label: primary.label, href: structureHref(production.id) };
  }
}

/** The ⋯ items of the studio, above the production's own ("Renomear"). */
function useStudioMenu(): MenuSection[] {
  const studio = useStudio();
  const { panes, generation, approval } = studio;
  const withdrawal = useWithdrawReview(
    approval ?? { pieceId: studio.piece.id, kind: 'article', state: 'none', viewer: { canEdit: false, canSend: false, canDecide: false, canWithdraw: false, isRequester: false, isAssignee: false } },
  );
  const writable = studio.canEdit && !studio.refusal;
  const rewriteReason = generation.active ? 'Aguarde a IA terminar.' : (studio.refusal ?? undefined);
  const items: MenuSection['items'] = [
    ...(studio.canEdit
      ? [{ label: 'Editar pauta', icon: ClipboardList, disabled: generation.active, ...(generation.active ? { description: 'Aguarde a IA terminar.' } : {}), onSelect: () => panes.openDialog('brief') }]
      : []),
    { label: 'Ver estrutura', icon: ListTree, onSelect: () => panes.openDialog('structure') },
    { label: 'Histórico de versões', icon: HistoryIcon, onSelect: () => panes.openDialog('history') },
    { label: 'Como a IA escreveu', icon: Sparkles, onSelect: () => panes.openDialog('trace') },
    ...(studio.canEdit && !studio.empty
      ? [
          {
            label: 'Reescrever o artigo do zero…',
            icon: RotateCcw,
            disabled: !writable || generation.active,
            ...(rewriteReason ? { description: rewriteReason } : {}),
            onSelect: () => panes.openDialog('rewrite'),
          },
        ]
      : []),
  ];
  const sections: MenuSection[] = [{ items }];
  if (withdrawal.allowed) {
    sections.push({ items: [{ label: 'Retirar envio', icon: Undo2, disabled: withdrawal.withdrawing, onSelect: () => void withdrawal.withdraw() }] });
  }
  return sections;
}

/** The ONE task notice under the header line (or none: the frame then says when another tab edits). */
function useStudioNotice(): ReactNode {
  const studio = useStudio();
  const { generation, piece, approval, production, panes, actions } = studio;
  const [stopping, setStopping] = useState(false);
  const run = generation.run;
  if (generation.active && run) {
    return (
      <GenerationBanner
        run={run}
        subject="article"
        busy={stopping}
        {...(studio.canEdit
          ? {
              onStop: () => {
                setStopping(true);
                void actions.stopGeneration().finally(() => setStopping(false));
              },
            }
          : {})}
      />
    );
  }
  if (piece.status === 'failed' && run?.status === 'failed') {
    return (
      <GenerationBanner
        run={run}
        subject="article"
        {...(studio.canEdit ? { onRetry: () => void (generation.retryable ? actions.retryGeneration() : actions.generate()) } : {})}
      />
    );
  }
  if (studio.articleStatus.kind === 'production' && studio.empty) {
    return (
      <StatusBanner kind="unauthorized" action={{ label: 'Autorizar', href: materialHref(production.id) }}>
        Falta a autorização dos falantes.
      </StatusBanner>
    );
  }
  if (approval && approval.state !== 'none') {
    const carousel = production.pieces.find((entry) => entry.kind === 'carousel');
    return (
      <ApprovalBanner
        approval={approval}
        onShowComments={() => panes.showPanel('comments')}
        approvedNext={carousel && carousel.status !== 'approved' ? 'carousel' : 'delivery'}
        usedBy={carousel ? 'carousel_and_delivery' : 'delivery'}
        onUndo={actions.undoChanges}
      />
    );
  }
  return undefined;
}

export function StudioHeader({ withPrimary = true }: { withPrimary?: boolean }) {
  const studio = useStudio();
  const primary = useStudioPrimary();
  const menu = useStudioMenu();
  const notice = useStudioNotice();
  const badge = studio.articleStatus;
  return (
    <ProductionHeader
      status={badge.kind === 'production' ? <StatusBadge kind="production" status={badge.status} /> : <StatusBadge kind="piece" status={badge.status} />}
      {...(withPrimary && primary ? { primary } : {})}
      menu={menu}
      {...(notice ? { notice } : {})}
    />
  );
}

/** Narrow layouts: the primary at the bottom, with the footer's short facts ("1,5 de 2 laudas · Falta 5"). */
export function StudioPrimaryBar({ detail }: { detail?: ReactNode }) {
  const primary = useStudioPrimary();
  return <ProductionPrimaryBar primary={primary} detail={detail} />;
}
