/**
 * Client state layer: the only door from screens to the runtime. Screens read through the query
 * hooks, act through `useCommands`, and never import adapters, fixtures or the runtime itself.
 */

export { RuntimeProvider } from './runtime-provider.tsx';
export { useCommands, useRuntime, useSaveStatus, useSimulation } from './use-runtime.ts';
export type { RuntimeStatus, SimulationControls } from './use-runtime.ts';
export {
  useActivity,
  useCompare,
  useDelivery,
  useFeedback,
  useOverview,
  usePeople,
  usePiece,
  useProduction,
  useProductions,
  useQuery,
  useReview,
  useSession,
  useSource,
  useVersion,
} from './use-queries.ts';
export { useRun, useRunListener, useRunOutcomes } from './use-runs.ts';
export { useAudit, useAuditControls, useAuditEvent } from './use-audit.ts';
export type { AuditControls } from './use-audit.ts';
export { useVote } from './use-vote.ts';
export { useTabSync } from './use-tab-sync.ts';
export { useBrief } from './use-brief.ts';
export type { BriefEditor } from './use-brief.ts';
export type { TabSyncState } from './use-tab-sync.ts';
export type { VoteState } from './use-vote.ts';
export { useAsset, useAssetLimits, useAssetLookup, useAssets, useAssetUrl } from './use-assets.ts';
export type { Commands } from './commands.ts';
export type { QueryError, QueryState, QueryStatus } from './query-state.ts';
export type { RuntimeQuery, SessionData } from './query-specs.ts';
export type { RunState } from './run-store.ts';
