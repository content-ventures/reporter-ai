import { isReleased } from '../registries/release.ts';

/**
 * Published R2 demonstration navigation and screens, shown while R1 ships. A build that releases
 * R2 (the local R2 preview) replaces it with the Hard News screens and the release's own menu.
 */
export const R2_UI_PREVIEW = !isReleased('R2');
export const R2_NAVIGATION = { previewR2: R2_UI_PREVIEW };
export const R2_ROUTES = {
  news: '/news', 'hard-news': '/news/draft', images: '/images', quotes: '/quotes', archive: '/archive',
  'editorial-map': '/settings/editorial-map', 'writing-guide': '/settings/writing-guide', cms: '/admin/integrations',
} as const;
export type R2Screen = keyof typeof R2_ROUTES;
export const isR2PreviewPath = (pathname: string) => R2_UI_PREVIEW && Object.values(R2_ROUTES).some(href => href === pathname);

/**
 * Screens of the released R2 that still run on simulated data, with no backend yet: the radar and
 * its sources, Apuração, the image and quote banks, the Acervo, the editorial map, the writing
 * guide and the integrations. They carry "Demo" in the top bar. Screens on real data (Modelos and
 * the R1 stages) do not. Never in an R1 build.
 */
const R2_DEMO_PATHS: readonly RegExp[] = [
  /^\/news(\/sources)?$/,
  /^\/productions\/[^/]+\/research$/,
  /^\/images(\/[^/]+)?$/,
  /^\/quotes$/,
  /^\/archive$/,
  /^\/settings\/(editorial-map|writing-guide)$/,
  /^\/admin\/integrations(\/[^/]+)?$/,
];
export const isR2DemoPath = (pathname: string) => isReleased('R2') && R2_DEMO_PATHS.some(pattern => pattern.test(pathname));
