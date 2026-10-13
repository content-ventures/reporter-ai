import { PIECE_LABELS, PIECE_PARENTS } from '../domain/index.ts';
import type { DeliveryFormat, GateId, PieceKind } from '../domain/index.ts';
import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Piece kinds (the `[piece]` route segment). R1 ships article and carousel; each later kind
 * brings its own studio, review body and export formats but reuses the same gate, version and
 * delivery model.
 */

export type PieceKindEntry = {
  kind: PieceKind;
  label: string;
  /** Route segment under `/productions/[id]/`. */
  slug: string;
  icon: IconKey;
  since: ReleaseId;
  /** Approval gate for this kind (absent: no human gate yet). */
  gateId?: GateId;
  /** Kinds that must be approved first (REQ-1.3: carousel ← approved article). */
  parents: PieceKind[];
  /** Files the export channel produces for this kind. */
  exportFormats: DeliveryFormat[];
  /** Mandatory in the production plan (R1: the article). */
  required: boolean;
};

function entry(
  kind: PieceKind,
  since: ReleaseId,
  icon: IconKey,
  options: { gateId?: GateId; exportFormats?: DeliveryFormat[]; required?: boolean } = {},
): PieceKindEntry {
  const value: PieceKindEntry = {
    kind,
    label: PIECE_LABELS[kind],
    slug: kind,
    icon,
    since,
    parents: [...(PIECE_PARENTS[kind] ?? [])],
    exportFormats: options.exportFormats ?? [],
    required: options.required ?? false,
  };
  if (options.gateId) value.gateId = options.gateId;
  return value;
}

export const PIECE_KINDS: readonly PieceKindEntry[] = [
  entry('article', 'R1', 'FileText', { gateId: 'article.approval', exportFormats: ['md', 'html'], required: true }),
  entry('carousel', 'R1', 'Presentation', { gateId: 'carousel.approval', exportFormats: ['png', 'pdf', 'json'] }),
  entry('outline', 'R3', 'ListChecks', { gateId: 'outline.approval' }),
  entry('cut', 'R4', 'Captions', { gateId: 'cut.approval' }),
  entry('script', 'R5', 'FileSignature', { gateId: 'script.approval' }),
  entry('audio', 'R5', 'Volume2', { gateId: 'media.approval' }),
  entry('video', 'R5', 'FileVideo', { gateId: 'media.approval' }),
  entry('stories', 'R6', 'Smartphone', { gateId: 'creative.approval' }),
  entry('webstory', 'R6', 'MonitorSmartphone', { gateId: 'creative.approval' }),
  entry('newsletter', 'R6', 'Mail', { gateId: 'newsletter.approval' }),
  entry('post', 'R6', 'AtSign', { gateId: 'creative.approval' }),
];

export function pieceKindsFor(release: ReleaseId = CURRENT_RELEASE): PieceKindEntry[] {
  return availableIn(PIECE_KINDS, release);
}

export function pieceKind(kind: PieceKind): PieceKindEntry | undefined {
  return PIECE_KINDS.find((candidate) => candidate.kind === kind);
}

/** Resolves a `[piece]` route segment for a release; unknown or future slugs → undefined (404). */
export function pieceKindBySlug(slug: string, release: ReleaseId = CURRENT_RELEASE): PieceKindEntry | undefined {
  return pieceKindsFor(release).find((candidate) => candidate.slug === slug);
}
