'use client';

import { useEffect, useState } from 'react';
import type { ReceivedMaterial } from '@/ports';
import { useCommands } from '@/state';

const REFRESH_MS = 30_000;
const NONE: readonly ReceivedMaterial[] = [];

/**
 * Files the Drive folder brought in that no production uses yet, for the board's Material lane.
 * Read while the board is open (a transcription finishes on its own); none without a backend
 * or for someone who does not create productions.
 */
export function useReceivedMaterials(enabled: boolean): readonly ReceivedMaterial[] {
  const commands = useCommands();
  const [items, setItems] = useState<readonly ReceivedMaterial[]>(NONE);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      void commands.ingest.received().then((result) => {
        if (alive && result.ok) setItems(result.value);
      }).catch(() => {});
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [commands, enabled]);

  return enabled ? items : NONE;
}
