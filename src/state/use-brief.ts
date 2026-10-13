'use client';

import { useCallback, useState } from 'react';
import type { ProductionId } from '../domain/ids.ts';
import type { Brief } from '../domain/production.ts';
import { refuse } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { BriefInput, BriefRefusal } from '../ports/production-commands.ts';
import { useProduction } from './use-queries.ts';
import { useCommands } from './use-runtime.ts';

/**
 * A08 · the brief ("pauta": orientação editorial, seções, tamanho) as an editable value, for
 * Material and the studio's "Estrutura" tab. A form keeps the revision it was opened from and
 * saves over it: when another tab (or person) saved the brief meanwhile, the save is refused
 * (`conflict`) instead of overwriting it; `brief` already holds the newer one, so the form can
 * show it and let the person save again on top of it. "Gerar nova versão" uses the saved brief.
 */

export type BriefEditor = {
  /** The saved brief (undefined while the production loads). */
  brief: Brief | undefined;
  /** Characters of the longest article the material supports, when known (`ProductionDetail.charsAvailable`). */
  charsAvailable: number | undefined;
  saving: boolean;
  /** The last save was refused because the brief changed after the form opened. */
  conflict: boolean;
  /** Saves `input` over `baseRevision` (the revision the form was opened with). */
  save(input: BriefInput, baseRevision: number): Promise<Result<Brief, BriefRefusal>>;
  /** The form reloaded the newer brief: the conflict is resolved. */
  clearConflict(): void;
};

export function useBrief(productionId: ProductionId | null | undefined): BriefEditor {
  const commands = useCommands();
  const production = useProduction(productionId);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const save = useCallback(
    async (input: BriefInput, baseRevision: number): Promise<Result<Brief, BriefRefusal>> => {
      if (!productionId) return refuse('not_found', 'Não encontramos esta produção.');
      setSaving(true);
      const result = await commands.production.updateBrief(productionId, input, baseRevision);
      setSaving(false);
      setConflict(!result.ok && result.refusal.code === 'conflict');
      return result;
    },
    [commands, productionId],
  );

  const clearConflict = useCallback(() => setConflict(false), []);
  return { brief: production.data?.brief, charsAvailable: production.data?.charsAvailable, saving, conflict, save, clearConflict };
}
