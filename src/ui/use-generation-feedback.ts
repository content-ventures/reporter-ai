'use client';

import { useEffect, useState } from 'react';
import { generationFeedback, type FeedbackRun } from './generation-feedback';

/** Tick only while work is active; timers never drive progress or promise a finish time. */
export function useGenerationFeedback(run?: FeedbackRun) {
  const [now, setNow] = useState<number>();
  const active = run?.status === 'running' || run?.status === 'queued';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return run ? generationFeedback(run, now) : undefined;
}
