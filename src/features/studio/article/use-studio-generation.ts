'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import { isRunActive, type ArticleBody, type GenerationRun, type RunId } from '@/domain';
import type { PieceView, ProductionDetail, RunView } from '@/ports';
import { useRun, type Commands } from '@/state';
import { takeArmedSimulation } from '@/ui/shell';
import { isBlankBody } from './studio-model';
import { continuationMode, generationRunsOf } from './studio-session-model';
import type { StreamMode } from './studio-types';

/**
 * The article generation on screen: the live run of the piece, the one this tab started
 * ("Reescrever o artigo do zero", a retry) or the last one, and how it reaches the text. Runs
 * before the editor: the editor streams `runId` in `streamMode`.
 */
export function useStudioGeneration({ production, piece }: { production: ProductionDetail; piece: PieceView }) {
  const pieceId = piece.id;
  const generationRuns = useMemo(() => generationRunsOf(production.runs, pieceId), [production.runs, pieceId]);
  const lastGeneration = generationRuns[generationRuns.length - 1];
  const activeGeneration = piece.activeRun?.kind === 'article.generate' ? piece.activeRun : undefined;
  const [started, setStarted] = useState<{ runId: RunId; mode: StreamMode } | null>(null);
  const runId = activeGeneration?.id ?? started?.runId ?? lastGeneration?.id ?? null;
  const streamMode: StreamMode = started && started.runId === runId ? started.mode : 'append';
  const liveRun = useRun(runId);
  const live = liveRun.status === 'ready' ? liveRun.data : undefined;
  const run: GenerationRun | RunView | undefined = live?.fold.run ?? generationRuns.find((entry) => entry.id === runId) ?? activeGeneration;
  const active = run ? isRunActive(run) : false;
  /** Bumps with every event of the live run (the text follows the block being written). */
  const streamSeq = liveRun.status === 'ready' ? liveRun.data.fold.seq : 0;
  return { runId, run, live, active, streamMode, streamSeq, setStarted };
}

export type StudioGeneration = ReturnType<typeof useStudioGeneration>;

/** "Reescrever o artigo do zero", "Parar" and "Tentar de novo" of the generation on screen. */
export function useGenerationActions({
  commands,
  productionId,
  pieceId,
  generation,
  prepare,
  setLocalTitle,
}: {
  commands: Commands;
  productionId: ProductionDetail['id'];
  pieceId: PieceView['id'];
  generation: StudioGeneration;
  prepare: () => Promise<{ body: ArticleBody; baseRevision: number } | null>;
  setLocalTitle: Dispatch<SetStateAction<string | null>>;
}) {
  const { runId, streamMode, live, setStarted } = generation;

  const generate = useCallback(async () => {
    const prepared = await prepare();
    const hasText = prepared ? !isBlankBody(prepared.body) : false;
    setLocalTitle(null);
    const simulation = takeArmedSimulation('article.draft');
    const result = await commands.generation.start('article.draft', { productionId, pieceId }, simulation ? { simulation } : undefined);
    if (!result.ok) {
      toast('Geração não iniciada', { tone: 'error', description: result.refusal.message });
      return;
    }
    setStarted({ runId: result.value.runId, mode: hasText ? 'replace' : 'append' });
  }, [prepare, commands, productionId, pieceId, setLocalTitle, setStarted]);

  const stopGeneration = useCallback(async () => {
    if (!runId) return;
    const result = await commands.generation.cancel(runId);
    if (!result.ok) toast('Não foi possível parar', { tone: 'error', description: result.refusal.message });
  }, [commands, runId]);

  const retryGeneration = useCallback(
    async (stepId?: string) => {
      if (!runId) return;
      const result = await commands.generation.retry(runId, stepId);
      if (!result.ok) {
        toast('Não foi possível continuar', { tone: 'error', description: result.refusal.message });
        return;
      }
      setStarted({ runId: result.value.runId, mode: continuationMode(streamMode, live?.fold.blocks.length ?? 0) });
    },
    [commands, runId, streamMode, live, setStarted],
  );

  return { generate, stopGeneration, retryGeneration };
}
