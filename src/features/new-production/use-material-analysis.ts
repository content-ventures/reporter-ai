'use client';

import { useEffect, useState } from 'react';
import type { SourceAnalysis } from '@/ports';
import { useCommands } from '@/state';

/**
 * Live reading of the material (SourceIngest.analyze): words, speakers, segments, duplicate
 * hash, and the outlook ("Como o artigo nasce") for the brief's angle and the speakers' names.
 * Pasted text is analysed after a short pause; a file right away. While a new answer is on its
 * way the previous one stays on screen (`analysis`), so the preview never flashes.
 */

export type MaterialAnalysis = {
  status: 'idle' | 'analyzing' | 'ready' | 'error';
  /** Latest answer for the current text when `ready`; the previous one while `analyzing`. */
  analysis: SourceAnalysis | undefined;
  /** pt-BR refusal ("Cole ou envie o material…") when `error`. */
  message: string | undefined;
};

type Answer = { key: string; text: string; analysis?: SourceAnalysis; message?: string };

const IDLE: MaterialAnalysis = { status: 'idle', analysis: undefined, message: undefined };

/** Brief and "Falantes" as the outlook's headline reads them (the draft's headline rule). */
export type OutlookInput = { angle: string; speakerNames: Readonly<Record<string, string>> };

/** Typing in "Orientação editorial" re-reads the outlook after a pause, even for a file. */
const OPTIONS_PAUSE_MS = 400;

export function useMaterialAnalysis(text: string, fileName: string | undefined, delayMs: number, outlook?: OutlookInput): MaterialAnalysis {
  const commands = useCommands();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const blank = text.trim() === '';
  const angle = outlook?.angle.trim() ?? '';
  const names = JSON.stringify(outlook?.speakerNames ?? {});
  const textKey = `${fileName ?? ''}\u0000${text}`;
  const key = `${textKey}\u0000${angle}\u0000${names}`;
  // Same material, new brief or names: only the outlook changes, after a short pause.
  const delay = answer?.text === textKey ? Math.max(delayMs, OPTIONS_PAUSE_MS) : delayMs;

  useEffect(() => {
    if (blank) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      const speakerNames = JSON.parse(names) as Record<string, string>;
      const options = { format: 'auto' as const, ...(fileName ? { fileName } : {}), ...(angle ? { angle } : {}), ...(Object.keys(speakerNames).length > 0 ? { speakerNames } : {}) };
      void commands.ingest.analyze(text, options).then((result) => {
        if (!alive) return;
        setAnswer(result.ok ? { key, text: textKey, analysis: result.value } : { key, text: textKey, message: result.refusal.message });
      });
    }, delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [angle, blank, commands, delay, fileName, key, names, text, textKey]);

  if (blank) return IDLE;
  if (answer?.key === key) {
    return answer.analysis
      ? { status: 'ready', analysis: answer.analysis, message: undefined }
      : { status: 'error', analysis: undefined, message: answer.message };
  }
  return { status: 'analyzing', analysis: answer?.analysis, message: undefined };
}
