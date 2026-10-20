import type { ArticleBlock, FigureBlock, Inline } from '../article.ts';
import { normalizeLink } from './links.ts';

/**
 * Article text → semantic HTML with NO styling (no style element, no style or class attributes),
 * shared by the package's `artigo.html` and the "Copiar texto" clipboard. Figures are left to the
 * caller: where an image points depends on where its file goes.
 */

export type TextBlock = Exclude<ArticleBlock, FigureBlock>;

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

export function inlinesHtml(inlines: readonly Inline[]): string {
  return inlines.map(inlineHtml).join('');
}

export function textBlockHtml(block: TextBlock): string {
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
  }
}
