import type { ArticleBlock, ArticleBody, Inline } from '../../../domain/article.ts';
import { creditLine } from '../../../domain/asset.ts';
import type { ImageRef } from '../../../domain/asset.ts';
import { normalizeLink } from '../../../domain/text/links.ts';
import type { ImageSources } from './markdown.ts';

/**
 * Article → semantic HTML document: the cover first (`<figure data-role="cover">`, as the screens
 * show it, marked so a CMS can take it as the featured image), the title, then headings,
 * paragraphs, blockquotes, lists, inline marks and figures
 * (`<figure><img><figcaption>legenda — <cite>Foto: crédito</cite></figcaption></figure>`), with NO
 * styling (no style element, no style or class attributes). The CMS or the reader's stylesheet
 * decides the look; provenance travels in the manifest and in two meta tags.
 */

const NO_IMAGES: ImageSources = new Map();

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

export function inlineHtml(inline: Inline): string {
  let html = escapeHtml(inline.text).replace(/\n/g, '<br>');
  const marks = inline.marks ?? [];
  if (marks.includes('strike')) html = `<s>${html}</s>`;
  if (marks.includes('underline')) html = `<u>${html}</u>`;
  if (marks.includes('italic')) html = `<em>${html}</em>`;
  if (marks.includes('bold')) html = `<strong>${html}</strong>`;
  if (marks.includes('link') && inline.href) {
    const link = normalizeLink(inline.href);
    if (link.ok) html = `<a href="${escapeHtml(link.href)}">${html}</a>`;
  }
  return html;
}

function inlinesHtml(inlines: readonly Inline[]): string {
  return inlines.map(inlineHtml).join('');
}

export function imageHtml(image: ImageRef, sources: ImageSources, role: 'cover' | 'figure' = 'figure'): string {
  const source = sources.get(image.assetId);
  if (!source) return '';
  const size = source.width && source.height ? ` width="${source.width}" height="${source.height}"` : '';
  const img = `<img src="${escapeHtml(source.src)}" alt="${escapeHtml(image.alt?.trim() ?? '')}"${size}>`;
  const caption = image.caption?.trim() ? escapeHtml(image.caption.trim()) : '';
  const credit = creditLine(source.credit);
  const cite = credit ? `<cite>${escapeHtml(credit)}</cite>` : '';
  const figcaption = caption || cite ? `\n<figcaption>${[caption, cite].filter(Boolean).join(' — ')}</figcaption>` : '';
  return `<figure${role === 'cover' ? ' data-role="cover"' : ''}>\n${img}${figcaption}\n</figure>`;
}

function blockHtml(block: ArticleBlock, sources: ImageSources): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${inlinesHtml(block.inlines)}</p>`;
    case 'heading':
      return `<h${block.level}>${inlinesHtml(block.inlines)}</h${block.level}>`;
    case 'quote':
      return `<blockquote><p>${inlinesHtml(block.inlines)}</p></blockquote>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>\n${block.items.map((item) => `  <li>${inlinesHtml(item)}</li>`).join('\n')}\n</${tag}>`;
    }
    case 'divider':
      return '<hr>';
    case 'figure':
      // An image slot ("Sugestão de imagem") is not publishable: the manifest lists it.
      return block.image ? imageHtml(block.image, sources) : '';
  }
}

export type HtmlMeta = { versionLabel: string; hash: string };

export function articleToHtml(body: ArticleBody, meta: HtmlMeta, sources: ImageSources = NO_IMAGES): string {
  const title = escapeHtml(body.title.trim());
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    '<meta name="generator" content="Reporter IA">',
    `<meta name="reporter:version" content="${escapeHtml(meta.versionLabel)} · ${escapeHtml(meta.hash)}">`,
    '</head>',
    '<body>',
    '<article>',
    ...[body.cover ? imageHtml(body.cover, sources, 'cover') : '', `<h1>${title}</h1>`, ...body.blocks.map((block) => blockHtml(block, sources))].filter(Boolean),
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
