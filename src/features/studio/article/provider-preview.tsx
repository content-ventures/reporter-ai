'use client';

import { useEffect } from 'react';
import { EditorContent, setArticleBody, useArticleEditor } from '@/editor';
import type { ArticleBody } from '@/domain';

/** A separate read-only document: streaming never autosaves or modifies the real editor. */
export function ProviderPreview({ body }: { body: ArticleBody }) {
  const { editor } = useArticleEditor({ initialBody: body,title: body.title,readOnly: true,
    label: 'Prévia do artigo em tempo real',placeholder: false });
  useEffect(() => {
    if (editor && !editor.isDestroyed) setArticleBody(editor,body);
  },[editor,body]);
  return <EditorContent editor={editor} />;
}
