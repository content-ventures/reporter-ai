import { NO_ASSETS } from '../../../domain/asset.ts';
import type { AssetLookup } from '../../../domain/asset.ts';
import type { CarouselBody } from '../../../domain/carousel.ts';
import { deliveryIdempotencyKey, EXPORT_CHANNEL, exportFileName, MANIFEST_FILE_NAME } from '../../../domain/delivery.ts';
import type { DeliveryFormat, DeliveryItem } from '../../../domain/delivery.ts';
import type { AssetId, ProductionId } from '../../../domain/ids.ts';
import { buildManifest, exportImageSources, MISSING_IMAGE_REASON, plannedExportFiles } from '../../../domain/manifest.ts';
import type { AssetDigests, ExportFile, FormatSupport } from '../../../domain/manifest.ts';
import { versionLabel } from '../../../domain/piece.ts';
import type { Version } from '../../../domain/piece.ts';
import { carouselArticleCover, findVersion } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { canExport, defaultExportSelection } from '../../../domain/rules/export.ts';
import type {
  BuiltFile,
  ExportPackage,
  ExportPlan,
  ExportRequest,
  ExportService,
  ExportServiceRefusal,
  FileOutcome,
  PackageFile,
  PackageFormat,
} from '../../../ports/export.ts';
import type { AssetStore } from '../../../ports/assets.ts';
import type { RenderService } from '../../../ports/render.ts';
import type { Clock } from '../../../ports/system.ts';
import { sha256Hex } from '../assets/sha256.ts';
import { dataUrl, utf8 } from '../render/encoding.ts';
import { carouselJson } from './carousel-json.ts';
import { articleToHtml } from './html.ts';
import { articleToMarkdown } from './markdown.ts';

/**
 * Local ExportService (F1.6): builds the package of APPROVED versions in the browser — article
 * as .md and semantic .html with its image files (next to them, the stored bytes as they are), one
 * PNG per slide (RenderService, the article cover drawn where the template asks for it), the
 * carousel as .json and the manifest (source hash, versions, decisions, runs, image origin,
 * credit, rights and SHA-256). Linked images cannot be downloaded by the browser (CORS): they
 * stay listed as "Link externo" and the .md/.html point at their address. PDF, DOCX and the .zip
 * need a dependency or a server: they stay listed, disabled, with the reason. `canExport` is
 * enforced on every call; images never block the package.
 */

export type LocalExportDeps = {
  clock: Clock;
  getRecord: (productionId: ProductionId) => ProductionRecord | undefined;
  render: RenderService;
  /** Article images (bytes, metadata, object URLs). Without it, images are listed as missing. */
  assets?: AssetStore;
};

export const MIME_TYPES: Record<PackageFormat, string> = {
  md: 'text/markdown',
  html: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};

const SERVER_ONLY = 'Disponível com a exportação no servidor.';
const PDF_REASON = 'Disponível com o render final do carrossel.';
const PACKAGE_NAME = 'pacote.zip';

/** Simulation scenario: one file fails on the first build and works on retry. */
export const EXPORT_PARTIAL_FAILURE = 'export-partial';

function withType(file: ExportFile, pieceId?: string): PackageFile {
  const packaged: PackageFile = { ...file, mimeType: MIME_TYPES[file.format] };
  if (pieceId) packaged.pieceId = pieceId;
  return packaged;
}

function disabled(fileName: string, format: PackageFormat, kind: PackageFile['kind'], reason: string, version?: Version): PackageFile {
  const file: PackageFile = { fileName, format, mimeType: MIME_TYPES[format], kind, available: false, unavailableReason: reason };
  if (version) {
    file.pieceId = version.pieceId;
    file.versionId = version.id;
  }
  return file;
}

export function createLocalExportService(deps: LocalExportDeps): ExportService {
  const failedOnce = new Set<string>();
  /** Assets never change their bytes: one digest per asset for the life of the service. */
  const digests = new Map<AssetId, { sha256: string; bytes: number }>();
  const lookup: AssetLookup = deps.assets ? (assetId) => deps.assets?.get(assetId) : NO_ASSETS;
  const assetsReady = async () => {
    await deps.assets?.ready();
  };

  const support = (): FormatSupport => {
    const raster = deps.render.capabilities();
    return { md: true, html: true, json: true, png: raster.raster ? true : (raster.reason ?? 'Imagens indisponíveis neste navegador.'), pdf: PDF_REASON };
  };

  const planFor = (request: ExportRequest): Result<{ plan: ExportPlan; record: ProductionRecord }, ExportServiceRefusal> => {
    const record = deps.getRecord(request.productionId);
    if (!record) return refuse('unknown_production', 'Produção não encontrada.');
    const selection = request.selection ?? defaultExportSelection(record);
    const checked = canExport(record, selection);
    if (!checked.ok) return checked;
    const items = checked.value;
    const files: PackageFile[] = [];
    const planned = plannedExportFiles(record, items, support(), lookup).filter((file) => file.kind !== 'manifest');
    for (const item of items) {
      const version = findVersion(record, item.version.versionId);
      const own = planned.filter((file) => file.versionId === item.version.versionId).map((file) => withType(file, item.version.pieceId));
      files.push(...own.filter((file) => file.kind !== 'image'));
      if (item.kind === 'article' && version) files.push(disabled(exportFileName('article', item.version, 'docx'), 'docx', 'article', SERVER_ONLY, version));
      files.push(...own.filter((file) => file.kind === 'image'));
      if (item.kind === 'carousel' && version) {
        files.push({
          fileName: exportFileName('carousel', item.version, 'json'),
          format: 'json',
          mimeType: MIME_TYPES.json,
          kind: 'carousel',
          pieceId: version.pieceId,
          versionId: version.id,
          available: true,
        });
      }
    }
    files.push({ fileName: MANIFEST_FILE_NAME, format: 'json', mimeType: MIME_TYPES.json, kind: 'manifest', available: true });
    files.push(disabled(PACKAGE_NAME, 'zip', 'package', SERVER_ONLY));
    return ok({
      record,
      plan: { selection, items, files, idempotencyKey: deliveryIdempotencyKey(record.production.id, EXPORT_CHANNEL, selection) },
    });
  };

  const textFile = (file: PackageFile, text: string): BuiltFile => {
    const bytes = utf8(text);
    return { ...file, status: 'ready', text, bytes: bytes.length, href: dataUrl(`${file.mimeType};charset=utf-8`, bytes) };
  };

  const failed = (file: PackageFile, message: string, code = 'build_failed'): BuiltFile => ({ ...file, status: 'failed', error: { code, message } });

  /** Simulated failure: the first PNG (or the HTML) fails once per package. */
  const simulateFailure = (request: ExportRequest, plan: ExportPlan, file: PackageFile): boolean => {
    if (request.simulation !== EXPORT_PARTIAL_FAILURE) return false;
    const victim = plan.files.find((entry) => entry.format === 'png' && entry.available) ?? plan.files.find((entry) => entry.format === 'html');
    const key = `${plan.idempotencyKey}|${file.fileName}`;
    if (victim?.fileName !== file.fileName || failedOnce.has(key)) return false;
    failedOnce.add(key);
    return true;
  };

  /** Builds one non-manifest file. */
  const buildOne = async (record: ProductionRecord, plan: ExportPlan, file: PackageFile, request: ExportRequest): Promise<BuiltFile> => {
    if (!file.available) return { ...file, status: 'unavailable' };
    if (simulateFailure(request, plan, file)) return failed(file, 'Falha simulada ao gerar este arquivo. Tente de novo.', 'simulated_failure');
    const version = file.versionId ? findVersion(record, file.versionId) : undefined;
    if (!version) return failed(file, 'Versão não encontrada.');
    if (file.kind === 'image') return imageFile(file);
    const label = versionLabel(version);
    if (version.body.type === 'article') {
      const sources = exportImageSources(plan.files.filter((entry) => entry.versionId === version.id));
      if (file.format === 'md') return textFile(file, articleToMarkdown(version.body, sources));
      if (file.format === 'html') return textFile(file, articleToHtml(version.body, { versionLabel: `Artigo ${label}`, hash: version.hash }, sources));
    }
    if (version.body.type === 'carousel') {
      if (file.format === 'json') return textFile(file, `${JSON.stringify(carouselJson(version, version.body), null, 2)}\n`);
      if (file.format === 'png') return pngFile(file, version.body, carouselArticleCover(record, version.inputs)?.assetId);
    }
    return failed(file, 'Formato sem gerador.');
  };

  /** The stored bytes as they are, linked by their object URL; the digest goes to the manifest. */
  const imageFile = async (file: PackageFile): Promise<BuiltFile> => {
    const assetId = file.image?.assetId;
    const blob = assetId ? await deps.assets?.blob(assetId) : undefined;
    if (!assetId || !blob) return failed(file, MISSING_IMAGE_REASON, 'missing_image');
    try {
      if (!digests.has(assetId)) digests.set(assetId, { sha256: await sha256Hex(new Uint8Array(await blob.arrayBuffer())), bytes: blob.size });
      const href = (await deps.assets?.objectUrl(assetId)) ?? dataUrl(file.mimeType, new Uint8Array(await blob.arrayBuffer()));
      return { ...file, status: 'ready', href, bytes: blob.size };
    } catch {
      return failed(file, 'Não foi possível ler esta imagem. Tente de novo.', 'unreadable_image');
    }
  };

  const pngFile = async (file: PackageFile, body: CarouselBody, articleCover?: AssetId): Promise<BuiltFile> => {
    const slide = file.slideIndex === undefined ? undefined : body.slides[file.slideIndex];
    if (!slide) return failed(file, 'Slide não encontrado.');
    const rendered = await deps.render.render({ body, slideIds: [slide.id], ...(articleCover ? { articleCover } : {}) });
    const image = rendered.ok ? rendered.value.slides[0]?.image : undefined;
    if (!image) {
      const reason = rendered.ok ? rendered.value.slides[0]?.unavailableReason : rendered.refusal.message;
      return failed(file, reason ?? 'Não foi possível desenhar o slide.');
    }
    return { ...file, status: 'ready', href: image.dataUrl, bytes: image.bytes };
  };

  const manifestFile = (record: ProductionRecord, plan: ExportPlan, built: readonly BuiltFile[]): { file: BuiltFile; manifest: ExportPackage['manifest'] } => {
    const exportFiles: ExportFile[] = built
      .filter((file): file is BuiltFile & { kind: ExportFile['kind']; format: DeliveryFormat } => file.kind !== 'package' && file.format !== 'zip')
      .map((file) => {
        const entry: ExportFile = { fileName: file.fileName, format: file.format, kind: file.kind, available: file.status === 'ready' };
        if (file.versionId) entry.versionId = file.versionId;
        if (file.slideIndex !== undefined) entry.slideIndex = file.slideIndex;
        if (file.image) entry.image = file.image;
        const reason = file.unavailableReason ?? file.error?.message;
        if (file.status !== 'ready' && reason) entry.unavailableReason = reason;
        return entry;
      });
    const included: AssetDigests = Object.fromEntries(
      built.filter((file) => file.kind === 'image' && file.status === 'ready' && file.image && digests.has(file.image.assetId)).map((file) => {
        const assetId = file.image?.assetId as AssetId;
        return [assetId, digests.get(assetId) as { sha256: string; bytes: number }];
      }),
    );
    const manifest = buildManifest(record, plan.items, exportFiles, deps.clock.now(), included);
    const template = plan.files.find((file) => file.kind === 'manifest') as PackageFile;
    return { file: textFile(template, `${JSON.stringify(manifest, null, 2)}\n`), manifest };
  };

  const outcomeOf = (file: BuiltFile): FileOutcome | undefined => {
    if (file.status === 'unavailable' || file.format === 'zip') return undefined;
    const outcome: FileOutcome = { fileName: file.fileName, format: file.format, ok: file.status === 'ready' };
    if (file.versionId) outcome.versionId = file.versionId;
    if (file.error) outcome.error = file.error;
    return outcome;
  };

  return {
    async plan(request) {
      await assetsReady();
      const planned = planFor(request);
      return planned.ok ? ok(planned.value.plan) : planned;
    },
    async build(request) {
      await assetsReady();
      const planned = planFor(request);
      if (!planned.ok) return planned;
      const { plan, record } = planned.value;
      const built: BuiltFile[] = [];
      for (const file of plan.files) {
        if (file.kind === 'manifest') continue;
        built.push(await buildOne(record, plan, file, request));
      }
      const { file: manifest, manifest: data } = manifestFile(record, plan, built);
      const files = plan.files.map((file) => (file.kind === 'manifest' ? manifest : (built.find((entry) => entry.fileName === file.fileName) as BuiltFile)));
      const attempted = files.filter((file) => file.status !== 'unavailable');
      const ready = attempted.filter((file) => file.status === 'ready');
      const deliveryItems: DeliveryItem[] = [];
      for (const file of ready) {
        const item = plan.items.find((entry) => entry.version.versionId === file.versionId);
        if (!item || file.format === 'zip') continue;
        deliveryItems.push({ version: item.version, decisionId: item.decisionId, format: file.format, fileName: file.fileName });
      }
      const pkg: ExportPackage = {
        plan,
        files,
        manifest: data,
        deliveryItems,
        outcomes: files.map(outcomeOf).filter((outcome): outcome is FileOutcome => outcome !== undefined),
        status: ready.length === attempted.length ? 'completed' : ready.length > 1 ? 'partial' : 'failed',
        builtAt: deps.clock.now(),
      };
      return ok(pkg);
    },
    async buildFile(request) {
      await assetsReady();
      const planned = planFor(request);
      if (!planned.ok) return planned;
      const { plan, record } = planned.value;
      const file = plan.files.find((entry) => entry.fileName === request.fileName);
      if (!file) return refuse('unknown_file', 'Arquivo fora deste pacote.');
      if (!file.available) return refuse('file_unavailable', file.unavailableReason ?? 'Formato ainda não disponível.');
      if (file.kind === 'manifest') {
        const built: BuiltFile[] = [];
        for (const entry of plan.files) if (entry.kind !== 'manifest') built.push(await buildOne(record, plan, entry, { productionId: request.productionId }));
        return ok(manifestFile(record, plan, built).file);
      }
      return ok(await buildOne(record, plan, file, request));
    },
  };
}
