import type { EditorialPolicy } from './editorial-policy.ts';

export type WritingResearchSettings = {
  enabled: boolean; instructions: string; maxQueries: number; maxResults: number; maxSources: number;
  timeoutMs: number; failureMode: 'stop' | 'continue_original'; excludeDomains: string[]; excludeUrls: string[];
};
export type WritingResearchQuery = { query: string; purpose: string; evidenceIds: string[] };
export type WritingResearchPlan = { queries: WritingResearchQuery[]; reason: string };
export type WritingExternalSource = {
  id: string; kind: 'external'; provider: 'tavily'; query: string; title: string; url: string; site: string;
  excerpt: string; publishedOn: string | null; retrievedAt: string;
};
export type WritingResearchQueryTrace = WritingResearchQuery & {
  status: 'completed' | 'failed'; startedAt: string; completedAt: string; sourceIds: string[];
  requestId?: string | null; credits?: number | null; error?: string; reason?: string;
};
export type WritingResearchSnapshot = {
  status: 'completed' | 'partial' | 'failed' | 'skipped'; startedAt: string; completedAt: string;
  queries: WritingResearchQueryTrace[]; sources: WritingExternalSource[];
  excludedDomains: string[]; excludedUrls: string[]; reason?: string;
};

export function defaultWritingResearch(): WritingResearchSettings {
  return { enabled: false, instructions: 'Pesquise apenas contexto complementar útil ao recorte. Proponha consultas curtas e neutras, com termos sustentados pelo conteúdo e IDs originais. Priorize documentação primária para nomes de produtos, conceitos e dados. Não pesquise o artigo de referência, nem envie falas inteiras, dados pessoais ou conteúdo confidencial. Não procure completar identidade, cargo ou data desconhecida por semelhança. Se não houver contexto relevante a pesquisar, retorne queries vazio e explique em reason.',
    maxQueries: 2, maxResults: 3, maxSources: 6, timeoutMs: 20000, failureMode: 'stop', excludeDomains: [], excludeUrls: [] };
}

/** A missing legacy field never turns on paid searches. */
export function effectiveWritingResearch(configuration: { research?: WritingResearchSettings }): WritingResearchSettings {
  return configuration.research ?? defaultWritingResearch();
}

/** Match URL variants of the same benchmark without treating arbitrary text as a URL. */
export function researchUrlKey(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.hostname.toLowerCase().replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
  } catch { return undefined; }
}

export function writingResearchExclusions(settings: WritingResearchSettings, policy?: EditorialPolicy) {
  const mapDomains = (policy?.map.blocked ?? []).flatMap(value => {
    try {
      const url = new URL(value.includes('://') ? value : 'https://' + value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
        ? [url.hostname] : [];
    } catch { return []; }
  });
  const excludedDomains = [...new Set([...settings.excludeDomains, ...mapDomains].map(domain => domain.toLowerCase().replace(/^www\./, '').trim()).filter(Boolean))];
  const excludedUrls = [...new Set([...settings.excludeUrls, ...(policy?.guide.examples.map(example => example.url) ?? [])].filter(Boolean))];
  return { excludedDomains, excludedUrls };
}

export function excludedResearchUrl(url: string, exclusions: { excludedDomains: readonly string[]; excludedUrls: readonly string[] }): boolean {
  const key = researchUrlKey(url);
  if (!key) return true;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return exclusions.excludedDomains.some(domain => host === domain || host.endsWith('.' + domain))
    || exclusions.excludedUrls.some(value => researchUrlKey(value) === key);
}
