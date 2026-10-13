'use client';

import { usePathname, useRouter } from 'next/navigation';
import { toast } from '@content-ventures/design-system/v3';
import type { PieceKind } from '@/domain';
import type { GenerationKind, ProductionListItem, RunUpdate } from '@/ports';
import { useRunOutcomes } from '@/state';
import { pieceHref } from '../routes';

/** Full generations announce their end; assists (rewrite, titles…) stay inside the studio. */
const ANNOUNCED: Partial<Record<GenerationKind, PieceKind>> = {
  'article.draft': 'article',
  'carousel.copy': 'carousel',
};

const READY_TITLE: Partial<Record<PieceKind, string>> = {
  article: 'Rascunho pronto',
  carousel: 'Textos do carrossel prontos',
};

/** A production's stages (studio, review, Material, Entrega): the immersive work areas. */
const STAGE_ROUTE = /^\/productions\/(?!new$)[^/]+\/[^/]+/;

/**
 * Runs live in the runtime: leaving the studio never cancels them. When a full generation ends
 * somewhere else, the shell says so — "Rascunho pronto · Abrir" (or "A IA parou antes de terminar ·
 * Abrir") — and stays quiet when the person is already looking at that studio. Inside another
 * production's work area it stays quiet too: the toast would cover the composer and the actions
 * there, and the bell lists the outcome once the person is back outside.
 */
export function RunOutcomeToasts({ productions }: { productions: readonly ProductionListItem[] }) {
  const pathname = usePathname();
  const router = useRouter();

  useRunOutcomes((update: RunUpdate) => {
    const kind = ANNOUNCED[update.meta.request.kind];
    if (!kind) return;
    const href = pieceHref(update.meta.productionId, kind);
    if (pathname === href || pathname.startsWith(`${href}/`) || STAGE_ROUTE.test(pathname)) return;
    const title = productions.find((item) => item.id === update.meta.productionId)?.title;
    const open = { label: 'Abrir', onClick: () => router.push(href) };
    if (update.event.type === 'run.completed') {
      toast(READY_TITLE[kind] ?? 'Texto pronto', { description: title, action: open });
    } else if (update.event.type === 'run.failed') {
      toast('A IA parou antes de terminar', { tone: 'error', description: title, action: open });
    }
  });

  return null;
}
