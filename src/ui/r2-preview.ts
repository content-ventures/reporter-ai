/** Published R2 demonstration navigation and screens only. Does not enable R2 runtime features. */
export const R2_UI_PREVIEW = true;
export const R2_NAVIGATION = { previewR2: R2_UI_PREVIEW };
export const R2_ROUTES = {
  news: '/news', 'hard-news': '/news/draft', images: '/images', quotes: '/quotes', archive: '/archive',
  'editorial-map': '/settings/editorial-map', 'writing-guide': '/settings/writing-guide', cms: '/admin/integrations',
} as const;
export type R2Screen = keyof typeof R2_ROUTES;
export const isR2PreviewPath = (pathname: string) => R2_UI_PREVIEW && Object.values(R2_ROUTES).some(href => href === pathname);
