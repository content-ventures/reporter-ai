'use client';

import { useEffect, useState } from 'react';

/** Local preview of a chosen file, revoked when the file changes or the picker closes. */
export function useFilePreview(file: Blob | null): string | undefined {
  const [preview, setPreview] = useState<{ file: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    let live = true;
    queueMicrotask(() => {
      if (live) setPreview({ file, url });
    });
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return preview?.file === file ? preview.url : undefined;
}
