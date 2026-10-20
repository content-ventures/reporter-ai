'use client';

import { Button, toast } from '@content-ventures/design-system/v3';
import { Copy } from '@content-ventures/design-system/v3/icons';
import { articleClipboard, type ArticleClipboard, type VersionId } from '@/domain';
import { useVersion } from '@/state';

/** Both flavours where the browser takes them; otherwise (or when it refuses HTML) the plain text. */
async function writeClipboard({ text, html }: ArticleClipboard): Promise<void> {
  // The clipboard is missing outside a secure origin.
  if (!navigator.clipboard) throw new Error('clipboard');
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // Falls through to the plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

/**
 * "Copiar texto": the approved article on the clipboard, ready to paste into the site — plain text
 * in a notepad, intertítulos, quotations and links in a rich editor (see `articleClipboard`).
 */
export function CopyArticleButton({ versionId }: { versionId: VersionId }) {
  const version = useVersion(versionId);
  const body = version.data?.body.type === 'article' ? version.data.body : undefined;

  function copy() {
    if (!body) return;
    writeClipboard(articleClipboard(body)).then(
      () => toast('Texto do artigo copiado'),
      () => toast('Não foi possível copiar', { tone: 'error' }),
    );
  }

  return (
    <Button size="sm" icon={Copy} loading={version.status === 'loading'} disabled={!body} onClick={copy}>
      Copiar texto
    </Button>
  );
}
