import type { ActorId, ChannelId, DecisionId, DeliveryId, IsoDateTime, ProductionId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import type { VersionRef } from './refs.ts';

/**
 * A delivery sends approved versions to a channel. R1 has only `export` (files to download);
 * the same record carries CMS drafts (R2), social posts (R4) and R6 channels later.
 */

/** Channel ids come from the channels registry; R1 ships `export`. */
export const EXPORT_CHANNEL: ChannelId = 'export';

export type DeliveryMode = 'download' | 'draft' | 'scheduled' | 'published';

/** `jpg`/`png`/`webp`/`gif` are also the article's image files. */
export type DeliveryFormat = 'md' | 'html' | 'png' | 'pdf' | 'json' | 'txt' | 'docx' | 'jpg' | 'webp' | 'gif';

export type DeliveryItem = {
  version: VersionRef;
  /** The approval that authorises this exact version to leave (REQ-T.6). */
  decisionId: DecisionId;
  format: DeliveryFormat;
  fileName?: string;
};

export type DeliveryStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed' | 'scheduled';

export type DeliveryAttempt = {
  at: IsoDateTime;
  status: 'succeeded' | 'failed';
  /** File names or item keys covered by this attempt. */
  items?: string[];
  error?: { code: string; message: string };
};

export type Delivery = {
  id: DeliveryId;
  productionId: ProductionId;
  channel: ChannelId;
  mode?: DeliveryMode;
  items: DeliveryItem[];
  /** Id/URL in the destination (CMS post, social post); absent for downloads. */
  externalRef?: { id?: string; url?: string };
  attempts: DeliveryAttempt[];
  status: DeliveryStatus;
  scheduledAt?: IsoDateTime;
  /** Same key → same delivery; retries never duplicate a publication. */
  idempotencyKey: string;
  createdBy: ActorId;
  createdAt: IsoDateTime;
};

const FILE_PREFIX: Partial<Record<PieceKind, string>> = { article: 'artigo', carousel: 'carrossel' };

/** "artigo-v4.md", "carrossel-v2-slide-03.png", "carrossel-v2.pdf". */
export function exportFileName(kind: PieceKind, version: Pick<VersionRef, 'number'>, format: DeliveryFormat, slideIndex?: number): string {
  const prefix = FILE_PREFIX[kind] ?? kind;
  const slide = slideIndex === undefined ? '' : `-slide-${String(slideIndex + 1).padStart(2, '0')}`;
  return `${prefix}-v${version.number}${slide}.${format}`;
}

export const MANIFEST_FILE_NAME = 'manifesto.json';

/**
 * Article image files sit next to the article files (downloads have no folders, and the .md/.html
 * point at these names): "estudio-norte-amplia-a-producao-destaque.jpg" for the cover,
 * "estudio-norte-amplia-a-producao-2.png" for the figures (n is 1-based, in reading order).
 */
export function imageFileName(slug: string, image: { role: 'cover' } | { role: 'figure'; n: number }, extension: string): string {
  const base = slug || 'imagem';
  return image.role === 'cover' ? `${base}-destaque.${extension}` : `${base}-${image.n}.${extension}`;
}

/** Deterministic idempotency key: same production + same exact versions + channel. */
export function deliveryIdempotencyKey(productionId: ProductionId, channel: ChannelId, versions: readonly VersionRef[]): string {
  const parts = versions.map((ref) => `${ref.pieceId}@${ref.versionId}:${ref.hash}`).sort();
  return `${productionId}|${channel}|${parts.join('|')}`;
}
