'use client';
import { createContext, use, useState, type ReactNode } from 'react';
import { ARCHIVE, DEFAULT_OUTLINE, FEEDS, NEWS, type Feed, type News } from './demo-data';

export function usePrototypeModel() {
  const [news, setNews] = useState<News[]>(NEWS);
  const [feeds, setFeeds] = useState<Feed[]>(FEEDS);
  const [hardNewsStage, setHardNewsStage] = useState<'research' | 'outline' | 'article' | 'evidence' | 'enrich'>('research');
  const [brief, setBrief] = useState(NEWS[0].title);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [outline, setOutline] = useState(DEFAULT_OUTLINE);
  const [article, setArticle] = useState('');
  const [imageId, setImageId] = useState<string>();
  const [credits, setCredits] = useState<Record<string, string>>({});
  const [quoteIds, setQuoteIds] = useState<string[]>([]);
  const [linkIds, setLinkIds] = useState<string[]>([]);
  const [archive, setArchive] = useState<{ id: string; title: string; topic: string; date: string; url: string; excerpt: string; state: 'indexed' | 'error' | 'pending' }[]>(ARCHIVE);
  const [map, setMap] = useState({ audience: 'Profissionais da cadeia do pescado: indústria, distribuição e varejo.', topics: ['Indústria', 'Mercado', 'Aquicultura'], exclusions: ['Receitas sem contexto de mercado', 'Publicidade sem identificação'], geography: 'Brasil e comércio internacional', relevance: 40, impact: 35, freshness: 25 });
  const [guide, setGuide] = useState({ tone: 'Direto, informativo e preciso', lead: 'Comece pelo fato novo, com agente, ação e contexto. Evite adjetivos promocionais.', attribution: 'Atribua dados e falas à fonte. Separe fatos confirmados de alegações. Preserve as limitações da pesquisa.', avoid: 'revolucionário, sucesso absoluto, sem precedentes', example: 'A cooperativa iniciou um teste de rastreabilidade em duas unidades. Os resultados ainda não foram divulgados.' });
  const [cms, setCms] = useState({ url: '', platform: 'wordpress', connected: false, section: 'Indústria', author: 'Redação', imported: false });
  return { hardNewsStage, setHardNewsStage, news, setNews, feeds, setFeeds, brief, setBrief, sourceIds, setSourceIds, outline, setOutline, article, setArticle, imageId, setImageId, credits, setCredits, quoteIds, setQuoteIds, linkIds, setLinkIds, archive, setArchive, map, setMap, guide, setGuide, cms, setCms };
}
type Model = ReturnType<typeof usePrototypeModel>;
const PrototypeContext = createContext<Model | null>(null);
export function PrototypeProvider({ children }: { children: ReactNode }) {
  const value = usePrototypeModel();
  return <PrototypeContext value={value}>{children}</PrototypeContext>;
}
export function usePrototype() {
  const model = use(PrototypeContext);
  if (!model) throw new Error('R2 prototype provider is missing');
  return model;
}
