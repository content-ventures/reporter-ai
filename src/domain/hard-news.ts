/**
 * R2 · Hard News (F2.1–F2.13): the records the news desk works with. The screens read these
 * shapes; the backend fills them (RSS ingestion, AI triage, web research, CMS adapter, archive
 * index) without changing the screens. Pure TypeScript: no framework, no I/O.
 */

import type { FactCheck } from './fact-check.ts';

// ── F2.1 · Fontes de notícias ─────────────────────────────────────────────────────────────────

export type FeedState = 'active' | 'paused' | 'failing';

export type NewsFeed = {
  id: string;
  name: string;
  url: string;
  /** Minutes between two reads. */
  everyMinutes: number;
  state: FeedState;
  lastReadAt?: string;
  /** What the last failed read answered ("Tempo esgotado"). */
  lastError?: string;
  /** News imported in the last 24 hours. */
  lastDay: number;
  /** News imported per day in the last 7 days, oldest first (the source's rhythm). */
  lastWeek?: number[];
};

export const FEED_INTERVALS = [15, 30, 60, 120, 360] as const;

// ── F2.2 / F2.4 · Fila e triagem ─────────────────────────────────────────────────────────────

/** Where a news item is in the desk's queue. `covered` became a production. */
export type NewsStatus = 'new' | 'covered' | 'later' | 'discarded';

export type NewsPriority = 'high' | 'medium' | 'low';

/** One criterion of the editorial map that moved the score, as the AI read it. */
export type ScoreReason = { criterion: string; effect: 'up' | 'down'; detail: string };

export type NewsClassification = {
  /** 0–100 against the editorial map version `mapVersion`. */
  score: number;
  topic: string;
  /** One line: why this deserves (or not) the desk's time. */
  summary: string;
  reasons: ScoreReason[];
  mapVersion: number;
  /** A person's correction, kept for calibration (REQ-2.4). */
  correction?: { priority: NewsPriority; by: string; at: string; note?: string };
};

/** The same story from another outlet (REQ-2.1: duplicates never erase their origin). */
export type NewsDuplicate = { source: string; url: string; publishedAt: string };

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  feedId?: string;
  via: 'rss' | 'url';
  publishedAt: string;
  importedAt: string;
  /** The outlet's lead, as published. */
  excerpt: string;
  /** Paragraphs of the original text, for reading without leaving the queue. */
  body: string[];
  duplicates: NewsDuplicate[];
  /** Absent while the AI is still reading it. */
  classification?: NewsClassification;
  status: NewsStatus;
  decidedBy?: string;
  decidedAt?: string;
  /** "Adiar" until this moment. */
  laterUntil?: string;
  /** When a postponed item came back to the queue on its own. */
  returnedAt?: string;
  discardReason?: string;
  /** The production "Cobrir" opened. */
  productionId?: string;
};

export function priorityOf(item: Pick<NewsItem, 'classification'>): NewsPriority | undefined {
  const classification = item.classification;
  if (!classification) return undefined;
  if (classification.correction) return classification.correction.priority;
  if (classification.score >= 75) return 'high';
  if (classification.score >= 50) return 'medium';
  return 'low';
}

export const PRIORITY_LABELS: Record<NewsPriority, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };

/** Highest priority first, then the higher score, then the most recent. Items still being read go last. */
export function compareQueue(a: NewsItem, b: NewsItem): number {
  const rank = (item: NewsItem) => ({ high: 0, medium: 1, low: 2 } as const)[priorityOf(item) ?? 'low'] + (item.classification ? 0 : 3);
  return rank(a) - rank(b)
    || (b.classification?.score ?? 0) - (a.classification?.score ?? 0)
    || b.publishedAt.localeCompare(a.publishedAt);
}

export const DISCARD_REASONS = ['Fora do mapa editorial', 'Já publicamos', 'Fonte pouco confiável', 'Sem novidade'] as const;

/** REQ-2.2: how many stories the desk wants to open per day. */
export type DeskGoal = { perDay: number };

// ── F2.3 · Mapa editorial ────────────────────────────────────────────────────────────────────

export type TopicWeight = 'core' | 'regular' | 'occasional';

export const TOPIC_WEIGHT_LABELS: Record<TopicWeight, string> = { core: 'Principal', regular: 'Cobre', occasional: 'Às vezes' };

export type EditorialTopic = { id: string; label: string; weight: TopicWeight };

export type EditorialMap = {
  version: number;
  updatedAt: string;
  updatedBy: string;
  audience: string;
  regions: string[];
  topics: EditorialTopic[];
  exclusions: string[];
  /** Outlets that raise the score (official bodies, trade associations). */
  trusted: string[];
  /** Outlets the desk never covers from. */
  blocked: string[];
};

// ── F2.5 · Guia de escrita ───────────────────────────────────────────────────────────────────

export type GuideRule = { id: string; text: string };
export type PreferredTerm = { avoid: string; use: string };
export type GuideExample = { id: string; title: string; url: string; note: string };

export type WritingGuide = {
  version: number;
  updatedAt: string;
  updatedBy: string;
  voice: string;
  headline: string;
  lead: string;
  attribution: string;
  rules: GuideRule[];
  terms: PreferredTerm[];
  examples: GuideExample[];
};

// ── F2.6 / F2.7 · Apuração e outline ─────────────────────────────────────────────────────────

export type ResearchKind = 'official' | 'data' | 'press' | 'association' | 'archive';

export const RESEARCH_KIND_LABELS: Record<ResearchKind, string> = {
  official: 'Oficial',
  data: 'Dados',
  press: 'Imprensa',
  association: 'Entidade',
  archive: 'Acervo',
};

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  outlet: string;
  kind: ResearchKind;
  publishedAt?: string;
  /** REQ-2.6: when the search read it. */
  consultedAt: string;
  /** The passage that matters, quoted as found. */
  excerpt: string;
  state: 'suggested' | 'accepted' | 'discarded';
};

export type OutlineSection = { id: string; heading: string; points: string[]; sourceIds: string[] };

export type HardNewsOutline = {
  headline: string;
  lead: string;
  sections: OutlineSection[];
  /** "Curto" (1 lauda) or "Padrão" (2 laudas), as in R1. */
  size: 'short' | 'standard';
  /** Keywords the AI suggests (REQ-2.7: always shown as suggestions); they prefill the CMS tags. */
  keywords?: string[];
};

export type ResearchState = 'idle' | 'searching' | 'done';

/** Where a covered story is: being researched, being written, or in the studio. */
export type DossierStage = 'research' | 'writing' | 'article';

export type HardNewsDossier = {
  productionId: string;
  newsId: string;
  /** The desk's angle for this story. */
  angle: string;
  research: ResearchState;
  searchedAt?: string;
  sources: ResearchSource[];
  /** Quote bank entries attached to the story (F2.11). */
  quoteIds: string[];
  /** Archive articles attached for context (F2.12). */
  archiveIds: string[];
  outline?: HardNewsOutline;
  stage: DossierStage;
  writtenAt?: string;
  /** Writing guide version the draft followed (REQ-2.5). */
  guideVersion?: number;
};

export function acceptedSources(dossier: { sources: readonly ResearchSource[] }): ResearchSource[] {
  return dossier.sources.filter((source) => source.state === 'accepted');
}

// ── F2.8 · Evidências ────────────────────────────────────────────────────────────────────────

export type EvidenceKind = 'unsupported' | 'attribution' | 'number';

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  unsupported: 'Sem fonte',
  attribution: 'Atribuição',
  number: 'Número diferente da fonte',
};

/**
 * `open` until a person decides; the decision is kept (REQ-2.8): `fixed` took the source's
 * wording, `confirmed` was checked by a person, `removed` took the claim out of the text.
 */
export type EvidenceState = 'open' | 'fixed' | 'confirmed' | 'removed';

export const EVIDENCE_STATE_LABELS: Record<Exclude<EvidenceState, 'open'>, string> = {
  fixed: 'Corrigida',
  confirmed: 'Conferida',
  removed: 'Removida',
};

export type EvidenceFlag = {
  id: string;
  kind: EvidenceKind;
  /** The claim exactly as written in the article. */
  claim: string;
  detail: string;
  /** What the closest source says, when there is one. */
  sourceId?: string;
  /** Wording the sources support, offered as "Corrigir". */
  fix?: string;
  state: EvidenceState;
  decidedBy?: string;
  decidedAt?: string;
};

export function openFlags(flags: readonly EvidenceFlag[]): EvidenceFlag[] {
  return flags.filter((flag) => flag.state === 'open');
}

// ── F2.13 · Enriquecimento ───────────────────────────────────────────────────────────────────

export type EnrichmentSuggestion = {
  id: string;
  kind: 'quote' | 'link';
  /** Quote text, or the archive headline the link points to. */
  text: string;
  /** Words of the article where it fits. */
  anchor: string;
  why: string;
  origin: { title: string; url?: string; date: string; author?: string };
  state: 'pending' | 'accepted' | 'rejected';
};

// ── F2.9 · Imagens do acervo ─────────────────────────────────────────────────────────────────

export type ImageLicense = 'own' | 'agency' | 'partner' | 'stock' | 'pending';

export const IMAGE_LICENSE_LABELS: Record<ImageLicense, string> = {
  own: 'Própria',
  agency: 'Agência',
  partner: 'Cedida',
  stock: 'Banco de imagens',
  pending: 'Direitos a confirmar',
};

/** The photo bank a stock image came from (Unsplash, Pexels), kept for attribution and dedupe. */
export type ImageOrigin = {
  provider: 'unsplash' | 'pexels';
  providerId: string;
  sourceUrl: string;
  licenseUrl: string;
  creator: string;
  creatorUrl?: string;
};

export type ArchiveImage = {
  id: string;
  src: string;
  width: number;
  height: number;
  caption: string;
  credit: string;
  license: ImageLicense;
  tags: string[];
  takenOn?: string;
  /** Published articles that used it. */
  uses: number;
  /** Set when the photo was saved from a photo bank. */
  origin?: ImageOrigin;
  /** Dominant color word (pt-BR), for the color filter. */
  color?: string;
};

/** A credited image can go into an article; one with pending rights cannot. */
export function imageUsable(image: Pick<ArchiveImage, 'license' | 'credit'>): boolean {
  return image.license !== 'pending' && image.credit.trim().length > 0;
}

// ── F2.10 · CMS ──────────────────────────────────────────────────────────────────────────────

export type CmsStatus = 'connected' | 'disconnected' | 'failing';
export type CmsMode = 'draft' | 'scheduled' | 'published';

export const CMS_MODE_LABELS: Record<CmsMode, string> = { draft: 'Rascunho', scheduled: 'Agendado', published: 'Publicado' };

export type CmsOption = { id: string; label: string };

export type CmsConnection = {
  platform: 'WordPress';
  siteUrl: string;
  account: string;
  status: CmsStatus;
  checkedAt?: string;
  /** What "Enviar ao CMS" creates; R2 starts with drafts. */
  mode: CmsMode;
  categories: CmsOption[];
  authors: CmsOption[];
  /** Reporter people → CMS authors. */
  authorMap: Record<string, string>;
  /** Required fields the portal refuses without. */
  requires: { category: boolean; image: boolean; excerpt: boolean };
};

export type CmsDeliveryState = 'idle' | 'sending' | 'sent' | 'failed';

export type CmsDelivery = {
  productionId: string;
  state: CmsDeliveryState;
  categoryId?: string;
  authorId?: string;
  slug: string;
  tags: string[];
  excerpt: string;
  remoteId?: string;
  url?: string;
  sentAt?: string;
  /** Article version that was sent: a later version resends as an update, never a new post. */
  sentVersion?: number;
  error?: string;
  attempts: number;
};

export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ── F2.11 · Banco de citações ────────────────────────────────────────────────────────────────

export type QuoteOrigin = 'transcript' | 'article' | 'event';

export const QUOTE_ORIGIN_LABELS: Record<QuoteOrigin, string> = { transcript: 'Entrevista', article: 'Matéria', event: 'Evento' };

export type BankQuote = {
  id: string;
  text: string;
  author: string;
  role: string;
  topic: string;
  origin: QuoteOrigin;
  sourceTitle: string;
  sourceUrl?: string;
  /** Timestamp or paragraph, only when the source has one (REQ-2.11). */
  locator?: string;
  /** Context of the passage, in the desk's words. */
  context: string;
  recordedOn: string;
  /** The author was confirmed with the source ("Autoria conferida"). */
  verified: boolean;
  /** An outline passage the text did not quote, kept for a person to check ("Sugerida"); never verified. */
  suggested?: boolean;
  uses: number;
  /** The productions that used it, newest first; the connected build only. */
  usedIn?: { productionId: string; title: string; at: string }[];
  /** Veracity of what was said (`fact-check.ts`); absent until checked. */
  factCheck?: FactCheck;
  /**
   * What the score's attribution reads when the shown fields fall back to placeholders (a
   * connected citation shows its material title and creation day when the programme and the
   * recording day are unknown). Absent: the shown fields are the real ones.
   */
  attribution?: { sourceNamed: boolean; dated: boolean };
  /** False when the source is no longer authorized: it can be read, not checked. */
  checkable?: boolean;
};

// ── F2.12 · Acervo ───────────────────────────────────────────────────────────────────────────

export type IndexState = 'indexed' | 'pending' | 'failed';

export type ArchiveArticle = {
  id: string;
  title: string;
  url: string;
  section: string;
  publishedAt: string;
  author: string;
  excerpt: string;
  index: IndexState;
};

export type ArchivePassage = { articleId: string; text: string };

/**
 * An answer reads only from the passages it cites. `none` is "no passage in the archive", which
 * is not evidence that something did not happen (REQ-2.12).
 */
export type ArchiveAnswer =
  | { question: string; kind: 'answer'; text: string; passages: ArchivePassage[] }
  | { question: string; kind: 'none' };
