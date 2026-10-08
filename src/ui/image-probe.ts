'use client';

import { useEffect, useState } from 'react';

/**
 * Whether an address really opens an image, and its size, before it goes into the text ("Link",
 * images pasted from another page). The browser loads the picture as an `<img>` would: no CORS
 * needed (the pixels are never read), nothing is attached to the page. A page, a PDF or a broken
 * address answers `error`; a slow one gives up after `timeoutMs`.
 */

export type ImageProbe =
  | { status: 'loading' }
  | { status: 'loaded'; width: number; height: number }
  | { status: 'error' };

type ImageConstructor = new () => {
  src: string;
  decoding: string;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

/** One answer per address while the page is open (a preview and the insert ask the same). */
const answers = new Map<string, Promise<ImageProbe>>();

export function probeImage(url: string, timeoutMs = 10_000): Promise<ImageProbe> {
  const cached = answers.get(url);
  if (cached) return cached;
  const Loader = (globalThis as { Image?: ImageConstructor }).Image;
  if (!Loader) return Promise.resolve({ status: 'error' });
  const answer = new Promise<ImageProbe>((resolve) => {
    const image = new Loader();
    const timer = setTimeout(() => finish({ status: 'error' }), timeoutMs);
    function finish(result: ImageProbe) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    }
    image.decoding = 'async';
    image.onload = () =>
      finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? { status: 'loaded', width: image.naturalWidth, height: image.naturalHeight } : { status: 'error' });
    image.onerror = () => finish({ status: 'error' });
    image.src = url;
  });
  answers.set(url, answer);
  // A failure may be temporary (offline, slow server): the next ask tries again.
  void answer.then((result) => {
    if (result.status === 'error' && answers.get(url) === answer) answers.delete(url);
  });
  return answer;
}

/** `probeImage` as state; `undefined` without an address. */
export function useImageProbe(url: string | undefined): ImageProbe | undefined {
  const [state, setState] = useState<{ url: string; probe: ImageProbe } | null>(null);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    void probeImage(url).then((probe) => {
      if (live) setState({ url, probe });
    });
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return undefined;
  return state?.url === url ? state.probe : { status: 'loading' };
}
