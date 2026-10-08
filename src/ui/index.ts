/**
 * Reporter compositions shared by several screens. Everything here is built from the public
 * Design System (`@content-ventures/design-system/v3`) and reads data through `@/state`.
 */
export * from './shell';
export { StatusBadge, statusPresentation, type StatusBadgeProps, type StatusKind, type StatusPresentation, type StatusRef } from './status-badge';
export { RunTrace, runDuration, runSummary, traceSteps, type RunTraceProps, type TraceableRun, type TraceDetail } from './run-trace';
export { Provenance, describeRef, describeRefForWriter, summarizeInputs, type ProvenanceProps, type ProvenanceRun } from './provenance';
export { SourceChipFor, resolveChip, type ResolvedChip, type SourceChipForProps } from './source-chip-for';
export { PersonAvatar, usePerson, type PersonAvatarProps } from './person-avatar';
export { ChecksList, checkProgress, visibleChecks, type ChecksListProps } from './checks-list';
export { StatusBanner, TaskNotice, type BannerAction, type StatusBannerProps } from './status-banner';
export { ApprovalBanner, subjectOf, useWithdrawReview, type ApprovalBannerProps } from './approval-banner';
export { GenerationBanner, type GenerationBannerProps } from './generation-banner';
export { SendForApprovalDialog, type SendForApprovalDialogProps } from './send-for-approval-dialog';
export * from './approval-copy';
export { RelativeTime, useNow, useRelativeTime } from './time';
export {
  charactersAbove,
  formatCharacters,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatLaudas,
  formatLaudasOf,
  formatListDateTime,
  formatShortDate,
  formatSize,
  plural,
  SIZE_OPTIONS,
} from './format';
export { useDocumentTitle, PRODUCT_NAME } from './use-document-title';
export { ICONS, iconFor } from './icons';
export * from './routes';
