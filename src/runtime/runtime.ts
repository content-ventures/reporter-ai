import type { AssetId, IsoDateTime, RunId } from '../domain/ids.ts';
import type { AssetStore } from '../ports/assets.ts';
import type { AuditQueries } from '../ports/audit.ts';
import type { ChangeListener, Unsubscribe } from '../ports/common.ts';
import type { ExportService } from '../ports/export.ts';
import type { FeedbackPort } from '../ports/feedback.ts';
import type { GenerationService } from '../ports/generation.ts';
import type { ProductionCommands } from '../ports/production-commands.ts';
import type { ProductionQueries } from '../ports/production-queries.ts';
import type { RenderService } from '../ports/render.ts';
import type { SaveStatusPort } from '../ports/save-status.ts';
import type { SessionMode, SessionPort } from '../ports/session.ts';
import type { SourceIngest } from '../ports/source-ingest.ts';
import type { Clock, IdGenerator } from '../ports/system.ts';

/**
 * What the screens run on: port implementations only. `createRuntime()` composes the local
 * simulated adapters today; a remote runtime (backend + AI provider) will return the same shape,
 * so `src/state` and every screen stay untouched when it is plugged in.
 */

export type RuntimeMode = SessionMode;

/** Structural key-value storage (browser `localStorage`, or a test double). */
export type RuntimeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Simulated mode only: how the demo workspace was opened and what happened to its runs. */
export type SimulationInfo = {
  /** Fresh fixtures (first visit, `?reset=1`) or the snapshot saved in this browser. */
  loadedFrom: 'fixtures' | 'snapshot';
  /** Seeded runs that were mid-stream and continue in place (the flagship "Gerando" on load). */
  adoptedRunIds: RunId[];
  /** Runs a previous page load left streaming, closed as "interrompida" with their partial. */
  recoveredRunIds: RunId[];
};

/**
 * This tab and the other tabs of the browser that share the saved workspace (A10). `active`:
 * changes saved by another tab reload here at once. `elsewhere`: another tab saved over work in
 * progress here (the same text edited in two tabs), so this tab stopped saving; it is read-only
 * until the person chooses "Usar esta aba", which reloads what the other tab saved.
 */
export type TabState =
  | { status: 'active' }
  | { status: 'elsewhere'; reason: 'same-draft' | 'write-race'; since: IsoDateTime };

export type TabSync = {
  current(): TabState;
  subscribe(listener: (state: TabState) => void): Unsubscribe;
  /** "Usar esta aba". */
  claim(): void;
};

export type Runtime = {
  readonly mode: RuntimeMode;
  readonly queries: ProductionQueries;
  readonly commands: ProductionCommands;
  readonly ingest: SourceIngest;
  readonly generation: GenerationService;
  readonly render: RenderService;
  readonly export: ExportService;
  readonly session: SessionPort;
  readonly feedback: FeedbackPort;
  /** Save status of the workspace AND its images (an image that could not be stored is a save error). */
  readonly saveStatus: SaveStatusPort;
  /** Article images (cover and figures): bytes, credit and rights. */
  readonly assets: AssetStore;
  /** Audit trail (Logs, F1.7): read-only, admins only. */
  readonly audit: AuditQueries;
  /** Other tabs of this browser on the same saved workspace ("Aberta em outra aba"). */
  readonly tabs: TabSync;
  /** Every image a draft or a version of any production uses (the rest can be deleted to free space). */
  usedAssetIds(): ReadonlySet<AssetId>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Present only in simulated mode. */
  readonly simulation?: SimulationInfo;
  /** Resolves once start-up work (continuing seeded runs, recovering orphans, opening the image store) has settled. */
  readonly ready: Promise<void>;
  /** Every change notice: commands, runs settling, session switches, resets. */
  subscribe(listener: ChangeListener): Unsubscribe;
  /** Writes coalesced changes now (route change, `pagehide`). A remote runtime may no-op. */
  flush(): void;
  /** Stops background work and releases listeners; the runtime must not be used afterwards. */
  dispose(): void;
};
