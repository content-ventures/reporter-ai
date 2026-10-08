import { articleImages, creditLine, IMAGE_ISSUE_LABELS, imageIssues, normalizeImageRef, validateImageFile } from '../../../domain/index.ts';
import type { ArticleBody, AssetLookup, BlockId, ImageAsset, ImageIssue, ImageRef } from '../../../domain/index.ts';

/**
 * Pure helpers of the article images in the studio: the picker's copy and fields, what
 * "Imagens com crédito" lists in Checagem, and the messages of a refused file. No React and no
 * Design System, so `node --test` covers them.
 */

/** The cover (`ArticleBody.cover`) or a figure block. */
export type ImageRole = 'cover' | 'figure';

/** `choose`: tabs to pick an image (new or replacing one) · `edit`: caption, credit and rights. */
export type PickerMode = 'choose' | 'edit';

export type PickerCopy = { title: string; primary: string };

export function pickerCopy(role: ImageRole, mode: PickerMode, replacing: boolean): PickerCopy {
  if (mode === 'edit') return { title: 'Legenda e crédito', primary: 'Salvar alterações' };
  if (role === 'cover') return { title: replacing ? 'Trocar imagem de destaque' : 'Imagem de destaque', primary: 'Definir como destaque' };
  return replacing ? { title: 'Trocar imagem', primary: 'Trocar imagem' } : { title: 'Inserir imagem', primary: 'Inserir imagem' };
}

/** How the credit reads under the image: "Na legenda: “Foto: Ana Prado”". */
export function creditPreview(credit: string): string {
  return `Na legenda: “${creditLine(credit) ?? 'Foto: …'}”`;
}

/** Hint under "Crédito": what happens without one, then how the typed one reads. */
export function creditHint(credit: string): string {
  return creditLine(credit) ? creditPreview(credit) : 'Sem crédito, a checagem avisa.';
}

/** The fields of the picker, as typed. */
export type ImageFields = { alt: string; caption: string; credit: string; authorized: boolean };

export function fieldsOf(image: Partial<ImageRef> | undefined, asset: Pick<ImageAsset, 'credit' | 'rights'> | undefined): ImageFields {
  return {
    alt: image?.alt ?? '',
    caption: image?.caption ?? '',
    credit: asset?.credit ?? '',
    authorized: asset?.rights.authorized ?? false,
  };
}

/** Fills the fields still empty with what the image source knows (an archive record's credit). */
export function withSuggested(fields: ImageFields, suggested: Partial<ImageFields> | undefined): ImageFields {
  if (!suggested) return fields;
  return {
    alt: fields.alt.trim() ? fields.alt : (suggested.alt ?? fields.alt),
    caption: fields.caption.trim() ? fields.caption : (suggested.caption ?? fields.caption),
    credit: fields.credit.trim() ? fields.credit : (suggested.credit ?? fields.credit),
    authorized: fields.authorized || suggested.authorized === true,
  };
}

/** The use of the image (alt and caption, trimmed; empty ones dropped). */
export function imageRefOf(assetId: string, fields: Pick<ImageFields, 'alt' | 'caption'>): ImageRef {
  return normalizeImageRef({ assetId, alt: fields.alt, caption: fields.caption });
}

/** Credit or rights changed in "Legenda e crédito" (they belong to the image, not to this use). */
export function rightsChanged(asset: Pick<ImageAsset, 'credit' | 'rights'>, fields: Pick<ImageFields, 'credit' | 'authorized'>): boolean {
  return (asset.credit ?? '').trim() !== fields.credit.trim() || asset.rights.authorized !== fields.authorized;
}

/** A file the Dropzone (or a paste) refused: the same message the store would give. */
export function refusedFileMessage(file: { name: string; type?: string; size: number }): string {
  const result = validateImageFile(file);
  return result.ok ? 'Envie uma imagem JPG, PNG, WebP ou GIF.' : result.refusal.message;
}

// ——— Checagem: "Imagens com crédito" ———

export type ImageToCheck = {
  /** The figure block, or `COVER_BLOCK_ID`. */
  blockId: BlockId;
  role: ImageRole;
  image: ImageRef;
  asset?: ImageAsset;
  issues: ImageIssue[];
  /** "Imagem de destaque", the caption, the alt text, or "Imagem 2". */
  label: string;
};

/** Images the text uses that miss credit, authorisation or the file, in reading order. */
export function imagesToCheck(body: ArticleBody, assets: AssetLookup): ImageToCheck[] {
  let figures = 0;
  return articleImages(body).flatMap((use) => {
    if (use.role === 'figure') figures += 1;
    const asset = assets(use.image.assetId);
    const issues = imageIssues(asset);
    if (issues.length === 0) return [];
    const label = use.role === 'cover' ? 'Imagem de destaque' : (use.image.caption ?? use.image.alt ?? `Imagem ${figures}`);
    const entry: ImageToCheck = { blockId: use.blockId, role: use.role, image: use.image, issues, label };
    if (asset) entry.asset = asset;
    return [entry];
  });
}

/** "Sem crédito · Uso não autorizado". */
export function issueLine(issues: readonly ImageIssue[]): string {
  return issues.map((issue) => IMAGE_ISSUE_LABELS[issue]).join(' · ');
}
