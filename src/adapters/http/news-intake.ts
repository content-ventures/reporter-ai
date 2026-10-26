import type { NewsIntake } from '../../ports/news-intake.ts';
import { defaultReporterTransport, type ReporterTransport } from './reporter-client.ts';

const id = (value: string) => encodeURIComponent(value);

/** The connected build's news desk: the same-origin `/api/reporter/news` routes. */
export function createHttpNewsIntake(http: ReporterTransport = defaultReporterTransport): NewsIntake {
  return {
    search: { read: () => http.request('/news/search'), save: input => http.request('/news/search', input), collect: () => http.request('/news/search/collect', {}) },
    discover: (input) => http.request('/news/discover', input, AbortSignal.timeout(45_000)),
    decide: (itemId, input) => http.request(`/news/items/${id(itemId)}/decision`, input),
    retryTranslation: (itemId) => http.request(`/news/items/${id(itemId)}/translation/retry`, {}),
    read: (since, page) => {
      const query = new URLSearchParams();
      if (since) query.set('since', since);
      if (page) query.set('after', JSON.stringify(page));
      return http.request(`/news${query.size ? `?${query}` : ''}`);
    },
    item: async (itemId) => (await http.request<{ item?: Awaited<ReturnType<NewsIntake['item']>> }>(`/news/items/${id(itemId)}`)).item,
    // Creating an RSS.app feed waits for RSS.app to read the site.
    addSource: (input) => http.request('/news/sources', input, AbortSignal.timeout(60_000)),
    updateSource: (sourceId, patch) => http.request(`/news/sources/${id(sourceId)}`, patch),
    readSource: (sourceId) => http.request(`/news/sources/${id(sourceId)}/read`, {}),
    removeSource: async (sourceId) => { await http.request(`/news/sources/${id(sourceId)}/remove`, {}); },
    importLink: (url) => http.request('/news/links', { url }),
  };
}
