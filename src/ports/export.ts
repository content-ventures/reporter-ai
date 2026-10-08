import type { DeliveryFormat, DeliveryItem } from '../domain/delivery.ts';
import type { IsoDateTime, PieceId, ProductionId, VersionId } from '../domain/ids.ts';
import type { DeliveryManifest, ExportImage } from '../domain/manifest.ts';
import type { PieceKind } from '../domain/piece.ts';
import type { VersionRef } from '../domain/refs.ts';
import type { Result } from '../domain/result.ts';
import type { ExportItem, ExportRefusal } from '../domain/rules/export.ts';

/**
 * Export port (F1.6, REQ-1.6, REQ-T.2). Builds the final package of APPROVED versions only, and
 * refuses mixed versions (a carousel written from article v4 next to article v5). Formats the
 * current adapter cannot produce stay listed, disabled, with the pt-BR reason.
 */

export type PackageFormat = DeliveryFormat | 'zip';

export type PackageFile = {
  /** Image files sit next to the article files: `<slug>-destaque.<ext>`, `<slug>-<n>.<ext>`. */
  fileName: string;
  format: PackageFormat;
  mimeType: string;
  kind: PieceKind | 'manifest' | 'package' | 'image';
  pieceId?: PieceId;
  versionId?: VersionId;
  /** 0-based slide index for one-file-per-slide formats. */
  slideIndex?: number;
  /**
   * Article images: the asset, its uses (cover/figure, alt, caption) and metadata (origin, credit,
   * rights). Linked images (`asset.origin.type === 'url'`) are listed disabled as "Link externo".
   */
  image?: ExportImage;
  available: boolean;
  unavailableReason?: string;
};

export type ExportPlan = {
  selection: VersionRef[];
  items: ExportItem[];
  files: PackageFile[];
  /** Same package → same key: retries add attempts, never duplicate deliveries. */
  idempotencyKey: string;
};

export type BuiltFileStatus = 'ready' | 'failed' | 'unavailable';

export type BuiltFile = PackageFile & {
  status: BuiltFileStatus;
  /**
   * URL for a DS link with `href` + `download` (product code creates no DOM): a `data:` URL for
   * generated files, the image's `blob:` URL for article images.
   */
  href?: string;
  bytes?: number;
  /** Text content of textual formats (md, html, json), for previews and tests. */
  text?: string;
  error?: { code: string; message: string };
};

/** Result of one produced file, shaped for `ProductionCommands.recordDelivery({ files })`. */
export type FileOutcome = {
  fileName: string;
  format: DeliveryFormat;
  versionId?: VersionId;
  ok: boolean;
  error?: { code: string; message: string };
};

export type ExportPackage = {
  plan: ExportPlan;
  files: BuiltFile[];
  manifest: DeliveryManifest;
  /** One per built file of an approved version (what left, from which decision). */
  deliveryItems: DeliveryItem[];
  /** Every attempted file (disabled formats excluded), for the delivery record. */
  outcomes: FileOutcome[];
  status: 'completed' | 'partial' | 'failed';
  builtAt: IsoDateTime;
};

export type ExportRequest = {
  productionId: ProductionId;
  /** Exact versions to export; default: the latest approved version of each planned piece. */
  selection?: VersionRef[];
  /** Simulation scenario id (e.g. a file failing once); remote adapters ignore it. */
  simulation?: string;
};

export type ExportServiceRefusal = ExportRefusal | 'unknown_production' | 'unknown_file' | 'file_unavailable';

export interface ExportService {
  /** The file list of the package (Entrega screen), without building contents. */
  plan(request: ExportRequest): Promise<Result<ExportPlan, ExportServiceRefusal>>;
  /** Builds every available file; one failing file makes the package `partial`. */
  build(request: ExportRequest): Promise<Result<ExportPackage, ExportServiceRefusal>>;
  /** Builds (or retries) one file of the package. */
  buildFile(request: ExportRequest & { fileName: string }): Promise<Result<BuiltFile, ExportServiceRefusal>>;
}
