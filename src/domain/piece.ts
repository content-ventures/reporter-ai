import { articleHash } from './article.ts';
import type { ArticleBody } from './article.ts';
import { carouselHash } from './carousel.ts';
import type { CarouselBody } from './carousel.ts';
import type { ActorId, IsoDateTime, PieceId, ProductionId, RunId, VersionId } from './ids.ts';
import type { SourceVersionRef, VersionRef } from './refs.ts';

/** `article` and `carousel` are live in R1; the rest are reserved plug points (R3–R6). */
export type PieceKind =
  | 'article'
  | 'carousel'
  | 'outline'
  | 'cut'
  | 'script'
  | 'audio'
  | 'video'
  | 'stories'
  | 'webstory'
  | 'newsletter'
  | 'post';

export const R1_PIECE_KINDS: readonly PieceKind[] = ['article', 'carousel'];

/** Body per piece kind. Reserved kinds add their own body types when they ship. */
export type PieceBody = ArticleBody | CarouselBody;

/**
 * The working draft: a single overwritten slot (never appended), autosaved with a revision
 * counter for optimistic concurrency (`saveDraft` with a stale revision is a conflict).
 */
export type WorkingDraft = {
  body: PieceBody;
  revision: number;
  /** Version the draft started from (latest saved, restored or generated). */
  basedOn?: VersionId;
  /** Approved parent versions this draft derives from (carousel → article vN). */
  inputs: VersionRef[];
  /** Source versions the content was built from. */
  sources: SourceVersionRef[];
  updatedAt: IsoDateTime;
  updatedBy: ActorId;
};

export type Piece = {
  id: PieceId;
  productionId: ProductionId;
  kind: PieceKind;
  /** Route segment: `article`, `carousel`; later `cut-2`, `stories`… */
  slug: string;
  draft: WorkingDraft;
  createdAt: IsoDateTime;
  createdBy: ActorId;
};

export type VersionOrigin = 'generation' | 'edit' | 'suggestion' | 'restore';

/** Immutable snapshot of a piece body, identified by id + content hash. */
export type Version = {
  id: VersionId;
  pieceId: PieceId;
  number: number;
  body: PieceBody;
  hash: string;
  origin: VersionOrigin;
  runId?: RunId;
  /** Approved parent versions (plural: a newsletter compiles many, F6.5). */
  inputs: VersionRef[];
  sources: SourceVersionRef[];
  /** Previous version of the same piece this one was edited from. */
  basedOn?: VersionId;
  restoredFrom?: VersionId;
  /** Generation stopped by the user or by a failure; the partial output is kept. */
  interrupted?: boolean;
  createdBy: ActorId;
  createdAt: IsoDateTime;
};

export function bodyHash(body: PieceBody): string {
  return body.type === 'article' ? articleHash(body) : carouselHash(body);
}

export function toVersionRef(version: Version): VersionRef {
  return { kind: 'version', pieceId: version.pieceId, versionId: version.id, number: version.number, hash: version.hash };
}

/** pt-BR label used across studio, review and delivery: "v1 · IA", "v4 · restaurada da v2". */
export function versionLabel(version: Version, all: readonly Version[] = []): string {
  const base = `v${version.number}`;
  if (version.origin === 'generation') return version.interrupted ? `${base} · interrompida` : `${base} · IA`;
  if (version.origin === 'restore') {
    const source = all.find((candidate) => candidate.id === version.restoredFrom);
    return source ? `${base} · restaurada da v${source.number}` : `${base} · restaurada`;
  }
  if (version.origin === 'suggestion') return `${base} · sugestão aceita`;
  return base;
}

export const PIECE_LABELS: Record<PieceKind, string> = {
  article: 'Artigo',
  carousel: 'Carrossel',
  outline: 'Estrutura',
  cut: 'Corte',
  script: 'Roteiro',
  audio: 'Áudio',
  video: 'Vídeo',
  stories: 'Stories',
  webstory: 'Web story',
  newsletter: 'Newsletter',
  post: 'Post',
};
