import { inlinesText } from '../article.ts';
import type { ArticleBody } from '../article.ts';
import type { EventBoxLine } from '../formats.ts';
import { escapeHtml, textBlockHtml } from './article-html.ts';
import type { TextBlock } from './article-html.ts';

/**
 * "Copiar texto" (Entrega): the approved article as the newsroom pastes it into its site — the
 * title and the text, without images (they leave as files) or provenance. One content in two
 * flavours: plain text for a notepad, a blank line between blocks, and bare HTML, so a rich editor
 * keeps intertítulos, quotations, lists, bold and links. Dividers and image slots stay out of both.
 */
export type ArticleClipboard = { text: string; html: string };

const OPENS_QUOTED = /^["“«]/u;

function plainBlock(block: TextBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlinesText(block.inlines).trim();
    case 'quote': {
      // A quotation block holds the speaker's words; plain text has no blockquote to mark them.
      const text = inlinesText(block.inlines).trim();
      return !text || OPENS_QUOTED.test(text) ? text : `“${text}”`;
    }
    case 'list':
      return block.items
        .map((item) => inlinesText(item).trim())
        .filter(Boolean)
        .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`)
        .join('\n');
    case 'divider':
      return '';
  }
}

/**
 * An event format adds its linha fina under the title and, after the text, the event box built
 * from the event the reporter typed (formats.ts), as the outlet publishes them.
 */
export function articleClipboard(body: ArticleBody, box: readonly EventBoxLine[] = []): ArticleClipboard {
  const title = body.title.trim();
  const dek = body.dek?.trim();
  const text: string[] = title ? [title] : [];
  const html: string[] = title ? [`<h1>${escapeHtml(title)}</h1>`] : [];
  if (dek) {
    text.push(dek);
    html.push(`<p><em>${escapeHtml(dek)}</em></p>`);
  }
  for (const block of body.blocks) {
    if (block.type === 'figure') continue;
    const plain = plainBlock(block);
    if (!plain) continue;
    text.push(plain);
    html.push(textBlockHtml(block));
  }
  for (const line of box) {
    text.push(line.text);
    html.push(line.kind === 'heading' ? `<h3>${escapeHtml(line.text)}</h3>` : line.kind === 'divider' ? '<hr>'
      : line.kind === 'label' ? `<p><strong>${escapeHtml(line.text)}</strong></p>` : `<p>${escapeHtml(line.text)}</p>`);
  }
  return { text: text.join('\n\n'), html: html.join('\n') };
}
