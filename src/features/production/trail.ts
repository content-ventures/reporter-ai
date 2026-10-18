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
    case 'research':
      return 'Apuração';
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

/** One trail level, the shape of the DS `Crumb` it feeds (declared here so the module stays relative-only). */
type TrailCrumb = { label: string; href?: string };

type TrailLinks = {
  /** The Produções list. */
  productions: string;
  /** The production's title and the stage it is on (absent while it loads). */
  title?: { label: string; href: string };
};

/**
 * "Produções › <título> › <etapa>": every level but the last is a link. Without the title (loading,
 * the shell's default) "Produções › <etapa>"; on the index "Produções › <título>". With neither, a
 * neutral leaf keeps "Produções" a link: "Produção" on the index (loading, restricted, not found)
 * and "Página não encontrada" on an unknown sub-route (its 404).
 */
export function productionTrail(route: ProductionRoute, links: TrailLinks): TrailCrumb[] {
  const stage = stageCrumbLabel(route);
  const crumbs: TrailCrumb[] = [{ label: 'Produções', href: links.productions }];
  if (links.title) crumbs.push(stage ? { label: links.title.label, href: links.title.href } : { label: links.title.label });
  if (stage) crumbs.push({ label: stage });
  else if (!links.title) crumbs.push({ label: route.kind === 'unknown' ? 'Página não encontrada' : 'Produção' });
  return crumbs;
}

/** The tab title: "<título> · <etapa>" ("Lume · Aprovação do carrossel"); none while loading. */
export function productionDocumentTitle(route: ProductionRoute, title: string | undefined): string | null {
  if (!title) return null;
  return [title, stageCrumbLabel(route)].filter(Boolean).join(' · ');
}
