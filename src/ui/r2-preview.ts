import { isReleased } from '../registries/release.ts';

/**
 * The Hard News (R2) screens in an R1 build: a demonstration on their own routes. The R1 stages do
 * not change (their R2 plug points stay behind the release) and the demonstration writes nothing
 * to the workspace on its own: no example productions, no "Cobrir". A build that releases R2 (the
 * local R2 preview) shows the same screens as the release.
 */
export const HARD_NEWS_DEMO = !isReleased('R2');

/** The R1 build's menu shows the Hard News destinations the way the R2 menu does. */
export const R2_NAVIGATION = { previewR2: HARD_NEWS_DEMO };

/**
 * Hard News screens that still run on simulated data, with no backend yet: the radar and its
 * sources, Apuração, the Acervo, the editorial map, the writing guide and the integrations. They
 * carry "Demo" in the top bar, in both builds. The image and quote banks read the R1 visual and
 * citation libraries when the build has them (the connected build), so they carry it only without.
 */
const R2_DEMO_PATHS: readonly RegExp[] = [
  /^\/news(\/sources)?$/,
  /^\/productions\/[^/]+\/research$/,
  /^\/archive$/,
  /^\/settings\/(editorial-map|writing-guide)$/,
  /^\/admin\/integrations(\/[^/]+)?$/,
];
const R1_LIBRARY_PATHS: readonly RegExp[] = [/^\/images(\/[^/]+)?$/, /^\/quotes$/];
export const isR2DemoPath = (pathname: string, libraries = false) =>
  R2_DEMO_PATHS.some(pattern => pattern.test(pathname)) || (!libraries && R1_LIBRARY_PATHS.some(pattern => pattern.test(pathname)));

/** The earlier R2 demonstration (Codex prototype), until it is removed. */
export const R2_UI_PREVIEW = HARD_NEWS_DEMO;
export const R2_ROUTES = {
  news: '/news', 'hard-news': '/news/draft', images: '/images', quotes: '/quotes', archive: '/archive',
  'editorial-map': '/settings/editorial-map', 'writing-guide': '/settings/writing-guide', cms: '/admin/integrations',
} as const;
export type R2Screen = keyof typeof R2_ROUTES;
