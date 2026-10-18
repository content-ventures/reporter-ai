/** Addresses of the R2 screens (the menu entries live in the navigation registry). */

export const NEWS_HREF = '/news';
export const NEWS_SOURCES_HREF = '/news/sources';

/** "Apuração": research and outline of a covered story, before the article studio. */
export function researchHref(productionId: string): string {
  return `/productions/${encodeURIComponent(productionId)}/research`;
}

export function deliveryHref(productionId: string): string {
  return `/productions/${encodeURIComponent(productionId)}/delivery`;
}

/** "Modelos": the carousel library (the R1 route; R2 shows it as shelves). */
export const TEMPLATES_HREF = '/library/templates';

/** The carousel's start with a model chosen (`?model=`, which the start reads). */
export function carouselStartHref(productionId: string, templateId: string): string {
  return `/productions/${encodeURIComponent(productionId)}/carousel?model=${encodeURIComponent(templateId)}`;
}
