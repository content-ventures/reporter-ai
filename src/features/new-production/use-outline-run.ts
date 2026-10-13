'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isPlanningRun, outlineProposalOf, type GenerationRun, type OutlineProposal, type ProductionId, type RunId } from '@/domain';
import type { ProductionDetail } from '@/ports';
import { useCommands, useRun } from '@/state';
import { takeArmedSimulation } from '@/ui/shell';
import { newestRunId } from '@/ui/generation-feedback';

/**
 * "Montar estrutura" (CONTRACT §2.5, §3.9): the article's outline run of a production. Step 3
 * reuses the last outline run of the article (a reload, or "Montar estrutura" from Material or
 * Início), follows the one this page started, and starts one when the article has none. The run
 * proposes the structure in its fold (`outlineProposalOf`); it writes no version and leaves the
 * article "Não iniciado".
 */

export type OutlineRunState =
  | { status: 'loading' }
  | { status: 'running'; run: GenerationRun; message?: string }
  | { status: 'ready'; runId: RunId; proposal: OutlineProposal }
  | { status: 'failed'; run?: GenerationRun; message?: string };

export type OutlineRun = {
  state: OutlineRunState;
  /** A new outline run ("Tentar de novo", or the Pauta changed). */
  restart: () => Promise<void>;
  /** The run this page started (Pauta → "Montar estrutura" starts it before step 3 opens). */
  adopt: (runId: RunId) => void;
  stop: () => Promise<void>;
};

export function useOutlineRun(productionId: ProductionId | undefined, detail: ProductionDetail | undefined, enabled: boolean): OutlineRun {
  const commands = useCommands();
  const pieceId = detail?.pieces.find((piece) => piece.kind === 'article')?.id;
  const [started, setStarted] = useState<RunId | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const autoStarted = useRef(false);

  const runId = newestRunId(detail?.runs.filter(run => isPlanningRun(run) && run.pieceId === pieceId) ?? [], started);
  const run = useRun(runId);

  const start = useCallback(async () => {
    if (!productionId || !pieceId) return;
    setStarting(true);
    setRefusal(undefined);
    const simulation = takeArmedSimulation('article.outline');
    try {
      const result = await commands.generation.start('article.outline', { productionId, pieceId }, simulation ? { simulation } : undefined);
      if (result.ok) setStarted(result.value.runId);
      else setRefusal(result.refusal.message);
    } catch { setRefusal('Não foi possível iniciar a geração. Tente novamente.'); }
    finally { setStarting(false); }
  }, [commands, productionId, pieceId, setStarting, setRefusal, setStarted]);

  // An article without any outline run gets one as soon as step 3 opens (once).
  const needsRun = enabled && Boolean(detail) && Boolean(pieceId) && !runId && !starting && !refusal;
  useEffect(() => {
    if (!needsRun || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [needsRun, start]);

  const adopt = (id: RunId) => {
    setRefusal(undefined);
    setStarted(id);
  };
  const stop = async () => {
    if (!runId) return;
    const result = await commands.generation.cancel(runId);
    if (!result.ok) setRefusal(result.refusal.message);
  };

  let state: OutlineRunState;
  if (refusal) state = { status: 'failed', message: refusal };
  else if (starting || !runId || run.status === 'loading') state = { status: 'loading' };
  else if (run.status === 'error') state = { status: 'failed', message: run.error.message };
  else {
    const fold = run.data.fold;
    const status = fold.run.status;
    if (status === 'completed') {
      const proposal = outlineProposalOf(fold);
      state = proposal ? { status: 'ready', runId: fold.run.id, proposal } : { status: 'failed' };
    } else if (status === 'failed' || status === 'cancelled') {
      state = { status: 'failed', run: fold.run, message: status === 'cancelled' ? 'Você interrompeu a geração. O material continua salvo.' : fold.run.error?.message };
    } else state = { status: 'running', run: fold.run, message: fold.run.steps.filter(step => step.state === 'current').at(-1)?.meta };
  }

  return { state, restart: start, adopt, stop };
}
