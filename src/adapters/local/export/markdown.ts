import type { ArticleBlock, ArticleBody, Inline } from '../../../domain/article.ts';
import { creditLine } from '../../../domain/asset.ts';
import type { ImageRef } from '../../../domain/asset.ts';
import type { AssetId } from '../../../domain/ids.ts';
import type { ExportImageSource } from '../../../domain/manifest.ts';
import { normalizeLink } from '../../../domain/text/links.ts';

/**
 * Article → Markdown, the portable format a CMS accepts. Only the publishable content goes out
 * (title, cover, blocks, marks, safe links, images with caption and credit); provenance travels
 * in the manifest. Underline has no Markdown form and is exported as plain text. Images point at
 * the package files (next to the .md: downloads have no folders) or, for linked images, at their
 * original address.
 */

/** Where each image of the article points (see `exportImageSources`); images without one are left out. */
export type ImageSources = ReadonlyMap<AssetId, ExportImageSource>;

const NO_IMAGES: ImageSources = new Map();

/** Escapes characters Markdown would read as syntax. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>~|])/g, '\\$1');
}

/** Escapes a line start that Markdown would read as a heading, quote or list marker. */
function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)(#{1,6}\s|>|[-+]\s)/, (_, space: string, marker: string) => `${space}\\${marker}`)
    .replace(/^(\s*\d+)([.)]\s)/, '$1\\$2');
}

function wrap(text: string, marker: string): string {
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const core = text.trim();
  if (!core) return text;
  const trail = text.slice(lead.length + core.length);
  return `${lead}${marker}${core}${marker}${trail}`;
}

/** Parentheses and spaces would end a Markdown link target early. */
function linkTarget(href: string): string {
  return href.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

export function inlineMarkdown(inline: Inline): string {
  let text = escapeMarkdown(inline.text);
  const marks = inline.marks ?? [];
  if (marks.includes('strike')) text = wrap(text, '~~');
  if (marks.includes('italic')) text = wrap(text, '*');
  if (marks.includes('bold')) text = wrap(text, '**');
  if (marks.includes('link') && inline.href) {
    const link = normalizeLink(inline.href);
    // Parentheses and spaces would end the Markdown link target early.
    if (link.ok) text = `[${text}](${linkTarget(link.href)})`;
  }
  return text;
}

function inlinesMarkdown(inlines: readonly Inline[]): string {
  return escapeLineStart(inlines.map(inlineMarkdown).join('').replace(/\n/g, ' '));
}

/** `![alt](<slug>-1.jpg)`, then the caption and the credit as the next paragraph. */
export function imageMarkdown(image: ImageRef, sources: ImageSources): string {
  const source = sources.get(image.assetId);
  if (!source) return '';
  const alt = escapeMarkdown((image.alt ?? '').replace(/\s+/g, ' ').trim());
  const caption = image.caption?.trim() ? `*${escapeMarkdown(image.caption.trim())}*` : '';
  const credit = creditLine(source.credit);
  const line = [caption, credit ? escapeMarkdown(credit) : ''].filter(Boolean).join(' — ');
  const picture = `![${alt}](${linkTarget(source.src)})`;
  return line ? `${picture}\n\n${escapeLineStart(line)}` : picture;
}

function blockMarkdown(block: ArticleBlock, sources: ImageSources): string {
  switch (block.type) {
    case 'paragraph':
      return inlinesMarkdown(block.inlines);
    case 'heading':
      return `${'#'.repeat(block.level)} ${inlinesMarkdown(block.inlines)}`;
    case 'quote':
      return `> ${inlinesMarkdown(block.inlines)}`;
    case 'list':
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlinesMarkdown(item)}`).join('\n');
    case 'divider':
      return '---';
    case 'figure':
      return imageMarkdown(block.image, sources);
  }
}

/** The cover follows the title (featured image), then the body in order. */
export function articleToMarkdown(body: ArticleBody, sources: ImageSources = NO_IMAGES): string {
  const parts = [
    `# ${escapeLineStart(escapeMarkdown(body.title.trim()))}`,
    body.cover ? imageMarkdown(body.cover, sources) : '',
    ...body.blocks.map((block) => blockMarkdown(block, sources)),
  ].filter((part) => part.trim().length > 0);
  return `${parts.join('\n\n')}\n`;
}
