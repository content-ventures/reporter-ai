import type { BannerContent, BannerDraft, LibraryImage, StockImage, StockProvider, VisualLibraryView } from '../domain/visual-library.ts';
export interface VisualLibrary {
  get(): Promise<VisualLibraryView>;
  articleSeed(productionId: string): Promise<{ content: BannerContent; quotes: string[]; sourceState: string }>;
  search(provider: StockProvider, query: string, page?: number, options?: { signal?: AbortSignal; curated?: boolean }): Promise<{ images: StockImage[]; hasMore: boolean }>;
  importImage(provider: StockProvider, id: string, confirmed: boolean): Promise<LibraryImage>;
  illustrate?(productionId: string,revision: number,bodyHash: string): Promise<{ filled: number; codes: string[]; revision: number }>;
  preview(content: BannerContent, signal?: AbortSignal): Promise<Blob>;
  saveBanner(id: string, revision: number, content: BannerContent): Promise<BannerDraft>;
}
