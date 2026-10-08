import type { ActorId, AssetId, IsoDateTime, RunId, WorkspaceId } from './ids.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';
import { normalizeLink } from './text/links.ts';

/**
 * Images of an article (R1): uploaded files and external links, with credit and usage rights
 * (R2 F2.9/REQ-2.9 asks origin, credit and caption). The archive (R2 "Acervo") and generated
 * images (R6 F6.10) are origins already, so they plug in without changing articles. The bytes
 * live in the AssetStore port; articles only hold an `ImageRef`. Approval of an asset as such
 * (R5 avatar/voice) goes through the generic `Decision` with an `AssetRef`.
 */

/** Reserved kinds: only `image` ships in R1 (audio/video R4, avatar/voice R5). */
export type AssetKind = 'image' | 'audio' | 'video' | 'avatar' | 'voice' | 'document';

export type AssetOrigin =
  | { type: 'upload'; fileName: string }
  | { type: 'url'; url: string }
  /** R2 "Acervo" (F2.9). */
  | { type: 'archive'; archiveId: string }
  /** R6 "Gerar com IA" (F6.10). */
  | { type: 'generated'; runId: RunId };

export type AssetOriginType = AssetOrigin['type'];

export type AssetRights = {
  /** A person confirmed the image may be used ("Uso autorizado"). */
  authorized: boolean;
  /** Restrictions as written by the rights holder (territory, expiry, credit form…). */
  note?: string;
};

export type ImageAsset = {
  id: AssetId;
  workspaceId: WorkspaceId;
  kind: 'image';
  origin: AssetOrigin;
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** Credit as typed ("Ana Prado/Ateliê Sul"); shown as `creditLine` ("Foto: Ana Prado/Ateliê Sul"). */
  credit?: string;
  rights: AssetRights;
  createdAt: IsoDateTime;
  createdBy: ActorId;
};

/** R1 assets are images; R4/R5 add their own shapes to this union. */
export type Asset = ImageAsset;

/** How an article uses an image: the cover or a figure block. Alt and caption belong to the use. */
export type ImageRef = { assetId: AssetId; alt?: string; caption?: string };

/** Synchronous asset metadata lookup (checks, diff, export). Undefined = not in this store. */
export type AssetLookup = (assetId: AssetId) => ImageAsset | undefined;

export const NO_ASSETS: AssetLookup = () => undefined;

export function assetLookupOf(assets: readonly ImageAsset[]): AssetLookup {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return (assetId) => byId.get(assetId);
}

// ── Intake limits (Dropzone, link) ──────────────────────────────────────────────────────

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export const IMAGE_MIME_TYPES: readonly ImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Extension per type, as files are named in the delivery package. */
export const IMAGE_EXTENSIONS: Readonly<Record<ImageMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXTENSION_TYPES: Readonly<Record<string, ImageMime>> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  /** For the Dropzone `accept`. */
  accept: '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif',
  /** pt-BR hint under the Dropzone. */
  hint: 'JPG, PNG, WebP ou GIF, até 10 MB.',
} as const;

export type ImageFileRefusal = 'empty' | 'too_large' | 'unsupported_type';

export type ImageUrlRefusal = 'empty' | 'invalid_url';

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

/** Image type from the declared MIME type, or from the extension when the browser left it empty. */
export function imageMimeOf(input: { type?: string; name?: string }): ImageMime | undefined {
  const type = (input.type ?? '').toLowerCase().trim();
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(type)) return type as ImageMime;
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (type && type !== 'application/octet-stream') return undefined;
  return EXTENSION_TYPES[extensionOf(input.name ?? '')];
}

/** Same rule the Dropzone shows and the AssetStore enforces: jpg/png/webp/gif, ≤ 10 MB. */
export function validateImageFile(input: { name: string; type?: string; size: number }): Result<{ mime: ImageMime }, ImageFileRefusal> {
  if (input.size <= 0) return refuse('empty', 'O arquivo está vazio.');
  const mime = imageMimeOf(input);
  if (!mime) return refuse('unsupported_type', 'Envie uma imagem JPG, PNG, WebP ou GIF.');
  if (input.size > IMAGE_LIMITS.maxBytes) return refuse('too_large', 'A imagem passa de 10 MB. Reduza o arquivo e envie de novo.', { maxBytes: IMAGE_LIMITS.maxBytes, bytes: input.size });
  return ok({ mime });
}

/** "Link" tab: only http(s) addresses of an image. */
export function validateImageUrl(input: string): Result<string, ImageUrlRefusal> {
  if (!input.trim()) return refuse('empty', 'Informe o endereço da imagem.');
  const link = normalizeLink(input);
  if (!link.ok || !/^https?:$/.test(new URL(link.href).protocol)) return refuse('invalid_url', 'Use um endereço que comece com http:// ou https://.');
  return ok(link.href);
}

/** Extension for a file name: from the type, else from the original name or URL, else `jpg`. */
export function imageExtension(asset: Pick<ImageAsset, 'mime' | 'origin'>): string {
  const mime = asset.mime ? imageMimeOf({ type: asset.mime }) : undefined;
  if (mime) return IMAGE_EXTENSIONS[mime];
  const name = asset.origin.type === 'upload' ? asset.origin.fileName : asset.origin.type === 'url' ? asset.origin.url.split(/[?#]/)[0] : '';
  const fromName = EXTENSION_TYPES[extensionOf(name)];
  return fromName ? IMAGE_EXTENSIONS[fromName] : 'jpg';
}

// ── Credit and rights ───────────────────────────────────────────────────────────────────

const CREDIT_LABEL = /^(foto|fotos|imagem|imagens|ilustração|ilustracao|arte|reprodução|reproducao|divulgação|divulgacao)\s*:/i;

/** Credits that name where the image came from and read alone ("Reprodução/Instagram", "Divulgação"). */
const STANDALONE_CREDIT = /^(reprodução|reproducao|divulgação|divulgacao|arquivo|acervo|agência|agencia|cortesia)(?![\p{L}\p{N}])/iu;

/** Credit trimmed, or undefined when blank. */
export function normalizeCredit(credit: string | undefined): string | undefined {
  const trimmed = credit?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : undefined;
}

/**
 * "Foto: Ana Prado/Ateliê Sul". A credit that already names its kind ("Ilustração: …") or says
 * where the image came from ("Reprodução/Instagram", "Divulgação", "Arquivo pessoal") stays as typed.
 */
export function creditLine(credit: string | undefined): string | undefined {
  const normalized = normalizeCredit(credit);
  if (!normalized) return undefined;
  return CREDIT_LABEL.test(normalized) || STANDALONE_CREDIT.test(normalized) ? normalized : `Foto: ${normalized}`;
}

/**
 * Alt text of one use of an image, the same everywhere it is drawn (studio, review, delivery,
 * exports): what the person typed, or empty. The caption sits next to the image, so it is never
 * repeated as the alt text (a screen reader would read it twice).
 */
export function imageAlt(image: Pick<ImageRef, 'alt'> | undefined): string {
  return image?.alt?.replace(/\s+/g, ' ').trim() ?? '';
}

// ── Approval snapshot ───────────────────────────────────────────────────────────────────

/**
 * Credit and rights of one image as they stood when a version was approved. Credit and rights
 * belong to the image (every use shows the current ones), so the approval keeps its own copy: the
 * package and the review say when they changed afterwards (R2 REQ-2.9).
 */
export type ImageRightsRecord = { assetId: AssetId; credit?: string; rights: AssetRights };

export function imageRightsRecord(asset: Pick<ImageAsset, 'id' | 'credit' | 'rights'>): ImageRightsRecord {
  const record: ImageRightsRecord = { assetId: asset.id, rights: { authorized: asset.rights.authorized } };
  const credit = normalizeCredit(asset.credit);
  if (credit) record.credit = credit;
  const note = asset.rights.note?.trim();
  if (note) record.rights.note = note;
  return record;
}

/** Same credit and rights (blank and missing credits are the same). */
export function sameRights(a: Pick<ImageAsset, 'credit' | 'rights'>, b: Pick<ImageAsset, 'credit' | 'rights'>): boolean {
  return (
    (normalizeCredit(a.credit) ?? '') === (normalizeCredit(b.credit) ?? '') &&
    a.rights.authorized === b.rights.authorized &&
    (a.rights.note?.trim() ?? '') === (b.rights.note?.trim() ?? '')
  );
}

/** The lookup as approved: credit and rights from the approval snapshot, everything else from the store. */
export function withApprovedRights(assets: AssetLookup, records: readonly ImageRightsRecord[] | undefined): AssetLookup {
  if (!records || records.length === 0) return assets;
  const byId = new Map(records.map((record) => [record.assetId, record]));
  return (assetId) => {
    const asset = assets(assetId);
    const record = byId.get(assetId);
    if (!asset || !record) return asset;
    const approved: ImageAsset = { ...asset, rights: record.rights };
    if (record.credit) approved.credit = record.credit;
    else delete approved.credit;
    return approved;
  };
}

export const ASSET_ORIGIN_LABELS: Readonly<Record<AssetOriginType, string>> = {
  upload: 'Arquivo enviado',
  url: 'Link externo',
  archive: 'Acervo',
  generated: 'Gerada com IA',
};

/** "Arquivo enviado · retrato.jpg", "Link externo · exemplo.com". */
export function assetOriginLabel(origin: AssetOrigin): string {
  switch (origin.type) {
    case 'upload':
      return `${ASSET_ORIGIN_LABELS.upload} · ${origin.fileName}`;
    case 'url': {
      let host = origin.url;
      try {
        host = new URL(origin.url).hostname;
      } catch {
        // Keep the raw address.
      }
      return `${ASSET_ORIGIN_LABELS.url} · ${host}`;
    }
    case 'archive':
      return ASSET_ORIGIN_LABELS.archive;
    case 'generated':
      return ASSET_ORIGIN_LABELS.generated;
  }
}

export type ImageIssue = 'missing_asset' | 'missing_credit' | 'not_authorized';

/** What keeps an image from being publish-ready (credit and authorisation; R2 REQ-2.9). */
export function imageIssues(asset: ImageAsset | undefined): ImageIssue[] {
  if (!asset) return ['missing_asset'];
  const issues: ImageIssue[] = [];
  if (!normalizeCredit(asset.credit)) issues.push('missing_credit');
  if (!asset.rights.authorized) issues.push('not_authorized');
  return issues;
}

export const IMAGE_ISSUE_LABELS: Readonly<Record<ImageIssue, string>> = {
  missing_asset: 'Imagem não encontrada neste navegador',
  missing_credit: 'Sem crédito',
  not_authorized: 'Uso não autorizado',
};

/** Alt and caption trimmed; empty fields dropped. */
export function normalizeImageRef(ref: ImageRef): ImageRef {
  const out: ImageRef = { assetId: ref.assetId };
  const alt = ref.alt?.replace(/\s+/g, ' ').trim();
  const caption = ref.caption?.replace(/\s+/g, ' ').trim();
  if (alt) out.alt = alt;
  if (caption) out.caption = caption;
  return out;
}
