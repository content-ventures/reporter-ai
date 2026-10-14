'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, setArticleBody, useArticleEditor } from '@/editor';
import type { ArticleBody } from '@/domain';
import { advanceProviderPreview, emptyProviderPreview, providerPreviewHasMore } from './provider-preview-model';

/** A separate read-only document: streaming types smoothly but never autosaves or modifies the real editor. */
export function ProviderPreview({ body }: { body: ArticleBody }) {
  const [initialBody] = useState(() => emptyProviderPreview(body));
  const visible = useRef(initialBody);
  const target = useRef(body);
  const { editor } = useArticleEditor({ initialBody,title: body.title,readOnly: true,
    label: 'Prévia do artigo em tempo real',placeholder: false });
  useEffect(() => {
    target.current = body;
    if (!editor || editor.isDestroyed) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      visible.current = body;
      setArticleBody(editor,body);
      return undefined;
    }
    let timer: number | undefined;
    const reveal = () => {
      const next = advanceProviderPreview(visible.current,target.current,2);
      if (next !== visible.current) {
        visible.current = next;
        setArticleBody(editor,next);
      }
      if (!providerPreviewHasMore(visible.current,target.current) && timer !== undefined) window.clearInterval(timer);
    };
    reveal();
    if (providerPreviewHasMore(visible.current,target.current)) timer = window.setInterval(reveal,32);
    return () => window.clearInterval(timer);
  },[editor,body]);
  return <EditorContent editor={editor} />;
}
