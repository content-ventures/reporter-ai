import type { VisualLibrary } from '../../ports/visual-library.ts';
import type { ImageGenerator } from '../../ports/image-generation.ts';
import { imageDescription } from '../../domain/image-generation.ts';
import { ok, refuse } from '../../domain/result.ts';
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

const FAILED = 'Não foi possível gerar a imagem. Tente de novo.';

/** "Gerar com IA" on the server's provider key; the bytes come back for the picker to show. */
export function createHttpImageGenerator(): ImageGenerator {
  return {
    async generate(input,signal) {
      const prompt = imageDescription(input.prompt);
      if (!prompt) return refuse('empty','Descreva a imagem.');
      const timeout = AbortSignal.timeout(160000);
      try {
        const response = await fetch('/api/reporter/visuals/generate',{ method: 'POST',headers: { 'content-type': 'application/json','x-reporter-client': 'local' },
          body: JSON.stringify({ productionId: input.productionId,prompt,...(input.orientation ? { orientation: input.orientation } : {}) }),
          signal: signal ? AbortSignal.any([signal,timeout]) : timeout });
        if (!response.ok) return refuse('unavailable',((await response.json().catch(() => ({}))) as { message?: string }).message ?? FAILED);
        return ok({ file: await response.blob() });
      } catch { return refuse('unavailable',FAILED); }
    },
  };
}
