'use client';

import { useEffect, useRef, useState } from 'react';
import { isPlanningRun, outlineProposalOf, type OutlineProposal, type PieceId, type ProductionId, type RunId } from '@/domain';
import type { ProductionDetail } from '@/ports';
import { useCommands, useRun } from '@/state';
import { takeArmedSimulation } from '@/ui/shell';

/**
 * "Montar estrutura" (CONTRACT §2.5, §3.9): the article's outline run of a production. Step 3
 * reuses the last outline run of the article (a reload, or "Montar estrutura" from Material or
 * Início), follows the one this page started, and starts one when the article has none. The run
 * proposes the structure in its fold (`outlineProposalOf`); it writes no version and leaves the
 * article "Não iniciado".
 */

export type OutlineRunState =
  | { status: 'loading' }
  | { status: 'running' }
  | { status: 'ready'; runId: RunId; proposal: OutlineProposal }
  | { status: 'failed'; message?: string };

export type OutlineRun = {
  state: OutlineRunState;
  /** A new outline run ("Tentar de novo", or the Pauta changed). */
  restart: () => Promise<void>;
  /** The run this page started (Pauta → "Montar estrutura" starts it before step 3 opens). */
  adopt: (runId: RunId) => void;
};

function latestOutlineRunId(detail: ProductionDetail | undefined, pieceId: PieceId | undefined): RunId | undefined {
  if (!detail || !pieceId) return undefined;
  const runs = detail.runs.filter((run) => isPlanningRun(run) && run.pieceId === pieceId);
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return runs[0]?.id;
}

export function useOutlineRun(productionId: ProductionId | undefined, detail: ProductionDetail | undefined, enabled: boolean): OutlineRun {
  const commands = useCommands();
  const pieceId = detail?.pieces.find((piece) => piece.kind === 'article')?.id;
  const [started, setStarted] = useState<RunId | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const autoStarted = useRef(false);

  const runId = started ?? latestOutlineRunId(detail, pieceId);
  const run = useRun(runId);

  const start = async () => {
    if (!productionId || !pieceId) return;
    setStarting(true);
    setRefusal(undefined);
    const simulation = takeArmedSimulation('article.outline');
    const result = await commands.generation.start('article.outline', { productionId, pieceId }, simulation ? { simulation } : undefined);
    setStarting(false);
    if (result.ok) setStarted(result.value.runId);
    else setRefusal(result.refusal.message);
  };

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
      state = { status: 'failed', message: fold.run.error?.message };
    } else state = { status: 'running' };
  }

  return { state, restart: start, adopt };
}
