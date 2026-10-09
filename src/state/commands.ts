import type { AssetId, PersonId } from '../domain/ids.ts';
import { refuse } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { AssetRefusal, AssetStore, UnusedAssets } from '../ports/assets.ts';
import type { ExportService } from '../ports/export.ts';
import type { FeedbackPort } from '../ports/feedback.ts';
import type { GenerationService } from '../ports/generation.ts';
import type { ProductionCommands } from '../ports/production-commands.ts';
import type { RenderService } from '../ports/render.ts';
import type { SaveStatusPort } from '../ports/save-status.ts';
import type { ActAsRefusal, SessionMember } from '../ports/session.ts';
import type { SourceIngest } from '../ports/source-ingest.ts';
import type { Runtime } from '../runtime/runtime.ts';

/**
 * Everything a screen can DO, grouped by port. Each method waits for the runtime, so a handler
 * can call it at any time; results are the ports' own `Result`s with pt-BR refusals. Changes
 * reach the screens through the change notices, never through these return values alone.
 */

export type Commands = {
  production: ProductionCommands;
  generation: Pick<GenerationService, 'start' | 'cancel' | 'resume' | 'retry'>;
  export: Pick<ExportService, 'plan' | 'build' | 'buildFile'>;
  ingest: Pick<SourceIngest, 'read' | 'analyze'>;
  /** "Retorno do piloto" (`record`) and 👍/👎 on AI output (`vote`, one per person and target). */
  feedback: Pick<FeedbackPort, 'record' | 'vote'>;
  /** Slides as PNG (`render`) and the template library's images: card covers (`thumbnail`) and every layout (`preview`). */
  render: Pick<RenderService, 'render' | 'thumbnail' | 'preview'>;
  /**
   * Article images: "Inserir imagem" / "Definir como destaque" (`put`), credit and rights
   * (`update`), and "Liberar espaço" when the browser storage is full: `unused` says what no draft
   * or version uses, `freeSpace` deletes it. `inUse` adds what the screen holds but has not saved
   * yet (the text being edited, images an undo can bring back).
   */
  assets: Pick<AssetStore, 'put' | 'update'> & {
    unused(inUse?: Iterable<AssetId>): Promise<UnusedAssets>;
    freeSpace(inUse?: Iterable<AssetId>): Promise<Result<UnusedAssets, AssetRefusal>>;
  };
  /** "Agir como" (simulated mode only). */
  session: { actAs(personId: PersonId): Promise<Result<SessionMember, ActAsRefusal>> };
  /** "Tentar de novo" after a save error. */
  save: Pick<SaveStatusPort, 'retry'>;
  /** "Usar esta aba": this tab reloads what another tab saved and edits again (A10). */
  tabs: { claim(): Promise<void> };
};

type Methods<T> = { [K in keyof T]: true };

const PRODUCTION_METHODS: Methods<ProductionCommands> = {
  createFromSource: true,
  createBlank: true,
  rename: true,
  updateBrief: true,
  updateSpeakers: true,
  updatePerson: true,
  setMaterialAuthorization: true,
  saveDraft: true,
  createVersion: true,
  restoreVersion: true,
  requestReview: true,
  withdrawReview: true,
  decide: true,
  derive: true,
  decideSuggestion: true,
  recordDelivery: true,
  archive: true,
  recordFeedback: true,
};

const GENERATION_METHODS: Methods<Commands['generation']> = { start: true, cancel: true, resume: true, retry: true };
const EXPORT_METHODS: Methods<Commands['export']> = { plan: true, build: true, buildFile: true };
const INGEST_METHODS: Methods<Commands['ingest']> = { read: true, analyze: true };

type AnyMethod = (...args: unknown[]) => unknown;

/** Refusal of every write while another tab owns the saved workspace ("Aberta em outra aba"). */
export const READ_ONLY_REFUSAL = refuse('read_only', 'Esta produção está aberta em outra aba. Escolha “Usar esta aba” para editar aqui.');

const readOnly = (runtime: Runtime): boolean => runtime.tabs?.current().status === 'elsewhere';

/**
 * A port whose methods resolve the runtime first, then call the same method on it. Methods in
 * `writes` are refused while this tab is read-only (another tab saved over its work).
 */
function deferred<T extends object>(
  whenReady: () => Promise<Runtime>,
  pick: (runtime: Runtime) => T,
  methods: Methods<T>,
  writes: ReadonlySet<string> | 'all' = new Set(),
): T {
  const port: Record<string, AnyMethod> = {};
  for (const name of Object.keys(methods)) {
    port[name] = async (...args: unknown[]) => {
      const runtime = await whenReady();
      if ((writes === 'all' || writes.has(name)) && readOnly(runtime)) return READ_ONLY_REFUSAL;
      const target = pick(runtime) as unknown as Record<string, AnyMethod>;
      return target[name](...args);
    };
  }
  return port as unknown as T;
}

export function createCommands(whenReady: () => Promise<Runtime>): Commands {
  return {
    production: deferred<ProductionCommands>(whenReady, (runtime) => runtime.commands, PRODUCTION_METHODS, 'all'),
    generation: deferred<Commands['generation']>(whenReady, (runtime) => runtime.generation, GENERATION_METHODS, new Set(['start', 'retry', 'resume'])),
    export: deferred<Commands['export']>(whenReady, (runtime) => runtime.export, EXPORT_METHODS),
    ingest: deferred<Commands['ingest']>(whenReady, (runtime) => runtime.ingest, INGEST_METHODS),
    feedback: deferred<Commands['feedback']>(whenReady, (runtime) => runtime.feedback, { record: true, vote: true }, 'all'),
    render: deferred<Commands['render']>(whenReady, (runtime) => runtime.render, { render: true, thumbnail: true, preview: true }),
    assets: {
      ...deferred<Pick<AssetStore, 'put' | 'update'>>(whenReady, (runtime) => runtime.assets, { put: true, update: true }),
      async unused(inUse = []) {
        const runtime = await whenReady();
        return runtime.assets.unused(new Set([...runtime.usedAssetIds(), ...inUse]));
      },
      async freeSpace(inUse = []) {
        const runtime = await whenReady();
        // What the screen holds is saved first, so the workspace snapshot agrees with what stays.
        runtime.flush();
        return runtime.assets.collect(new Set([...runtime.usedAssetIds(), ...inUse]));
      },
    },
    session: {
      async actAs(personId) {
        const { session } = await whenReady();
        if (!session.actAs) return refuse('not_simulated', 'Trocar de pessoa só existe na simulação.');
        return session.actAs(personId);
      },
    },
    save: deferred<Commands['save']>(whenReady, (runtime) => runtime.saveStatus, { retry: true }),
    tabs: {
      async claim() {
        (await whenReady()).tabs?.claim();
      },
    },
  };
}
