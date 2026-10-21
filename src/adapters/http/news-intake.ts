import type { NewsIntake } from '../../ports/news-intake.ts';
import { reporterRequest } from './reporter-client.ts';

const id = (value: string) => encodeURIComponent(value);

/** The connected build's news desk: the same-origin `/api/reporter/news` routes. */
export function createHttpNewsIntake(): NewsIntake {
  return {
    discover: (input) => reporterRequest('/news/discover', input, AbortSignal.timeout(45_000)),
    decide: (itemId, input) => reporterRequest(`/news/items/${id(itemId)}/decision`, input),
    read: (since, page) => {
      const query = new URLSearchParams();
      if (since) query.set('since', since);
      if (page) query.set('after', JSON.stringify(page));
      return reporterRequest(`/news${query.size ? `?${query}` : ''}`);
    },
    item: async (itemId) => (await reporterRequest<{ item?: Awaited<ReturnType<NewsIntake['item']>> }>(`/news/items/${id(itemId)}`)).item,
    // Creating an RSS.app feed waits for RSS.app to read the site.
    addSource: (input) => reporterRequest('/news/sources', input, AbortSignal.timeout(60_000)),
    updateSource: (sourceId, patch) => reporterRequest(`/news/sources/${id(sourceId)}`, patch),
    readSource: (sourceId) => reporterRequest(`/news/sources/${id(sourceId)}/read`, {}),
    removeSource: async (sourceId) => { await reporterRequest(`/news/sources/${id(sourceId)}/remove`, {}); },
    importLink: (url) => reporterRequest('/news/links', { url }),
  };
}
