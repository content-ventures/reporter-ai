import type { Crumb } from '@content-ventures/design-system/v3';
import { gateById, pieceKind } from '../../registries/index.ts';
import type { ProductionRoute } from '../../ui/routes.ts';

/**
 * The TopBar trail of a production, the only way back from a stage (no header back link):
 * "Produções › <título> › <etapa>". The stage label comes from the route alone, so the shell's
 * default (server render, first paint) already says "Produções › Artigo" and loading the
 * production only inserts its title. The same label names the tab ("<título> · Artigo"). Pure,
 * so it is tested without React.
 */

/** The stage a route shows: Material, Artigo, Aprovação do artigo, Carrossel, Aprovação do carrossel, Entrega. */
export function stageCrumbLabel(route: ProductionRoute): string | undefined {
  switch (route.kind) {
    case 'source':
      return 'Material';
    case 'delivery':
      return 'Entrega';
    case 'studio':
      return pieceKind(route.pieceKind)?.label;
    case 'review': {
      const entry = pieceKind(route.pieceKind);
      return (entry?.gateId ? gateById(entry.gateId)?.label : undefined) ?? entry?.label;
    }
    default:
      return undefined;
  }
}

export type TrailLinks = {
  /** The Produções list. */
  productions: string;
  /** The production's title and the stage it is on (absent while it loads). */
  title?: { label: string; href: string };
};

/**
 * "Produções › <título> › <etapa>": every level but the last is a link. Without the title (loading,
 * the shell's default) "Produções › <etapa>"; on the index "Produções › <título>".
 */
export function productionTrail(route: ProductionRoute, links: TrailLinks): Crumb[] {
  const stage = stageCrumbLabel(route);
  const crumbs: Crumb[] = [{ label: 'Produções', href: links.productions }];
  if (links.title) crumbs.push(stage ? { label: links.title.label, href: links.title.href } : { label: links.title.label });
  if (stage) crumbs.push({ label: stage });
  return crumbs;
}

/** The tab title: "<título> · <etapa>" ("Lume · Aprovação do carrossel"); none while loading. */
export function productionDocumentTitle(route: ProductionRoute, title: string | undefined): string | null {
  if (!title) return null;
  return [title, stageCrumbLabel(route)].filter(Boolean).join(' · ');
}
