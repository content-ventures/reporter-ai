'use client';

import { createContext, use } from 'react';
import type { Studio } from './use-article-studio';

/**
 * The article studio state shared by its three regions (Fonte, Texto, Copiloto), the header and
 * the footer. Built once by `useArticleStudio` in `ArticleWorkspace`.
 */
export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = use(StudioContext);
  if (!studio) throw new Error('useStudio must be used inside ArticleWorkspace.');
  return studio;
}
