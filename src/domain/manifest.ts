import { articleImages } from './article.ts';
import type { ArticleBody } from './article.ts';
import { imageExtension, NO_ASSETS, sameRights } from './asset.ts';
import type { AssetLookup, AssetOrigin, AssetRights, ImageAsset, ImageRightsRecord } from './asset.ts';
import type { AssetId, BlockId, DecisionId, IsoDateTime, PersonId, PieceId, ProductionId, RunId, SourceId, VersionId } from './ids.ts';
import { exportFileName, imageFileName, MANIFEST_FILE_NAME } from './delivery.ts';
import type { DeliveryFormat } from './delivery.ts';
import type { PieceKind } from './piece.ts';
import { decidedImageRights, findVersion } from './record.ts';
import type { ProductionRecord } from './record.ts';
import type { ExportItem } from './rules/export.ts';
import type { ModelInfo, PromptRef, RunKind } from './run.ts';
import { currentSourceVersion } from './source.ts';
import { slugify } from './text/normalize.ts';

/**
 * The R1 delivery file set, designed for the final package (critique #1): article as .md and
 * semantic .html with its image files (next to them: downloads have no folders), one PNG per slide
 * plus a PDF of the sequence, and a manifest that keeps the source → article → creative → versions
 * link and the origin, credit and rights of every image (REQ-1.6, REQ-T.2, R2 REQ-2.9).
 */

/** One place the article uses an image. */
export type ExportImageUse = { role: 'cover' | 'figure'; blockId: BlockId; alt?: string; caption?: string };

/** An image of the exported article version (one file per distinct asset). */
export type ExportImage = {
  assetId: AssetId;
  uses: ExportImageUse[];
  /** Metadata from the AssetStore; absent when the image is not in this browser. */
  asset?: ImageAsset;
  /** Credit and rights as the approval kept them, when they changed since (see `Decision.images`). */
  approved?: ImageRightsRecord;
};

export type ExportFile = {
  fileName: string;
  format: DeliveryFormat;
  kind: PieceKind | 'manifest' | 'image';
  versionId?: VersionId;
  slideIndex?: number;
  /** Image files: the asset and where the article uses it. */
  image?: ExportImage;
  /** Formats the current adapter cannot produce yet stay listed, disabled, with the reason. */
  available: boolean;
  unavailableReason?: string;
};

/** Linked images stay where they are (the browser may not read another site's file): only the address leaves. */
export const EXTERNAL_IMAGE_REASON = 'Link externo: fica no endereço original, citado no .md, no .html e no manifesto.';
export const MISSING_IMAGE_REASON = 'Imagem não encontrada neste navegador.';

export type FormatSupport = Partial<Record<DeliveryFormat, true | string>>;

/** Default support of the local adapter: everything renders in the browser. */
export const LOCAL_FORMAT_SUPPORT: FormatSupport = { md: true, html: true, png: true, pdf: true, json: true };

const ARTICLE_FORMATS: readonly DeliveryFormat[] = ['md', 'html'];
const CAROUSEL_FORMATS: readonly DeliveryFormat[] = ['png', 'pdf'];

function availability(format: DeliveryFormat, support: FormatSupport): Pick<ExportFile, 'available' | 'unavailableReason'> {
  const entry = support[format];
  if (entry === true) return { available: true };
  return { available: false, unavailableReason: typeof entry === 'string' ? entry : 'Formato ainda não disponível.' };
}

const IMAGE_FORMATS: readonly DeliveryFormat[] = ['jpg', 'png', 'webp', 'gif'];

/**
 * Image files of one article version, in reading order (cover first), one per distinct asset:
 * "<slug do título>-destaque.<ext>", then "<slug do título>-<n>.<ext>". Linked images and images
 * missing from this browser stay listed, disabled, with the reason; images never block the
 * package. `approved`: credit and rights as the version's approval kept them.
 */
export function exportImageFiles(
  body: ArticleBody,
  versionId: VersionId,
  assets: AssetLookup = NO_ASSETS,
  approved?: readonly ImageRightsRecord[],
): ExportFile[] {
  const slug = slugify(body.title);
  const byAsset = new Map<AssetId, ExportImage>();
  for (const use of articleImages(body)) {
    const entry: ExportImageUse = { role: use.role, blockId: use.blockId };
    if (use.image.alt) entry.alt = use.image.alt;
    if (use.image.caption) entry.caption = use.image.caption;
    const existing = byAsset.get(use.image.assetId);
    if (existing) {
      existing.uses.push(entry);
      continue;
    }
    const image: ExportImage = { assetId: use.image.assetId, uses: [entry] };
    const asset = assets(use.image.assetId);
    if (asset) image.asset = asset;
    const kept = approved?.find((record) => record.assetId === use.image.assetId);
    if (asset && kept && !sameRights(asset, kept)) image.approved = kept;
    byAsset.set(use.image.assetId, image);
  }
  let figures = 0;
  return [...byAsset.values()].map((image) => {
    const extension = image.asset ? imageExtension(image.asset) : 'jpg';
    const format = (IMAGE_FORMATS as readonly string[]).includes(extension) ? (extension as DeliveryFormat) : 'jpg';
    const cover = image.uses.some((use) => use.role === 'cover');
    if (!cover) figures += 1;
    const fileName = imageFileName(slug, cover ? { role: 'cover' } : { role: 'figure', n: figures }, extension);
    const file: ExportFile = { fileName, format, kind: 'image', versionId, image, available: true };
    if (!image.asset) return { ...file, available: false, unavailableReason: MISSING_IMAGE_REASON };
    if (image.asset.origin.type === 'url') return { ...file, available: false, unavailableReason: EXTERNAL_IMAGE_REASON };
    return file;
  });
}

/** Where the exported .md/.html points each image: the package file, or a linked image's address. */
export type ExportImageSource = { src: string; credit?: string; width?: number; height?: number };

export function exportImageSources(files: readonly Pick<ExportFile, 'fileName' | 'available' | 'image'>[]): ReadonlyMap<AssetId, ExportImageSource> {
  const sources = new Map<AssetId, ExportImageSource>();
  for (const file of files) {
    const asset = file.image?.asset;
    if (!file.image || !asset) continue;
    const src = asset.origin.type === 'url' ? asset.origin.url : file.available ? file.fileName : undefined;
    if (!src) continue;
    const source: ExportImageSource = { src };
    if (asset.credit?.trim()) source.credit = asset.credit.trim();
    if (asset.width) source.width = asset.width;
    if (asset.height) source.height = asset.height;
    sources.set(file.image.assetId, source);
  }
  return sources;
}

export function plannedExportFiles(
  record: Pick<ProductionRecord, 'versions' | 'decisions'>,
  items: readonly ExportItem[],
  support: FormatSupport = LOCAL_FORMAT_SUPPORT,
  assets: AssetLookup = NO_ASSETS,
): ExportFile[] {
  const files: ExportFile[] = [];
  for (const item of items) {
    const version = findVersion(record, item.version.versionId);
    if (item.kind === 'article') {
      for (const format of ARTICLE_FORMATS) {
        files.push({ fileName: exportFileName('article', item.version, format), format, kind: 'article', versionId: item.version.versionId, ...availability(format, support) });
      }
      if (version?.body.type === 'article') files.push(...exportImageFiles(version.body, item.version.versionId, assets, decidedImageRights(record, version)));
    } else if (item.kind === 'carousel' && version?.body.type === 'carousel') {
      version.body.slides.forEach((_, index) => {
        files.push({
          fileName: exportFileName('carousel', item.version, 'png', index),
          format: 'png',
          kind: 'carousel',
          versionId: item.version.versionId,
          slideIndex: index,
          ...availability('png', support),
        });
      });
      for (const format of CAROUSEL_FORMATS.filter((entry) => entry !== 'png')) {
        files.push({ fileName: exportFileName('carousel', item.version, format), format, kind: 'carousel', versionId: item.version.versionId, ...availability(format, support) });
      }
    }
  }
  files.push({ fileName: MANIFEST_FILE_NAME, format: 'json', kind: 'manifest', ...availability('json', support) });
  return files;
}

export type DeliveryManifest = {
  schema: 'reporter.delivery/v1';
  generatedAt: IsoDateTime;
  production: { id: ProductionId; title: string };
  sources: { id: SourceId; title: string; version: number; hash: string; authorized: boolean }[];
  items: {
    kind: PieceKind;
    pieceId: PieceId;
    versionId: VersionId;
    version: number;
    hash: string;
    decisionId: DecisionId;
    approvedBy: PersonId;
    approvedAt: IsoDateTime;
    derivedFrom: { pieceId: PieceId; version: number; hash: string }[];
    sourceVersions: { sourceId: SourceId; version: number; hash: string }[];
    runId?: RunId;
    files: string[];
  }[];
  runs: { id: RunId; kind: RunKind; prompt: PromptRef; model: ModelInfo; startedAt?: IsoDateTime; endedAt?: IsoDateTime }[];
  /** Every image of the exported article: origin, credit, rights, size and digest (R2 REQ-2.9). */
  assets: ManifestAsset[];
};

export type ManifestAsset = {
  id: AssetId;
  /** Package file; absent for linked images and images missing from this browser. */
  fileName?: string;
  /** The file travels in this package. */
  included: boolean;
  /** Linked image: the address the .md/.html point to. */
  url?: string;
  /** Why the file is not in the package. */
  note?: string;
  origin?: AssetOrigin;
  credit?: string;
  rights?: AssetRights;
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** SHA-256 (hex) of the bytes in the package. */
  sha256?: string;
  /** Credit and rights as the approval kept them, when they changed since (`credit`/`rights` are the current ones). */
  approvedAs?: { credit?: string; rights: AssetRights };
  usedIn: (ExportImageUse & { versionId: VersionId })[];
};

/** Per asset: the digest and size of the bytes actually written to the package. */
export type AssetDigests = Readonly<Record<AssetId, { sha256: string; bytes: number }>>;

function manifestAsset(file: ExportFile & { image: ExportImage }, digests: AssetDigests): ManifestAsset {
  const { image } = file;
  const asset = image.asset;
  const entry: ManifestAsset = {
    id: image.assetId,
    included: file.available,
    usedIn: image.uses.map((use) => ({ ...use, versionId: file.versionId ?? '' })),
  };
  if (file.available) entry.fileName = file.fileName;
  else if (file.unavailableReason) entry.note = file.unavailableReason;
  if (asset) {
    entry.origin = asset.origin;
    if (asset.origin.type === 'url') entry.url = asset.origin.url;
    if (asset.credit?.trim()) entry.credit = asset.credit.trim();
    entry.rights = asset.rights;
    if (asset.mime) entry.mime = asset.mime;
    if (asset.width) entry.width = asset.width;
    if (asset.height) entry.height = asset.height;
    if (asset.bytes) entry.bytes = asset.bytes;
  }
  if (image.approved) {
    entry.approvedAs = { rights: image.approved.rights };
    if (image.approved.credit) entry.approvedAs.credit = image.approved.credit;
  }
  const digest = file.available ? digests[image.assetId] : undefined;
  if (digest) {
    entry.sha256 = digest.sha256;
    entry.bytes = digest.bytes;
  }
  return entry;
}

export function buildManifest(
  record: ProductionRecord,
  items: readonly ExportItem[],
  files: readonly ExportFile[],
  generatedAt: IsoDateTime,
  digests: AssetDigests = {},
): DeliveryManifest {
  const runIds = new Set<RunId>();
  const manifestItems = items.map((item) => {
    const version = findVersion(record, item.version.versionId);
    const decision = record.decisions.find((entry) => entry.id === item.decisionId);
    if (version?.runId) runIds.add(version.runId);
    const entry: DeliveryManifest['items'][number] = {
      kind: item.kind,
      pieceId: item.version.pieceId,
      versionId: item.version.versionId,
      version: item.version.number,
      hash: item.version.hash,
      decisionId: item.decisionId,
      approvedBy: decision?.by ?? '',
      approvedAt: decision?.at ?? '',
      derivedFrom: (version?.inputs ?? []).map((input) => ({ pieceId: input.pieceId, version: input.number, hash: input.hash })),
      sourceVersions: (version?.sources ?? []).map((source) => ({ sourceId: source.sourceId, version: source.sourceVersion, hash: source.hash })),
      files: files.filter((file) => file.versionId === item.version.versionId && file.available).map((file) => file.fileName),
    };
    if (version?.runId) entry.runId = version.runId;
    return entry;
  });
  return {
    schema: 'reporter.delivery/v1',
    generatedAt,
    production: { id: record.production.id, title: record.production.title },
    sources: record.sources.map((source) => {
      const version = currentSourceVersion(source);
      return { id: source.id, title: source.title, version: version.number, hash: version.hash, authorized: source.rights.authorized };
    }),
    items: manifestItems,
    runs: record.runs
      .filter((run) => runIds.has(run.id))
      .map((run) => {
        const entry: DeliveryManifest['runs'][number] = { id: run.id, kind: run.kind, prompt: run.prompt, model: run.model };
        if (run.startedAt) entry.startedAt = run.startedAt;
        if (run.endedAt) entry.endedAt = run.endedAt;
        return entry;
      }),
    assets: files.filter((file): file is ExportFile & { image: ExportImage } => file.image !== undefined).map((file) => manifestAsset(file, digests)),
  };
}
