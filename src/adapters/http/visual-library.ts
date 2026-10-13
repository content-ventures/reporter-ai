import type { VisualLibrary } from '../../ports/visual-library.ts';
import { reporterRequest } from './reporter-client.ts';
export function createHttpVisualLibrary(): VisualLibrary {
  return {
    get: () => reporterRequest('/visuals'),
    articleSeed: id => reporterRequest('/visuals/article/'+encodeURIComponent(id)),
    search: (provider, query, page = 1, options) => reporterRequest(`/visuals/search?provider=${provider}&q=${encodeURIComponent(query)}&page=${page}&curated=${options?.curated !== false}`,undefined,options?.signal),
    importImage: (provider,id,confirmed) => reporterRequest('/visuals/images',{ provider,id,confirmed }),
    illustrate: (productionId,revision,bodyHash) => reporterRequest('/visuals/illustrate',{ productionId,revision,bodyHash },AbortSignal.timeout(90000)),
    saveBanner: (id,revision,content) => reporterRequest('/visuals/banners',{ id,revision,content }),
    async preview(content,signal) {
      const response = await fetch('/api/reporter/visuals/preview',{ method: 'POST',headers: { 'content-type': 'application/json','x-reporter-client': 'local' },body: JSON.stringify(content),signal: signal ?? AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Não foi possível montar o banner.');
      return response.blob();
    },
  };
}
